from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from jwt import InvalidTokenError

from app.core.config import Settings

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "campusquiz-api"
JWT_AUDIENCE = "campusquiz-client"

_password_hasher = PasswordHasher()
_dummy_password_hash = _password_hasher.hash("campusquiz-invalid-user-dummy-password")


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerificationError):
        return False


def verify_password_or_dummy(password_hash: str | None, password: str) -> bool:
    if password_hash is None:
        verify_password(_dummy_password_hash, password)
        return False
    return verify_password(password_hash, password)


def create_token(
    *,
    user_id: str,
    college_id: str,
    roles: list[str],
    token_version: int,
    token_type: str,
    lifetime: timedelta,
    settings: Settings,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "college_id": college_id,
        "roles": roles,
        "token_version": token_version,
        "token_type": token_type,
        "iat": now,
        "exp": now + lifetime,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key.get_secret_value(), algorithm=JWT_ALGORITHM)


def create_token_pair(
    *,
    user_id: str,
    college_id: str,
    roles: list[str],
    token_version: int,
    settings: Settings,
    refresh_token: str | None = None,
) -> tuple[str, str, int]:
    access_lifetime = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_token(
        user_id=user_id,
        college_id=college_id,
        roles=roles,
        token_version=token_version,
        token_type="access",
        lifetime=access_lifetime,
        settings=settings,
    )
    if refresh_token is None:
        refresh_token = create_token(
            user_id=user_id,
            college_id=college_id,
            roles=roles,
            token_version=token_version,
            token_type="refresh",
            lifetime=timedelta(days=settings.refresh_token_expire_days),
            settings=settings,
        )
    return access_token, refresh_token, int(access_lifetime.total_seconds())


def decode_token(token: str, *, expected_type: str, settings: Settings) -> dict[str, Any]:
    payload = jwt.decode(
        token,
        settings.jwt_secret_key.get_secret_value(),
        algorithms=[JWT_ALGORITHM],
        audience=JWT_AUDIENCE,
        issuer=JWT_ISSUER,
        options={
            "require": [
                "sub",
                "college_id",
                "roles",
                "token_version",
                "token_type",
                "iat",
                "exp",
                "jti",
            ]
        },
    )
    if payload.get("token_type") != expected_type:
        raise InvalidTokenError("Unexpected token type")
    if not isinstance(payload.get("roles"), list) or not all(
        isinstance(role, str) for role in payload["roles"]
    ):
        raise InvalidTokenError("Invalid roles claim")
    if type(payload.get("token_version")) is not int or payload["token_version"] < 1:
        raise InvalidTokenError("Invalid token version")
    return payload
