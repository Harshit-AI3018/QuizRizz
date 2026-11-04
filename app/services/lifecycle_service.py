from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timezone
from decimal import Decimal
import json
import re
import secrets
from typing import Any, TypeVar
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import Settings
from app.core.hmac_tickets import create_actor_ticket
from app.schemas.auth import AuthenticatedUser
from app.schemas.lifecycle import QuizSessionCreate
from app.services import authoring_service
from app.services.student_service import normalize_option_ids

_SESSION_SELECT = """
    SELECT id, college_id, quiz_id, faculty_user_id, class_id, session_code,
           session_mode, status, start_window_time, end_window_time,
           actual_started_at, actual_ended_at, duration_minutes,
           negative_marking_enabled, negative_penalty, result_visibility,
           results_released_at, created_at, updated_at
    FROM quiz_sessions
"""
_SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_SESSION_PROCEDURES = {
    "activate": "sp_activate_quiz_session",
    "start": "sp_activate_quiz_session",
    "pause": "sp_pause_quiz_session",
    "resume": "sp_resume_quiz_session",
    "complete": "sp_complete_quiz_session",
    "end": "sp_complete_quiz_session",
    "cancel": "sp_cancel_quiz_session",
    "release": "sp_release_session_results",
}
Result = TypeVar("Result")


def _is_admin(actor: AuthenticatedUser) -> bool:
    return "ADMIN" in actor.roles


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Quiz or session not found")


def _clean_procedure_message(original: Any) -> str:
    msg = str(getattr(original, "message", None) or original)
    if "CONTEXT:" in msg:
        msg = msg.split("CONTEXT:")[0]
    for prefix in ("error:", "exception:"):
        idx = msg.lower().find(prefix)
        if idx != -1:
            msg = msg[idx + len(prefix):]
    return msg.strip()


def _procedure_http_error(exc: DBAPIError) -> HTTPException | None:
    original = exc.orig
    sqlstate = getattr(original, "sqlstate", None) or getattr(original, "pgcode", None)
    if sqlstate != "P0001":
        return None

    raw_message = _clean_procedure_message(original)
    low = raw_message.lower()

    if "unauthorized" in low or "authorization failed" in low:
        return HTTPException(status_code=403, detail="Not authorized to perform this operation")
    if "does not exist" in low or "not found" in low:
        return _not_found()
    if "authentication failed" in low:
        return HTTPException(status_code=401, detail="Actor authentication is no longer valid")

    # Specific structural / validation errors from fn_validate_quiz_for_publishing
    if (
        "must contain at least one question" in low
        or "must have" in low
        or "invalid non-positive" in low
        or "invalid negative penalty" in low
        or "blank question text" in low
        or "contains an option with blank text" in low
        or "subject does not match quiz subject" in low
        or "cannot be included in published quiz" in low
    ):
        return HTTPException(status_code=422, detail=raw_message)

    return HTTPException(
        status_code=409,
        detail=raw_message or "The operation is not valid for the current quiz or session state",
    )


async def _commit_mutation(
    connection: AsyncConnection,
    operation: Callable[[], Awaitable[Result]],
) -> Result:
    try:
        result = await operation()
        await connection.commit()
        return result
    except IntegrityError as exc:
        await connection.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The change conflicts with existing quiz or session records",
        ) from exc
    except DBAPIError as exc:
        await connection.rollback()
        translated = _procedure_http_error(exc)
        if translated is not None:
            raise translated from exc
        raise
    except HTTPException:
        await connection.rollback()
        raise


async def _require_faculty_subject_assignment(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    *,
    faculty_user_id: UUID,
    subject_id: UUID,
    class_id: UUID,
) -> None:
    result = await connection.execute(
        text(
            """
            SELECT 1
            FROM classes AS c
            JOIN faculty_assignments AS fa
              ON fa.college_id = c.college_id
             AND fa.class_id = c.id
             AND fa.academic_year_id = c.academic_year_id
            JOIN users AS u
              ON u.id = fa.faculty_user_id
             AND u.college_id = fa.college_id
            WHERE c.college_id = :college_id
              AND c.id = :class_id
              AND fa.faculty_user_id = :faculty_user_id
              AND fa.subject_id = :subject_id
              AND fa.is_active = TRUE
              AND u.is_active = TRUE
              AND EXISTS (
                  SELECT 1
                  FROM user_roles AS ur
                  WHERE ur.college_id = fa.college_id
                    AND ur.user_id = fa.faculty_user_id
                    AND ur.role_code = 'FACULTY'
              )
            LIMIT 1
            """
        ),
        {
            "college_id": actor.college_id,
            "class_id": class_id,
            "faculty_user_id": faculty_user_id,
            "subject_id": subject_id,
        },
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=403,
            detail="The quiz faculty member is not actively assigned to this subject and class",
        )


async def publish_quiz(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    quiz_id: UUID,
    settings: Settings,
) -> Mapping[str, Any]:
    quiz = await authoring_service.get_quiz(connection, actor, quiz_id)

    if quiz["status"] != "DRAFT":
        raise HTTPException(
            status_code=409,
            detail=f"Quiz {quiz_id} is in status {quiz['status']}; only DRAFT quizzes can be published",
        )

    if not _is_admin(actor):
        assignment = await connection.execute(
            text(
                """
                SELECT 1
                FROM faculty_assignments
                WHERE college_id = :college_id
                  AND faculty_user_id = :actor_id
                  AND subject_id = :subject_id
                  AND is_active = TRUE
                LIMIT 1
                """
            ),
            {
                "college_id": actor.college_id,
                "actor_id": actor.id,
                "subject_id": quiz["subject_id"],
            },
        )
        if assignment.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=403,
                detail="No active faculty assignment for this subject",
            )

    questions = quiz.get("questions") or []
    if len(questions) == 0:
        raise HTTPException(
            status_code=422,
            detail="Quiz must contain at least one question before publishing",
        )

    signature = create_actor_ticket(
        user_id=str(actor.id),
        token_version=actor.token_version,
        role="ANY",
        settings=settings,
    )

    async def operation() -> Mapping[str, Any]:
        result = await connection.execute(
            text(
                """
                SELECT quiz_id, status, total_marks
                FROM sp_publish_quiz(:quiz_id, :actor_id, :auth_signature)
                """
            ),
            {
                "quiz_id": quiz_id,
                "actor_id": actor.id,
                "auth_signature": signature,
            },
        )
        return result.mappings().one()

    return await _commit_mutation(connection, operation)


def _new_session_code() -> str:
    return "".join(secrets.choice(_SESSION_CODE_ALPHABET) for _ in range(8))


async def create_session(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: QuizSessionCreate,
) -> Mapping[str, Any]:
    quiz = await authoring_service.get_quiz(connection, actor, payload.quiz_id)
    if quiz["status"] != "PUBLISHED":
        raise HTTPException(status_code=409, detail="Only published quizzes can be scheduled")

    await _require_faculty_subject_assignment(
        connection,
        actor,
        faculty_user_id=quiz["faculty_user_id"],
        subject_id=quiz["subject_id"],
        class_id=payload.class_id,
    )

    duration = (
        payload.duration_minutes
        if payload.duration_minutes is not None
        else quiz["default_duration_minutes"]
    )
    visibility = (
        payload.result_visibility
        if payload.result_visibility is not None
        else quiz["default_result_visibility"]
    )

    async def operation_attempt() -> Mapping[str, Any]:
        session_code = _new_session_code()
        result = await connection.execute(
            text(
                """
                INSERT INTO quiz_sessions (
                    college_id, quiz_id, faculty_user_id, class_id, session_code,
                    session_mode, start_window_time, end_window_time, duration_minutes,
                    negative_marking_enabled, negative_penalty, result_visibility
                ) VALUES (
                    :college_id, :quiz_id, :faculty_user_id, :class_id, :session_code,
                    :session_mode, :start_window_time, :end_window_time, :duration_minutes,
                    :negative_marking_enabled, :negative_penalty, :result_visibility
                )
                RETURNING id
                """
            ),
            {
                "college_id": actor.college_id,
                "quiz_id": payload.quiz_id,
                "faculty_user_id": quiz["faculty_user_id"],
                "class_id": payload.class_id,
                "session_code": session_code,
                "session_mode": payload.session_mode,
                "start_window_time": payload.start_window_time,
                "end_window_time": payload.end_window_time,
                "duration_minutes": duration,
                "negative_marking_enabled": payload.negative_marking_enabled,
                "negative_penalty": payload.negative_penalty,
                "result_visibility": visibility,
            },
        )
        session_id = result.scalar_one()
        return await _get_session(connection, actor, session_id)

    # Retry up to 3 times in case of improbable session_code collision
    for attempt in range(3):
        try:
            return await _commit_mutation(connection, operation_attempt)
        except HTTPException as exc:
            if exc.status_code == 409 and "conflicts" in exc.detail and attempt < 2:
                continue
            raise


async def _get_session(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_id: UUID,
) -> Mapping[str, Any]:
    owner_filter = "" if _is_admin(actor) else "AND faculty_user_id = :actor_id"
    parameters: dict[str, object] = {
        "college_id": actor.college_id,
        "session_id": session_id,
    }
    if not _is_admin(actor):
        parameters["actor_id"] = actor.id
    result = await connection.execute(
        text(
            _SESSION_SELECT
            + f"""
            WHERE college_id = :college_id
              AND id = :session_id
              {owner_filter}
            """
        ),
        parameters,
    )
    session = result.mappings().one_or_none()
    if session is None:
        raise _not_found()
    return session


async def get_session(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_id: UUID,
) -> Mapping[str, Any]:
    return await _get_session(connection, actor, session_id)


async def list_sessions(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    *,
    limit: int = 100,
    offset: int = 0,
    quiz_id: UUID | None = None,
    class_id: UUID | None = None,
    status: str | None = None,
) -> list[Mapping[str, Any]]:
    owner_filter = "" if _is_admin(actor) else "AND faculty_user_id = :actor_id"
    conditions = ["college_id = :college_id"]
    parameters: dict[str, object] = {
        "college_id": actor.college_id,
        "limit": limit,
        "offset": offset,
    }
    if not _is_admin(actor):
        parameters["actor_id"] = actor.id
        conditions.append("faculty_user_id = :actor_id")
    if quiz_id is not None:
        conditions.append("quiz_id = :quiz_id")
        parameters["quiz_id"] = quiz_id
    if class_id is not None:
        conditions.append("class_id = :class_id")
        parameters["class_id"] = class_id
    if status is not None:
        conditions.append("status = :status")
        parameters["status"] = status

    where_clause = " AND ".join(conditions)
    result = await connection.execute(
        text(
            _SESSION_SELECT
            + f"""
            WHERE {where_clause}
            ORDER BY created_at DESC, id
            LIMIT :limit OFFSET :offset
            """
        ),
        parameters,
    )
    return list(result.mappings().all())


async def transition_session(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_id: UUID,
    action: str,
    settings: Settings,
) -> Mapping[str, Any]:
    normalized_action = action.lower()
    if normalized_action not in _SESSION_PROCEDURES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported session lifecycle action '{action}'",
        )

    procedure = _SESSION_PROCEDURES[normalized_action]
    session = await _get_session(connection, actor, session_id)
    current_status = session["status"]

    # 1. Terminal states cannot transition to anything
    if current_status in ("COMPLETED", "CANCELLED"):
        if (
            (current_status == "COMPLETED" and normalized_action in ("complete", "end"))
            or (current_status == "CANCELLED" and normalized_action == "cancel")
        ):
            # Safe idempotent repeat
            return session
        raise HTTPException(
            status_code=409,
            detail=f"Cannot transition session out of terminal status {current_status}",
        )

    # 2. Repeated requests / idempotent handling
    if normalized_action in ("activate", "start") and current_status == "ACTIVE":
        return session
    if normalized_action == "pause" and current_status == "PAUSED":
        return session
    if normalized_action == "resume" and current_status == "ACTIVE":
        return session
    if normalized_action == "release" and session.get("results_released_at") is not None:
        return session

    # 3. State transition validity check
    if normalized_action in ("activate", "start") and current_status != "SCHEDULED":
        raise HTTPException(
            status_code=409,
            detail=f"Session {session_id} is in status {current_status}; only SCHEDULED sessions can be activated",
        )
    if normalized_action == "pause" and current_status != "ACTIVE":
        raise HTTPException(
            status_code=409,
            detail=f"Invalid session transition from {current_status} to PAUSED",
        )
    if normalized_action == "resume" and current_status != "PAUSED":
        raise HTTPException(
            status_code=409,
            detail=f"Invalid session transition from {current_status} to ACTIVE",
        )
    if normalized_action in ("complete", "end") and current_status not in ("ACTIVE", "PAUSED"):
        raise HTTPException(
            status_code=409,
            detail=f"Invalid session transition from {current_status} to COMPLETED",
        )
    if normalized_action == "cancel" and current_status not in ("SCHEDULED", "ACTIVE", "PAUSED"):
        raise HTTPException(
            status_code=409,
            detail=f"Invalid session transition from {current_status} to CANCELLED",
        )
    if normalized_action == "release" and current_status != "COMPLETED":
        raise HTTPException(
            status_code=409,
            detail="Results can only be released for completed sessions",
        )

    # 4. Generate actor ticket and execute stored procedure
    signature = create_actor_ticket(
        user_id=str(actor.id),
        token_version=actor.token_version,
        role="ANY",
        settings=settings,
    )

    async def operation() -> Mapping[str, Any]:
        await connection.execute(
            text(f"SELECT {procedure}(:session_id, :actor_id, :auth_signature)"),
            {
                "session_id": session_id,
                "actor_id": actor.id,
                "auth_signature": signature,
            },
        )
        return await _get_session(connection, actor, session_id)

    res = await _commit_mutation(connection, operation)

    # Post-commit notification to connected session sockets
    try:
        from app.core.ws_hub import fire_and_forget, global_room_hub
        event = {
            "event": "SESSION_STATUS_CHANGED",
            "session_id": str(session_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {
                "session_id": str(session_id),
                "previous_status": current_status,
                "new_status": res["status"],
                "actual_ended_at": (
                    res.get("actual_ended_at").isoformat()
                    if res.get("actual_ended_at")
                    else None
                ),
            },
        }
        fire_and_forget(global_room_hub.broadcast_to_session(session_id, event))
    except Exception:
        pass

    return res


# =============================================================================
# Phase 8: Session Results Reporting & Student Attempt Inspection
# =============================================================================

async def get_session_results(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_id: UUID,
    settings: Settings | None = None,
) -> Mapping[str, Any]:
    session = await _get_session(connection, actor, session_id)

    # Opportunistically finalize any expired IN_PROGRESS attempts for this session
    if settings is not None:
        now = datetime.now(timezone.utc)
        expired_res = await connection.execute(
            text(
                """
                SELECT id, student_user_id
                FROM quiz_attempts
                WHERE session_id = :session_id
                  AND status = 'IN_PROGRESS'
                  AND deadline < :now
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"session_id": session_id, "now": now},
        )
        expired_candidates = list(expired_res.mappings().all())
        if expired_candidates:
            for cand in expired_candidates:
                att_id = cand["id"]
                stud_id = cand["student_user_id"]
                signature = create_actor_ticket(
                    user_id=str(stud_id),
                    token_version=1,
                    role="ANY",
                    settings=settings,
                )
                try:
                    await connection.execute(
                        text(
                            """
                            SELECT final_status, total_score, finalized_at
                            FROM sp_finalize_attempt(:attempt_id, 'AUTO_TIME_EXPIRED', :actor_id, :auth_signature)
                            """
                        ),
                        {
                            "attempt_id": att_id,
                            "actor_id": stud_id,
                            "auth_signature": signature,
                        },
                    )
                except Exception:
                    continue
            await connection.commit()

    # Fetch quiz title and class name
    meta_res = await connection.execute(
        text(
            """
            SELECT q.title AS quiz_title, c.name AS class_name
            FROM quizzes q, classes c
            WHERE q.id = :quiz_id AND c.id = :class_id
            """
        ),
        {"quiz_id": session["quiz_id"], "class_id": session["class_id"]},
    )
    meta = meta_res.mappings().one_or_none()
    quiz_title = meta["quiz_title"] if meta else ""
    class_name = meta["class_name"] if meta else ""

    # Fetch attempts for this session
    attempts_res = await connection.execute(
        text(
            """
            SELECT
                qa.id AS attempt_id,
                qa.student_user_id,
                TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS student_name,
                sp.enrollment_number,
                sp.roll_number,
                qa.status,
                qa.submission_type,
                qa.started_at,
                qa.submitted_at,
                qa.finalized_at,
                qa.total_score,
                qa.total_correct,
                qa.total_incorrect,
                qa.total_unattempted
            FROM quiz_attempts qa
            JOIN users u ON u.id = qa.student_user_id
            LEFT JOIN student_profiles sp ON sp.user_id = qa.student_user_id
            WHERE qa.session_id = :session_id
            ORDER BY qa.total_score DESC NULLS LAST, qa.finalized_at ASC NULLS LAST, qa.started_at ASC
            """
        ),
        {"session_id": session_id},
    )
    attempts = list(attempts_res.mappings().all())

    total_attempts = len(attempts)
    finalized_attempts = sum(1 for a in attempts if a["status"] == "FINALIZED")
    in_progress_attempts = sum(1 for a in attempts if a["status"] == "IN_PROGRESS")

    scores = [Decimal(str(a["total_score"])) for a in attempts if a["total_score"] is not None]
    if scores:
        average_score = round(sum(scores) / len(scores), 2)
        highest_score = max(scores)
        lowest_score = min(scores)
    else:
        average_score = None
        highest_score = None
        lowest_score = None

    return {
        "session_id": session_id,
        "session_code": session["session_code"],
        "quiz_id": session["quiz_id"],
        "quiz_title": quiz_title,
        "class_id": session["class_id"],
        "class_name": class_name,
        "status": session["status"],
        "result_visibility": session["result_visibility"],
        "results_released_at": session.get("results_released_at"),
        "total_attempts": total_attempts,
        "finalized_attempts": finalized_attempts,
        "in_progress_attempts": in_progress_attempts,
        "average_score": average_score,
        "highest_score": highest_score,
        "lowest_score": lowest_score,
        "attempts": attempts,
    }


async def get_session_attempt_result(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_id: UUID,
    attempt_id: UUID,
    settings: Settings,
) -> Mapping[str, Any]:
    # 1. Enforce faculty / admin access to session
    await _get_session(connection, actor, session_id)

    # 2. Verify attempt belongs to this session
    att_res = await connection.execute(
        text("SELECT id, session_id, status FROM quiz_attempts WHERE id = :attempt_id"),
        {"attempt_id": attempt_id},
    )
    attempt = att_res.mappings().one_or_none()
    if attempt is None or attempt["session_id"] != session_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attempt {attempt_id} does not belong to session {session_id}",
        )

    # 3. Call sp_get_student_attempt_results as faculty / admin (privileged)
    signature = create_actor_ticket(
        user_id=str(actor.id),
        token_version=actor.token_version,
        role="ANY",
        settings=settings,
    )
    result = await connection.execute(
        text(
            """
            SELECT attempt_id, status, is_results_released, total_score, question_breakdown
            FROM sp_get_student_attempt_results(:attempt_id, :actor_id, :auth_signature)
            """
        ),
        {"attempt_id": attempt_id, "actor_id": actor.id, "auth_signature": signature},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attempt {attempt_id} results not found",
        )

    raw_breakdown = row["question_breakdown"]
    if isinstance(raw_breakdown, str):
        breakdown_list = json.loads(raw_breakdown)
    elif isinstance(raw_breakdown, list):
        breakdown_list = raw_breakdown
    else:
        breakdown_list = []

    cleaned_breakdown = []
    for item in breakdown_list:
        options = []
        for opt in item.get("options") or []:
            options.append(
                {
                    "option_id": UUID(str(opt["option_id"])),
                    "option_text": opt["option_text"],
                    "display_order": int(opt["display_order"]),
                    "is_correct": bool(opt.get("is_correct", False)),
                }
            )
        cleaned_breakdown.append(
            {
                "question_id": UUID(str(item["question_id"])),
                "sequence_order": int(item["sequence_order"]),
                "question_text": item["question_text"],
                "question_type": item["question_type"],
                "marks": Decimal(str(item["marks"])),
                "awarded_marks": Decimal(str(item.get("awarded_marks", "0.0000"))),
                "is_correct": bool(item.get("is_correct", False)),
                "selected_option_ids": normalize_option_ids(item.get("selected_option_ids")),
                "explanation": item.get("explanation"),
                "options": options,
            }
        )

    return {
        "attempt_id": attempt_id,
        "status": row["status"],
        "is_results_released": bool(row["is_results_released"]),
        "total_score": Decimal(str(row["total_score"])) if row["total_score"] is not None else None,
        "question_breakdown": cleaned_breakdown,
        "message": "Results are available.",
    }
