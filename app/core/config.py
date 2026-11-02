from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: SecretStr

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except ArgumentError as exc:
            raise ValueError("DATABASE_URL must be a valid PostgreSQL URL") from exc

        if url.drivername not in {"postgresql", "postgresql+asyncpg"}:
            raise ValueError("DATABASE_URL must use PostgreSQL")
        if url.username != "campusquiz_app":
            raise ValueError("DATABASE_URL must connect as campusquiz_app")
        if not url.host or not url.database:
            raise ValueError("DATABASE_URL must include a host and database name")
        if "pooler" in url.host.lower():
            raise ValueError("DATABASE_URL must use a direct, unpooled database endpoint")
        return value

    def async_database_url(self) -> URL:
        url = make_url(self.database_url.get_secret_value())
        if url.drivername == "postgresql":
            url = url.set(drivername="postgresql+asyncpg")
        return url
