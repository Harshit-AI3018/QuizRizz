from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError
from typing_extensions import Self


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_database_url: SecretStr = Field(
        validation_alias=AliasChoices("APP_DATABASE_URL", "DATABASE_URL")
    )
    jwt_secret_key: SecretStr
    auth_hmac_secret: SecretStr
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    @model_validator(mode="after")
    def validate_auth_settings(self) -> Self:
        jwt_secret = self.jwt_secret_key.get_secret_value()
        hmac_secret = self.auth_hmac_secret.get_secret_value()
        if len(jwt_secret.encode("utf-8")) < 32:
            raise ValueError("JWT_SECRET_KEY must contain at least 32 bytes")
        if len(hmac_secret.encode("utf-8")) < 32:
            raise ValueError("AUTH_HMAC_SECRET must contain at least 32 bytes")
        if jwt_secret == hmac_secret:
            raise ValueError("JWT_SECRET_KEY and AUTH_HMAC_SECRET must be different")
        if self.access_token_expire_minutes < 1:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be positive")
        if self.refresh_token_expire_days < 1:
            raise ValueError("REFRESH_TOKEN_EXPIRE_DAYS must be positive")
        return self

    @field_validator("app_database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except ArgumentError as exc:
            raise ValueError("APP_DATABASE_URL must be a valid PostgreSQL URL") from exc

        if url.drivername not in {"postgresql", "postgresql+asyncpg"}:
            raise ValueError("APP_DATABASE_URL must use PostgreSQL")
        if url.username != "campusquiz_app":
            raise ValueError("APP_DATABASE_URL must connect as campusquiz_app")
        if not url.host or not url.database:
            raise ValueError("APP_DATABASE_URL must include a host and database name")
        if "pooler" in url.host.lower():
            raise ValueError("APP_DATABASE_URL must use a direct, unpooled database endpoint")
        return value

    def async_database_url(self) -> URL:
        url = make_url(self.app_database_url.get_secret_value())
        if url.drivername == "postgresql":
            url = url.set(drivername="postgresql+asyncpg")
        return url
