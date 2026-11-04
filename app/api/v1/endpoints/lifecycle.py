from collections.abc import Mapping
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncConnection

from app.api.deps import (
    get_current_actor,
    get_database_connection,
    get_settings,
    require_roles,
)
from app.core.config import Settings
from app.schemas.auth import AuthenticatedUser
from app.schemas.lifecycle import (
    QuizPublished,
    QuizSessionCreate,
    QuizSessionRead,
    SessionResultsSummary,
    SessionStatus,
)
from app.schemas.student import StudentAttemptResult
from app.services import lifecycle_service

router = APIRouter(
    tags=["quiz publishing and sessions"],
    dependencies=[Depends(require_roles("FACULTY", "ADMIN"))],
)
DatabaseConnection = Annotated[AsyncConnection, Depends(get_database_connection)]
Actor = Annotated[AuthenticatedUser, Depends(get_current_actor)]
ApplicationSettings = Annotated[Settings, Depends(get_settings)]
SessionAction = Literal[
    "activate",
    "start",
    "pause",
    "resume",
    "complete",
    "end",
    "cancel",
    "release",
]


@router.post(
    "/quizzes/{quiz_id}/publish",
    response_model=QuizPublished,
)
async def publish_quiz(
    quiz_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await lifecycle_service.publish_quiz(connection, actor, quiz_id, settings)


@router.get("/sessions", response_model=list[QuizSessionRead])
async def list_sessions(
    connection: DatabaseConnection,
    actor: Actor,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    quiz_id: Annotated[UUID | None, Query()] = None,
    class_id: Annotated[UUID | None, Query()] = None,
    status: Annotated[SessionStatus | None, Query()] = None,
) -> list[Mapping[str, Any]]:
    return await lifecycle_service.list_sessions(
        connection,
        actor,
        limit=limit,
        offset=offset,
        quiz_id=quiz_id,
        class_id=class_id,
        status=status,
    )


@router.post(
    "/sessions",
    response_model=QuizSessionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    request: QuizSessionCreate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await lifecycle_service.create_session(connection, actor, request)


@router.post(
    "/quizzes/{quiz_id}/sessions",
    response_model=QuizSessionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_session_for_quiz(
    quiz_id: UUID,
    request: QuizSessionCreate,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    if request.quiz_id != quiz_id:
        request = request.model_copy(update={"quiz_id": quiz_id})
    return await lifecycle_service.create_session(connection, actor, request)


@router.get("/sessions/{session_id}", response_model=QuizSessionRead)
async def read_session(
    session_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await lifecycle_service.get_session(connection, actor, session_id)


# -----------------------------------------------------------------------------
# Phase 8: Results Reporting & Faculty Release Endpoints
# -----------------------------------------------------------------------------

@router.get(
    "/sessions/{session_id}/results",
    response_model=SessionResultsSummary,
)
async def get_session_results(
    session_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await lifecycle_service.get_session_results(
        connection,
        actor,
        session_id,
        settings,
    )


@router.get(
    "/sessions/{session_id}/attempts/{attempt_id}/result",
    response_model=StudentAttemptResult,
)
async def get_session_attempt_result(
    session_id: UUID,
    attempt_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await lifecycle_service.get_session_attempt_result(
        connection,
        actor,
        session_id,
        attempt_id,
        settings,
    )


@router.post(
    "/sessions/{session_id}/results/release",
    response_model=QuizSessionRead,
)
async def release_session_results(
    session_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await lifecycle_service.transition_session(
        connection,
        actor,
        session_id,
        "release",
        settings,
    )


@router.post(
    "/sessions/{session_id}/{action}",
    response_model=QuizSessionRead,
)
async def transition_session(
    session_id: UUID,
    action: SessionAction,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await lifecycle_service.transition_session(
        connection,
        actor,
        session_id,
        action,
        settings,
    )
