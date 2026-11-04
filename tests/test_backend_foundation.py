import asyncio
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.api.health import liveness, readiness
from app.api.deps import get_access_token_payload
from app.core.config import Settings
from app.db.session import create_database_engine
from app.db.sp_caller import call_database_function
from app.main import create_app


def make_settings(
    database_url: str = "postgresql://campusquiz_app:password@localhost/campusquiz",
) -> Settings:
    return Settings(
        _env_file=None,
        app_database_url=database_url,
        jwt_secret_key="a" * 32,
        auth_hmac_secret="b" * 32,
    )


class SettingsTests(unittest.TestCase):
    def test_accepts_direct_application_role_url(self) -> None:
        settings = make_settings()
        self.assertEqual(settings.async_database_url().drivername, "postgresql+asyncpg")

    def test_prefers_runtime_role_url_over_migration_url(self) -> None:
        environment = {
            "DATABASE_URL": "postgresql://migration_owner:password@migration.test/db",
            "APP_DATABASE_URL": "postgresql://campusquiz_app:password@app.test/db",
            "JWT_SECRET_KEY": "j" * 48,
            "AUTH_HMAC_SECRET": "h" * 48,
        }
        with patch.dict("os.environ", environment):
            settings = Settings(_env_file=None)
        self.assertEqual(settings.async_database_url().host, "app.test")

    def test_rejects_non_application_database_role(self) -> None:
        with self.assertRaisesRegex(ValueError, "campusquiz_app"):
            make_settings("postgresql://owner:password@localhost/campusquiz")

    def test_missing_bearer_token_is_rejected_before_database_access(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(get_access_token_payload(None, make_settings()))
        self.assertEqual(raised.exception.status_code, 401)

    def test_rejects_pooled_database_endpoint(self) -> None:
        with self.assertRaisesRegex(ValueError, "direct, unpooled"):
            make_settings(
                "postgresql://campusquiz_app:password@sample-pooler.neon.tech/campusquiz"
            )


    def test_explicit_kwargs_override_env_database_url(self) -> None:
        """Regression: explicit app_database_url kwarg must win over os.environ DATABASE_URL.

        When database/verify_and_migrate.py is imported before this test suite,
        its load_dotenv() call could previously inject DATABASE_URL into os.environ.
        The Settings.__init__ normalisation introduced in this audit ensures that
        an explicit kwarg always takes precedence regardless of ambient env vars.
        """
        import os
        from unittest.mock import patch

        # Simulate the env state that existed after verify_and_migrate was imported.
        env_pollution = {
            "DATABASE_URL": "postgresql://campusquiz_app:poison@evil-host.example.com/db",
            "APP_DATABASE_URL": "postgresql://campusquiz_app:poison@evil-host.example.com/db",
        }
        with patch.dict(os.environ, env_pollution):
            # The explicit kwarg must override the polluted env value.
            settings = make_settings(
                "postgresql://campusquiz_app:safe@localhost/campusquiz"
            )
        self.assertEqual(settings.async_database_url().host, "localhost")

    def test_explicit_kwargs_override_env_app_database_url(self) -> None:
        """Regression: explicit kwarg beats APP_DATABASE_URL env variable."""
        import os
        from unittest.mock import patch

        env_pollution = {
            "APP_DATABASE_URL": "postgresql://campusquiz_app:wrong@pooler.neon.tech/db",
        }
        # 'pooler' would normally be rejected – but we pass a good URL as kwarg.
        with patch.dict(os.environ, env_pollution):
            settings = make_settings(
                "postgresql://campusquiz_app:safe@ep-direct.neon.tech/campusquiz"
            )
        self.assertNotIn("pooler", settings.async_database_url().host)

    def test_rejects_non_app_role_even_with_valid_env_vars_present(self) -> None:
        """Regression: validation still fires even when env has a valid URL."""
        import os
        from unittest.mock import patch

        # A perfectly valid URL in the environment must not mask kwarg validation.
        env_state = {
            "DATABASE_URL": "postgresql://campusquiz_app:pw@localhost/campusquiz",
        }
        with patch.dict(os.environ, env_state):
            with self.assertRaisesRegex(ValueError, "campusquiz_app"):
                make_settings("postgresql://owner:password@localhost/campusquiz")

    def test_rejects_pooled_endpoint_even_with_valid_env_vars_present(self) -> None:
        """Regression: pooled-URL rejection fires regardless of env var content."""
        import os
        from unittest.mock import patch

        env_state = {
            "DATABASE_URL": "postgresql://campusquiz_app:pw@localhost/campusquiz",
        }
        with patch.dict(os.environ, env_state):
            with self.assertRaisesRegex(ValueError, "direct, unpooled"):
                make_settings(
                    "postgresql://campusquiz_app:pw@sample-pooler.neon.tech/campusquiz"
                )

    def test_engine_maps_sslmode_to_asyncpg(self) -> None:
        settings = make_settings(
            "postgresql://campusquiz_app:password@localhost/campusquiz?sslmode=require"
        )
        engine = create_database_engine(settings)
        try:
            self.assertEqual(engine.url.drivername, "postgresql+asyncpg")
            self.assertNotIn("sslmode", engine.url.query)
        finally:
            asyncio.run(engine.dispose())


class HealthRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock(return_value=MagicMock())
        self.engine = MagicMock()

        @asynccontextmanager
        async def connect():
            yield self.connection

        self.engine.connect = connect
        self.application = create_app(make_settings())
        self.engine.dispose = AsyncMock()
        self.engine_patch = patch(
            "app.main.create_database_engine",
            return_value=self.engine,
        )
        self.engine_patch.start()
        self.addCleanup(self.engine_patch.stop)

    async def test_liveness_does_not_depend_on_database(self) -> None:
        async with self.application.router.lifespan_context(self.application):
            response = await liveness()
        self.assertEqual(response, {"status": "alive"})
        self.connection.execute.assert_not_awaited()

    async def test_readiness_checks_database(self) -> None:
        async with self.application.router.lifespan_context(self.application):
            response = await readiness(self.engine)
        self.assertEqual(response, {"status": "ready"})
        self.connection.execute.assert_awaited_once()

    async def test_readiness_reports_database_failure_as_unavailable(self) -> None:
        self.connection.execute.side_effect = OperationalError(
            "SELECT 1",
            {},
            RuntimeError("offline"),
        )

        async with self.application.router.lifespan_context(self.application):
            with self.assertLogs("app.api.health", level="ERROR"):
                with self.assertRaises(HTTPException) as raised:
                    await readiness(self.engine)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "Database unavailable")

    async def test_readiness_reports_connection_failure_as_unavailable(self) -> None:
        self.engine.connect = MagicMock(
            side_effect=ConnectionRefusedError("database is offline")
        )

        async with self.application.router.lifespan_context(self.application):
            with self.assertLogs("app.api.health", level="ERROR"):
                with self.assertRaises(HTTPException) as raised:
                    await readiness(self.engine)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "Database unavailable")

    def test_health_routes_are_registered(self) -> None:
        paths = self.application.openapi()["paths"]
        self.assertIn("/health/live", paths)
        self.assertIn("/health/ready", paths)
        self.assertIn("/api/v1/health/live", paths)
        self.assertIn("/api/v1/health/ready", paths)
        self.assertIn("/api/v1/auth/login", paths)
        self.assertIn("/api/v1/auth/refresh", paths)
        self.assertIn("/api/v1/auth/logout", paths)
        self.assertIn("/api/v1/auth/me", paths)
        self.assertNotIn("/auth/login", paths)


class DatabaseFunctionCallerTests(unittest.IsolatedAsyncioTestCase):
    async def test_executes_parameterized_function_and_returns_one_row(self) -> None:
        connection = MagicMock()
        connection.execute = AsyncMock()
        result = MagicMock()
        result.mappings.return_value.one.return_value = {"attempt_id": "attempt-1"}
        connection.execute.return_value = result
        statement = text("SELECT sp_start_quiz_attempt(:session_id, :actor_id, :sig)")
        parameters = {
            "session_id": "session-1",
            "actor_id": "student-1",
            "sig": "ticket",
        }

        row = await call_database_function(connection, statement, parameters)

        self.assertEqual(row, {"attempt_id": "attempt-1"})
        connection.execute.assert_awaited_once_with(statement, parameters)


if __name__ == "__main__":
    unittest.main()
