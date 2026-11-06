from collections.abc import Mapping
from typing import Annotated, Any
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
from app.schemas.student import (
    SessionJoinRequest,
    StudentAttemptFinalized,
    StudentAttemptRead,
    StudentAttemptResult,
    StudentAttemptStart,
    StudentLobbyStatus,
    StudentQuestion,
    StudentResponseSaveRequest,
    StudentResponseSaveResult,
    StudentSavedResponse,
    StudentSessionDiscovery,
)
from app.services import student_service

router = APIRouter(
    prefix="/student",
    tags=["student quiz discovery and lobby"],
    dependencies=[Depends(require_roles("STUDENT"))],
)
DatabaseConnection = Annotated[AsyncConnection, Depends(get_database_connection)]
Actor = Annotated[AuthenticatedUser, Depends(get_current_actor)]
ApplicationSettings = Annotated[Settings, Depends(get_settings)]


# -----------------------------------------------------------------------------
# Phase 6: Discovery & Lobby Endpoints
# -----------------------------------------------------------------------------

@router.get("/sessions", response_model=list[StudentSessionDiscovery])
async def list_available_sessions(
    connection: DatabaseConnection,
    actor: Actor,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Mapping[str, Any]]:
    return await student_service.list_available_sessions(
        connection,
        actor,
        limit=limit,
        offset=offset,
    )


@router.get("/sessions/joined", response_model=list[StudentSessionDiscovery])
async def list_joined_sessions(
    connection: DatabaseConnection,
    actor: Actor,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Mapping[str, Any]]:
    return await student_service.list_joined_sessions(
        connection,
        actor,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/sessions/join",
    response_model=StudentLobbyStatus,
    status_code=status.HTTP_200_OK,
)
async def join_session(
    request: SessionJoinRequest,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await student_service.join_session_by_code(
        connection,
        actor,
        request.session_code,
    )


@router.post(
    "/join",
    response_model=StudentLobbyStatus,
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def join_session_alias(
    request: SessionJoinRequest,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await student_service.join_session_by_code(
        connection,
        actor,
        request.session_code,
    )


@router.get(
    "/sessions/{session_id}",
    response_model=StudentLobbyStatus,
)
async def get_session_details(
    session_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await student_service.get_session_lobby(
        connection,
        actor,
        session_id,
    )


@router.get(
    "/sessions/{session_id}/lobby",
    response_model=StudentLobbyStatus,
)
async def get_session_lobby(
    session_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await student_service.get_session_lobby(
        connection,
        actor,
        session_id,
    )


# -----------------------------------------------------------------------------
# Phase 7: Attempt Engine & Autosave Endpoints
# -----------------------------------------------------------------------------

@router.post(
    "/sessions/{session_id}/start",
    response_model=StudentAttemptStart,
    status_code=status.HTTP_200_OK,
)
async def start_quiz_attempt(
    session_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await student_service.start_quiz_attempt(
        connection,
        actor,
        session_id,
        settings,
    )


@router.get(
    "/attempts/{attempt_id}",
    response_model=StudentAttemptRead,
)
async def get_attempt(
    attempt_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> Mapping[str, Any]:
    return await student_service.get_attempt(
        connection,
        actor,
        attempt_id,
    )


@router.get(
    "/attempts/{attempt_id}/questions",
    response_model=list[StudentQuestion],
)
async def get_attempt_questions(
    attempt_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> list[Mapping[str, Any]]:
    return await student_service.get_attempt_questions(
        connection,
        actor,
        attempt_id,
    )


@router.get(
    "/attempts/{attempt_id}/responses",
    response_model=list[StudentSavedResponse],
)
async def get_saved_responses(
    attempt_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
) -> list[Mapping[str, Any]]:
    return await student_service.get_saved_responses(
        connection,
        actor,
        attempt_id,
    )


@router.post(
    "/attempts/{attempt_id}/responses",
    response_model=StudentResponseSaveResult,
    status_code=status.HTTP_200_OK,
)
async def save_student_response(
    attempt_id: UUID,
    payload: StudentResponseSaveRequest,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await student_service.save_student_response(
        connection,
        actor,
        attempt_id,
        payload,
        settings,
    )


# -----------------------------------------------------------------------------
# Phase 8: Quiz Finalization & Results Endpoints
# -----------------------------------------------------------------------------

@router.post(
    "/attempts/{attempt_id}/submit",
    response_model=StudentAttemptFinalized,
    status_code=status.HTTP_200_OK,
)
async def submit_student_attempt(
    attempt_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await student_service.finalize_student_attempt(
        connection,
        actor,
        attempt_id,
        settings,
        submission_type="MANUAL",
    )


@router.get(
    "/attempts/{attempt_id}/result",
    response_model=StudentAttemptResult,
)
async def get_student_attempt_result(
    attempt_id: UUID,
    connection: DatabaseConnection,
    actor: Actor,
    settings: ApplicationSettings,
) -> Mapping[str, Any]:
    return await student_service.get_student_attempt_result(
        connection,
        actor,
        attempt_id,
        settings,
    )
