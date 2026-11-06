from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import re
from typing import Any, TypeVar
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import Settings
from app.core.hmac_tickets import create_actor_ticket
from app.schemas.auth import AuthenticatedUser
from app.schemas.student import (
    StudentAttemptFinalized,
    StudentAttemptRead,
    StudentAttemptResult,
    StudentAttemptStart,
    StudentQuestion,
    StudentResponseSaveRequest,
    StudentResponseSaveResult,
    StudentResultOptionBreakdown,
    StudentResultQuestionBreakdown,
    StudentSavedResponse,
)

Result = TypeVar("Result")
_SESSION_CODE_PATTERN = re.compile(r"^[A-Z0-9]{6,10}$")

_AVAILABLE_SESSIONS_QUERY = """
    SELECT
        qs.id AS session_id,
        qs.session_code,
        qs.quiz_id,
        q.title AS quiz_title,
        q.description AS quiz_description,
        q.subject_id,
        s.name AS subject_name,
        s.code AS subject_code,
        qs.class_id,
        CONCAT(
            b.name, ' - Year ', c.year_of_study,
            ', Semester ', c.semester, ', Section ', c.section
        ) AS class_name,
        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS faculty_name,
        qs.session_mode,
        qs.status,
        qs.start_window_time,
        qs.end_window_time,
        qs.duration_minutes,
        qa.id AS attempt_id,
        qa.status AS attempt_status
    FROM quiz_sessions qs
    JOIN quizzes q ON q.id = qs.quiz_id
    JOIN subjects s ON s.id = q.subject_id
    JOIN classes c ON c.id = qs.class_id
    JOIN branches b ON b.id = c.branch_id AND b.college_id = c.college_id
    JOIN users u ON u.id = qs.faculty_user_id
    JOIN student_enrollments se
      ON se.class_id = qs.class_id
     AND se.student_user_id = :student_id
     AND se.college_id = :college_id
     AND se.is_active = TRUE
    LEFT JOIN quiz_attempts qa
      ON qa.session_id = qs.id
     AND qa.student_user_id = :student_id
    WHERE qs.college_id = :college_id
      AND qs.status IN ('SCHEDULED', 'ACTIVE', 'PAUSED')
    ORDER BY qs.start_window_time ASC, qs.created_at DESC
    LIMIT :limit OFFSET :offset
"""

_JOINED_SESSIONS_QUERY = """
    SELECT
        qs.id AS session_id,
        qs.session_code,
        qs.quiz_id,
        q.title AS quiz_title,
        q.description AS quiz_description,
        q.subject_id,
        s.name AS subject_name,
        s.code AS subject_code,
        qs.class_id,
        CONCAT(
            b.name, ' - Year ', c.year_of_study,
            ', Semester ', c.semester, ', Section ', c.section
        ) AS class_name,
        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS faculty_name,
        qs.session_mode,
        qs.status,
        qs.start_window_time,
        qs.end_window_time,
        qs.duration_minutes,
        qa.id AS attempt_id,
        qa.status AS attempt_status
    FROM quiz_attempts qa
    JOIN quiz_sessions qs ON qs.id = qa.session_id
    JOIN quizzes q ON q.id = qs.quiz_id
    JOIN subjects s ON s.id = q.subject_id
    JOIN classes c ON c.id = qs.class_id
    JOIN branches b ON b.id = c.branch_id AND b.college_id = c.college_id
    JOIN users u ON u.id = qs.faculty_user_id
    WHERE qa.college_id = :college_id
      AND qa.student_user_id = :student_id
    ORDER BY qa.created_at DESC
    LIMIT :limit OFFSET :offset
"""

_SESSION_DETAILS_QUERY = """
    SELECT
        qs.id AS session_id,
        qs.session_code,
        qs.quiz_id,
        q.title AS quiz_title,
        q.description AS quiz_description,
        q.instructions AS quiz_instructions,
        s.name AS subject_name,
        s.code AS subject_code,
        qs.class_id,
        CONCAT(
            b.name, ' - Year ', c.year_of_study,
            ', Semester ', c.semester, ', Section ', c.section
        ) AS class_name,
        TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS faculty_name,
        qs.session_mode,
        qs.status AS session_status,
        qs.start_window_time,
        qs.end_window_time,
        qs.duration_minutes
    FROM quiz_sessions qs
    JOIN quizzes q ON q.id = qs.quiz_id
    JOIN subjects s ON s.id = q.subject_id
    JOIN classes c ON c.id = qs.class_id
    JOIN branches b ON b.id = c.branch_id AND b.college_id = c.college_id
    JOIN users u ON u.id = qs.faculty_user_id
"""


def _not_found(detail: str = "Invalid session code or session not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


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

    if "unauthorized" in low or "does not own" in low:
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this attempt")
    if "does not exist" in low or "not found" in low:
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")
    if "authentication failed" in low:
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Actor authentication is no longer valid")

    if (
        "not currently active" in low
        or "schedule window" in low
        or "deadline has passed" in low
        or "already finalized" in low
        or "cannot save response: attempt is already" in low
    ):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=raw_message)

    if (
        "not part of the active quiz snapshot" in low
        or "does not belong to question" in low
        or "permit at most 1" in low
        or "duplicate option" in low
        or "positive integer" in low
        or "not actively enrolled" in low
    ):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=raw_message)

    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=raw_message)


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
            detail="The change conflicts with existing records",
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


async def _require_student_profile(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> None:
    result = await connection.execute(
        text(
            """
            SELECT 1 FROM student_profiles
            WHERE user_id = :student_id AND college_id = :college_id
            LIMIT 1
            """
        ),
        {"student_id": actor.id, "college_id": actor.college_id},
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a registered student profile in this institution",
        )


async def _require_student_enrollment(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    class_id: UUID,
) -> None:
    result = await connection.execute(
        text(
            """
            SELECT 1 FROM student_enrollments
            WHERE college_id = :college_id
              AND student_user_id = :student_id
              AND class_id = :class_id
              AND is_active = TRUE
            LIMIT 1
            """
        ),
        {
            "college_id": actor.college_id,
            "student_id": actor.id,
            "class_id": class_id,
        },
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student is not actively enrolled in the class for this quiz session",
        )


def _build_lobby_status(
    session: Mapping[str, Any],
    attempt: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    session_status = session["session_status"]
    is_joined = True

    if session_status == "SCHEDULED":
        lobby_status = "WAITING_FOR_TEACHER"
        is_waiting = True
        message = "You have joined the lobby. Waiting for the teacher to activate the session."
    elif session_status == "ACTIVE":
        lobby_status = "READY_TO_START"
        is_waiting = False
        message = "The quiz session is active. You may begin your attempt."
    elif session_status == "PAUSED":
        lobby_status = "SESSION_PAUSED"
        is_waiting = True
        message = "The quiz session is currently paused by the teacher."
    elif session_status == "COMPLETED":
        lobby_status = "COMPLETED"
        is_waiting = False
        message = "This quiz session has already completed."
    else:
        lobby_status = "CANCELLED"
        is_waiting = False
        message = "This quiz session has been cancelled."

    return {
        "session_id": session["session_id"],
        "session_code": session["session_code"],
        "quiz_id": session["quiz_id"],
        "quiz_title": session["quiz_title"],
        "quiz_description": session["quiz_description"],
        "quiz_instructions": session.get("quiz_instructions"),
        "subject_name": session["subject_name"],
        "subject_code": session["subject_code"],
        "class_name": session["class_name"],
        "faculty_name": session["faculty_name"],
        "session_status": session_status,
        "start_window_time": session["start_window_time"],
        "end_window_time": session["end_window_time"],
        "duration_minutes": session["duration_minutes"],
        "session_mode": session["session_mode"],
        "is_joined": is_joined,
        "is_waiting": is_waiting,
        "lobby_status": lobby_status,
        "message": message,
        "attempt_id": attempt["id"] if attempt else None,
        "attempt_status": attempt["status"] if attempt else None,
    }


async def list_available_sessions(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    *,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    await _require_student_profile(connection, actor)
    result = await connection.execute(
        text(_AVAILABLE_SESSIONS_QUERY),
        {
            "college_id": actor.college_id,
            "student_id": actor.id,
            "limit": limit,
            "offset": offset,
        },
    )
    rows = result.mappings().all()
    sessions: list[dict[str, Any]] = []
    for r in rows:
        d: dict[str, Any] = {str(k): v for k, v in r.items()}
        d["has_attempt"] = d.get("attempt_id") is not None
        d["is_joined"] = d["has_attempt"]
        sessions.append(d)
    return sessions


async def list_joined_sessions(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    *,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    await _require_student_profile(connection, actor)
    result = await connection.execute(
        text(_JOINED_SESSIONS_QUERY),
        {
            "college_id": actor.college_id,
            "student_id": actor.id,
            "limit": limit,
            "offset": offset,
        },
    )
    rows = result.mappings().all()
    sessions: list[dict[str, Any]] = []
    for r in rows:
        d: dict[str, Any] = {str(k): v for k, v in r.items()}
        d["has_attempt"] = True
        d["is_joined"] = True
        sessions.append(d)
    return sessions


async def join_session_by_code(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_code: str,
) -> dict[str, Any]:
    await _require_student_profile(connection, actor)

    clean_code = session_code.strip().upper()
    if not _SESSION_CODE_PATTERN.match(clean_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid session code format: must be 6 to 10 alphanumeric characters",
        )

    result = await connection.execute(
        text(
            _SESSION_DETAILS_QUERY
            + """
            WHERE qs.session_code = :session_code
              AND qs.college_id = :college_id
            """
        ),
        {
            "session_code": clean_code,
            "college_id": actor.college_id,
        },
    )
    session = result.mappings().one_or_none()
    if session is None:
        raise _not_found()

    current_status = session["session_status"]
    if current_status == "CANCELLED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz session has been cancelled",
        )
    if current_status == "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz session has already completed",
        )

    await _require_student_enrollment(connection, actor, session["class_id"])

    attempt_res = await connection.execute(
        text(
            """
            SELECT id, status
            FROM quiz_attempts
            WHERE session_id = :session_id
              AND student_user_id = :student_id
            """
        ),
        {
            "session_id": session["session_id"],
            "student_id": actor.id,
        },
    )
    attempt = attempt_res.mappings().one_or_none()

    return _build_lobby_status(
        {str(k): v for k, v in session.items()},
        {str(k): v for k, v in attempt.items()} if attempt is not None else None,
    )


async def get_session_lobby(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_id: UUID,
) -> dict[str, Any]:
    await _require_student_profile(connection, actor)

    result = await connection.execute(
        text(
            _SESSION_DETAILS_QUERY
            + """
            WHERE qs.id = :session_id
              AND qs.college_id = :college_id
            """
        ),
        {
            "session_id": session_id,
            "college_id": actor.college_id,
        },
    )
    session = result.mappings().one_or_none()
    if session is None:
        raise _not_found("Session not found")

    await _require_student_enrollment(connection, actor, session["class_id"])

    attempt_res = await connection.execute(
        text(
            """
            SELECT id, status
            FROM quiz_attempts
            WHERE session_id = :session_id
              AND student_user_id = :student_id
            """
        ),
        {
            "session_id": session["session_id"],
            "student_id": actor.id,
        },
    )
    attempt = attempt_res.mappings().one_or_none()

    return _build_lobby_status(
        {str(k): v for k, v in session.items()},
        {str(k): v for k, v in attempt.items()} if attempt is not None else None,
    )


# =============================================================================
# PHASE 7: QUIZ ATTEMPT ENGINE & AUTOSAVE
# =============================================================================

async def start_quiz_attempt(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    session_id: UUID,
    settings: Settings,
) -> dict[str, Any]:
    await _require_student_profile(connection, actor)

    # 1. Verify session exists in student's college
    session_res = await connection.execute(
        text(
            """
            SELECT id, status, class_id, duration_minutes
            FROM quiz_sessions
            WHERE id = :session_id AND college_id = :college_id
            """
        ),
        {"session_id": session_id, "college_id": actor.college_id},
    )
    session = session_res.mappings().one_or_none()
    if session is None:
        raise _not_found("Session not found")

    # 2. Verify session is currently ACTIVE
    if session["status"] != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot start attempt: Session is not currently ACTIVE (current status: {session['status']})",
        )

    # 3. Verify student enrollment
    await _require_student_enrollment(connection, actor, session["class_id"])

    # 4. Verify student has not already finalized an attempt
    existing_attempt = await connection.execute(
        text(
            """
            SELECT id, status
            FROM quiz_attempts
            WHERE session_id = :session_id AND student_user_id = :student_id
            """
        ),
        {"session_id": session_id, "student_id": actor.id},
    )
    att_row = existing_attempt.mappings().one_or_none()
    if att_row and att_row["status"] == "FINALIZED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz attempt has already been finalized",
        )

    # 5. Generate HMAC actor ticket
    signature = create_actor_ticket(
        user_id=str(actor.id),
        token_version=actor.token_version,
        role="STUDENT",
        settings=settings,
    )

    async def operation() -> dict[str, Any]:
        result = await connection.execute(
            text(
                """
                SELECT attempt_id, status, deadline, duration_minutes, snapshot_questions
                FROM sp_start_quiz_attempt(:session_id, :actor_id, :auth_signature)
                """
            ),
            {
                "session_id": session_id,
                "actor_id": actor.id,
                "auth_signature": signature,
            },
        )
        row = result.mappings().one()
        return {str(k): v for k, v in row.items()}

    attempt_data = await _commit_mutation(connection, operation)

    # Post-commit notification to faculty monitor
    try:
        from app.core.ws_hub import fire_and_forget, global_room_hub
        fire_and_forget(
            global_room_hub.broadcast_to_faculty(
                session_id,
                {
                    "event": "ATTEMPT_STATUS_CHANGED",
                    "session_id": str(session_id),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "student_user_id": str(actor.id),
                        "attempt_id": str(attempt_data["attempt_id"]),
                        "attempt_status": "IN_PROGRESS",
                        "submission_type": None,
                        "answered_count": 0,
                    },
                },
            )
        )
    except Exception:
        pass

    # Parse questions payload
    raw_questions = attempt_data["snapshot_questions"]
    if isinstance(raw_questions, str):
        questions = json.loads(raw_questions)
    else:
        questions = raw_questions or []

    # Fetch any already saved responses (idempotency / reconnection)
    responses_res = await connection.execute(
        text(
            """
            SELECT attempt_id, question_id, selected_option_ids, is_marked_for_review,
                   client_version, client_submitted_at, server_received_at
            FROM student_responses
            WHERE attempt_id = :attempt_id
            ORDER BY server_received_at ASC
            """
        ),
        {"attempt_id": attempt_data["attempt_id"]},
    )
    saved_responses = list(responses_res.mappings().all())

    return {
        "attempt_id": attempt_data["attempt_id"],
        "session_id": session_id,
        "status": attempt_data["status"],
        "deadline": attempt_data["deadline"],
        "duration_minutes": attempt_data["duration_minutes"],
        "questions": questions,
        "saved_responses": saved_responses,
    }


async def get_attempt(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    attempt_id: UUID,
) -> dict[str, Any]:
    await _require_student_profile(connection, actor)

    result = await connection.execute(
        text(
            """
            SELECT qa.id AS attempt_id, qa.session_id, qa.status, qa.started_at, qa.deadline,
                   qs.duration_minutes
            FROM quiz_attempts qa
            JOIN quiz_sessions qs ON qs.id = qa.session_id
            WHERE qa.id = :attempt_id
              AND qa.college_id = :college_id
              AND qa.student_user_id = :student_id
            """
        ),
        {
            "attempt_id": attempt_id,
            "college_id": actor.college_id,
            "student_id": actor.id,
        },
    )
    attempt = result.mappings().one_or_none()
    if attempt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz attempt not found",
        )

    now = datetime.now(timezone.utc)
    deadline = attempt["deadline"]
    is_expired = now > deadline
    time_remaining = max(0, int((deadline - now).total_seconds()))

    return {
        "attempt_id": attempt["attempt_id"],
        "session_id": attempt["session_id"],
        "status": attempt["status"],
        "started_at": attempt["started_at"],
        "deadline": deadline,
        "duration_minutes": attempt["duration_minutes"],
        "is_expired": is_expired,
        "time_remaining_seconds": time_remaining,
    }


async def get_attempt_questions(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    attempt_id: UUID,
) -> list[dict[str, Any]]:
    await _require_student_profile(connection, actor)

    # Query questions and options through authorized relational tables to avoid
    # 42501 permission denied on quiz_sessions.snapshot_json (column-level security restricted)
    result = await connection.execute(
        text(
            """
            SELECT
                qa.id AS attempt_id,
                q.id AS question_id,
                qq.sequence_order,
                q.question_type,
                q.question_text,
                COALESCE(qq.marks_override, q.default_marks) AS marks,
                CASE
                    WHEN COALESCE(qs.negative_marking_enabled, qq.negative_marking_enabled_override, qz.default_negative_marking_enabled, FALSE) = FALSE THEN 0.000000
                    WHEN qs.negative_penalty IS NOT NULL THEN qs.negative_penalty
                    WHEN qq.negative_penalty_override IS NOT NULL THEN qq.negative_penalty_override
                    WHEN qz.default_negative_penalty IS NOT NULL THEN qz.default_negative_penalty
                    ELSE q.default_negative_penalty
                END AS negative_penalty,
                qo.id AS option_id,
                qo.option_text,
                qo.display_order
            FROM quiz_attempts qa
            JOIN quiz_sessions qs ON qs.id = qa.session_id
            JOIN quizzes qz ON qz.id = qs.quiz_id
            JOIN quiz_questions qq ON qq.quiz_id = qz.id
            JOIN questions q ON q.id = qq.question_id
            JOIN question_options qo ON qo.question_id = q.id
            WHERE qa.id = :attempt_id
              AND qa.college_id = :college_id
              AND qa.student_user_id = :student_id
            ORDER BY qq.sequence_order ASC, qo.display_order ASC
            """
        ),
        {
            "attempt_id": attempt_id,
            "college_id": actor.college_id,
            "student_id": actor.id,
        },
    )
    rows = result.mappings().all()

    if not rows:
        # Check if attempt exists for this student and college
        att_check = await connection.execute(
            text(
                """
                SELECT id
                FROM quiz_attempts
                WHERE id = :attempt_id
                  AND college_id = :college_id
                  AND student_user_id = :student_id
                """
            ),
            {
                "attempt_id": attempt_id,
                "college_id": actor.college_id,
                "student_id": actor.id,
            },
        )
        if att_check.mappings().one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Quiz attempt not found",
            )
        return []

    questions_map: dict[UUID, dict[str, Any]] = {}
    for r in rows:
        qid = r["question_id"]
        if qid not in questions_map:
            questions_map[qid] = {
                "question_id": qid,
                "sequence_order": r["sequence_order"],
                "question_type": r["question_type"],
                "question_text": r["question_text"],
                "marks": r["marks"],
                "negative_penalty": r["negative_penalty"],
                "options": [],
            }
        if r.get("option_id") is not None:
            questions_map[qid]["options"].append({
                "option_id": r["option_id"],
                "option_text": r["option_text"],
                "display_order": r["display_order"],
            })
    return list(questions_map.values())


async def get_saved_responses(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    attempt_id: UUID,
) -> list[dict[str, Any]]:
    # Verify attempt ownership & student profile (get_attempt calls _require_student_profile)
    await get_attempt(connection, actor, attempt_id)

    result = await connection.execute(
        text(
            """
            SELECT sr.attempt_id, sr.question_id, sr.selected_option_ids, sr.is_marked_for_review,
                   sr.client_version, sr.client_submitted_at, sr.server_received_at
            FROM student_responses sr
            JOIN quiz_attempts qa ON qa.id = sr.attempt_id
            WHERE sr.attempt_id = :attempt_id
              AND qa.college_id = :college_id
              AND qa.student_user_id = :student_id
            ORDER BY sr.server_received_at ASC
            """
        ),
        {
            "attempt_id": attempt_id,
            "college_id": actor.college_id,
            "student_id": actor.id,
        },
    )
    return [{str(k): v for k, v in r.items()} for r in result.mappings().all()]


async def save_student_response(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    attempt_id: UUID,
    payload: StudentResponseSaveRequest,
    settings: Settings,
) -> dict[str, Any]:
    # 1. Verify attempt ownership & active status (get_attempt checks profile)
    attempt = await get_attempt(connection, actor, attempt_id)
    if attempt["status"] != "IN_PROGRESS":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot save response: Attempt is already {attempt['status']}",
        )

    # 2. Authoritative deadline check (plus 15s grace period matching procedure)
    now = datetime.now(timezone.utc)
    if now > (attempt["deadline"] + timedelta(seconds=15)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot save response: Attempt deadline has passed",
        )

    # 3. Generate HMAC actor ticket
    signature = create_actor_ticket(
        user_id=str(actor.id),
        token_version=actor.token_version,
        role="STUDENT",
        settings=settings,
    )

    option_ids_array = [str(uid) for uid in payload.selected_option_ids]

    async def operation() -> dict[str, Any]:
        result = await connection.execute(
            text(
                """
                SELECT result_status AS sync_status, saved_version AS persisted_version
                FROM sp_save_student_response(
                    :attempt_id,
                    :question_id,
                    CAST(:selected_option_ids AS UUID[]),
                    :is_marked_for_review,
                    :client_version,
                    :client_submitted_at,
                    :actor_id,
                    :auth_signature
                )
                """
            ),
            {
                "attempt_id": attempt_id,
                "question_id": payload.question_id,
                "selected_option_ids": option_ids_array,
                "is_marked_for_review": payload.is_marked_for_review,
                "client_version": payload.client_version,
                "client_submitted_at": payload.client_submitted_at or now,
                "actor_id": actor.id,
                "auth_signature": signature,
            },
        )
        row = result.mappings().one()
        return {str(k): v for k, v in row.items()}

    save_result = await _commit_mutation(connection, operation)

    # Post-commit notification to faculty monitor (strictly NO option selections or correctness!)
    try:
        from app.core.ws_hub import fire_and_forget, global_room_hub
        cnt_res = await connection.execute(
            text("SELECT COUNT(*) FROM student_responses WHERE attempt_id = :att_id"),
            {"att_id": attempt_id},
        )
        answered_cnt = cnt_res.scalar() or 0
        fire_and_forget(
            global_room_hub.broadcast_to_faculty(
                attempt["session_id"],
                {
                    "event": "STUDENT_PROGRESS_UPDATED",
                    "session_id": str(attempt["session_id"]),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "student_user_id": str(actor.id),
                        "attempt_id": str(attempt_id),
                        "question_id": str(payload.question_id),
                        "answered_count": answered_cnt,
                        "is_marked_for_review": payload.is_marked_for_review,
                        "client_version": save_result["persisted_version"],
                    },
                },
            )
        )
    except Exception:
        pass
    sync_status = save_result["sync_status"]
    persisted_version = save_result["persisted_version"]

    if sync_status == "VERSION_CONFLICT":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Version conflict: a different response was already saved with this version",
        )
    if sync_status == "STALE_REJECTED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Stale response rejected: incoming version {payload.client_version} is older than persisted version {persisted_version}",
        )

    return {
        "question_id": payload.question_id,
        "sync_status": sync_status,
        "persisted_version": persisted_version,
        "server_received_at": datetime.now(timezone.utc),
    }


def normalize_option_ids(raw_val: Any) -> list[UUID]:
    if not raw_val:
        return []
    if isinstance(raw_val, list):
        return [UUID(str(x)) for x in raw_val if x]
    if isinstance(raw_val, str):
        cleaned = raw_val.strip("{}[]")
        if not cleaned:
            return []
        return [UUID(p.strip().strip('"').strip("'")) for p in cleaned.split(",") if p.strip()]
    return []


# =============================================================================
# Phase 8: Finalization, Scoring Engine & Results
# =============================================================================

async def finalize_student_attempt(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    attempt_id: UUID,
    settings: Settings,
    submission_type: str = "MANUAL",
) -> Mapping[str, Any]:
    # 1. Verify attempt ownership & fetch current state
    attempt = await get_attempt(connection, actor, attempt_id)
    now = datetime.now(timezone.utc)
    effective_sub_type = submission_type

    # 2. Idempotent short-circuit if already FINALIZED
    if attempt["status"] == "FINALIZED":
        is_released = False
        score = None
        try:
            ticket = create_actor_ticket(
                user_id=str(actor.id),
                token_version=actor.token_version,
                role="ANY",
                settings=settings,
            )
            res = await connection.execute(
                text(
                    """
                    SELECT is_results_released, total_score
                    FROM sp_get_student_attempt_results(:attempt_id, :actor_id, :auth_signature)
                    """
                ),
                {"attempt_id": attempt_id, "actor_id": actor.id, "auth_signature": ticket},
            )
            res_row = res.mappings().one_or_none()
            is_released = bool(res_row["is_results_released"]) if res_row else False
            score = res_row["total_score"] if (res_row and is_released) else None
        except Exception:
            is_released = False
            score = None

        return {
            "attempt_id": attempt_id,
            "status": "FINALIZED",
            "submission_type": attempt.get("submission_type") or submission_type,
            "finalized_at": attempt.get("finalized_at") or now,
            "is_results_released": is_released,
            "total_score": score,
            "message": "Attempt is already finalized.",
        }

    # 3. Timeout handling: If deadline passed by > 15s and student called manual, auto-switch to AUTO_TIME_EXPIRED
    if effective_sub_type == "MANUAL":
        if now > (attempt["deadline"] + timedelta(seconds=15)):
            effective_sub_type = "AUTO_TIME_EXPIRED"

    ticket_role = "STUDENT" if effective_sub_type == "MANUAL" else "ANY"
    signature = create_actor_ticket(
        user_id=str(actor.id),
        token_version=actor.token_version,
        role=ticket_role,
        settings=settings,
    )

    async def operation() -> dict[str, Any]:
        result = await connection.execute(
            text(
                """
                SELECT final_status, total_score, finalized_at
                FROM sp_finalize_attempt(:attempt_id, :sub_type, :actor_id, :auth_signature)
                """
            ),
            {
                "attempt_id": attempt_id,
                "sub_type": effective_sub_type,
                "actor_id": actor.id,
                "auth_signature": signature,
            },
        )
        row = result.mappings().one()
        return {str(k): v for k, v in row.items()}

    final_row = await _commit_mutation(connection, operation)

    # Post-commit notification to faculty monitor
    try:
        from app.core.ws_hub import fire_and_forget, global_room_hub
        fire_and_forget(
            global_room_hub.broadcast_to_faculty(
                attempt["session_id"],
                {
                    "event": "ATTEMPT_STATUS_CHANGED",
                    "session_id": str(attempt["session_id"]),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "student_user_id": str(actor.id),
                        "attempt_id": str(attempt_id),
                        "attempt_status": "FINALIZED",
                        "submission_type": effective_sub_type,
                    },
                },
            )
        )
    except Exception:
        pass

    # 4. Check whether results are released
    is_released = False
    score = None
    try:
        res_ticket = create_actor_ticket(
            user_id=str(actor.id),
            token_version=actor.token_version,
            role="ANY",
            settings=settings,
        )
        result_check = await connection.execute(
            text(
                """
                SELECT is_results_released, total_score
                FROM sp_get_student_attempt_results(:attempt_id, :actor_id, :auth_signature)
                """
            ),
            {"attempt_id": attempt_id, "actor_id": actor.id, "auth_signature": res_ticket},
        )
        res_row = result_check.mappings().one_or_none()
        is_released = bool(res_row["is_results_released"]) if res_row else False
        score = final_row["total_score"] if is_released else None
    except Exception:
        is_released = False
        score = None

    return {
        "attempt_id": attempt_id,
        "status": final_row["final_status"],
        "submission_type": effective_sub_type,
        "finalized_at": final_row["finalized_at"],
        "is_results_released": is_released,
        "total_score": score,
        "message": (
            "Attempt finalized successfully."
            if is_released
            else "Attempt submitted successfully. Results will be published by faculty."
        ),
    }


async def get_student_attempt_result(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    attempt_id: UUID,
    settings: Settings,
) -> Mapping[str, Any]:
    # 1. Fetch attempt and verify ownership
    attempt = await get_attempt(connection, actor, attempt_id)
    now = datetime.now(timezone.utc)

    # 2. If IN_PROGRESS, check deadline
    if attempt["status"] == "IN_PROGRESS":
        if now > attempt["deadline"]:
            # Auto-expire the attempt
            await finalize_student_attempt(
                connection,
                actor,
                attempt_id,
                settings,
                submission_type="AUTO_TIME_EXPIRED",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Quiz attempt is still in progress and deadline has not expired",
            )

    # 3. Call sp_get_student_attempt_results
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

    is_released = bool(row["is_results_released"])
    if not is_released:
        return {
            "attempt_id": attempt_id,
            "status": row["status"],
            "is_results_released": False,
            "total_score": None,
            "question_breakdown": None,
            "message": "Results are not yet released for this session.",
        }

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
        "is_results_released": True,
        "total_score": Decimal(str(row["total_score"])) if row["total_score"] is not None else None,
        "question_breakdown": cleaned_breakdown,
        "message": "Results are available.",
    }


async def sweep_expired_attempts(
    connection: AsyncConnection,
    settings: Settings,
    batch_size: int = 100,
) -> list[UUID]:
    """
    Sweeper process: finds and finalizes all expired IN_PROGRESS attempts across all sessions.
    Safe for concurrent execution: uses FOR UPDATE SKIP LOCKED on candidates.
    Idempotent: sp_finalize_attempt guarantees no duplicate scoring.
    """
    now = datetime.now(timezone.utc)
    res = await connection.execute(
        text(
            """
            SELECT id, student_user_id
            FROM quiz_attempts
            WHERE status = 'IN_PROGRESS'
              AND deadline < :now
            ORDER BY deadline ASC
            LIMIT :batch_size
            FOR UPDATE SKIP LOCKED
            """
        ),
        {"now": now, "batch_size": batch_size},
    )
    candidates = list(res.mappings().all())
    finalized_ids: list[UUID] = []

    for cand in candidates:
        att_id = cand["id"]
        stud_id = cand["student_user_id"]
        # Generate ticket for AUTO_TIME_EXPIRED (uses role="ANY")
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
            finalized_ids.append(att_id)
        except Exception:
            # Continue processing remaining batch items
            continue

    if finalized_ids:
        await connection.commit()

    return finalized_ids
