"""
Standalone CLI worker: sweep expired quiz attempts.

Intended for use as a scheduled cron job on Render or any process scheduler.

Usage:
    python -m app.workers.timeout_sweeper

Environment variables required (same as the main application):
    DATABASE_URL       — application database connection string
    SECRET_KEY         — application secret key
    HMAC_SECRET_KEY    — HMAC signing key for internal procedure calls

Exit codes:
    0  — completed successfully (even if zero attempts were swept)
    1  — fatal error (misconfiguration, database unreachable, etc.)
"""

import asyncio
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [sweeper] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


async def _run() -> int:
    """Core sweeper coroutine. Returns the number of attempts finalized."""
    # Import lazily so the module can be imported without triggering
    # Pydantic settings validation at collection time (useful in tests).
    from app.core.config import Settings
    from app.db.session import create_database_engine
    from app.services.student_service import sweep_expired_attempts
    from sqlalchemy.ext.asyncio import AsyncSession

    settings = Settings()
    engine = create_database_engine(settings)
    try:
        async with AsyncSession(engine) as session:
            finalized = await sweep_expired_attempts(session, settings)
            count = len(finalized)
            if count:
                logger.info("Finalized %d expired attempt(s): %s", count, [str(a) for a in finalized])
            else:
                logger.info("No expired attempts found.")
            return count
    finally:
        await engine.dispose()


def main() -> None:
    """Entry point for `python -m app.workers.timeout_sweeper`."""
    try:
        finalized_count = asyncio.run(_run())
        logger.info("Sweeper finished. Total finalized: %d", finalized_count)
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        logger.error("Sweeper failed with an unexpected error: %s", exc, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
