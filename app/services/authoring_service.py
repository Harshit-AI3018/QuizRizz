from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any, TypeVar
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.schemas.authoring import (
    QuestionCreate,
    QuestionOptionCreate,
    QuestionOptionsReplace,
    QuestionUpdate,
    QuizCreate,
    QuizQuestionInput,
    QuizQuestionsReplace,
    QuizUpdate,
)
from app.schemas.auth import AuthenticatedUser

Result = TypeVar("Result")

_QUESTION_COLUMNS = {
    "question_text",
    "explanation",
    "difficulty",
    "topic",
    "default_marks",
    "default_negative_penalty",
    "is_bank_question",
}
_QUIZ_COLUMNS = {
    "subject_id",
    "title",
    "description",
    "instructions",
    "topic",
    "default_duration_minutes",
    "default_negative_marking_enabled",
    "default_negative_penalty",
    "default_result_visibility",
}
_QUESTION_SELECT = """
    SELECT id, college_id, subject_id, created_by_faculty_id, question_type,
           question_text, explanation, difficulty, topic, default_marks,
           default_negative_penalty, is_bank_question, is_active, created_at, updated_at
    FROM questions
"""
_QUIZ_SELECT = """
    SELECT id, college_id, faculty_user_id, subject_id, title, description,
           instructions, topic, default_duration_minutes, total_marks,
           default_negative_marking_enabled, default_negative_penalty,
           default_result_visibility, status, created_at, updated_at
    FROM quizzes
"""


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
            detail="The change conflicts with existing question or quiz records",
        ) from exc
    except HTTPException:
        await connection.rollback()
        raise


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Question or quiz not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


def _is_admin(actor: AuthenticatedUser) -> bool:
    return "ADMIN" in actor.roles


async def _require_subject_authoring(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    subject_id: UUID,
) -> None:
    if _is_admin(actor):
        return
    result = await connection.execute(
        text(
            """
            SELECT 1
            FROM faculty_assignments AS fa
            JOIN users AS u
              ON u.id = fa.faculty_user_id AND u.college_id = fa.college_id
            WHERE fa.college_id = :college_id
              AND fa.faculty_user_id = :actor_id
              AND fa.subject_id = :subject_id
              AND fa.is_active = TRUE
              AND u.is_active = TRUE
            LIMIT 1
            """
        ),
        {
            "college_id": actor.college_id,
            "actor_id": actor.id,
            "subject_id": subject_id,
        },
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="No active faculty assignment for this subject")


async def _require_question_access(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    question_id: UUID,
) -> Mapping[str, Any]:
    result = await connection.execute(
        text(
            _QUESTION_SELECT
            + """
            WHERE college_id = :college_id AND id = :question_id AND is_active = TRUE
            """
        ),
        {"college_id": actor.college_id, "question_id": question_id},
    )
    question = result.mappings().one_or_none()
    if question is None:
        raise _not_found()
    if (
        not _is_admin(actor)
        and not question["is_bank_question"]
        and question["created_by_faculty_id"] != actor.id
    ):
        raise _not_found()
    await _require_subject_authoring(connection, actor, question["subject_id"])
    return question


async def _require_question_editable(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    question_id: UUID,
) -> Mapping[str, Any]:
    question = await _require_question_access(connection, actor, question_id)
    if not _is_admin(actor) and question["created_by_faculty_id"] != actor.id:
        raise HTTPException(status_code=403, detail="Only the question author can edit this question")
    await connection.execute(
        text(
            """
            SELECT id FROM questions
            WHERE id = :question_id AND college_id = :college_id
            FOR UPDATE
            """
        ),
        {"college_id": actor.college_id, "question_id": question_id},
    )
    linked_result = await connection.execute(
        text(
            """
            SELECT q.id, q.status
                FROM quiz_questions AS qq
                JOIN quizzes AS q
                  ON q.id = qq.quiz_id AND q.college_id = qq.college_id
                WHERE qq.college_id = :college_id
                  AND qq.question_id = :question_id
                ORDER BY q.id
                FOR UPDATE OF q
            """
        ),
        {"college_id": actor.college_id, "question_id": question_id},
    )
    if any(row["status"] != "DRAFT" for row in linked_result.mappings().all()):
        raise _conflict("Questions attached to a published or archived quiz cannot be changed")
    return question


async def _question_response(
    connection: AsyncConnection,
    question: Mapping[str, Any],
) -> dict[str, Any]:
    options_result = await connection.execute(
        text(
            """
            SELECT id, option_text, display_order
            FROM question_options
            WHERE question_id = :question_id
            ORDER BY display_order
            """
        ),
        {"question_id": question["id"]},
    )
    response = dict(question)
    response["options"] = [dict(option) for option in options_result.mappings().all()]
    return response


async def list_questions(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    *,
    subject_id: UUID | None,
    limit: int,
    offset: int,
) -> list[Mapping[str, Any]]:
    if subject_id is not None:
        await _require_subject_authoring(connection, actor, subject_id)
    if _is_admin(actor):
        where_sql = "college_id = :college_id AND is_active = TRUE"
        parameters: dict[str, object] = {
            "college_id": actor.college_id,
            "limit": limit,
            "offset": offset,
        }
        if subject_id is not None:
            where_sql += " AND subject_id = :subject_id"
            parameters["subject_id"] = subject_id
    else:
        where_sql = """
            college_id = :college_id AND is_active = TRUE
            AND EXISTS (
                SELECT 1 FROM faculty_assignments AS fa
                WHERE fa.college_id = questions.college_id
                  AND fa.faculty_user_id = :actor_id
                  AND fa.subject_id = questions.subject_id
                  AND fa.is_active = TRUE
            )
            AND (
                questions.is_bank_question = TRUE
                OR questions.created_by_faculty_id = :actor_id
            )
        """
        parameters = {
            "college_id": actor.college_id,
            "actor_id": actor.id,
            "limit": limit,
            "offset": offset,
        }
        if subject_id is not None:
            where_sql += " AND subject_id = :subject_id"
            parameters["subject_id"] = subject_id
    result = await connection.execute(
        text(
            _QUESTION_SELECT
            + f"""
            WHERE {where_sql}
            ORDER BY created_at DESC, id
            LIMIT :limit OFFSET :offset
            """
        ),
        parameters,
    )
    questions = list(result.mappings().all())
    if not questions:
        return []
    placeholders = ", ".join(f":question_id_{index}" for index in range(len(questions)))
    option_parameters = {
        f"question_id_{index}": question["id"]
        for index, question in enumerate(questions)
    }
    options_result = await connection.execute(
        text(
            f"""
            SELECT id, question_id, option_text, display_order
            FROM question_options
            WHERE question_id IN ({placeholders})
            ORDER BY question_id, display_order
            """
        ),
        option_parameters,
    )
    options_by_question: dict[UUID, list[Mapping[str, Any]]] = {
        question["id"]: [] for question in questions
    }
    for option in options_result.mappings().all():
        options_by_question[option["question_id"]].append(
            {
                "id": option["id"],
                "option_text": option["option_text"],
                "display_order": option["display_order"],
            }
        )
    responses = []
    for question in questions:
        response = dict(question)
        response["options"] = options_by_question[question["id"]]
        responses.append(response)
    return responses


async def get_question(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    question_id: UUID,
) -> Mapping[str, Any]:
    question = await _require_question_access(connection, actor, question_id)
    return await _question_response(connection, question)


def _validate_correct_answers(question_type: str, options: Sequence[QuestionOptionCreate]) -> None:
    correct_count = sum(option.is_correct for option in options)
    if len({option.display_order for option in options}) != len(options):
        raise HTTPException(status_code=422, detail="Option display_order values must be unique")
    if question_type in {"MCQ", "TRUE_FALSE"} and correct_count != 1:
        raise HTTPException(status_code=422, detail="This question type requires exactly one correct option")
    if question_type == "TRUE_FALSE" and len(options) != 2:
        raise HTTPException(status_code=422, detail="TRUE_FALSE questions require exactly two options")
    if question_type == "MULTIPLE_SELECT" and correct_count < 1:
        raise HTTPException(status_code=422, detail="MULTIPLE_SELECT requires at least one correct option")


async def create_question(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: QuestionCreate,
) -> Mapping[str, Any]:
    await _require_subject_authoring(connection, actor, payload.subject_id)
    _validate_correct_answers(payload.question_type, payload.options)
    values = payload.model_dump(exclude={"options"})

    async def operation() -> Mapping[str, Any]:
        result = await connection.execute(
            text(
                """
                INSERT INTO questions (
                    college_id, subject_id, created_by_faculty_id, question_type,
                    question_text, explanation, difficulty, topic, default_marks,
                    default_negative_penalty, is_bank_question
                ) VALUES (
                    :college_id, :subject_id, :created_by_faculty_id, :question_type,
                    :question_text, :explanation, :difficulty, :topic, :default_marks,
                    :default_negative_penalty, :is_bank_question
                )
                RETURNING id
                """
            ),
            {
                **values,
                "college_id": actor.college_id,
                "created_by_faculty_id": actor.id,
            },
        )
        question_id = result.scalar_one()
        option_responses = await _insert_options(
            connection,
            question_id,
            payload.options,
        )
        question_result = await connection.execute(
            text(_QUESTION_SELECT + " WHERE id = :question_id AND college_id = :college_id"),
            {"question_id": question_id, "college_id": actor.college_id},
        )
        question = dict(question_result.mappings().one())
        question["options"] = option_responses
        return question

    return await _commit_mutation(connection, operation)


async def _insert_options(
    connection: AsyncConnection,
    question_id: UUID,
    options: Sequence[QuestionOptionCreate],
) -> list[dict[str, Any]]:
    responses: list[dict[str, Any]] = []
    parameters: list[dict[str, object]] = []
    for option in options:
        option_id = uuid4()
        parameters.append(
            {
                "id": option_id,
                "question_id": question_id,
                "option_text": option.option_text,
                "is_correct": option.is_correct,
                "display_order": option.display_order,
            }
        )
        response = {
            "id": option_id,
            "option_text": option.option_text,
            "display_order": option.display_order,
        }
        responses.append(response)
    await connection.execute(
        text(
            """
            INSERT INTO question_options
                (id, question_id, option_text, is_correct, display_order)
            VALUES
                (:id, :question_id, :option_text, :is_correct, :display_order)
            """
        ),
        parameters,
    )
    return responses


async def update_question(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    question_id: UUID,
    values: Mapping[str, object],
) -> Mapping[str, Any]:
    if not values or not values.keys() <= _QUESTION_COLUMNS:
        raise HTTPException(status_code=422, detail="Invalid fields for this question")
    await _require_question_editable(connection, actor, question_id)
    assignments = ", ".join(f"{field} = :{field}" for field in values)

    async def operation() -> Mapping[str, Any]:
        result = await connection.execute(
            text(
                _QUESTION_SELECT
                + f"""
                WHERE id = :question_id AND college_id = :college_id
                """
            ),
            {"question_id": question_id, "college_id": actor.college_id},
        )
        current = result.mappings().one_or_none()
        if current is None:
            raise _not_found()
        if any(value is None and key not in {"explanation", "topic"} for key, value in values.items()):
            raise HTTPException(status_code=422, detail="Required question fields cannot be null")
        update_result = await connection.execute(
            text(
                f"""
                UPDATE questions SET {assignments}
                WHERE id = :question_id AND college_id = :college_id
                RETURNING id
                """
            ),
            {"question_id": question_id, "college_id": actor.college_id, **values},
        )
        if update_result.scalar_one_or_none() is None:
            raise _not_found()
        updated_result = await connection.execute(
            text(
                _QUESTION_SELECT
                + " WHERE id = :question_id AND college_id = :college_id"
            ),
            {"question_id": question_id, "college_id": actor.college_id},
        )
        updated = dict(updated_result.mappings().one())
        options_result = await connection.execute(
            text(
                """
                SELECT id, option_text, display_order
                FROM question_options WHERE question_id = :question_id
                ORDER BY display_order
                """
            ),
            {"question_id": question_id},
        )
        updated["options"] = list(options_result.mappings().all())
        return updated

    return await _commit_mutation(connection, operation)


async def replace_question_options(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    question_id: UUID,
    payload: QuestionOptionsReplace,
) -> Mapping[str, Any]:
    question = await _require_question_editable(connection, actor, question_id)
    _validate_correct_answers(question["question_type"], payload.options)

    async def operation() -> Mapping[str, Any]:
        await connection.execute(
            text("DELETE FROM question_options WHERE question_id = :question_id"),
            {"question_id": question_id},
        )
        question_result = await connection.execute(
            text(
                _QUESTION_SELECT
                + " WHERE id = :question_id AND college_id = :college_id"
            ),
            {"question_id": question_id, "college_id": actor.college_id},
        )
        updated = dict(question_result.mappings().one())
        updated["options"] = await _insert_options(
            connection,
            question_id,
            payload.options,
        )
        return updated

    return await _commit_mutation(connection, operation)


async def deactivate_question(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    question_id: UUID,
) -> None:
    await _require_question_editable(connection, actor, question_id)

    async def operation() -> None:
        result = await connection.execute(
            text(
                """
                UPDATE questions SET is_active = FALSE
                WHERE id = :question_id AND college_id = :college_id
                RETURNING id
                """
            ),
            {"question_id": question_id, "college_id": actor.college_id},
        )
        if result.scalar_one_or_none() is None:
            raise _not_found()

    await _commit_mutation(connection, operation)


async def _quiz_result(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    quiz_id: UUID,
    *,
    require_draft: bool = False,
) -> dict[str, Any]:
    result = await connection.execute(
        text(
            _QUIZ_SELECT
            + """
            WHERE id = :quiz_id AND college_id = :college_id
            """
        ),
        {"quiz_id": quiz_id, "college_id": actor.college_id},
    )
    quiz = result.mappings().one_or_none()
    if quiz is None or (not _is_admin(actor) and quiz["faculty_user_id"] != actor.id):
        raise _not_found()
    if require_draft and quiz["status"] != "DRAFT":
        raise _conflict("Only draft quizzes can be edited")
    items = await connection.execute(
        text(
            """
            SELECT question_id, sequence_order, marks_override,
                   negative_marking_enabled_override, negative_penalty_override
            FROM quiz_questions
            WHERE college_id = :college_id AND quiz_id = :quiz_id
            ORDER BY sequence_order
            """
        ),
        {"college_id": actor.college_id, "quiz_id": quiz_id},
    )
    response = dict(quiz)
    response["questions"] = list(items.mappings().all())
    return response


async def list_quizzes(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    *,
    limit: int,
    offset: int,
) -> list[Mapping[str, Any]]:
    ownership_clause = "" if _is_admin(actor) else "AND faculty_user_id = :actor_id"
    parameters: dict[str, object] = {
        "college_id": actor.college_id,
        "limit": limit,
        "offset": offset,
    }
    if not _is_admin(actor):
        parameters["actor_id"] = actor.id
    result = await connection.execute(
        text(
            _QUIZ_SELECT
            + f"""
            WHERE college_id = :college_id {ownership_clause}
            ORDER BY created_at DESC, id
            LIMIT :limit OFFSET :offset
            """
        ),
        parameters,
    )
    quizzes = [dict(quiz) for quiz in result.mappings().all()]
    if not quizzes:
        return quizzes
    placeholders = ", ".join(f":quiz_id_{index}" for index in range(len(quizzes)))
    question_parameters = {
        "college_id": actor.college_id,
        **{f"quiz_id_{index}": quiz["id"] for index, quiz in enumerate(quizzes)},
    }
    questions_result = await connection.execute(
        text(
            f"""
            SELECT quiz_id, question_id, sequence_order, marks_override,
                   negative_marking_enabled_override, negative_penalty_override
            FROM quiz_questions
            WHERE college_id = :college_id AND quiz_id IN ({placeholders})
            ORDER BY quiz_id, sequence_order
            """
        ),
        question_parameters,
    )
    questions_by_quiz: dict[UUID, list[Mapping[str, Any]]] = {
        quiz["id"]: [] for quiz in quizzes
    }
    for row in questions_result.mappings().all():
        question = dict(row)
        quiz_id = question.pop("quiz_id")
        questions_by_quiz[quiz_id].append(question)
    for quiz in quizzes:
        quiz["questions"] = questions_by_quiz[quiz["id"]]
    return quizzes


async def get_quiz(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    quiz_id: UUID,
) -> Mapping[str, Any]:
    return await _quiz_result(connection, actor, quiz_id)


async def create_quiz(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    payload: QuizCreate,
) -> Mapping[str, Any]:
    await _require_subject_authoring(connection, actor, payload.subject_id)
    values = payload.model_dump()

    async def operation() -> Mapping[str, Any]:
        result = await connection.execute(
            text(
                """
                INSERT INTO quizzes (
                    college_id, faculty_user_id, subject_id, title, description,
                    instructions, topic, default_duration_minutes,
                    default_negative_marking_enabled, default_negative_penalty,
                    default_result_visibility
                ) VALUES (
                    :college_id, :faculty_user_id, :subject_id, :title, :description,
                    :instructions, :topic, :default_duration_minutes,
                    :default_negative_marking_enabled, :default_negative_penalty,
                    :default_result_visibility
                )
                RETURNING id
                """
            ),
            {
                **values,
                "college_id": actor.college_id,
                "faculty_user_id": actor.id,
            },
        )
        quiz_id = result.scalar_one()
        return await _quiz_result(connection, actor, quiz_id)

    return await _commit_mutation(connection, operation)


async def update_quiz(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    quiz_id: UUID,
    values: Mapping[str, object],
) -> Mapping[str, Any]:
    if not values or not values.keys() <= _QUIZ_COLUMNS:
        raise HTTPException(status_code=422, detail="Invalid fields for this quiz")
    quiz = await _quiz_result(connection, actor, quiz_id, require_draft=True)
    if "subject_id" in values:
        await _require_subject_authoring(connection, actor, values["subject_id"])
    if any(value is None and key not in {"description", "instructions", "topic", "default_negative_penalty"} for key, value in values.items()):
        raise HTTPException(status_code=422, detail="Required quiz fields cannot be null")
    assignments = ", ".join(f"{field} = :{field}" for field in values)

    async def operation() -> Mapping[str, Any]:
        lock_result = await connection.execute(
            text(
                """
                SELECT status FROM quizzes
                WHERE id = :quiz_id AND college_id = :college_id
                  AND (faculty_user_id = :actor_id OR :is_admin = TRUE)
                FOR UPDATE
                """
            ),
            {
                "quiz_id": quiz_id,
                "college_id": actor.college_id,
                "actor_id": actor.id,
                "is_admin": _is_admin(actor),
            },
        )
        locked_quiz = lock_result.mappings().one_or_none()
        if locked_quiz is None:
            raise _not_found()
        if locked_quiz["status"] != "DRAFT":
            raise _conflict("Only draft quizzes can be edited")
        if "subject_id" in values:
            question_count_result = await connection.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM quiz_questions
                        WHERE college_id = :college_id AND quiz_id = :quiz_id
                    )
                    """
                ),
                {"college_id": actor.college_id, "quiz_id": quiz_id},
            )
            if question_count_result.scalar_one():
                raise HTTPException(
                    status_code=422,
                    detail="Remove all quiz questions before changing the quiz subject",
                )
        result = await connection.execute(
            text(
                f"""
                UPDATE quizzes SET {assignments}
                WHERE id = :quiz_id AND college_id = :college_id
                  AND status = 'DRAFT'
                RETURNING id
                """
            ),
            {"quiz_id": quiz_id, "college_id": actor.college_id, **values},
        )
        if result.scalar_one_or_none() is None:
            raise _conflict("Only draft quizzes can be edited")
        return await _quiz_result(connection, actor, quiz["id"])

    return await _commit_mutation(connection, operation)


async def replace_quiz_questions(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    quiz_id: UUID,
    payload: QuizQuestionsReplace,
) -> Mapping[str, Any]:
    quiz = await _quiz_result(connection, actor, quiz_id, require_draft=True)
    await _require_subject_authoring(connection, actor, quiz["subject_id"])

    async def operation() -> Mapping[str, Any]:
        lock_result = await connection.execute(
            text(
                """
                SELECT status, subject_id, faculty_user_id FROM quizzes
                WHERE id = :quiz_id AND college_id = :college_id
                FOR UPDATE
                """
            ),
            {"quiz_id": quiz_id, "college_id": actor.college_id},
        )
        locked_quiz = lock_result.mappings().one_or_none()
        if locked_quiz is None:
            raise _not_found()
        if not _is_admin(actor) and locked_quiz["faculty_user_id"] != actor.id:
            raise _not_found()
        if locked_quiz["status"] != "DRAFT":
            raise _conflict("Only draft quizzes can be edited")
        await _require_subject_authoring(connection, actor, locked_quiz["subject_id"])
        for item in payload.questions:
            question_result = await connection.execute(
                text(
                    """
                    SELECT id
                    FROM questions
                    WHERE id = :question_id
                      AND college_id = :college_id
                      AND subject_id = :subject_id
                      AND is_active = TRUE
                      AND (
                          is_bank_question = TRUE
                          OR created_by_faculty_id = :actor_id
                          OR :is_admin = TRUE
                      )
                    """
                ),
                {
                    "question_id": item.question_id,
                    "college_id": actor.college_id,
                    "subject_id": locked_quiz["subject_id"],
                    "actor_id": actor.id,
                    "is_admin": _is_admin(actor),
                },
            )
            if question_result.scalar_one_or_none() is None:
                raise HTTPException(
                    status_code=422,
                    detail="Every quiz question must be active and belong to the quiz subject",
                )
        await connection.execute(
            text(
                """
                DELETE FROM quiz_questions
                WHERE college_id = :college_id AND quiz_id = :quiz_id
                """
            ),
            {"college_id": actor.college_id, "quiz_id": quiz_id},
        )
        if payload.questions:
            question_parameters = [
                {
                    **item.model_dump(),
                    "college_id": actor.college_id,
                    "quiz_id": quiz_id,
                }
                for item in payload.questions
            ]
            await connection.execute(
                text(
                    """
                    INSERT INTO quiz_questions (
                        college_id, quiz_id, question_id, sequence_order, marks_override,
                        negative_marking_enabled_override, negative_penalty_override
                    ) VALUES (
                        :college_id, :quiz_id, :question_id, :sequence_order, :marks_override,
                        :negative_marking_enabled_override, :negative_penalty_override
                    )
                    """
                ),
                question_parameters,
            )
        return await _quiz_result(connection, actor, quiz_id, require_draft=True)

    return await _commit_mutation(connection, operation)


async def archive_quiz(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
    quiz_id: UUID,
) -> None:
    await _quiz_result(connection, actor, quiz_id)

    async def operation() -> None:
        lock_result = await connection.execute(
            text(
                """
                SELECT status, faculty_user_id
                FROM quizzes
                WHERE id = :quiz_id AND college_id = :college_id
                FOR UPDATE
                """
            ),
            {"quiz_id": quiz_id, "college_id": actor.college_id},
        )
        locked_quiz = lock_result.mappings().one_or_none()
        if locked_quiz is None:
            raise _not_found()
        if not _is_admin(actor) and locked_quiz["faculty_user_id"] != actor.id:
            raise _not_found()
        if locked_quiz["status"] == "ARCHIVED":
            raise _not_found()
        active_sessions = await connection.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM quiz_sessions
                    WHERE college_id = :college_id AND quiz_id = :quiz_id
                      AND status IN ('SCHEDULED', 'ACTIVE', 'PAUSED')
                )
                """
            ),
            {"college_id": actor.college_id, "quiz_id": quiz_id},
        )
        if active_sessions.scalar_one():
            raise _conflict("A quiz with scheduled or active sessions cannot be archived")
        result = await connection.execute(
            text(
                """
                UPDATE quizzes SET status = 'ARCHIVED'
                WHERE id = :quiz_id AND college_id = :college_id
                  AND status <> 'ARCHIVED'
                RETURNING id
                """
            ),
            {"quiz_id": quiz_id, "college_id": actor.college_id},
        )
        if result.scalar_one_or_none() is None:
            raise _not_found()

    await _commit_mutation(connection, operation)


async def list_faculty_assignments(
    connection: AsyncConnection,
    actor: AuthenticatedUser,
) -> list[Mapping[str, Any]]:
    is_admin = _is_admin(actor)
    where_sql = "fa.college_id = :college_id AND fa.is_active = TRUE"
    params: dict[str, Any] = {"college_id": actor.college_id}
    if not is_admin:
        where_sql += " AND fa.faculty_user_id = :faculty_user_id"
        params["faculty_user_id"] = actor.id

    query = f"""
        SELECT
            fa.id,
            fa.college_id,
            fa.faculty_user_id,
            fa.subject_id,
            s.name AS subject_name,
            s.code AS subject_code,
            fa.class_id,
            CONCAT(b.name, ' - Year ', c.year_of_study, ', Sem ', c.semester, ', Sec ', c.section) AS class_name,
            fa.academic_year_id,
            ay.name AS academic_year_name,
            fa.is_active
        FROM faculty_assignments AS fa
        JOIN subjects AS s
          ON s.id = fa.subject_id AND s.college_id = fa.college_id
        JOIN classes AS c
          ON c.id = fa.class_id AND c.college_id = fa.college_id
        JOIN branches AS b
          ON b.id = c.branch_id AND b.college_id = c.college_id
        JOIN academic_years AS ay
          ON ay.id = fa.academic_year_id AND ay.college_id = fa.college_id
        WHERE {where_sql}
        ORDER BY s.name, class_name
    """
    result = await connection.execute(text(query), params)
    return result.mappings().all()
