from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.api import api_router
from app.core.config import Settings
from app.db.session import create_database_engine


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        configured_settings = settings or Settings()
        engine = create_database_engine(configured_settings)
        application.state.engine = engine
        try:
            yield
        finally:
            await engine.dispose()

    application = FastAPI(
        title="CampusQuiz API",
        version="1.0.0",
        lifespan=lifespan,
    )
    application.include_router(api_router)
    return application


app = create_app()
