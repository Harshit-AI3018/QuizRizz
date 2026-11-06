from collections.abc import Mapping
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncConnection

from app.api.deps import get_current_actor, get_database_connection, require_roles
from app.schemas.authoring import (
    FacultyAssignmentRead,
    QuestionCreate,
    QuestionOptionsReplace,
    QuestionRead,
    QuestionUpdate,
    QuizCreate,
    QuizQuestionsReplace,
    QuizRead,
    QuizUpdate,
)
from app.schemas.auth import AuthenticatedUser
from app.services import authoring_service

router = APIRouter(
    tags=["question bank and quiz authoring"],
    dependencies=[Depends(require_roles("FACULTY", "ADMIN"))],
)
DatabaseConnection = Annotated[AsyncConnection, Depends(get_database_connection)]
Actor = Annotated[AuthenticatedUser, Depends(get_current_actor)]


@router.get("/questions", response_model=list[QuestionRead], response_model_exclude_none=True)
async def list_questions(
    connection: DatabaseConnection,
    actor: Actor,
    subject_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Mapping[str, Any]]:
    return await authoring_service.list_questions(
        connection,
        actor,
        subject_id=subject_id,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/questions",
    response_model=QuestionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_question(
    request: QuestionCreate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.create_question(connection, actor, request)


@router.get(
    "/questions/{question_id}",
    response_model=QuestionRead,
    response_model_exclude_none=True,
)
async def read_question(
    question_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.get_question(connection, actor, question_id)


@router.patch(
    "/questions/{question_id}",
    response_model=QuestionRead,
    response_model_exclude_none=True,
)
async def update_question(
    question_id: UUID,
    request: QuestionUpdate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.update_question(
        connection,
        actor,
        question_id,
        request.model_dump(exclude_unset=True),
    )


@router.put(
    "/questions/{question_id}/options",
    response_model=QuestionRead,
)
async def replace_question_options(
    question_id: UUID,
    request: QuestionOptionsReplace,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.replace_question_options(
        connection,
        actor,
        question_id,
        request,
    )


@router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_question(
    question_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Response:
    await authoring_service.deactivate_question(connection, actor, question_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/quizzes", response_model=list[QuizRead])
async def list_quizzes(
    connection: DatabaseConnection,
    actor: Actor,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Mapping[str, Any]]:
    return await authoring_service.list_quizzes(
        connection,
        actor,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/quizzes",
    response_model=QuizRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_quiz(
    request: QuizCreate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.create_quiz(connection, actor, request)


@router.get("/quizzes/{quiz_id}", response_model=QuizRead)
async def read_quiz(
    quiz_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.get_quiz(connection, actor, quiz_id)


@router.patch("/quizzes/{quiz_id}", response_model=QuizRead)
async def update_quiz(
    quiz_id: UUID,
    request: QuizUpdate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.update_quiz(
        connection,
        actor,
        quiz_id,
        request.model_dump(exclude_unset=True),
    )


@router.put("/quizzes/{quiz_id}/questions", response_model=QuizRead)
async def replace_quiz_questions(
    quiz_id: UUID,
    request: QuizQuestionsReplace,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await authoring_service.replace_quiz_questions(
        connection,
        actor,
        quiz_id,
        request,
    )


@router.delete("/quizzes/{quiz_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_quiz(
    quiz_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Response:
    await authoring_service.archive_quiz(connection, actor, quiz_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/faculty/assignments",
    response_model=list[FacultyAssignmentRead],
)
async def list_faculty_assignments(
    connection: DatabaseConnection,
    actor: Actor,
) -> list[Mapping[str, Any]]:
    return await authoring_service.list_faculty_assignments(connection, actor)
