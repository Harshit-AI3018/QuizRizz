"""
CampusQuiz — Backend HMAC Authentication Token Generator
Generates signed actor context tokens matching PostgreSQL fn_verify_actor_context.
"""
import hashlib
import hmac
import time
from typing import Optional


def generate_auth_signature(
    user_id: str,
    token_version: int,
    role: str = "ANY",
    validity_seconds: int = 300,
    secret: str = "",
    fixed_epoch: Optional[int] = None,
) -> str:
    """
    Generate an HMAC-SHA256 signature ticket matching PostgreSQL fn_verify_actor_context.

    Payload format: "<user_id>:<token_version>:<role_or_ANY>:<expires_epoch>"
    Ticket format:   "<expires_epoch>:<hmac_hex>"
    """
    if not secret:
        raise ValueError("HMAC secret cannot be empty")
    expires_epoch = fixed_epoch if fixed_epoch is not None else int(time.time() + validity_seconds)
    role_str = role if role else "ANY"
    payload = f"{user_id}:{token_version}:{role_str}:{expires_epoch}"
    hmac_hex = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{expires_epoch}:{hmac_hex}"

