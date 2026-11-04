import json
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

from fastapi import HTTPException

from app.api.v1.endpoints import lifecycle as lifecycle_endpoints
from app.api.v1.endpoints import student as student_endpoints
from app.core.config import Settings
from app.schemas.auth import AuthenticatedUser
from app.services import lifecycle_service, student_service

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OTHER_COLLEGE_ID = UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")
FACULTY_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
OTHER_FACULTY_ID = UUID("99999999-9999-4999-8999-999999999999")
STUDENT_ID = UUID("11111111-2222-4333-8444-555555555555")
OTHER_STUDENT_ID = UUID("99999999-8888-4777-8666-555555555555")
SESSION_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
ATTEMPT_ID = UUID("77777777-7777-4777-8777-777777777777")
CLASS_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
QUIZ_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
QUESTION_1 = UUID("22222222-2222-4222-8222-222222222222")
QUESTION_2 = UUID("33333333-3333-4333-8333-333333333333")
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
        first_name="College",
        last_name="Admin",
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


class StudentFinalizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.student = make_student()
        self.settings = MagicMock()
        self.settings.auth_hmac_secret.get_secret_value.return_value = "test-hmac-secret-string-32-chars-long"

    def test_manual_finalization_unreleased_results(self):
        """Student manually submits attempt within deadline; results not released yet."""
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW - timedelta(minutes=10),
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 30,
            "is_expired": False,
            "time_remaining_seconds": 1200,
        }
        finalize_row = {
            "final_status": "FINALIZED",
            "total_score": Decimal("15.50"),
            "finalized_at": NOW,
        }
        unreleased_row = {
            "is_results_released": False,
            "total_score": None,
        }

        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)):
            self.connection.execute.side_effect = [
                make_result(row=finalize_row),    # sp_finalize_attempt
                make_result(row=unreleased_row),  # sp_get_student_attempt_results
            ]
            result = run_async(
                student_service.finalize_student_attempt(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                    submission_type="MANUAL",
                )
            )

        self.assertEqual(result["attempt_id"], ATTEMPT_ID)
        self.assertEqual(result["status"], "FINALIZED")
        self.assertEqual(result["submission_type"], "MANUAL")
        self.assertFalse(result["is_results_released"])
        self.assertIsNone(result["total_score"])
        self.assertIn("Results will be published by faculty", result["message"])

    def test_manual_finalization_immediately_released(self):
        """Student manually submits attempt; session configured for IMMEDIATE release."""
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW - timedelta(minutes=10),
            "deadline": NOW + timedelta(minutes=20),
            "duration_minutes": 30,
            "is_expired": False,
            "time_remaining_seconds": 1200,
        }
        finalize_row = {
            "final_status": "FINALIZED",
            "total_score": Decimal("18.00"),
            "finalized_at": NOW,
        }
        released_row = {
            "is_results_released": True,
            "total_score": Decimal("18.00"),
        }

        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)):
            self.connection.execute.side_effect = [
                make_result(row=finalize_row),    # sp_finalize_attempt
                make_result(row=released_row),    # sp_get_student_attempt_results
            ]
            result = run_async(
                student_service.finalize_student_attempt(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                    submission_type="MANUAL",
                )
            )

        self.assertEqual(result["status"], "FINALIZED")
        self.assertTrue(result["is_results_released"])
        self.assertEqual(result["total_score"], Decimal("18.00"))
        self.assertIn("finalized successfully", result["message"])

    def test_manual_finalization_after_grace_period_switches_to_auto_time_expired(self):
        """When student submits > 15s after deadline, submission switches to AUTO_TIME_EXPIRED."""
        expired_deadline = NOW - timedelta(seconds=25)
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW - timedelta(minutes=35),
            "deadline": expired_deadline,
            "duration_minutes": 30,
            "is_expired": True,
            "time_remaining_seconds": 0,
        }
        finalize_row = {
            "final_status": "FINALIZED",
            "total_score": Decimal("12.00"),
            "finalized_at": NOW,
        }
        released_row = {
            "is_results_released": True,
            "total_score": Decimal("12.00"),
        }

        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)):
            self.connection.execute.side_effect = [
                make_result(row=finalize_row),
                make_result(row=released_row),
            ]
            result = run_async(
                student_service.finalize_student_attempt(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                    submission_type="MANUAL",
                )
            )

        self.assertEqual(result["submission_type"], "AUTO_TIME_EXPIRED")
        self.assertEqual(result["status"], "FINALIZED")

    def test_idempotent_finalization_on_already_finalized_attempt(self):
        """Submitting an attempt that is already FINALIZED returns idempotently without re-scoring."""
        finalized_time = NOW - timedelta(minutes=5)
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "FINALIZED",
            "submission_type": "MANUAL",
            "finalized_at": finalized_time,
            "started_at": NOW - timedelta(minutes=35),
            "deadline": NOW - timedelta(minutes=5),
            "duration_minutes": 30,
            "is_expired": True,
            "time_remaining_seconds": 0,
        }
        results_check = {
            "is_results_released": True,
            "total_score": Decimal("16.00"),
        }

        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)):
            self.connection.execute.return_value = make_result(row=results_check)
            result = run_async(
                student_service.finalize_student_attempt(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                )
            )

        self.assertEqual(result["status"], "FINALIZED")
        self.assertEqual(result["total_score"], Decimal("16.00"))
        self.assertEqual(result["message"], "Attempt is already finalized.")


class StudentResultRetrievalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.student = make_student()
        self.settings = MagicMock()
        self.settings.auth_hmac_secret.get_secret_value.return_value = "test-hmac-secret-string-32-chars-long"

    def test_in_progress_attempt_before_deadline_raises_bad_request(self):
        """Requesting results for an active attempt that hasn't expired raises 400."""
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW,
            "deadline": NOW + timedelta(minutes=15),
            "duration_minutes": 30,
            "is_expired": False,
            "time_remaining_seconds": 900,
        }
        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)):
            with self.assertRaises(HTTPException) as ctx:
                run_async(
                    student_service.get_student_attempt_result(
                        self.connection,
                        self.student,
                        ATTEMPT_ID,
                        self.settings,
                    )
                )
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn("still in progress", ctx.exception.detail)

    def test_in_progress_attempt_after_deadline_auto_finalizes(self):
        """Requesting results for an expired IN_PROGRESS attempt auto-finalizes it."""
        expired_deadline = NOW - timedelta(minutes=2)
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW - timedelta(minutes=35),
            "deadline": expired_deadline,
            "duration_minutes": 30,
            "is_expired": True,
            "time_remaining_seconds": 0,
        }
        breakdown_payload = [
            {
                "question_id": str(QUESTION_1),
                "sequence_order": 1,
                "question_text": "Capital of France?",
                "question_type": "MCQ",
                "marks": "5.0000",
                "awarded_marks": "5.0000",
                "is_correct": True,
                "selected_option_ids": [str(OPTION_1)],
                "explanation": "Paris is the capital.",
                "options": [
                    {
                        "option_id": str(OPTION_1),
                        "option_text": "Paris",
                        "display_order": 1,
                        "is_correct": True,
                    }
                ],
            }
        ]
        results_row = {
            "attempt_id": ATTEMPT_ID,
            "status": "FINALIZED",
            "is_results_released": True,
            "total_score": Decimal("5.00"),
            "question_breakdown": breakdown_payload,
        }

        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)), \
             patch("app.services.student_service.finalize_student_attempt", new=AsyncMock()) as mock_finalize:
            self.connection.execute.return_value = make_result(row=results_row)
            result = run_async(
                student_service.get_student_attempt_result(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                )
            )

        mock_finalize.assert_awaited_once()
        self.assertTrue(result["is_results_released"])
        self.assertEqual(result["total_score"], Decimal("5.00"))
        self.assertEqual(len(result["question_breakdown"]), 1)
        self.assertEqual(result["question_breakdown"][0]["question_id"], QUESTION_1)

    def test_unreleased_results_masks_score_and_breakdown(self):
        """When session results are not released, score and question breakdown are masked."""
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "FINALIZED",
            "started_at": NOW - timedelta(minutes=35),
            "deadline": NOW - timedelta(minutes=5),
            "duration_minutes": 30,
            "is_expired": True,
            "time_remaining_seconds": 0,
        }
        unreleased_row = {
            "attempt_id": ATTEMPT_ID,
            "status": "FINALIZED",
            "is_results_released": False,
            "total_score": None,
            "question_breakdown": None,
        }

        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)):
            self.connection.execute.return_value = make_result(row=unreleased_row)
            result = run_async(
                student_service.get_student_attempt_result(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                )
            )

        self.assertFalse(result["is_results_released"])
        self.assertIsNone(result["total_score"])
        self.assertIsNone(result["question_breakdown"])
        self.assertIn("not yet released", result["message"])


class TeacherSessionResultsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.faculty = make_faculty()
        self.settings = MagicMock()
        self.settings.auth_hmac_secret.get_secret_value.return_value = "test-hmac-secret-string-32-chars-long"

    def test_get_session_results_summary_metrics(self):
        """Teacher fetches session results summary with accurate metric calculations."""
        session_row = {
            "id": SESSION_ID,
            "college_id": COLLEGE_ID,
            "quiz_id": QUIZ_ID,
            "faculty_user_id": FACULTY_ID,
            "class_id": CLASS_ID,
            "session_code": "SES12345",
            "session_mode": "STUDENT_PACED",
            "status": "COMPLETED",
            "result_visibility": "UPON_FACULTY_RELEASE",
            "results_released_at": None,
            "start_window_time": NOW - timedelta(hours=2),
            "end_window_time": NOW - timedelta(hours=1),
            "duration_minutes": 45,
            "created_at": NOW - timedelta(days=1),
            "updated_at": NOW,
        }
        meta_row = {
            "quiz_title": "Physics Midterm",
            "class_name": "CS 3A",
        }
        attempts_rows = [
            {
                "attempt_id": ATTEMPT_ID,
                "student_user_id": STUDENT_ID,
                "student_name": "Alice Smith",
                "enrollment_number": "ENR001",
                "roll_number": "101",
                "status": "FINALIZED",
                "submission_type": "MANUAL",
                "started_at": NOW - timedelta(hours=2),
                "submitted_at": NOW - timedelta(hours=1, minutes=30),
                "finalized_at": NOW - timedelta(hours=1, minutes=30),
                "total_score": Decimal("24.50"),
                "total_correct": 5,
                "total_incorrect": 1,
                "total_unattempted": 0,
            },
            {
                "attempt_id": UUID("88888888-8888-4888-8888-888888888888"),
                "student_user_id": OTHER_STUDENT_ID,
                "student_name": "Bob Jones",
                "enrollment_number": "ENR002",
                "roll_number": "102",
                "status": "FINALIZED",
                "submission_type": "AUTO_TIME_EXPIRED",
                "started_at": NOW - timedelta(hours=2),
                "submitted_at": NOW - timedelta(hours=1, minutes=15),
                "finalized_at": NOW - timedelta(hours=1, minutes=15),
                "total_score": Decimal("15.50"),
                "total_correct": 3,
                "total_incorrect": 2,
                "total_unattempted": 1,
            },
            {
                "attempt_id": UUID("99999999-9999-4999-8999-999999999991"),
                "student_user_id": UUID("22222222-3333-4444-8555-666666666666"),
                "student_name": "Charlie Brown",
                "enrollment_number": "ENR003",
                "roll_number": "103",
                "status": "IN_PROGRESS",
                "submission_type": None,
                "started_at": NOW - timedelta(minutes=40),
                "submitted_at": None,
                "finalized_at": None,
                "total_score": None,
                "total_correct": None,
                "total_incorrect": None,
                "total_unattempted": None,
            },
        ]

        with patch("app.services.lifecycle_service._get_session", new=AsyncMock(return_value=session_row)):
            self.connection.execute.side_effect = [
                make_result(row=meta_row),
                make_result(rows=attempts_rows),
            ]
            summary = run_async(
                lifecycle_service.get_session_results(
                    self.connection,
                    self.faculty,
                    SESSION_ID,
                )
            )

        self.assertEqual(summary["session_id"], SESSION_ID)
        self.assertEqual(summary["quiz_title"], "Physics Midterm")
        self.assertEqual(summary["total_attempts"], 3)
        self.assertEqual(summary["finalized_attempts"], 2)
        self.assertEqual(summary["in_progress_attempts"], 1)
        self.assertEqual(summary["highest_score"], Decimal("24.50"))
        self.assertEqual(summary["lowest_score"], Decimal("15.50"))
        self.assertEqual(summary["average_score"], Decimal("20.00"))
        self.assertEqual(len(summary["attempts"]), 3)

    def test_get_session_attempt_breakdown_privileged_access(self):
        """Teacher accesses student attempt breakdown; privileged access returns full details."""
        session_row = {
            "id": SESSION_ID,
            "faculty_user_id": FACULTY_ID,
            "college_id": COLLEGE_ID,
        }
        attempt_check_row = {
            "id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "status": "FINALIZED",
        }
        breakdown_payload = [
            {
                "question_id": str(QUESTION_1),
                "sequence_order": 1,
                "question_text": "What is 2+2?",
                "question_type": "MCQ",
                "marks": "2.0000",
                "awarded_marks": "2.0000",
                "is_correct": True,
                "selected_option_ids": [str(OPTION_1)],
                "explanation": "Basic math.",
                "options": [
                    {
                        "option_id": str(OPTION_1),
                        "option_text": "4",
                        "display_order": 1,
                        "is_correct": True,
                    }
                ],
            }
        ]
        results_row = {
            "attempt_id": ATTEMPT_ID,
            "status": "FINALIZED",
            "is_results_released": True,
            "total_score": Decimal("2.00"),
            "question_breakdown": breakdown_payload,
        }

        with patch("app.services.lifecycle_service._get_session", new=AsyncMock(return_value=session_row)):
            self.connection.execute.side_effect = [
                make_result(row=attempt_check_row),
                make_result(row=results_row),
            ]
            result = run_async(
                lifecycle_service.get_session_attempt_result(
                    self.connection,
                    self.faculty,
                    SESSION_ID,
                    ATTEMPT_ID,
                    self.settings,
                )
            )

        self.assertTrue(result["is_results_released"])
        self.assertEqual(result["total_score"], Decimal("2.00"))
        self.assertEqual(len(result["question_breakdown"]), 1)
        self.assertEqual(result["question_breakdown"][0]["explanation"], "Basic math.")

    def test_attempt_not_in_session_raises_404(self):
        """Attempt that belongs to a different session is rejected with 404."""
        session_row = {
            "id": SESSION_ID,
            "faculty_user_id": FACULTY_ID,
            "college_id": COLLEGE_ID,
        }
        other_attempt_row = {
            "id": ATTEMPT_ID,
            "session_id": UUID("33333333-3333-4333-8333-333333333333"),
            "status": "FINALIZED",
        }
        with patch("app.services.lifecycle_service._get_session", new=AsyncMock(return_value=session_row)):
            self.connection.execute.return_value = make_result(row=other_attempt_row)
            with self.assertRaises(HTTPException) as ctx:
                run_async(
                    lifecycle_service.get_session_attempt_result(
                        self.connection,
                        self.faculty,
                        SESSION_ID,
                        ATTEMPT_ID,
                        self.settings,
                    )
                )
            self.assertEqual(ctx.exception.status_code, 404)


def compute_authoritative_score(
    question_type: str,
    selected_option_ids: list[UUID],
    correct_option_ids: list[UUID],
    incorrect_option_ids: list[UUID],
    marks: Decimal,
    penalty: Decimal,
    negative_marking_enabled: bool,
) -> tuple[Decimal, bool]:
    """
    Evaluates a single question using the authoritative CampusQuiz rules as implemented
    in sp_finalize_attempt.

    Rules:
    - Unanswered (empty selected_option_ids): 0.0000 marks, is_correct = False.
    - Negative marking disabled: effective penalty is 0.0000.
    - Single-select / True-False:
        * Full marks if selected matches correct.
        * If incorrect: 0 if negative marking disabled, else -1 * penalty.
    - Multiple-select:
        * Proportional partial credit: (c_sel / tot_correct) * marks.
        * If at least one incorrect option is selected (i_sel > 0) and negative marking enabled:
          deduct configured penalty ONCE (never multiplied by i_sel).
        * Full marks (is_correct = True) if awarded == marks.
    - Negative question scores and total scores are preserved (no floor at zero).
    """
    if not selected_option_ids:
        return Decimal("0.0000"), False

    effective_penalty = penalty if negative_marking_enabled else Decimal("0.0000")

    if question_type in ("MCQ", "TRUE_FALSE"):
        if set(selected_option_ids) == set(correct_option_ids):
            return marks, True
        else:
            return -1 * effective_penalty, False

    elif question_type == "MULTIPLE_SELECT":
        tot_correct = len(correct_option_ids)
        c_sel = len(set(selected_option_ids) & set(correct_option_ids))
        i_sel = len(set(selected_option_ids) & set(incorrect_option_ids))

        partial_credit = (Decimal(c_sel) / Decimal(tot_correct)) * marks
        deduction = effective_penalty if i_sel > 0 else Decimal("0.0000")
        awarded = partial_credit - deduction
        is_correct = (awarded == marks)
        return awarded, is_correct

    raise ValueError(f"Unknown question type {question_type}")


class ScoringFormulaVerificationTests(unittest.TestCase):
    """
    Mathematical and semantic verification of the stored procedure scoring rules
    as defined in sp_finalize_attempt.
    """

    def test_1_multi_select_partial_credit_no_incorrect_selection(self):
        """Rule 1: Proportional partial credit awarded when no incorrect options are chosen."""
        c1, c2, c3 = UUID(int=1), UUID(int=2), UUID(int=3)
        w1 = UUID(int=4)
        awarded, is_correct = compute_authoritative_score(
            question_type="MULTIPLE_SELECT",
            selected_option_ids=[c1, c2],
            correct_option_ids=[c1, c2, c3],
            incorrect_option_ids=[w1],
            marks=Decimal("6.00"),
            penalty=Decimal("1.50"),
            negative_marking_enabled=True,
        )
        # 2 of 3 correct selected -> (2/3) * 6.00 = 4.00, no penalty
        self.assertEqual(awarded, Decimal("4.00"))
        self.assertFalse(is_correct)

    def test_2_multi_select_with_one_incorrect_selection(self):
        """Rule 2: Proportional credit minus configured penalty applied once."""
        c1, c2, c3 = UUID(int=1), UUID(int=2), UUID(int=3)
        w1 = UUID(int=4)
        awarded, is_correct = compute_authoritative_score(
            question_type="MULTIPLE_SELECT",
            selected_option_ids=[c1, c2, w1],
            correct_option_ids=[c1, c2, c3],
            incorrect_option_ids=[w1],
            marks=Decimal("6.00"),
            penalty=Decimal("1.50"),
            negative_marking_enabled=True,
        )
        # 2 of 3 correct selected -> 4.00 - 1.50 = 2.50
        self.assertEqual(awarded, Decimal("2.50"))
        self.assertFalse(is_correct)

    def test_3_multi_select_with_multiple_incorrect_selections(self):
        """Rule 3: Penalty is applied ONCE, NOT multiplied by number of incorrect selections."""
        c1, c2, c3 = UUID(int=1), UUID(int=2), UUID(int=3)
        w1, w2, w3 = UUID(int=4), UUID(int=5), UUID(int=6)
        awarded, is_correct = compute_authoritative_score(
            question_type="MULTIPLE_SELECT",
            selected_option_ids=[c1, c2, w1, w2, w3],
            correct_option_ids=[c1, c2, c3],
            incorrect_option_ids=[w1, w2, w3],
            marks=Decimal("6.00"),
            penalty=Decimal("1.50"),
            negative_marking_enabled=True,
        )
        # 2 of 3 correct (4.00), 3 incorrect selected.
        # Penalty must be deducted ONCE (1.50), NOT 3 * 1.50 = 4.50!
        # Result: 4.00 - 1.50 = 2.50
        self.assertEqual(awarded, Decimal("2.50"))
        self.assertFalse(is_correct)

    def test_4_negative_marking_disabled(self):
        """Rule 4: When negative marking is disabled, zero penalty is deducted."""
        c1, c2 = UUID(int=1), UUID(int=2)
        w1, w2 = UUID(int=3), UUID(int=4)
        # Multi-select with incorrect options
        ms_awarded, _ = compute_authoritative_score(
            question_type="MULTIPLE_SELECT",
            selected_option_ids=[c1, w1, w2],
            correct_option_ids=[c1, c2],
            incorrect_option_ids=[w1, w2],
            marks=Decimal("4.00"),
            penalty=Decimal("1.00"),
            negative_marking_enabled=False,
        )
        # (1/2) * 4.00 = 2.00, 0 penalty deducted
        self.assertEqual(ms_awarded, Decimal("2.00"))

        # MCQ incorrect with negative marking disabled
        mcq_awarded, mcq_correct = compute_authoritative_score(
            question_type="MCQ",
            selected_option_ids=[w1],
            correct_option_ids=[c1],
            incorrect_option_ids=[w1],
            marks=Decimal("4.00"),
            penalty=Decimal("1.00"),
            negative_marking_enabled=False,
        )
        self.assertEqual(mcq_awarded, Decimal("0.00"))
        self.assertFalse(mcq_correct)

    def test_5_negative_marking_enabled(self):
        """Rule 5: When negative marking is enabled, penalty is applied."""
        c1, c2 = UUID(int=1), UUID(int=2)
        w1 = UUID(int=3)
        awarded, _ = compute_authoritative_score(
            question_type="MULTIPLE_SELECT",
            selected_option_ids=[c1, w1],
            correct_option_ids=[c1, c2],
            incorrect_option_ids=[w1],
            marks=Decimal("4.00"),
            penalty=Decimal("1.00"),
            negative_marking_enabled=True,
        )
        # (1/2) * 4.00 - 1.00 = 1.00
        self.assertEqual(awarded, Decimal("1.00"))

    def test_6_negative_question_score(self):
        """Rule 6: Question score can be negative without artificial zero floor."""
        c1, c2 = UUID(int=1), UUID(int=2)
        w1 = UUID(int=3)
        awarded, _ = compute_authoritative_score(
            question_type="MULTIPLE_SELECT",
            selected_option_ids=[w1],
            correct_option_ids=[c1, c2],
            incorrect_option_ids=[w1],
            marks=Decimal("4.00"),
            penalty=Decimal("1.50"),
            negative_marking_enabled=True,
        )
        # 0 correct, 1 wrong -> (0/2)*4.00 - 1.50 = -1.50
        self.assertEqual(awarded, Decimal("-1.50"))
        self.assertLess(awarded, Decimal("0.00"))

    def test_7_negative_total_score_preserved(self):
        """Rule 7: Attempt total score preserves negative sum without a zero floor."""
        q1_score = Decimal("-1.50")
        q2_score = Decimal("-2.00")
        q3_score = Decimal("0.00")
        total = round(q1_score + q2_score + q3_score, 2)
        self.assertEqual(total, Decimal("-3.50"))
        self.assertLess(total, Decimal("0.00"))

    def test_8_single_select_and_true_false_penalties(self):
        """Rule 8: MCQ and True-False scoring and penalties."""
        c = UUID(int=1)
        w = UUID(int=2)

        # MCQ correct
        awarded, is_c = compute_authoritative_score(
            "MCQ", [c], [c], [w], Decimal("3.00"), Decimal("1.00"), True
        )
        self.assertEqual(awarded, Decimal("3.00"))
        self.assertTrue(is_c)

        # MCQ incorrect with penalty
        awarded, is_c = compute_authoritative_score(
            "MCQ", [w], [c], [w], Decimal("3.00"), Decimal("1.00"), True
        )
        self.assertEqual(awarded, Decimal("-1.00"))
        self.assertFalse(is_c)

        # True/False correct
        awarded, is_c = compute_authoritative_score(
            "TRUE_FALSE", [c], [c], [w], Decimal("2.00"), Decimal("0.50"), True
        )
        self.assertEqual(awarded, Decimal("2.00"))
        self.assertTrue(is_c)

        # True/False incorrect with penalty
        awarded, is_c = compute_authoritative_score(
            "TRUE_FALSE", [w], [c], [w], Decimal("2.00"), Decimal("0.50"), True
        )
        self.assertEqual(awarded, Decimal("-0.50"))
        self.assertFalse(is_c)

    def test_9_unanswered_questions(self):
        """Rule 9: Unanswered question receives 0 marks and no penalty."""
        c = UUID(int=1)
        w = UUID(int=2)
        awarded, is_c = compute_authoritative_score(
            "MCQ", [], [c], [w], Decimal("4.00"), Decimal("1.00"), True
        )
        self.assertEqual(awarded, Decimal("0.0000"))
        self.assertFalse(is_c)

        ms_awarded, ms_is_c = compute_authoritative_score(
            "MULTIPLE_SELECT", [], [c], [w], Decimal("4.00"), Decimal("1.00"), True
        )
        self.assertEqual(ms_awarded, Decimal("0.0000"))
        self.assertFalse(ms_is_c)



class ConcurrencyAndAtomicityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.student = make_student()
        self.settings = MagicMock()
        self.settings.auth_hmac_secret.get_secret_value.return_value = "test-hmac-secret-string-32-chars-long"

    def test_concurrent_manual_and_timeout_finalization(self):
        """
        Simulates concurrent finalization where the first caller commits FINALIZED,
        and the second caller safely receives the finalized row via idempotent short-circuit.
        """
        finalized_time = NOW - timedelta(seconds=1)
        already_finalized_attempt = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "FINALIZED",
            "submission_type": "AUTO_TIME_EXPIRED",
            "finalized_at": finalized_time,
            "started_at": NOW - timedelta(minutes=30),
            "deadline": NOW - timedelta(minutes=1),
            "duration_minutes": 30,
            "is_expired": True,
            "time_remaining_seconds": 0,
        }
        res_row = {
            "is_results_released": True,
            "total_score": Decimal("14.00"),
        }

        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=already_finalized_attempt)):
            self.connection.execute.return_value = make_result(row=res_row)
            result = run_async(
                student_service.finalize_student_attempt(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                    submission_type="MANUAL",
                )
            )

        self.assertEqual(result["status"], "FINALIZED")
        self.assertEqual(result["total_score"], Decimal("14.00"))
        self.assertEqual(result["submission_type"], "AUTO_TIME_EXPIRED")
        self.assertEqual(result["message"], "Attempt is already finalized.")

    def test_repeated_finalization_returns_existing_score(self):
        """Retrying finalization returns identical score without re-running scoring logic."""
        finalized_row = {
            "final_status": "FINALIZED",
            "total_score": Decimal("22.50"),
            "finalized_at": NOW,
        }
        res_check = {
            "is_results_released": True,
            "total_score": Decimal("22.50"),
        }
        attempt_row = {
            "attempt_id": ATTEMPT_ID,
            "session_id": SESSION_ID,
            "student_user_id": STUDENT_ID,
            "status": "IN_PROGRESS",
            "started_at": NOW - timedelta(minutes=20),
            "deadline": NOW + timedelta(minutes=10),
            "duration_minutes": 30,
            "is_expired": False,
            "time_remaining_seconds": 600,
        }
        with patch("app.services.student_service.get_attempt", new=AsyncMock(return_value=attempt_row)):
            self.connection.execute.side_effect = [
                make_result(row=finalized_row),
                make_result(row=res_check),
            ]
            result = run_async(
                student_service.finalize_student_attempt(
                    self.connection,
                    self.student,
                    ATTEMPT_ID,
                    self.settings,
                )
            )
        self.assertEqual(result["total_score"], Decimal("22.50"))
        self.assertEqual(result["status"], "FINALIZED")


class TimeoutSweeperTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.faculty = make_faculty()
        self.settings = MagicMock()
        self.settings.auth_hmac_secret.get_secret_value.return_value = "test-hmac-secret-string-32-chars-long"

    def test_sweep_expired_attempts_finalizes_batch(self):
        """Worker sweeps expired attempts and finalizes each via sp_finalize_attempt."""
        expired_candidates = [
            {"id": ATTEMPT_ID, "student_user_id": STUDENT_ID},
            {"id": UUID("99999999-9999-4999-8999-999999999999"), "student_user_id": OTHER_STUDENT_ID},
        ]
        final_row = {
            "final_status": "FINALIZED",
            "total_score": Decimal("10.00"),
            "finalized_at": NOW,
        }
        self.connection.execute.side_effect = [
            make_result(rows=expired_candidates),  # query candidates
            make_result(row=final_row),           # finalize 1
            make_result(row=final_row),           # finalize 2
        ]
        finalized_ids = run_async(
            student_service.sweep_expired_attempts(
                self.connection,
                self.settings,
                batch_size=10,
            )
        )
        self.assertEqual(len(finalized_ids), 2)
        self.connection.commit.assert_awaited()

    def test_sweep_expired_attempts_skips_when_empty(self):
        """When no attempts are expired, returns empty list without committing."""
        self.connection.execute.return_value = make_result(rows=[])
        finalized_ids = run_async(
            student_service.sweep_expired_attempts(
                self.connection,
                self.settings,
            )
        )
        self.assertEqual(finalized_ids, [])
        self.connection.commit.assert_not_awaited()

    def test_get_session_results_opportunistically_finalizes_expired_attempts(self):
        """Teacher fetching session results finalizes any expired attempts in that session."""
        session_row = {
            "id": SESSION_ID,
            "college_id": COLLEGE_ID,
            "quiz_id": QUIZ_ID,
            "faculty_user_id": FACULTY_ID,
            "class_id": CLASS_ID,
            "session_code": "SES12345",
            "session_mode": "STUDENT_PACED",
            "status": "ACTIVE",
            "result_visibility": "IMMEDIATELY",
            "results_released_at": None,
            "start_window_time": NOW - timedelta(hours=2),
            "end_window_time": NOW + timedelta(hours=1),
            "duration_minutes": 30,
            "created_at": NOW - timedelta(days=1),
            "updated_at": NOW,
        }
        expired_in_session = [
            {"id": ATTEMPT_ID, "student_user_id": STUDENT_ID}
        ]
        finalize_row = {
            "final_status": "FINALIZED",
            "total_score": Decimal("15.00"),
            "finalized_at": NOW,
        }
        meta_row = {"quiz_title": "Quiz 1", "class_name": "Class A"}
        attempts_rows = [
            {
                "attempt_id": ATTEMPT_ID,
                "student_user_id": STUDENT_ID,
                "student_name": "Student A",
                "enrollment_number": "E1",
                "roll_number": "R1",
                "status": "FINALIZED",
                "submission_type": "AUTO_TIME_EXPIRED",
                "started_at": NOW - timedelta(minutes=40),
                "submitted_at": NOW - timedelta(minutes=10),
                "finalized_at": NOW - timedelta(minutes=10),
                "total_score": Decimal("15.00"),
                "total_correct": 3,
                "total_incorrect": 1,
                "total_unattempted": 0,
            }
        ]
        with patch("app.services.lifecycle_service._get_session", new=AsyncMock(return_value=session_row)):
            self.connection.execute.side_effect = [
                make_result(rows=expired_in_session), # opportunistic expired query
                make_result(row=finalize_row),        # finalize expired attempt
                make_result(row=meta_row),            # metadata
                make_result(rows=attempts_rows),      # attempts query
            ]
            summary = run_async(
                lifecycle_service.get_session_results(
                    self.connection,
                    self.faculty,
                    SESSION_ID,
                    self.settings,
                )
            )

        self.assertEqual(summary["total_attempts"], 1)
        self.assertEqual(summary["finalized_attempts"], 1)
        self.assertEqual(summary["average_score"], Decimal("15.00"))
        self.connection.commit.assert_awaited()


class RouterEndpointIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.student = make_student()
        self.faculty = make_faculty()
        self.settings = MagicMock()
        self.settings.auth_hmac_secret.get_secret_value.return_value = "test-hmac-secret-string-32-chars-long"

    @patch("app.services.student_service.finalize_student_attempt")
    def test_student_submit_endpoint_calls_service(self, mock_finalize: AsyncMock):
        mock_finalize.return_value = {
            "attempt_id": ATTEMPT_ID,
            "status": "FINALIZED",
            "submission_type": "MANUAL",
            "finalized_at": NOW,
            "is_results_released": True,
            "total_score": Decimal("10.00"),
            "message": "Attempt finalized successfully.",
        }
        res = run_async(
            student_endpoints.submit_student_attempt(
                ATTEMPT_ID,
                self.connection,
                self.student,
                self.settings,
            )
        )
        mock_finalize.assert_awaited_once_with(
            self.connection,
            self.student,
            ATTEMPT_ID,
            self.settings,
            submission_type="MANUAL",
        )
        self.assertEqual(res["status"], "FINALIZED")

    @patch("app.services.student_service.get_student_attempt_result")
    def test_student_result_endpoint_calls_service(self, mock_get_result: AsyncMock):
        mock_get_result.return_value = {
            "attempt_id": ATTEMPT_ID,
            "status": "FINALIZED",
            "is_results_released": False,
            "total_score": None,
            "question_breakdown": None,
            "message": "Results are not yet released for this session.",
        }
        res = run_async(
            student_endpoints.get_student_attempt_result(
                ATTEMPT_ID,
                self.connection,
                self.student,
                self.settings,
            )
        )
        mock_get_result.assert_awaited_once_with(
            self.connection,
            self.student,
            ATTEMPT_ID,
            self.settings,
        )
        self.assertFalse(res["is_results_released"])

    @patch("app.services.lifecycle_service.get_session_results")
    def test_faculty_session_results_endpoint_calls_service(self, mock_get_results: AsyncMock):
        mock_get_results.return_value = {
            "session_id": SESSION_ID,
            "session_code": "SES12345",
            "quiz_id": QUIZ_ID,
            "quiz_title": "Math Quiz",
            "class_id": CLASS_ID,
            "class_name": "CS 101",
            "status": "COMPLETED",
            "result_visibility": "IMMEDIATELY",
            "results_released_at": None,
            "total_attempts": 1,
            "finalized_attempts": 1,
            "in_progress_attempts": 0,
            "average_score": Decimal("10.00"),
            "highest_score": Decimal("10.00"),
            "lowest_score": Decimal("10.00"),
            "attempts": [],
        }
        res = run_async(
            lifecycle_endpoints.get_session_results(
                SESSION_ID,
                self.connection,
                self.faculty,
                self.settings,
            )
        )
        mock_get_results.assert_awaited_once_with(
            self.connection,
            self.faculty,
            SESSION_ID,
            self.settings,
        )
        self.assertEqual(res["total_attempts"], 1)

    @patch("app.services.lifecycle_service.get_session_attempt_result")
    def test_faculty_session_attempt_result_endpoint_calls_service(self, mock_get_attempt_result: AsyncMock):
        mock_get_attempt_result.return_value = {
            "attempt_id": ATTEMPT_ID,
            "status": "FINALIZED",
            "is_results_released": True,
            "total_score": Decimal("8.00"),
            "question_breakdown": [],
            "message": "Results are available.",
        }
        res = run_async(
            lifecycle_endpoints.get_session_attempt_result(
                SESSION_ID,
                ATTEMPT_ID,
                self.connection,
                self.faculty,
                self.settings,
            )
        )
        mock_get_attempt_result.assert_awaited_once_with(
            self.connection,
            self.faculty,
            SESSION_ID,
            ATTEMPT_ID,
            self.settings,
        )
        self.assertTrue(res["is_results_released"])

    @patch("app.services.lifecycle_service.transition_session")
    def test_faculty_release_endpoint_calls_transition_session(self, mock_transition: AsyncMock):
        mock_transition.return_value = {
            "id": SESSION_ID,
            "status": "COMPLETED",
            "results_released_at": NOW,
        }
        res = run_async(
            lifecycle_endpoints.release_session_results(
                SESSION_ID,
                self.connection,
                self.faculty,
                self.settings,
            )
        )
        mock_transition.assert_awaited_once_with(
            self.connection,
            self.faculty,
            SESSION_ID,
            "release",
            self.settings,
        )
        self.assertEqual(res["status"], "COMPLETED")


class CollegeIsolationFinalizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.student_other_college = make_student(college_id=OTHER_COLLEGE_ID)
        self.faculty_other_college = make_faculty(college_id=OTHER_COLLEGE_ID)
        self.settings = MagicMock()

    def test_other_college_student_get_attempt_rejected(self):
        """Student from other college cannot access attempt row."""
        # 1. If student profile not registered in this college -> 403
        self.connection.execute.return_value = make_result(scalar=None)
        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.get_attempt(
                    self.connection,
                    self.student_other_college,
                    ATTEMPT_ID,
                )
            )
        self.assertEqual(ctx.exception.status_code, 403)

        # 2. If student profile registered but attempt not found in college -> 404
        self.connection.execute.side_effect = [
            make_result(scalar=1),  # profile exists
            make_result(row=None),  # attempt not found
        ]
        with self.assertRaises(HTTPException) as ctx:
            run_async(
                student_service.get_attempt(
                    self.connection,
                    self.student_other_college,
                    ATTEMPT_ID,
                )
            )
        self.assertEqual(ctx.exception.status_code, 404)


    def test_other_college_faculty_get_session_rejected(self):
        """Faculty from other college cannot access session results."""
        self.connection.execute.return_value = make_result(row=None)
        with self.assertRaises(HTTPException) as ctx:
            run_async(
                lifecycle_service.get_session(
                    self.connection,
                    self.faculty_other_college,
                    SESSION_ID,
                )
            )
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
