from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncConnection

from app.api.deps import get_current_actor, get_database_connection, get_settings
from app.core.config import Settings
from app.core.security import create_ws_ticket_token
from app.schemas.websocket import WebSocketTicketRequest, WebSocketTicketResponse
from app.schemas.auth import (
    AuthenticatedUser,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    UserProfile,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["authentication"])
DatabaseConnection = Annotated[AsyncConnection, Depends(get_database_connection)]


@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    connection: DatabaseConnection,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    return await auth_service.login(connection, request, settings)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: RefreshRequest,
    connection: DatabaseConnection,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    return await auth_service.refresh(
        connection,
        request.refresh_token.get_secret_value(),
        settings,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: RefreshRequest,
    connection: DatabaseConnection,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    await auth_service.revoke_tokens(
        connection,
        request.refresh_token.get_secret_value(),
        settings,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserProfile)
async def current_user(
    user: Annotated[AuthenticatedUser, Depends(get_current_actor)],
) -> UserProfile:
    return auth_service.public_user(user)

@router.post("/ws-ticket", response_model=WebSocketTicketResponse)
async def create_ws_ticket(
    actor: Annotated[AuthenticatedUser, Depends(get_current_actor)],
    settings: Annotated[Settings, Depends(get_settings)],
    request: WebSocketTicketRequest | None = None,
) -> WebSocketTicketResponse:
    session_id_str = str(request.session_id) if request and request.session_id else None
    ticket = create_ws_ticket_token(
        user_id=str(actor.id),
        college_id=str(actor.college_id),
        roles=actor.roles,
        token_version=actor.token_version,
        settings=settings,
        session_id=session_id_str,
        lifetime_seconds=60,
    )
    return WebSocketTicketResponse(ticket=ticket, expires_in=60)
