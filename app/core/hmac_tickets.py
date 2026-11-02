from database.auth_utils import generate_auth_signature

from app.core.config import Settings


def create_actor_ticket(
    *,
    user_id: str,
    token_version: int,
    role: str,
    settings: Settings,
    validity_seconds: int = 300,
) -> str:
    return generate_auth_signature(
        user_id=user_id,
        token_version=token_version,
        role=role,
        validity_seconds=validity_seconds,
        secret=settings.auth_hmac_secret.get_secret_value(),
    )
