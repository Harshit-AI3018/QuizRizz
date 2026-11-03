import unittest
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from fastapi import HTTPException
from jwt import InvalidTokenError

from app.core.config import Settings
from app.core.hmac_tickets import create_actor_ticket
from app.core.security import (
    create_token,
    create_token_pair,
    decode_token,
    hash_password,
    verify_password,
)
from app.schemas.auth import LoginRequest
from app.services import auth_service
from database.auth_utils import generate_auth_signature

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
PASSWORD = "correct horse battery staple"


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_database_url": "postgresql://campusquiz_app:password@localhost/campusquiz",
        "jwt_secret_key": "j" * 48,
        "auth_hmac_secret": "h" * 48,
    }
    values.update(overrides)
    return Settings(**values)


def result_with_one(row):
    result = MagicMock()
    result.mappings.return_value.one_or_none.return_value = row
    return result


def result_with_all(rows):
    result = MagicMock()
    result.mappings.return_value.all.return_value = rows
    return result


def user_row(*, password_hash: str | None = None, **overrides):
    row = {
        "id": USER_ID,
        "college_id": COLLEGE_ID,
        "email": "student@example.edu",
        "password_hash": password_hash or hash_password(PASSWORD),
        "first_name": "Quiz",
        "last_name": "Student",
        "is_active": True,
        "must_change_password": False,
        "token_version": 1,
    }
    row.update(overrides)
    return row


class SettingsAndPasswordTests(unittest.TestCase):
    def test_requires_strong_independent_authentication_secrets(self) -> None:
        with self.assertRaisesRegex(ValueError, "JWT_SECRET_KEY"):
            make_settings(jwt_secret_key="short")
        with self.assertRaisesRegex(ValueError, "AUTH_HMAC_SECRET"):
            make_settings(auth_hmac_secret="short")
        with self.assertRaisesRegex(ValueError, "must be different"):
            make_settings(auth_hmac_secret="j" * 48)

    def test_argon2_password_hash_round_trip_and_mismatch(self) -> None:
        encoded = hash_password(PASSWORD)
        self.assertTrue(encoded.startswith("$argon2id$"))
        self.assertTrue(verify_password(encoded, PASSWORD))
        self.assertFalse(verify_password(encoded, "incorrect"))
        self.assertFalse(verify_password("not-an-argon2-hash", PASSWORD))

    def test_login_request_normalizes_email(self) -> None:
        request = LoginRequest(
            college_id=COLLEGE_ID,
            email="  STUDENT@Example.edu  ",
            password=PASSWORD,
        )
        self.assertEqual(request.email, "student@example.edu")
        for invalid_email in ("@example.edu", "student@", "student@@example.edu"):
            with self.subTest(email=invalid_email):
                with self.assertRaises(ValueError):
                    LoginRequest(
                        college_id=COLLEGE_ID,
                        email=invalid_email,
                        password=PASSWORD,
                    )


class TokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = make_settings()

    def test_token_pair_has_scoped_claims_and_lifetimes(self) -> None:
        access, refresh, expires_in = create_token_pair(
            user_id=str(USER_ID),
            college_id=str(COLLEGE_ID),
            roles=["STUDENT"],
            token_version=3,
            settings=self.settings,
        )
        access_payload = decode_token(
            access,
            expected_type="access",
            settings=self.settings,
        )
        refresh_payload = decode_token(
            refresh,
            expected_type="refresh",
            settings=self.settings,
        )
        self.assertEqual(access_payload["sub"], str(USER_ID))
        self.assertEqual(access_payload["college_id"], str(COLLEGE_ID))
        self.assertEqual(access_payload["roles"], ["STUDENT"])
        self.assertEqual(access_payload["token_version"], 3)
        self.assertEqual(access_payload["token_type"], "access")
        self.assertEqual(refresh_payload["token_type"], "refresh")
        self.assertEqual(expires_in, 900)
        self.assertGreater(refresh_payload["exp"], access_payload["exp"])

    def test_rejects_wrong_token_type_and_tampered_signature(self) -> None:
        token = create_token(
            user_id=str(USER_ID),
            college_id=str(COLLEGE_ID),
            roles=["STUDENT"],
            token_version=1,
            token_type="access",
            lifetime=timedelta(minutes=5),
            settings=self.settings,
        )
        with self.assertRaises(InvalidTokenError):
            decode_token(token, expected_type="refresh", settings=self.settings)
        with self.assertRaises(InvalidTokenError):
            decode_token(token[:-1] + ("a" if token[-1] != "a" else "b"),
                         expected_type="access",
                         settings=self.settings)

    def test_rejects_expired_token(self) -> None:
        token = create_token(
            user_id=str(USER_ID),
            college_id=str(COLLEGE_ID),
            roles=["STUDENT"],
            token_version=1,
            token_type="access",
            lifetime=timedelta(seconds=-1),
            settings=self.settings,
        )
        with self.assertRaises(InvalidTokenError):
            decode_token(token, expected_type="access", settings=self.settings)

    def test_database_actor_ticket_matches_existing_hmac_utility(self) -> None:
        ticket = create_actor_ticket(
            user_id=str(USER_ID),
            token_version=4,
            role="STUDENT",
            settings=self.settings,
        )
        expires_epoch = int(ticket.split(":", maxsplit=1)[0])
        expected = generate_auth_signature(
            user_id=str(USER_ID),
            token_version=4,
            role="STUDENT",
            secret="h" * 48,
            fixed_epoch=expires_epoch,
        )
        self.assertEqual(ticket, expected)


class AuthenticationServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.settings = make_settings()
        self.user = user_row()
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()

    def login_request(self, password: str = PASSWORD) -> LoginRequest:
        return LoginRequest(
            college_id=COLLEGE_ID,
            email="STUDENT@example.edu",
            password=password,
        )

    async def test_login_returns_access_refresh_tokens_and_current_roles(self) -> None:
        self.connection.execute.side_effect = [
            result_with_one(self.user),
            result_with_one(self.user),
            result_with_all([{"role_code": "STUDENT"}]),
        ]

        response = await auth_service.login(
            self.connection,
            self.login_request(),
            self.settings,
        )

        self.assertEqual(response.user.email, "student@example.edu")
        self.assertEqual(response.user.roles, ["STUDENT"])
        self.assertEqual(response.expires_in, 900)
        self.assertNotIn("password_hash", response.user.model_dump())
        access = decode_token(
            response.access_token,
            expected_type="access",
            settings=self.settings,
        )
        refresh = decode_token(
            response.refresh_token,
            expected_type="refresh",
            settings=self.settings,
        )
        self.assertEqual(access["sub"], str(USER_ID))
        self.assertEqual(refresh["token_version"], 1)

    async def test_login_rejects_wrong_password_and_unknown_user_uniformly(self) -> None:
        for row in (self.user, None):
            self.connection.execute.reset_mock()
            self.connection.execute.side_effect = [result_with_one(row)]
            with self.subTest(user_exists=row is not None):
                with self.assertRaises(HTTPException) as raised:
                    await auth_service.login(
                        self.connection,
                        self.login_request("wrong password"),
                        self.settings,
                    )
                self.assertEqual(raised.exception.status_code, 401)
                self.assertEqual(raised.exception.detail, "Invalid or expired credentials")

    async def test_login_rejects_inactive_user(self) -> None:
        self.connection.execute.side_effect = [
            result_with_one(user_row(is_active=False))
        ]
        with self.assertRaises(HTTPException) as raised:
            await auth_service.login(
                self.connection,
                self.login_request(),
                self.settings,
            )
        self.assertEqual(raised.exception.status_code, 401)

    async def test_refresh_preserves_refresh_token_and_checks_database_version(self) -> None:
        _, refresh_token, _ = create_token_pair(
            user_id=str(USER_ID),
            college_id=str(COLLEGE_ID),
            roles=["STUDENT"],
            token_version=1,
            settings=self.settings,
        )
        self.connection.execute.side_effect = [
            result_with_one(self.user),
            result_with_all([{"role_code": "STUDENT"}]),
        ]

        response = await auth_service.refresh(
            self.connection,
            refresh_token,
            self.settings,
        )
        self.assertEqual(response.refresh_token, refresh_token)

    async def test_token_version_change_invalidates_access_and_refresh_tokens(self) -> None:
        access_token, refresh_token, _ = create_token_pair(
            user_id=str(USER_ID),
            college_id=str(COLLEGE_ID),
            roles=["STUDENT"],
            token_version=1,
            settings=self.settings,
        )
        self.connection.execute.side_effect = [
            result_with_one(user_row(token_version=2)),
            result_with_all([{"role_code": "STUDENT"}]),
        ]
        with self.assertRaises(HTTPException):
            await auth_service.authenticate_token(
                self.connection,
                access_token,
                expected_type="access",
                settings=self.settings,
            )

        self.connection.execute.reset_mock()
        self.connection.execute.side_effect = [
            result_with_one(user_row(token_version=2)),
            result_with_all([{"role_code": "STUDENT"}]),
        ]
        with self.assertRaises(HTTPException):
            await auth_service.authenticate_token(
                self.connection,
                refresh_token,
                expected_type="refresh",
                settings=self.settings,
            )

    async def test_logout_increments_token_version(self) -> None:
        _, refresh_token, _ = create_token_pair(
            user_id=str(USER_ID),
            college_id=str(COLLEGE_ID),
            roles=["STUDENT"],
            token_version=1,
            settings=self.settings,
        )
        update_result = MagicMock(rowcount=1)
        self.connection.execute.side_effect = [
            result_with_one(self.user),
            result_with_all([{"role_code": "STUDENT"}]),
            update_result,
        ]

        await auth_service.revoke_tokens(
            self.connection,
            refresh_token,
            self.settings,
        )
        update_statement, parameters = self.connection.execute.await_args_list[-1].args
        self.assertIn("token_version = token_version + 1", str(update_statement))
        self.assertEqual(parameters["token_version"], 1)
        self.connection.commit.assert_awaited_once()

    async def test_logout_rejects_stale_version_without_commit(self) -> None:
        _, refresh_token, _ = create_token_pair(
            user_id=str(USER_ID),
            college_id=str(COLLEGE_ID),
            roles=["STUDENT"],
            token_version=1,
            settings=self.settings,
        )
        self.connection.execute.side_effect = [
            result_with_one(self.user),
            result_with_all([{"role_code": "STUDENT"}]),
            MagicMock(rowcount=0),
        ]
        with self.assertRaises(HTTPException):
            await auth_service.revoke_tokens(
                self.connection,
                refresh_token,
                self.settings,
            )
        self.connection.commit.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
