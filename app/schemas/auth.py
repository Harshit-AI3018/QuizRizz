from uuid import UUID

from pydantic import BaseModel, ConfigDict, SecretStr, field_validator


def normalize_email_address(value: str) -> str:
    normalized = value.strip().lower()
    local_part, separator, domain = normalized.partition("@")
    if (
        len(normalized) > 255
        or not separator
        or not local_part
        or not domain
        or "@" in domain
        or any(character.isspace() for character in normalized)
    ):
        raise ValueError("A valid email address is required")
    return normalized


class LoginRequest(BaseModel):
    college_id: UUID
    email: str
    password: SecretStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_address(value)


class RefreshRequest(BaseModel):
    refresh_token: SecretStr


class UserProfile(BaseModel):
    id: UUID
    college_id: UUID
    email: str
    first_name: str
    last_name: str
    roles: list[str]
    must_change_password: bool


class AuthenticatedUser(UserProfile):
    model_config = ConfigDict(frozen=True)
    token_version: int


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserProfile
