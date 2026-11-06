from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from jwt import InvalidTokenError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import Settings
from app.core.security import (
    create_token_pair,
    decode_token,
    verify_password_or_dummy,
)
from app.schemas.auth import AuthenticatedUser, LoginRequest, TokenResponse, UserProfile

_LOGIN_USER_QUERY = text(
    """
    SELECT id, college_id, email, password_hash, first_name, last_name,
           is_active, must_change_password, token_version
    FROM users
    WHERE college_id = :college_id AND email = :email
    """
)
_ACTIVE_USER_QUERY = text(
    """
    SELECT id, college_id, email, first_name, last_name,
           is_active, must_change_password, token_version
    FROM users
    WHERE id = :user_id
    """
)
_USER_ROLES_QUERY = text(
    """
    SELECT role_code
    FROM user_roles
    WHERE user_id = :user_id AND college_id = :college_id
    ORDER BY role_code
    """
)
_REVOKE_USER_TOKENS_QUERY = text(
    """
    UPDATE users
    SET token_version = token_version + 1
    WHERE id = :user_id
      AND college_id = :college_id
      AND token_version = :token_version
      AND is_active = TRUE
    """
)


def authentication_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def load_authenticated_user(
    connection: AsyncConnection,
    *,
    user_id: UUID,
    college_id: UUID,
) -> AuthenticatedUser | None:
    user_result = await connection.execute(
        _ACTIVE_USER_QUERY,
        {"user_id": user_id},
    )
    user = user_result.mappings().one_or_none()
    if user is None or not user["is_active"] or user["college_id"] != college_id:
        return None

    roles_result = await connection.execute(
        _USER_ROLES_QUERY,
        {"user_id": user_id, "college_id": college_id},
    )
    roles = [row["role_code"] for row in roles_result.mappings().all()]
    if not roles:
        return None
    return AuthenticatedUser(
        id=user["id"],
        college_id=user["college_id"],
        email=user["email"],
        first_name=user["first_name"],
        last_name=user["last_name"],
        roles=roles,
        must_change_password=user["must_change_password"],
        token_version=user["token_version"],
    )


def _token_response(
    user: AuthenticatedUser,
    settings: Settings,
    refresh_token: str | None = None,
) -> TokenResponse:
    access_token, current_refresh_token, expires_in = create_token_pair(
        user_id=str(user.id),
        college_id=str(user.college_id),
        roles=user.roles,
        token_version=user.token_version,
        settings=settings,
        refresh_token=refresh_token,
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=current_refresh_token,
        expires_in=expires_in,
        user=UserProfile.model_validate(user),
    )


async def login(
    connection: AsyncConnection,
    request: LoginRequest,
    settings: Settings,
) -> TokenResponse:
    college_id = (
        request.college_id
        if request.college_id is not None
        else getattr(settings, "default_college_id", UUID("511a5ce7-0665-496a-b246-72bb0821de81"))
    )
    result = await connection.execute(
        _LOGIN_USER_QUERY,
        {"college_id": college_id, "email": request.email},
    )
    user = result.mappings().one_or_none()
    password_valid = verify_password_or_dummy(
        user["password_hash"] if user is not None else None,
        request.password.get_secret_value(),
    )
    if user is None or not password_valid or not user["is_active"]:
        raise authentication_error()

    authenticated_user = await load_authenticated_user(
        connection,
        user_id=user["id"],
        college_id=user["college_id"],
    )
    if authenticated_user is None:
        raise authentication_error()
    return _token_response(authenticated_user, settings)


async def authenticate_token(
    connection: AsyncConnection,
    token: str,
    *,
    expected_type: str,
    settings: Settings,
) -> AuthenticatedUser:
    try:
        payload = decode_token(token, expected_type=expected_type, settings=settings)
    except (InvalidTokenError, ValueError, TypeError) as exc:
        raise authentication_error() from exc

    return await authenticate_payload(connection, payload)


async def authenticate_payload(
    connection: AsyncConnection,
    payload: dict[str, object],
) -> AuthenticatedUser:
    subject = payload.get("sub")
    college = payload.get("college_id")
    token_version = payload.get("token_version")
    if (
        not isinstance(subject, str)
        or not isinstance(college, str)
        or type(token_version) is not int
    ):
        raise authentication_error()
    try:
        user_id = UUID(subject)
        college_id = UUID(college)
    except ValueError as exc:
        raise authentication_error() from exc

    user = await load_authenticated_user(
        connection,
        user_id=user_id,
        college_id=college_id,
    )
    if user is None or user.token_version != token_version:
        raise authentication_error()
    return user


async def refresh(
    connection: AsyncConnection,
    refresh_token: str,
    settings: Settings,
) -> TokenResponse:
    user = await authenticate_token(
        connection,
        refresh_token,
        expected_type="refresh",
        settings=settings,
    )
    return _token_response(user, settings, refresh_token=refresh_token)


async def revoke_tokens(
    connection: AsyncConnection,
    refresh_token: str,
    settings: Settings,
) -> None:
    user = await authenticate_token(
        connection,
        refresh_token,
        expected_type="refresh",
        settings=settings,
    )
    result = await connection.execute(
        _REVOKE_USER_TOKENS_QUERY,
        {
            "user_id": user.id,
            "college_id": user.college_id,
            "token_version": user.token_version,
        },
    )
    if result.rowcount != 1:
        raise authentication_error()
    await connection.commit()


def public_user(user: AuthenticatedUser) -> UserProfile:
    return UserProfile.model_validate(user)
