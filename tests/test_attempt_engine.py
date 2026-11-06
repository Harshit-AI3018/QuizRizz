import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError

from app.main import create_app
from app.schemas.auth import AuthenticatedUser
from app.schemas.student import StudentResponseSaveRequest
from app.services import student_service

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OTHER_COLLEGE_ID = UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")
STUDENT_ID = UUID("11111111-2222-4333-8444-555555555555")
OTHER_STUDENT_ID = UUID("99999999-8888-4777-8666-555555555555")
SESSION_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
ATTEMPT_ID = UUID("77777777-7777-4777-8777-777777777777")
CLASS_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
QUESTION_ID = UUID("22222222-2222-4222-8222-222222222222")
OPTION_1 = UUID("aaaaaaaa-1111-4111-8111-111111111111")
OPTION_2 = UUID("bbbbbbbb-2222-4222-8222-222222222222")
NOW = datetime.now(timezone.utc)
DEADLINE = NOW + timedelta(minutes=25)


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


def make_result(*, row=None, rows=None, scalar=None):
    result = MagicMock()
    result.mappings.return_value.one.return_value = row
    result.mappings.return_value.one_or_none.return_value = row
    result.mappings.return_value.all.return_value = rows or []
    result.scalar_one.return_value = scalar
    result.scalar_one_or_none.return_value = scalar
    return result


def sample_snapshot_questions():
    return [
        {
            "question_id": str(QUESTION_ID),
            "sequence_order": 1,
            "question_type": "MCQ",
            "question_text": "What is the speed of light in vacuum?",
            "marks": "4.00",
            "negative_penalty": "1.0000",
            "options": [
                {
                    "option_id": str(OPTION_1),
                    "option_text": "3 x 10^8 m/s",
                    "display_order": 1,
                },
                {
                    "option_id": str(OPTION_2),
                    "option_text": "3 x 10^6 m/s",
                    "display_order": 2,
                },
            ],
        }
    ]


class AttemptEngineStartTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.student = make_student()
        self.settings = MagicMock()

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_start_attempt_in_active_session_succeeds(self, _ticket: MagicMock) -> None:
        session_row = {
            "id": SESSION_ID,
            "status": "ACTIVE",
            "class_id": CLASS_ID,
            "duration_minutes": 25,
        }
        sp_result = {
            "attempt_id": ATTEMPT_ID,
            "status": "IN_PROGRESS",
            "deadline": DEADLINE,
            "duration_minutes": 25,
            "snapshot_questions": sample_snapshot_questions(),
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # student profile exists
            make_result(row=session_row),  # session is active
            make_result(scalar=1),  # student enrolled
            make_result(row=None),  # no existing finalized attempt
            make_result(row=sp_result),  # sp_start_quiz_attempt
            make_result(rows=[]),  # saved responses empty
        ]

        attempt = run_async(
            student_service.start_quiz_attempt(
                self.connection, self.student, SESSION_ID, self.settings
            )
        )

        self.assertEqual(attempt["attempt_id"], ATTEMPT_ID)
        self.assertEqual(attempt["status"], "IN_PROGRESS")
        self.assertEqual(attempt["duration_minutes"], 25)
        self.assertEqual(len(attempt["questions"]), 1)
        self.assertEqual(len(attempt["questions"][0]["options"]), 2)

        # Verify correct answers are NOT in the question options
        for opt in attempt["questions"][0]["options"]:
            self.assertNotIn("is_correct", opt)

        # Verify procedure statement invoked with actor HMAC
        proc_call = str(self.connection.execute.await_args_list[4].args[0])
        self.assertIn("sp_start_quiz_attempt", proc_call)
        self.connection.commit.assert_awaited_once()

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_duplicate_start_request_safely_retrieves_existing_attempt(self, _ticket: MagicMock) -> None:
        session_row = {
            "id": SESSION_ID,
            "status": "ACTIVE",
            "class_id": CLASS_ID,
            "duration_minutes": 25,
        }
        sp_result = {
            "attempt_id": ATTEMPT_ID,
            "status": "IN_PROGRESS",
            "deadline": DEADLINE,
            "duration_minutes": 25,
            "snapshot_questions": sample_snapshot_questions(),
        }
        saved_row = {
            "attempt_id": ATTEMPT_ID,
            "question_id": QUESTION_ID,
            "selected_option_ids": [OPTION_1],
            "is_marked_for_review": False,
            "client_version": 1,
            "client_submitted_at": NOW,
            "server_received_at": NOW,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=session_row),  # active session
            make_result(scalar=1),  # enrollment
            make_result(row={"id": ATTEMPT_ID, "status": "IN_PROGRESS"}),  # existing in-progress attempt
            make_result(row=sp_result),  # sp_start_quiz_attempt idempotency
            make_result(rows=[saved_row]),  # saved responses returned
        ]

        attempt = run_async(
            student_service.start_quiz_attempt(
                self.connection, self.student, SESSION_ID, self.settings
            )
        )

        self.assertEqual(attempt["attempt_id"], ATTEMPT_ID)
        self.assertEqual(len(attempt["saved_responses"]), 1)
        self.assertEqual(attempt["saved_responses"][0]["question_id"], QUESTION_ID)

    def test_start_attempt_cross_college_rejected(self) -> None:
        # Session row not found in student's college
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=None),  # not found in college
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.start_quiz_attempt(
                    self.connection, self.student, SESSION_ID, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("Session not found", ctx.exception.detail)

    def test_start_attempt_rejects_non_active_sessions(self) -> None:
        for bad_status in ("SCHEDULED", "PAUSED", "COMPLETED", "CANCELLED"):
            session_row = {
                "id": SESSION_ID,
                "status": bad_status,
                "class_id": CLASS_ID,
                "duration_minutes": 25,
            }
            self.connection.execute.side_effect = [
                make_result(scalar=1),  # profile
                make_result(row=session_row),  # non-active session
            ]

            with self.assertRaises(HTTPException) as ctx:
                run_async(
                    student_service.start_quiz_attempt(
                        self.connection, self.student, SESSION_ID, self.settings
                    )
                )

            self.assertEqual(ctx.exception.status_code, 409)
            self.assertIn("not currently ACTIVE", ctx.exception.detail)

    def test_start_attempt_rejects_finalized_attempt(self) -> None:
        session_row = {
            "id": SESSION_ID,
            "status": "ACTIVE",
            "class_id": CLASS_ID,
            "duration_minutes": 25,
        }
        finalized_row = {"id": ATTEMPT_ID, "status": "FINALIZED"}

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=session_row),  # active session
            make_result(scalar=1),  # enrollment
            make_result(row=finalized_row),  # already finalized
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.start_quiz_attempt(
                    self.connection, self.student, SESSION_ID, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("already been finalized", ctx.exception.detail)

    def test_start_attempt_rejects_unenrolled_student(self) -> None:
        session_row = {
            "id": SESSION_ID,
            "status": "ACTIVE",
            "class_id": CLASS_ID,
            "duration_minutes": 25,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=session_row),  # active session
            make_result(scalar=None),  # enrollment check fails
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.start_quiz_attempt(
                    self.connection, self.student, SESSION_ID, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("not actively enrolled", ctx.exception.detail)

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_start_attempt_does_not_modify_session_schedule(self, _ticket: MagicMock) -> None:
        """Security: student-triggered start_quiz_attempt must NOT UPDATE quiz_sessions."""
        session_row = {
            "id": SESSION_ID,
            "status": "ACTIVE",
            "class_id": CLASS_ID,
            "duration_minutes": 25,
        }
        sp_result = {
            "attempt_id": ATTEMPT_ID,
            "status": "IN_PROGRESS",
            "deadline": DEADLINE,
            "duration_minutes": 25,
            "snapshot_questions": sample_snapshot_questions(),
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),   # student profile exists
            make_result(row=session_row),  # session is active
            make_result(scalar=1),   # student enrolled
            make_result(row=None),   # no existing finalized attempt
            make_result(row=sp_result),   # sp_start_quiz_attempt
            make_result(rows=[]),    # saved responses empty
        ]

        run_async(
            student_service.start_quiz_attempt(
                self.connection, self.student, SESSION_ID, self.settings
            )
        )

        # Assert that none of the SQL calls issued an UPDATE to quiz_sessions
        for call_args in self.connection.execute.await_args_list:
            stmt = str(call_args.args[0]).lower()
            self.assertNotIn(
                "update quiz_sessions",
                stmt,
                msg="start_quiz_attempt must not issue UPDATE quiz_sessions (session schedule is teacher-only)",
            )

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_start_attempt_schedule_window_error_no_session_mutation(self, _ticket: MagicMock) -> None:
        """Security: when sp_start_quiz_attempt raises a DBAPIError (e.g. schedule window),
        no UPDATE quiz_sessions is issued before the error — the student cannot mutate session state."""
        from sqlalchemy.exc import DBAPIError

        session_row = {
            "id": SESSION_ID,
            "status": "ACTIVE",
            "class_id": CLASS_ID,
            "duration_minutes": 25,
        }

        # Simulate the stored procedure raising a P0001 with schedule window message.
        # Build orig with the pgcode that _procedure_http_error checks.
        orig_exc = MagicMock()
        orig_exc.pgcode = "P0001"
        orig_exc.sqlstate = "P0001"
        orig_exc.message = "Current time is outside session schedule window"
        orig_exc.__str__ = MagicMock(return_value="Current time is outside session schedule window")
        sp_error = DBAPIError("SELECT sp_start_quiz_attempt(...)", {}, orig_exc)
        sp_error.orig = orig_exc

        self.connection.execute.side_effect = [
            make_result(scalar=1),       # student profile exists
            make_result(row=session_row),  # session is active
            make_result(scalar=1),       # student enrolled
            make_result(row=None),       # no existing finalized attempt
            sp_error,                    # sp_start_quiz_attempt raises schedule error
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.start_quiz_attempt(
                    self.connection, self.student, SESSION_ID, self.settings
                )
            )

        # _procedure_http_error maps "schedule window" + P0001 → 409
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("schedule window", ctx.exception.detail.lower())

        # Core security invariant: no UPDATE to quiz_sessions was issued
        for call_args in self.connection.execute.await_args_list:
            stmt = str(call_args.args[0]).lower()
            self.assertNotIn(
                "update quiz_sessions",
                stmt,
                msg="start_quiz_attempt must not issue UPDATE quiz_sessions (session schedule is teacher-only)",
            )


class ResponseAutosaveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.student = make_student()
        self.settings = MagicMock()

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_successful_single_select_response_saving(self, _ticket: MagicMock) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 25,
        }
        sp_result = {
            "sync_status": "ACCEPTED",
            "persisted_version": 1,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=attempt_row),  # get_attempt check
            make_result(row=sp_result),  # sp_save_student_response
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1],
            is_marked_for_review=False,
            client_version=1,
        )

        res = run_async(
            student_service.save_student_response(
                self.connection, self.student, ATTEMPT_ID, req, self.settings
            )
        )

        self.assertEqual(res["sync_status"], "ACCEPTED")
        self.assertEqual(res["persisted_version"], 1)
        self.assertEqual(res["question_id"], QUESTION_ID)

        # Verify call parameters
        proc_call = str(self.connection.execute.await_args_list[2].args[0])
        self.assertIn("sp_save_student_response", proc_call)
        self.assertIn("result_status AS sync_status", proc_call)
        self.assertIn("CAST(:selected_option_ids AS UUID[])", proc_call)
        self.connection.commit.assert_awaited_once()

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_successful_multi_select_response_saving(self, _ticket: MagicMock) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 25,
        }
        sp_result = {
            "sync_status": "ACCEPTED",
            "persisted_version": 2,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=attempt_row),  # get_attempt
            make_result(row=sp_result),  # sp_save_student_response
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1, OPTION_2],  # multi-select
            is_marked_for_review=True,
            client_version=2,
        )

        res = run_async(
            student_service.save_student_response(
                self.connection, self.student, ATTEMPT_ID, req, self.settings
            )
        )

        self.assertEqual(res["sync_status"], "ACCEPTED")
        self.assertEqual(res["persisted_version"], 2)

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_save_responses_for_multiple_separate_questions(self, _ticket: MagicMock) -> None:
        """Autosave saves responses for multiple questions independently without cross-contamination."""
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 25,
        }
        sp_result_q1 = {"sync_status": "ACCEPTED", "persisted_version": 1}
        sp_result_q2 = {"sync_status": "ACCEPTED", "persisted_version": 1}

        # First question save
        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=attempt_row),
            make_result(row=sp_result_q1),
        ]
        req_q1 = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1],
            is_marked_for_review=False,
            client_version=1,
        )
        res_q1 = run_async(
            student_service.save_student_response(
                self.connection, self.student, ATTEMPT_ID, req_q1, self.settings
            )
        )
        self.assertEqual(res_q1["question_id"], QUESTION_ID)
        self.assertEqual(res_q1["sync_status"], "ACCEPTED")

        # Second question save with different question_id
        q2_id = UUID("33333333-3333-4333-8333-333333333333")
        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=attempt_row),
            make_result(row=sp_result_q2),
        ]
        req_q2 = StudentResponseSaveRequest(
            question_id=q2_id,
            selected_option_ids=[OPTION_2],
            is_marked_for_review=True,
            client_version=1,
        )
        res_q2 = run_async(
            student_service.save_student_response(
                self.connection, self.student, ATTEMPT_ID, req_q2, self.settings
            )
        )
        self.assertEqual(res_q2["question_id"], q2_id)
        self.assertEqual(res_q2["sync_status"], "ACCEPTED")

    def test_cannot_save_response_for_another_student_attempt(self) -> None:
        # Attempt not found under this student's scope
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=None),  # attempt not found for this student
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1],
            client_version=1,
        )

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.save_student_response(
                    self.connection, self.student, ATTEMPT_ID, req, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("Quiz attempt not found", ctx.exception.detail)

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_idempotent_retry_returns_200(self, _ticket: MagicMock) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 25,
        }
        sp_result = {
            "sync_status": "IDEMPOTENT_RETRY",
            "persisted_version": 2,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=attempt_row),
            make_result(row=sp_result),
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1],
            is_marked_for_review=False,
            client_version=2,
        )

        res = run_async(
            student_service.save_student_response(
                self.connection, self.student, ATTEMPT_ID, req, self.settings
            )
        )

        self.assertEqual(res["sync_status"], "IDEMPOTENT_RETRY")
        self.assertEqual(res["persisted_version"], 2)

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_stale_response_rejected_with_409(self, _ticket: MagicMock) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 25,
        }
        sp_result = {
            "sync_status": "STALE_REJECTED",
            "persisted_version": 3,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=attempt_row),
            make_result(row=sp_result),
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1],
            is_marked_for_review=False,
            client_version=2,  # older than 3
        )

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.save_student_response(
                    self.connection, self.student, ATTEMPT_ID, req, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Stale response rejected", ctx.exception.detail)

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_version_conflict_rejected_with_409(self, _ticket: MagicMock) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 25,
        }
        sp_result = {
            "sync_status": "VERSION_CONFLICT",
            "persisted_version": 2,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=attempt_row),
            make_result(row=sp_result),
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_2],  # changed option on same version
            is_marked_for_review=False,
            client_version=2,
        )

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.save_student_response(
                    self.connection, self.student, ATTEMPT_ID, req, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Version conflict", ctx.exception.detail)

    def test_expired_attempt_rejected_with_409(self) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW - timedelta(minutes=30),
            "deadline": NOW - timedelta(minutes=5),  # expired 5 min ago
            "duration_minutes": 25,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=attempt_row),
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1],
            is_marked_for_review=False,
            client_version=1,
        )

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.save_student_response(
                    self.connection, self.student, ATTEMPT_ID, req, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("deadline has passed", ctx.exception.detail)

    def test_duplicate_option_ids_rejected_by_schema(self) -> None:
        with self.assertRaises(ValueError):
            StudentResponseSaveRequest(
                question_id=QUESTION_ID,
                selected_option_ids=[OPTION_1, OPTION_1],  # duplicate
                client_version=1,
            )

    @patch("app.services.student_service.create_actor_ticket", return_value="hmac_ticket")
    def test_procedure_validation_error_translated_to_422(self, _ticket: MagicMock) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 25,
        }

        orig_error = MagicMock()
        orig_error.sqlstate = "P0001"
        orig_error.message = "MCQ questions permit at most 1 selected option\nCONTEXT: PL/pgSQL function sp_save_student_response"
        orig_error.__str__ = MagicMock(return_value=orig_error.message)
        db_exc = DBAPIError("SELECT sp_save_student_response", {}, orig_error)

        self.connection.execute.side_effect = [
            make_result(scalar=1),
            make_result(row=attempt_row),
            db_exc,
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1, OPTION_2],
            is_marked_for_review=False,
            client_version=1,
        )

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.save_student_response(
                    self.connection, self.student, ATTEMPT_ID, req, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("permit at most 1", ctx.exception.detail)

    def test_save_student_response_rejected_if_already_finalized(self) -> None:
        """Autosave must reject responses for FINALIZED attempts with HTTP 409."""
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "FINALIZED",
            "started_at": NOW - timedelta(minutes=20),
            "deadline": NOW + timedelta(minutes=10),
            "duration_minutes": 30,
            "finalized_at": NOW,
            "submission_type": "MANUAL",
            "total_score": Decimal("10.00"),
        }
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile exists
            make_result(row=attempt_row),  # attempt fetch
        ]

        req = StudentResponseSaveRequest(
            question_id=QUESTION_ID,
            selected_option_ids=[OPTION_1],
            is_marked_for_review=False,
            client_version=1,
        )

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.save_student_response(
                    self.connection, self.student, ATTEMPT_ID, req, self.settings
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Cannot save response: Attempt is already FINALIZED", ctx.exception.detail)


class AttemptRetrievalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.student = make_student()

    def test_get_attempt_calculates_remaining_seconds_and_expiration(self) -> None:
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=10),
            "duration_minutes": 25,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=attempt_row),  # attempt
        ]

        attempt = run_async(
            student_service.get_attempt(self.connection, self.student, ATTEMPT_ID)
        )

        self.assertEqual(attempt["attempt_id"], ATTEMPT_ID)
        self.assertFalse(attempt["is_expired"])
        self.assertGreater(attempt["time_remaining_seconds"], 500)

    def test_get_attempt_questions_strips_correct_answers(self) -> None:
        # Test that the relational query path never exposes is_correct or explanation.
        # The old snapshot_json code path has been removed; correct answers were never
        # in the relational query columns, so this test verifies the structural guarantee.
        relational_rows = [
            {
                "attempt_id": ATTEMPT_ID,
                "question_id": QUESTION_ID,
                "sequence_order": 1,
                "question_type": "MCQ",
                "question_text": "Is this secure?",
                "marks": Decimal("5.00"),
                "negative_penalty": Decimal("1.0000"),
                "option_id": OPTION_1,
                "option_text": "Yes",
                "display_order": 1,
                # Note: is_correct and explanation are intentionally absent
                # (they are REVOKED at the column level for campusquiz_app role)
            },
            {
                "attempt_id": ATTEMPT_ID,
                "question_id": QUESTION_ID,
                "sequence_order": 1,
                "question_type": "MCQ",
                "question_text": "Is this secure?",
                "marks": Decimal("5.00"),
                "negative_penalty": Decimal("1.0000"),
                "option_id": OPTION_2,
                "option_text": "No",
                "display_order": 2,
            },
        ]

        self.connection.execute.side_effect = [
            make_result(scalar=1),             # profile exists
            make_result(rows=relational_rows), # relational query returns rows without is_correct
        ]

        questions = run_async(
            student_service.get_attempt_questions(self.connection, self.student, ATTEMPT_ID)
        )

        self.assertEqual(len(questions), 1)
        q = questions[0]
        # Sensitive fields must not be present in the output
        self.assertNotIn("explanation", q)
        self.assertNotIn("is_correct", q)
        for opt in q["options"]:
            self.assertNotIn("is_correct", opt)
        # Confirm snapshot_json is not in the executed SQL
        executed_sql = str(self.connection.execute.await_args_list[1].args[0])
        self.assertNotIn("snapshot_json", executed_sql)

    def test_get_saved_responses_preserves_student_answers(self) -> None:
        saved_rows = [
            {
                "attempt_id": ATTEMPT_ID,
                "question_id": QUESTION_ID,
                "selected_option_ids": [OPTION_1],
                "is_marked_for_review": True,
                "client_version": 2,
                "client_submitted_at": NOW,
                "server_received_at": NOW,
            }
        ]

        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=10),
            "duration_minutes": 25,
        }

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile
            make_result(row=attempt_row),  # get_attempt check
            make_result(rows=saved_rows),  # student_responses query
        ]

        responses = run_async(
            student_service.get_saved_responses(self.connection, self.student, ATTEMPT_ID)
        )

        self.assertEqual(len(responses), 1)
        self.assertEqual(responses[0]["question_id"], QUESTION_ID)
        self.assertEqual(responses[0]["selected_option_ids"], [OPTION_1])
        self.assertTrue(responses[0]["is_marked_for_review"])
        self.assertEqual(responses[0]["client_version"], 2)

    def test_get_attempt_questions_via_relational_tables_without_snapshot_json(self) -> None:
        relational_rows = [
            {
                "attempt_id": ATTEMPT_ID,
                "question_id": QUESTION_ID,
                "sequence_order": 1,
                "question_type": "MCQ",
                "question_text": "What is the speed of light in vacuum?",
                "marks": Decimal("4.00"),
                "negative_penalty": Decimal("1.0000"),
                "option_id": OPTION_1,
                "option_text": "3 x 10^8 m/s",
                "display_order": 1,
            },
            {
                "attempt_id": ATTEMPT_ID,
                "question_id": QUESTION_ID,
                "sequence_order": 1,
                "question_type": "MCQ",
                "question_text": "What is the speed of light in vacuum?",
                "marks": Decimal("4.00"),
                "negative_penalty": Decimal("1.0000"),
                "option_id": OPTION_2,
                "option_text": "3 x 10^6 m/s",
                "display_order": 2,
            },
        ]

        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile exists
            make_result(rows=relational_rows),  # relational query without snapshot_json
        ]

        questions = run_async(
            student_service.get_attempt_questions(self.connection, self.student, ATTEMPT_ID)
        )

        self.assertEqual(len(questions), 1)
        q = questions[0]
        self.assertEqual(q["question_id"], QUESTION_ID)
        self.assertEqual(q["sequence_order"], 1)
        self.assertEqual(q["question_type"], "MCQ")
        self.assertEqual(q["marks"], Decimal("4.00"))
        self.assertEqual(q["negative_penalty"], Decimal("1.0000"))
        self.assertEqual(len(q["options"]), 2)
        self.assertEqual(q["options"][0]["option_id"], OPTION_1)
        self.assertEqual(q["options"][1]["option_id"], OPTION_2)

        # Confirm neither options nor question expose answers or explanations
        self.assertNotIn("explanation", q)
        for opt in q["options"]:
            self.assertNotIn("is_correct", opt)

        # Confirm the query did NOT touch quiz_sessions.snapshot_json
        executed_sql = str(self.connection.execute.await_args_list[1].args[0])
        self.assertNotIn("snapshot_json", executed_sql)
        self.assertIn("quiz_attempts", executed_sql)
        self.assertIn("question_options", executed_sql)

    def test_get_attempt_questions_attempt_not_found_raises_404(self) -> None:
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile exists
            make_result(rows=[]),   # no question rows found
            make_result(row=None),  # attempt check returns None
        ]

        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.get_attempt_questions(self.connection, self.student, ATTEMPT_ID)
            )
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertIn("Quiz attempt not found", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
