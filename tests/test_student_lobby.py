import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from fastapi import HTTPException

from app.api.deps import require_roles
from app.main import create_app
from app.schemas.auth import AuthenticatedUser
from app.schemas.student import SessionJoinRequest
from app.services import student_service

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OTHER_COLLEGE_ID = UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")
STUDENT_ID = UUID("11111111-2222-4333-8444-555555555555")
OTHER_STUDENT_ID = UUID("99999999-8888-4777-8666-555555555555")
FACULTY_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
QUIZ_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
CLASS_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
OTHER_CLASS_ID = UUID("dddddddd-dddd-4ddd-8ddd-ddddddddddd2")
SESSION_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
SUBJECT_ID = UUID("33333333-3333-4333-8333-333333333333")
NOW = datetime.now(timezone.utc)


def run_async(coro):
    """Run an async coroutine synchronously without socket-based event loops."""
    gen = coro.__await__()
    val = None
    exc = None
    while True:
        try:
            if exc:
                future = gen.throw(exc)
            else:
                future = gen.send(val)
            val = None
            exc = None
        except StopIteration as e:
            return e.value


def make_student(*, student_id=STUDENT_ID, college_id=COLLEGE_ID) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=student_id,
        college_id=college_id,
        email="student@example.edu",
        first_name="Jane",
        last_name="Student",
        roles=["STUDENT"],
        must_change_password=False,
        token_version=1,
    )


def make_faculty(*, faculty_id=FACULTY_ID, college_id=COLLEGE_ID) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=faculty_id,
        college_id=college_id,
        email="faculty@example.edu",
        first_name="Quiz",
        last_name="Faculty",
        roles=["FACULTY"],
        must_change_password=False,
        token_version=1,
    )


def make_result(*, row=None, rows=None, scalar=None):
    result = MagicMock()
    result.mappings.return_value.one.return_value = row
    result.mappings.return_value.one_or_none.return_value = row
    result.mappings.return_value.all.return_value = rows or []
    result.scalar_one.return_value = scalar
    result.scalar_one_or_none.return_value = scalar
    return result


def session_row(
    *,
    session_id=SESSION_ID,
    status="SCHEDULED",
    class_id=CLASS_ID,
    college_id=COLLEGE_ID,
    session_code="ABCDEFG2",
):
    return {
        "session_id": session_id,
        "session_code": session_code,
        "quiz_id": QUIZ_ID,
        "quiz_title": "Physics Midterm Quiz",
        "quiz_description": "Units 1 to 4",
        "quiz_instructions": "No calculators allowed",
        "subject_id": SUBJECT_ID,
        "subject_name": "Physics I",
        "subject_code": "PHY101",
        "class_id": class_id,
        "class_name": "Class 10A",
        "faculty_name": "Dr. Quiz Faculty",
        "session_mode": "STUDENT_PACED",
        "session_status": status,
        "status": status,
        "start_window_time": NOW,
        "end_window_time": NOW + timedelta(hours=2),
        "duration_minutes": 30,
        "attempt_id": None,
        "attempt_status": None,
    }


class StudentLobbySchemaTests(unittest.TestCase):
    def test_session_code_normalization_and_validation(self) -> None:
        req = SessionJoinRequest(session_code="  abcdefg2  ")
        self.assertEqual(req.session_code, "ABCDEFG2")

        with self.assertRaises(ValueError):
            SessionJoinRequest(session_code="abc")  # too short

        with self.assertRaises(ValueError):
            SessionJoinRequest(session_code="ABCDEFGHIJKL")  # too long

        with self.assertRaises(ValueError):
            SessionJoinRequest(session_code="ABC-EFG2")  # invalid punctuation

    def test_student_endpoints_registered_and_do_not_expose_snapshot(self) -> None:
        openapi = create_app().openapi()
        expected_paths = {
            "/api/v1/student/sessions",
            "/api/v1/student/sessions/joined",
            "/api/v1/student/sessions/join",
            "/api/v1/student/sessions/{session_id}/lobby",
        }
        self.assertTrue(expected_paths <= openapi["paths"].keys())

        # Verify no snapshot_json or answer fields in student schemas
        for schema_name in ("StudentSessionDiscovery", "StudentLobbyStatus"):
            properties = openapi["components"]["schemas"][schema_name]["properties"]
            self.assertNotIn("snapshot_json", properties)
            self.assertNotIn("correct_answers", properties)
            self.assertNotIn("is_correct", properties)
            self.assertNotIn("explanation", properties)

    def test_non_student_role_rejected_from_student_gate(self) -> None:
        faculty = make_faculty()
        with self.assertRaises(HTTPException) as ctx:
            run_async(require_roles("STUDENT")(faculty))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_student_role_rejected_from_faculty_lifecycle_gate(self) -> None:
        student = make_student()
        with self.assertRaises(HTTPException) as ctx:
            run_async(require_roles("FACULTY", "ADMIN")(student))
        self.assertEqual(ctx.exception.status_code, 403)


class StudentDiscoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.student = make_student()

    def test_successful_session_discovery_scopes_to_student_enrollment(self) -> None:
        # 1. Profile check succeeds
        # 2. Query returns available sessions
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile exists
            make_result(rows=[session_row()]),  # available sessions
        ]

        sessions = run_async(
            student_service.list_available_sessions(self.connection, self.student)
        )

        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["session_code"], "ABCDEFG2")
        self.assertEqual(sessions[0]["quiz_title"], "Physics Midterm Quiz")
        self.assertEqual(sessions[0]["class_name"], "Class 10A")
        self.assertNotIn("snapshot_json", sessions[0])

        # Verify SQL parameter binding enforces tenant and student scoping
        query_args = self.connection.execute.await_args_list[1].args
        query_sql = str(query_args[0])
        params = query_args[1]
        self.assertIn("se.is_active = TRUE", query_sql)
        self.assertEqual(params["college_id"], COLLEGE_ID)
        self.assertEqual(params["student_id"], STUDENT_ID)

    def test_list_joined_sessions_returns_only_student_attempts(self) -> None:
        joined_row = session_row()
        joined_row["attempt_id"] = UUID("77777777-7777-4777-8777-777777777777")
        joined_row["attempt_status"] = "IN_PROGRESS"
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(rows=[joined_row]),  # joined
        ]

        sessions = run_async(
            student_service.list_joined_sessions(self.connection, self.student)
        )

        self.assertEqual(len(sessions), 1)
        self.assertTrue(sessions[0]["is_joined"])
        self.assertTrue(sessions[0]["has_attempt"])


class StudentLobbyJoinTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.student = make_student()

    def test_successful_joining_scheduled_session_enters_waiting_lobby(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile check
            make_result(row=session_row(status="SCHEDULED")),  # session details
            make_result(scalar=1),  # enrollment check
            make_result(row=None),  # attempt check (none yet)
        ]

        lobby = run_async(
            student_service.join_session_by_code(
                self.connection, self.student, "ABCDEFG2"
            )
        )

        self.assertEqual(lobby["session_code"], "ABCDEFG2")
        self.assertEqual(lobby["session_status"], "SCHEDULED")
        self.assertEqual(lobby["lobby_status"], "WAITING_FOR_TEACHER")
        self.assertTrue(lobby["is_waiting"])
        self.assertTrue(lobby["is_joined"])
        self.assertIn("Waiting for the teacher", lobby["message"])

        # CRITICAL: Joining lobby must never execute session activation
        for call_args in self.connection.execute.await_args_list:
            stmt = str(call_args.args[0]).lower()
            self.assertNotIn("sp_activate_quiz_session", stmt)
            self.assertNotIn("update quiz_sessions", stmt)

    def test_successful_joining_active_session_reports_ready_to_start(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=session_row(status="ACTIVE")),  # session active
            make_result(scalar=1),  # enrollment
            make_result(row=None),  # attempt
        ]

        lobby = run_async(
            student_service.join_session_by_code(
                self.connection, self.student, "ABCDEFG2"
            )
        )

        self.assertEqual(lobby["session_status"], "ACTIVE")
        self.assertEqual(lobby["lobby_status"], "READY_TO_START")
        self.assertFalse(lobby["is_waiting"])
        self.assertTrue(lobby["is_joined"])

    def test_invalid_session_code_returns_404(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=None),  # session not found
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.join_session_by_code(
                    self.connection, self.student, "NONEXIST9"
                )
            )

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("Invalid session code or session not found", ctx.exception.detail)

    def test_cross_college_session_returns_404(self) -> None:
        # Even if code exists, query scopes by college_id -> returns None -> 404
        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=None),
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.join_session_by_code(
                    self.connection, self.student, "CROSSCOL1"
                )
            )

        self.assertEqual(ctx.exception.status_code, 404)
        # Verify college_id filter was bound
        call_params = self.connection.execute.await_args_list[1].args[1]
        self.assertEqual(call_params["college_id"], COLLEGE_ID)

    def test_cancelled_session_rejected_with_409(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=session_row(status="CANCELLED")),
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.join_session_by_code(
                    self.connection, self.student, "ABCDEFG2"
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("cancelled", ctx.exception.detail)

    def test_completed_session_rejected_with_409(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=session_row(status="COMPLETED")),
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.join_session_by_code(
                    self.connection, self.student, "ABCDEFG2"
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("already completed", ctx.exception.detail)

    def test_ineligible_class_student_rejected_with_403(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=session_row(class_id=OTHER_CLASS_ID)),  # session for 10B
            make_result(scalar=None),  # enrollment check fails (student in 10A)
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.join_session_by_code(
                    self.connection, self.student, "ABCDEFG2"
                )
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("not actively enrolled", ctx.exception.detail)

    def test_missing_student_profile_rejected_with_403(self) -> None:
        self.connection.execute.return_value = make_result(scalar=None)

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.join_session_by_code(
                    self.connection, self.student, "ABCDEFG2"
                )
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("student profile", ctx.exception.detail)

    def test_rejoining_retrieves_existing_lobby_status_safely(self) -> None:
        existing_attempt = {
            "id": UUID("88888888-8888-4888-8888-888888888888"),
            "status": "IN_PROGRESS",
        }
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=session_row(status="ACTIVE")),  # session
            make_result(scalar=1),  # enrollment
            make_result(row=existing_attempt),  # existing attempt found
        ]

        lobby = run_async(
            student_service.join_session_by_code(
                self.connection, self.student, "ABCDEFG2"
            )
        )

        self.assertEqual(lobby["attempt_id"], existing_attempt["id"])
        self.assertEqual(lobby["attempt_status"], "IN_PROGRESS")
        self.assertTrue(lobby["is_joined"])

    def test_get_session_lobby_by_id(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=session_row(status="SCHEDULED")),  # session
            make_result(scalar=1),  # enrollment
            make_result(row=None),  # attempt
        ]

        lobby = run_async(
            student_service.get_session_lobby(
                self.connection, self.student, SESSION_ID
            )
        )

        self.assertEqual(lobby["session_id"], SESSION_ID)
        self.assertEqual(lobby["lobby_status"], "WAITING_FOR_TEACHER")
        self.assertTrue(lobby["is_waiting"])


if __name__ == "__main__":
    unittest.main()
