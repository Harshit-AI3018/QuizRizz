import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError

from app.main import create_app
from app.schemas.auth import AuthenticatedUser
from app.schemas.lifecycle import QuizSessionCreate
from app.services import lifecycle_service

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OTHER_COLLEGE_ID = UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")
FACULTY_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
OTHER_FACULTY_ID = UUID("99999999-9999-4999-8999-999999999999")
QUIZ_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
CLASS_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
SESSION_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
SESSION_ID_2 = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2")
SUBJECT_ID = UUID("11111111-1111-4111-8111-111111111111")
QUESTION_ID = UUID("22222222-2222-4222-8222-222222222222")
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


def make_admin(*, admin_id=FACULTY_ID, college_id=COLLEGE_ID) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=admin_id,
        college_id=college_id,
        email="admin@example.edu",
        first_name="Admin",
        last_name="User",
        roles=["ADMIN"],
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


def quiz_row(*, status="PUBLISHED", questions=None, faculty_user_id=FACULTY_ID, college_id=COLLEGE_ID):
    if questions is None:
        questions = [{"question_id": QUESTION_ID, "sequence_order": 1, "marks_override": Decimal("5.00")}]
    return {
        "id": QUIZ_ID,
        "college_id": college_id,
        "faculty_user_id": faculty_user_id,
        "subject_id": SUBJECT_ID,
        "status": status,
        "default_duration_minutes": 25,
        "default_result_visibility": "AFTER_SESSION_ENDS",
        "questions": questions,
    }


def session_row(*, session_id=SESSION_ID, status="SCHEDULED", faculty_user_id=FACULTY_ID, college_id=COLLEGE_ID, results_released_at=None):
    return {
        "id": session_id,
        "college_id": college_id,
        "quiz_id": QUIZ_ID,
        "faculty_user_id": faculty_user_id,
        "class_id": CLASS_ID,
        "session_code": "ABCDEFG2",
        "session_mode": "STUDENT_PACED",
        "status": status,
        "start_window_time": NOW,
        "end_window_time": NOW + timedelta(hours=1),
        "actual_started_at": NOW if status != "SCHEDULED" else None,
        "actual_ended_at": NOW if status in ("COMPLETED", "CANCELLED") else None,
        "duration_minutes": 25,
        "negative_marking_enabled": None,
        "negative_penalty": None,
        "result_visibility": "AFTER_SESSION_ENDS",
        "results_released_at": results_released_at,
        "created_at": NOW,
        "updated_at": NOW,
    }


class LifecycleSchemaTests(unittest.TestCase):
    def test_session_window_requires_timezone(self) -> None:
        with self.assertRaises(ValueError):
            QuizSessionCreate(
                quiz_id=QUIZ_ID,
                class_id=CLASS_ID,
                start_window_time=datetime(2026, 11, 3, 10),
                end_window_time=datetime(2026, 11, 3, 11),
            )

    def test_session_window_requires_end_after_start(self) -> None:
        with self.assertRaises(ValueError):
            QuizSessionCreate(
                quiz_id=QUIZ_ID,
                class_id=CLASS_ID,
                start_window_time=NOW,
                end_window_time=NOW,
            )

    def test_student_role_is_rejected_by_lifecycle_gate(self) -> None:
        from app.api.deps import require_roles
        actor = make_faculty().model_copy(update={"roles": ["STUDENT"]})
        with self.assertRaises(HTTPException) as ctx:
            run_async(require_roles("FACULTY", "ADMIN")(actor))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_lifecycle_routes_require_bearer_auth_and_do_not_define_snapshot(self) -> None:
        openapi = create_app().openapi()
        expected_paths = {
            "/api/v1/quizzes/{quiz_id}/publish",
            "/api/v1/sessions",
            "/api/v1/sessions/{session_id}",
            "/api/v1/sessions/{session_id}/{action}",
        }
        self.assertTrue(expected_paths <= openapi["paths"].keys())
        self.assertNotIn(
            "snapshot_json",
            openapi["components"]["schemas"]["QuizSessionRead"]["properties"],
        )
        for path in expected_paths:
            for operation in openapi["paths"][path].values():
                self.assertIn("security", operation)


class LifecyclePublishingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.actor = make_faculty()
        self.settings = MagicMock()

    @patch("app.services.lifecycle_service.create_actor_ticket", return_value="ticket")
    @patch("app.services.lifecycle_service.authoring_service.get_quiz", new_callable=AsyncMock)
    def test_successful_quiz_publishing(
        self,
        get_quiz: AsyncMock,
        _ticket: MagicMock,
    ) -> None:
        get_quiz.return_value = quiz_row(status="DRAFT")
        procedure_result = {
            "quiz_id": QUIZ_ID,
            "status": "PUBLISHED",
            "total_marks": Decimal("12.50"),
        }
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # assignment check
            make_result(row=procedure_result),  # sp_publish_quiz
        ]

        published = run_async(lifecycle_service.publish_quiz(
            self.connection,
            self.actor,
            QUIZ_ID,
            self.settings,
        ))

        self.assertEqual(published["status"], "PUBLISHED")
        self.assertEqual(published["total_marks"], Decimal("12.50"))
        self.assertIn("sp_publish_quiz", str(self.connection.execute.await_args_list[1].args[0]))
        self.connection.commit.assert_awaited_once()

    @patch("app.services.lifecycle_service.authoring_service.get_quiz", new_callable=AsyncMock)
    def test_empty_quiz_rejection(self, get_quiz: AsyncMock) -> None:
        get_quiz.return_value = quiz_row(status="DRAFT", questions=[])
        self.connection.execute.return_value = make_result(scalar=1)

        with self.assertRaises(HTTPException) as ctx:
            run_async(lifecycle_service.publish_quiz(
                self.connection,
                self.actor,
                QUIZ_ID,
                self.settings,
            ))

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("at least one question", ctx.exception.detail)
        self.connection.commit.assert_not_awaited()

    @patch("app.services.lifecycle_service.authoring_service.get_quiz", new_callable=AsyncMock)
    def test_already_published_quiz_rejection(self, get_quiz: AsyncMock) -> None:
        get_quiz.return_value = quiz_row(status="PUBLISHED")

        with self.assertRaises(HTTPException) as ctx:
            run_async(lifecycle_service.publish_quiz(
                self.connection,
                self.actor,
                QUIZ_ID,
                self.settings,
            ))

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("only DRAFT quizzes can be published", ctx.exception.detail)
        self.connection.commit.assert_not_awaited()

    @patch("app.services.lifecycle_service.create_actor_ticket", return_value="ticket")
    @patch("app.services.lifecycle_service.authoring_service.get_quiz", new_callable=AsyncMock)
    def test_invalid_question_or_option_rejection(
        self,
        get_quiz: AsyncMock,
        _ticket: MagicMock,
    ) -> None:
        get_quiz.return_value = quiz_row(status="DRAFT")

        orig_error = MagicMock()
        orig_error.sqlstate = "P0001"
        orig_error.message = "MCQ Question 123 must have at least 2 options\nCONTEXT: PL/pgSQL function fn_validate_quiz_for_publishing"
        orig_error.__str__ = MagicMock(return_value=orig_error.message)
        db_exc = DBAPIError("SELECT sp_publish_quiz", {}, orig_error)

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # assignment
            db_exc,  # sp_publish_quiz fails validation
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(lifecycle_service.publish_quiz(
                self.connection,
                self.actor,
                QUIZ_ID,
                self.settings,
            ))

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("must have at least 2 options", ctx.exception.detail)
        self.connection.rollback.assert_awaited_once()

    @patch("app.services.lifecycle_service.authoring_service.get_quiz", new_callable=AsyncMock)
    def test_unauthorized_teacher_publishing(self, get_quiz: AsyncMock) -> None:
        get_quiz.return_value = quiz_row(status="DRAFT")
        # No active assignment
        self.connection.execute.return_value = make_result(scalar=None)

        with self.assertRaises(HTTPException) as ctx:
            run_async(lifecycle_service.publish_quiz(
                self.connection,
                self.actor,
                QUIZ_ID,
                self.settings,
            ))

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("No active faculty assignment", ctx.exception.detail)


class LifecycleSessionCreationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.actor = make_faculty()

    @patch("app.services.lifecycle_service._new_session_code", return_value="ABCDEFG2")
    @patch("app.services.lifecycle_service.authoring_service.get_quiz", new_callable=AsyncMock)
    def test_successful_session_creation(
        self,
        get_quiz: AsyncMock,
        _session_code: MagicMock,
    ) -> None:
        get_quiz.return_value = quiz_row(status="PUBLISHED")
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # assignment check
            make_result(scalar=SESSION_ID),  # INSERT RETURNING id
            make_result(row=session_row()),  # _get_session
        ]
        request = QuizSessionCreate(
            quiz_id=QUIZ_ID,
            class_id=CLASS_ID,
            start_window_time=NOW,
            end_window_time=NOW + timedelta(hours=1),
        )

        created = run_async(lifecycle_service.create_session(
            self.connection,
            self.actor,
            request,
        ))

        self.assertEqual(created["session_code"], "ABCDEFG2")
        self.assertEqual(created["status"], "SCHEDULED")
        insert_args = self.connection.execute.await_args_list[1].args
        insert_stmt = str(insert_args[0])
        insert_params = insert_args[1]
        self.assertNotIn("snapshot_json", insert_stmt)
        self.assertEqual(insert_params["duration_minutes"], 25)
        self.assertEqual(insert_params["result_visibility"], "AFTER_SESSION_ENDS")
        self.assertEqual(insert_params["faculty_user_id"], FACULTY_ID)
        self.assertNotIn("snapshot_json", created)
        self.connection.commit.assert_awaited_once()

    def test_session_code_format_and_entropy(self) -> None:
        codes = [lifecycle_service._new_session_code() for _ in range(100)]
        for code in codes:
            self.assertEqual(len(code), 8)
            self.assertTrue(code.isalnum())
            self.assertTrue(code.isupper())
            for c in code:
                self.assertIn(c, lifecycle_service._SESSION_CODE_ALPHABET)
        self.assertEqual(len(set(codes)), 100)

    @patch("app.services.lifecycle_service.authoring_service.get_quiz", new_callable=AsyncMock)
    def test_multiple_sessions_for_same_quiz(self, get_quiz: AsyncMock) -> None:
        get_quiz.return_value = quiz_row(status="PUBLISHED")
        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(scalar=SESSION_ID),
            make_result(row=session_row(session_id=SESSION_ID)),
            make_result(scalar=1),
            make_result(scalar=SESSION_ID_2),
            make_result(row=session_row(session_id=SESSION_ID_2)),
        ]
        request = QuizSessionCreate(
            quiz_id=QUIZ_ID,
            class_id=CLASS_ID,
            start_window_time=NOW,
            end_window_time=NOW + timedelta(hours=1),
        )

        s1 = run_async(lifecycle_service.create_session(self.connection, self.actor, request))
        s2 = run_async(lifecycle_service.create_session(self.connection, self.actor, request))

        self.assertEqual(s1["id"], SESSION_ID)
        self.assertEqual(s2["id"], SESSION_ID_2)
        self.assertEqual(s1["quiz_id"], s2["quiz_id"])
        self.assertEqual(get_quiz.return_value["status"], "PUBLISHED")


class LifecycleTransitionsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.actor = make_faculty()
        self.settings = MagicMock()

    @patch("app.services.lifecycle_service.create_actor_ticket", return_value="ticket")
    def test_valid_transitions_activate_pause_resume_complete(
        self,
        _ticket: MagicMock,
    ) -> None:
        # 1. Activate
        self.connection.execute.side_effect = [
            make_result(row=session_row(status="SCHEDULED")),
            make_result(scalar='{"snapshot": "data"}'),
            make_result(row=session_row(status="ACTIVE")),
        ]
        active = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "activate", self.settings
        ))
        self.assertEqual(active["status"], "ACTIVE")
        self.assertIn("sp_activate_quiz_session", str(self.connection.execute.await_args_list[1].args[0]))

        # 2. Pause
        self.connection.execute.side_effect = [
            make_result(row=session_row(status="ACTIVE")),
            make_result(scalar="PAUSED"),
            make_result(row=session_row(status="PAUSED")),
        ]
        paused = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "pause", self.settings
        ))
        self.assertEqual(paused["status"], "PAUSED")
        self.assertIn("sp_pause_quiz_session", str(self.connection.execute.await_args_list[-2].args[0]))

        # 3. Resume
        self.connection.execute.side_effect = [
            make_result(row=session_row(status="PAUSED")),
            make_result(scalar="ACTIVE"),
            make_result(row=session_row(status="ACTIVE")),
        ]
        resumed = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "resume", self.settings
        ))
        self.assertEqual(resumed["status"], "ACTIVE")
        self.assertIn("sp_resume_quiz_session", str(self.connection.execute.await_args_list[-2].args[0]))

        # 4. Complete / End
        self.connection.execute.side_effect = [
            make_result(row=session_row(status="ACTIVE")),
            make_result(scalar="COMPLETED"),
            make_result(row=session_row(status="COMPLETED")),
        ]
        completed = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "complete", self.settings
        ))
        self.assertEqual(completed["status"], "COMPLETED")
        self.assertIn("sp_complete_quiz_session", str(self.connection.execute.await_args_list[-2].args[0]))

    @patch("app.services.lifecycle_service.create_actor_ticket", return_value="ticket")
    def test_session_cancellation(self, _ticket: MagicMock) -> None:
        self.connection.execute.side_effect = [
            make_result(row=session_row(status="SCHEDULED")),
            make_result(scalar="CANCELLED"),
            make_result(row=session_row(status="CANCELLED")),
        ]
        cancelled = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "cancel", self.settings
        ))
        self.assertEqual(cancelled["status"], "CANCELLED")
        self.assertIn("sp_cancel_quiz_session", str(self.connection.execute.await_args_list[1].args[0]))

    def test_invalid_lifecycle_transitions(self) -> None:
        # SCHEDULED -> pause (invalid)
        self.connection.execute.return_value = make_result(row=session_row(status="SCHEDULED"))
        with self.assertRaises(HTTPException) as ctx:
            run_async(lifecycle_service.transition_session(
                self.connection, self.actor, SESSION_ID, "pause", self.settings
            ))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Invalid session transition from SCHEDULED to PAUSED", ctx.exception.detail)

        # COMPLETED -> activate (terminal)
        self.connection.execute.return_value = make_result(row=session_row(status="COMPLETED"))
        with self.assertRaises(HTTPException) as ctx:
            run_async(lifecycle_service.transition_session(
                self.connection, self.actor, SESSION_ID, "activate", self.settings
            ))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Cannot transition session out of terminal status COMPLETED", ctx.exception.detail)

    def test_repeated_requests_handled_safely(self) -> None:
        # Repeating activate when already ACTIVE returns 200 without error
        self.connection.execute.return_value = make_result(row=session_row(status="ACTIVE"))
        result = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "activate", self.settings
        ))
        self.assertEqual(result["status"], "ACTIVE")

        # Repeating pause when already PAUSED returns 200 without error
        self.connection.execute.return_value = make_result(row=session_row(status="PAUSED"))
        result = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "pause", self.settings
        ))
        self.assertEqual(result["status"], "PAUSED")

        # Repeating complete when already COMPLETED returns 200 without error
        self.connection.execute.return_value = make_result(row=session_row(status="COMPLETED"))
        result = run_async(lifecycle_service.transition_session(
            self.connection, self.actor, SESSION_ID, "complete", self.settings
        ))
        self.assertEqual(result["status"], "COMPLETED")

    def test_session_ending_and_cancelling_does_not_modify_reusable_quiz(self) -> None:
        self.connection.execute.side_effect = [
            make_result(row=session_row(status="ACTIVE")),
            make_result(scalar="COMPLETED"),
            make_result(row=session_row(status="COMPLETED")),
        ]
        with patch("app.services.lifecycle_service.create_actor_ticket", return_value="ticket"):
            run_async(lifecycle_service.transition_session(
                self.connection, self.actor, SESSION_ID, "complete", self.settings
            ))
        for call_args in self.connection.execute.await_args_list:
            stmt = str(call_args.args[0]).lower()
            self.assertNotIn("update quizzes", stmt)
            self.assertNotIn("delete from quizzes", stmt)

    def test_cross_college_and_unauthorized_access_rejected(self) -> None:
        self.connection.execute.return_value = make_result(row=None)
        with self.assertRaises(HTTPException) as ctx:
            run_async(lifecycle_service.get_session(
                self.connection, self.actor, SESSION_ID
            ))
        self.assertEqual(ctx.exception.status_code, 404)

        statement, parameters = self.connection.execute.await_args.args
        self.assertEqual(parameters["college_id"], COLLEGE_ID)
        self.assertEqual(parameters["actor_id"], FACULTY_ID)


if __name__ == "__main__":
    unittest.main()
