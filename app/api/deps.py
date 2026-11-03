from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.core.config import Settings
from app.core.security import decode_token
from app.schemas.auth import AuthenticatedUser
from app.services import auth_service

bearer_scheme = HTTPBearer(auto_error=False)


def get_database_engine(request: Request) -> AsyncEngine:
    return request.app.state.engine


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_access_token_payload(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise auth_service.authentication_error()
    try:
        return decode_token(
            credentials.credentials,
            expected_type="access",
            settings=settings,
        )
    except (InvalidTokenError, ValueError, TypeError) as exc:
        raise auth_service.authentication_error() from exc


async def get_database_connection(request: Request) -> AsyncIterator[AsyncConnection]:
    engine = get_database_engine(request)
    async with engine.connect() as connection:
        yield connection


async def get_current_actor(
    payload: Annotated[dict[str, object], Depends(get_access_token_payload)],
    connection: Annotated[AsyncConnection, Depends(get_database_connection)],
) -> AuthenticatedUser:
    return await auth_service.authenticate_payload(connection, payload)


def require_roles(*allowed_roles: str) -> Callable[..., Awaitable[AuthenticatedUser]]:
    async def role_dependency(
        actor: Annotated[AuthenticatedUser, Depends(get_current_actor)],
    ) -> AuthenticatedUser:
        if not set(actor.roles).intersection(allowed_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return actor

    return role_dependency
