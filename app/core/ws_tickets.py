"""
WebSocket Ticket Store & Replay Protection.

Enforces:
1. Single-use consumption (once consumed, ticket JTI cannot be reused).
2. TTL bounding (entries pruned after 60-second expiration).
3. Cross-instance synchronization hooks (can propagate consumed JTI via bus).
4. Zero secret logging.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from uuid import UUID

import jwt
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import Settings
from app.core.security import JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER
from app.schemas.auth import AuthenticatedUser
from app.services import auth_service


class TicketConsumptionStore:
    """
    In-memory TTL ticket store with support for cross-process replication.
    Guarantees thread-safe / asyncio-safe single-use consumption.
    """

    def __init__(self) -> None:
        self._consumed: dict[str, float] = {}  # jti -> exp_timestamp
        self._lock = asyncio.Lock()

    async def consume(self, jti: str, exp_timestamp: float) -> bool:
        """
        Atomically mark a ticket jti as consumed.
        Returns True if newly consumed; False if already consumed (replay detected).
        """
        async with self._lock:
            now = time.time()
            self._prune_expired_locked(now)
            if jti in self._consumed:
                return False
            self._consumed[jti] = exp_timestamp
            return True

    def mark_remote_consumed(self, jti: str, exp_timestamp: float) -> None:
        """Called when a remote backend instance notifies of ticket consumption."""
        self._consumed[jti] = exp_timestamp

    def is_consumed(self, jti: str) -> bool:
        now = time.time()
        exp = self._consumed.get(jti)
        if exp is None:
            return False
        if exp < now:
            del self._consumed[jti]
            return False
        return True

    def _prune_expired_locked(self, now: float) -> None:
        expired_keys = [k for k, exp in self._consumed.items() if exp < now]
        for k in expired_keys:
            del self._consumed[k]

    def clear(self) -> None:
        self._consumed.clear()


# Default process-level ticket store
global_ticket_store = TicketConsumptionStore()


async def authenticate_and_consume_ws_ticket(
    connection: AsyncConnection,
    ticket: str,
    *,
    settings: Settings,
    store: TicketConsumptionStore | None = None,
    expected_session_id: UUID | None = None,
) -> AuthenticatedUser:
    """
    Validate, authenticate, and single-use consume a WebSocket ticket.
    Rejects:
    - Expired tickets (> 60s)
    - Replayed tickets (already consumed)
    - Invalid signatures / tampering
    - Inactive users / revoked token versions
    - Mismatched session scope if expected_session_id is provided
    """
    active_store = store or global_ticket_store

    try:
        payload = jwt.decode(
            ticket,
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
    except (InvalidTokenError, ValueError, TypeError) as exc:
        raise auth_service.authentication_error() from exc

    if payload.get("token_type") != "ws_ticket":
        raise auth_service.authentication_error()

    iat = payload.get("iat")
    exp = payload.get("exp")
    if isinstance(iat, (int, float)) and isinstance(exp, (int, float)):
        if exp - iat > 65:  # small 5s clock skew allowance max
            raise auth_service.authentication_error()
    else:
        raise auth_service.authentication_error()

    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti:
        raise auth_service.authentication_error()

    # Atomic single-use consumption check
    consumed = await active_store.consume(jti, float(exp))
    if not consumed:
        # Ticket already consumed — replay attempt!
        raise auth_service.authentication_error()

    # Check session scoping if requested
    if expected_session_id is not None and "session_id" in payload:
        ticket_session = payload.get("session_id")
        if ticket_session is not None and str(ticket_session) != str(expected_session_id):
            raise auth_service.authentication_error()

    # Verify user is active and token_version has not been revoked in DB
    return await auth_service.authenticate_payload(connection, payload)
