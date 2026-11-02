from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine


def get_database_engine(request: Request) -> AsyncEngine:
    return request.app.state.engine


async def get_database_connection(request: Request) -> AsyncIterator[AsyncConnection]:
    engine = get_database_engine(request)
    async with engine.connect() as connection:
        yield connection
