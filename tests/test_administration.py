import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.schemas.administration import (
    AcademicYearCreate,
    AcademicYearUpdate,
    DepartmentCreate,
    DepartmentUpdate,
    FacultyCreate,
    StudentCreate,
)
from app.schemas.auth import AuthenticatedUser
from app.api.deps import require_roles
from app.main import create_app
from app.services import administration_service

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
ADMIN_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
USER_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")


def make_admin() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=ADMIN_ID,
        college_id=COLLEGE_ID,
        email="admin@example.edu",
        first_name="Quiz",
        last_name="Admin",
        roles=["ADMIN"],
        must_change_password=False,
        token_version=1,
    )


def result_with_one(row):
    result = MagicMock()
    result.mappings.return_value.one.return_value = row
    result.mappings.return_value.one_or_none.return_value = row
    result.scalar_one.return_value = USER_ID
    result.scalar_one_or_none.return_value = row.get("id") if row else None
    return result


class AdministrationSchemaTests(unittest.TestCase):
    def test_academic_year_rejects_invalid_date_range(self) -> None:
        with self.assertRaises(ValueError):
            AcademicYearCreate(
                name="2026-27",
                start_date="2027-01-01",
                end_date="2026-01-01",
            )

    def test_admin_role_gate_rejects_non_admin_actor(self) -> None:
        dependency = require_roles("ADMIN")
        faculty = make_admin().model_copy(update={"roles": ["FACULTY"]})
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(dependency(faculty))
        self.assertEqual(raised.exception.status_code, 403)

    def test_admin_routes_are_registered_with_bearer_auth(self) -> None:
        paths = create_app().openapi()["paths"]
        admin_paths = [path for path in paths if path.startswith("/api/v1/admin/")]
        self.assertIn("/api/v1/admin/college", admin_paths)
        self.assertIn("/api/v1/admin/academic/{resource_name}", admin_paths)
        for path in admin_paths:
            for operation in paths[path].values():
                self.assertIn("security", operation)

    def test_patch_requires_values_and_rejects_null_required_fields(self) -> None:
        with self.assertRaises(ValueError):
            DepartmentUpdate()
        with self.assertRaises(ValueError):
            DepartmentUpdate(name=None)
        with self.assertRaises(ValueError):
            AcademicYearUpdate(is_current=None)

    def test_email_and_institution_codes_are_normalized(self) -> None:
        faculty = FacultyCreate(
            email="  FACULTY@Example.edu ",
            password="long secure password",
            first_name="A",
            last_name="Teacher",
            employee_id=" fac-01 ",
            department_id=USER_ID,
        )
        self.assertEqual(faculty.email, "faculty@example.edu")
        self.assertEqual(faculty.employee_id, "FAC-01")
        department = DepartmentCreate(name="Science", code=" sci ")
        self.assertEqual(department.code, "SCI")

    def test_student_password_minimum_is_enforced(self) -> None:
        with self.assertRaises(ValueError):
            StudentCreate(
                email="student@example.edu",
                password="short",
                first_name="A",
                last_name="Student",
                roll_number="r-01",
            )


class AdministrationServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.actor = make_admin()

    async def test_list_resources_always_scopes_to_admin_college(self) -> None:
        result = MagicMock()
        result.mappings.return_value.all.return_value = []
        self.connection.execute.return_value = result

        await administration_service.list_resources(
            self.connection,
            self.actor,
            "departments",
            limit=50,
            offset=10,
        )

        statement, parameters = self.connection.execute.await_args.args
        self.assertIn("WHERE college_id = :college_id", str(statement))
        self.assertEqual(parameters["college_id"], COLLEGE_ID)
        self.assertEqual(parameters["limit"], 50)

    async def test_create_resource_uses_caller_tenant_and_commits(self) -> None:
        result = result_with_one({"id": USER_ID, "college_id": COLLEGE_ID})
        self.connection.execute.return_value = result

        await administration_service.create_resource(
            self.connection,
            self.actor,
            "departments",
            {"name": "Science", "code": "SCI"},
        )

        _, parameters = self.connection.execute.await_args_list[-1].args
        self.assertEqual(parameters["college_id"], COLLEGE_ID)
        self.assertEqual(parameters["name"], "Science")
        self.connection.commit.assert_awaited_once()

    async def test_update_resource_cannot_cross_tenant(self) -> None:
        result = MagicMock()
        result.mappings.return_value.one_or_none.return_value = None
        self.connection.execute.return_value = result

        with self.assertRaises(HTTPException) as raised:
            await administration_service.update_resource(
                self.connection,
                self.actor,
                "departments",
                USER_ID,
                {"name": "Changed"},
            )

        self.assertEqual(raised.exception.status_code, 404)
        _, parameters = self.connection.execute.await_args.args
        self.assertEqual(parameters["college_id"], COLLEGE_ID)
        self.connection.commit.assert_not_awaited()

    async def test_integrity_conflict_rolls_back_and_returns_conflict(self) -> None:
        self.connection.execute.side_effect = IntegrityError(
            "INSERT",
            {},
            RuntimeError("duplicate key"),
        )

        with self.assertRaises(HTTPException) as raised:
            await administration_service.create_resource(
                self.connection,
                self.actor,
                "departments",
                {"name": "Science", "code": "SCI"},
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.connection.rollback.assert_awaited_once()
        self.connection.commit.assert_not_awaited()

    async def test_faculty_assignment_requires_active_college_faculty(self) -> None:
        role_lookup = MagicMock()
        role_lookup.scalar_one_or_none.return_value = None
        self.connection.execute.return_value = role_lookup

        with self.assertRaises(HTTPException) as raised:
            await administration_service.create_resource(
                self.connection,
                self.actor,
                "faculty_assignments",
                {
                    "faculty_user_id": USER_ID,
                    "subject_id": USER_ID,
                    "class_id": USER_ID,
                    "academic_year_id": USER_ID,
                },
            )

        self.assertEqual(raised.exception.status_code, 422)
        _, parameters = self.connection.execute.await_args_list[-1].args
        self.assertEqual(parameters["college_id"], COLLEGE_ID)
        self.assertEqual(parameters["role_code"], "FACULTY")
        self.connection.commit.assert_not_awaited()

    async def test_profile_creation_is_atomic_and_hashes_initial_password(self) -> None:
        user_insert = MagicMock()
        user_insert.scalar_one.return_value = USER_ID
        role_insert = MagicMock()
        profile_insert = MagicMock()
        profile_query = MagicMock()
        profile_query.mappings.return_value.one_or_none.return_value = {
            "id": USER_ID,
            "college_id": COLLEGE_ID,
            "email": "student@example.edu",
            "roll_number": "R-01",
        }
        self.connection.execute.side_effect = [
            user_insert,
            role_insert,
            profile_insert,
            profile_query,
        ]
        request = StudentCreate(
            email="STUDENT@example.edu",
            password="initial secure password",
            first_name="Test",
            last_name="Student",
            roll_number="r-01",
        )

        profile = await administration_service.create_profile(
            self.connection,
            self.actor,
            "student",
            request,
        )

        self.assertEqual(profile["id"], USER_ID)
        self.assertEqual(self.connection.execute.await_count, 4)
        insert_statement, user_parameters = self.connection.execute.await_args_list[0].args
        self.assertIn("password_hash", str(insert_statement))
        self.assertTrue(user_parameters["password_hash"].startswith("$argon2id$"))
        self.assertNotEqual(user_parameters["password_hash"], "initial secure password")
        self.connection.commit.assert_awaited_once()

    async def test_profile_deactivation_revokes_tokens_and_memberships(self) -> None:
        self.connection.execute.return_value = MagicMock()
        self.connection.execute.return_value.scalar_one_or_none.return_value = USER_ID

        await administration_service.deactivate_profile(
            self.connection,
            self.actor,
            "student",
            USER_ID,
        )

        self.assertEqual(self.connection.execute.await_count, 2)
        user_statement = self.connection.execute.await_args_list[0].args[0]
        self.assertIn("token_version = token_version + 1", str(user_statement))
        enrollment_statement = self.connection.execute.await_args_list[1].args[0]
        self.assertIn("UPDATE student_enrollments", str(enrollment_statement))
        self.connection.commit.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
