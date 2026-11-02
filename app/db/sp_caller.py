from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql.elements import TextClause


async def call_database_function(
    connection: AsyncConnection,
    statement: TextClause,
    parameters: Mapping[str, object],
) -> Mapping[str, Any]:
    result = await connection.execute(statement, parameters)
    return result.mappings().one()
