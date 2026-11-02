from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import Settings


def create_database_engine(settings: Settings) -> AsyncEngine:
    url = settings.async_database_url()
    connect_args: dict[str, object] = {}
    sslmode = url.query.get("sslmode")

    if isinstance(sslmode, tuple):
        raise ValueError("APP_DATABASE_URL must specify sslmode at most once")
    if sslmode is not None:
        supported_ssl_modes = {
            "allow",
            "disable",
            "prefer",
            "require",
            "verify-ca",
            "verify-full",
        }
        if sslmode not in supported_ssl_modes:
            raise ValueError("APP_DATABASE_URL specifies an unsupported sslmode")
        connect_args["ssl"] = False if sslmode == "disable" else sslmode
        url = url.set(query={key: value for key, value in url.query.items() if key != "sslmode"})

    return create_async_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
    )
