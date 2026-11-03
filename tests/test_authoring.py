import asyncio
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from fastapi import HTTPException

from app.api.deps import require_roles
from app.main import create_app
from app.schemas.authoring import (
    QuestionCreate,
    QuestionOptionCreate,
    QuizQuestionInput,
    QuizQuestionsReplace,
)
from app.schemas.auth import AuthenticatedUser
from app.services import authoring_service

COLLEGE_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
FACULTY_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
SUBJECT_ID = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
QUESTION_ID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
QUIZ_ID = UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
OPTION_IDS = (
    UUID("11111111-1111-4111-8111-111111111111"),
    UUID("22222222-2222-4222-8222-222222222222"),
)
NOW = datetime.now(timezone.utc)


def make_faculty() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=FACULTY_ID,
        college_id=COLLEGE_ID,
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


def question_row():
    return {
        "id": QUESTION_ID,
        "college_id": COLLEGE_ID,
        "subject_id": SUBJECT_ID,
        "created_by_faculty_id": FACULTY_ID,
        "question_type": "MCQ",
        "question_text": "Which option?",
        "explanation": None,
        "difficulty": "MEDIUM",
        "topic": None,
        "default_marks": Decimal("1.0000"),
        "default_negative_penalty": Decimal("0.0000"),
        "is_bank_question": True,
        "is_active": True,
        "created_at": NOW,
        "updated_at": NOW,
    }


def quiz_row():
    return {
        "id": QUIZ_ID,
        "college_id": COLLEGE_ID,
        "faculty_user_id": FACULTY_ID,
        "subject_id": SUBJECT_ID,
        "title": "Draft Quiz",
        "description": None,
        "instructions": None,
        "topic": None,
        "default_duration_minutes": 30,
        "total_marks": Decimal("0.00"),
        "default_negative_marking_enabled": False,
        "default_negative_penalty": None,
        "default_result_visibility": "AFTER_SESSION_ENDS",
        "status": "DRAFT",
        "created_at": NOW,
        "updated_at": NOW,
    }


def question_payload():
    return QuestionCreate(
        subject_id=SUBJECT_ID,
        question_type="MCQ",
        question_text="  Which option?  ",
        options=[
            QuestionOptionCreate(
                option_text=" right ",
                is_correct=True,
                display_order=1,
            ),
            QuestionOptionCreate(
                option_text="wrong",
                is_correct=False,
                display_order=2,
            ),
        ],
    )


class AuthoringSchemaTests(unittest.TestCase):
    def test_mcq_requires_exactly_one_correct_answer(self) -> None:
        with self.assertRaises(ValueError):
            QuestionCreate(
                subject_id=SUBJECT_ID,
                question_type="MCQ",
                question_text="Select",
                options=[
                    QuestionOptionCreate(
                        option_text="A",
                        is_correct=True,
                        display_order=1,
                    ),
                    QuestionOptionCreate(
                        option_text="B",
                        is_correct=True,
                        display_order=2,
                    ),
                ],
            )

    def test_true_false_requires_exactly_two_options(self) -> None:
        with self.assertRaises(ValueError):
            QuestionCreate(
                subject_id=SUBJECT_ID,
                question_type="TRUE_FALSE",
                question_text="Select",
                options=[
                    QuestionOptionCreate(
                        option_text="True",
                        is_correct=True,
                        display_order=1,
                    ),
                    QuestionOptionCreate(
                        option_text="False",
                        is_correct=False,
                        display_order=2,
                    ),
                    QuestionOptionCreate(
                        option_text="Maybe",
                        is_correct=False,
                        display_order=3,
                    ),
                ],
            )

    def test_multiple_select_requires_a_correct_answer(self) -> None:
        with self.assertRaises(ValueError):
            QuestionCreate(
                subject_id=SUBJECT_ID,
                question_type="MULTIPLE_SELECT",
                question_text="Select",
                options=[
                    QuestionOptionCreate(
                        option_text="A",
                        is_correct=False,
                        display_order=1,
                    ),
                    QuestionOptionCreate(
                        option_text="B",
                        is_correct=False,
                        display_order=2,
                    ),
                ],
            )

    def test_quiz_questions_reject_duplicate_ids_and_order(self) -> None:
        with self.assertRaises(ValueError):
            QuizQuestionsReplace(
                questions=[
                    QuizQuestionInput(question_id=QUESTION_ID, sequence_order=1),
                    QuizQuestionInput(question_id=QUESTION_ID, sequence_order=2),
                ]
            )
        with self.assertRaises(ValueError):
            QuizQuestionsReplace(
                questions=[
                    QuizQuestionInput(question_id=QUESTION_ID, sequence_order=1),
                    QuizQuestionInput(
                        question_id=OPTION_IDS[0],
                        sequence_order=1,
                    ),
                ]
            )

    def test_explicit_zero_override_is_preserved(self) -> None:
        question = QuizQuestionInput(
            question_id=QUESTION_ID,
            sequence_order=1,
            marks_override=Decimal("2.5"),
            negative_marking_enabled_override=True,
            negative_penalty_override=Decimal("0.0000"),
        )
        self.assertEqual(question.negative_penalty_override, Decimal("0.0000"))

    def test_authoring_endpoints_are_registered_and_require_bearer_auth(self) -> None:
        paths = create_app().openapi()["paths"]
        expected = {
            "/api/v1/questions",
            "/api/v1/questions/{question_id}",
            "/api/v1/questions/{question_id}/options",
            "/api/v1/quizzes",
            "/api/v1/quizzes/{quiz_id}",
            "/api/v1/quizzes/{quiz_id}/questions",
        }
        self.assertTrue(expected <= paths.keys())
        for path in expected:
            for operation in paths[path].values():
                self.assertIn("security", operation)

    def test_student_role_is_rejected_by_authoring_gate(self) -> None:
        actor = make_faculty().model_copy(update={"roles": ["STUDENT"]})
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(require_roles("FACULTY", "ADMIN")(actor))
        self.assertEqual(raised.exception.status_code, 403)


class AuthoringServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.connection = MagicMock()
        self.connection.execute = AsyncMock()
        self.connection.commit = AsyncMock()
        self.connection.rollback = AsyncMock()
        self.actor = make_faculty()

    async def test_question_creation_binds_tenant_author_and_answer_options(self) -> None:
        insert_question = make_result(scalar=QUESTION_ID)
        insert_options = make_result()
        selected_question = make_result(row=question_row())
        self.connection.execute.side_effect = [
            make_result(scalar=1),
            insert_question,
            insert_options,
            selected_question,
        ]

        created = await authoring_service.create_question(
            self.connection,
            self.actor,
            question_payload(),
        )

        self.assertEqual(created["id"], QUESTION_ID)
        self.assertNotIn("is_correct", created["options"][0])
        self.assertEqual(self.connection.execute.await_count, 4)
        question_insert = self.connection.execute.await_args_list[1]
        _, parameters = question_insert.args
        self.assertEqual(parameters["college_id"], COLLEGE_ID)
        self.assertEqual(parameters["created_by_faculty_id"], FACULTY_ID)
        self.assertEqual(parameters["question_text"], "Which option?")
        option_insert = self.connection.execute.await_args_list[2]
        self.assertTrue(option_insert.args[1][0]["is_correct"])
        self.connection.commit.assert_awaited_once()

    async def test_question_read_does_not_select_or_return_correctness(self) -> None:
        option_result = make_result(
            rows=[
                {
                    "id": OPTION_IDS[0],
                    "option_text": "Right",
                    "display_order": 1,
                }
            ]
        )
        self.connection.execute.side_effect = [
            make_result(row=question_row()),
            make_result(scalar=1),
            option_result,
        ]

        question = await authoring_service.get_question(
            self.connection,
            self.actor,
            QUESTION_ID,
        )

        self.assertNotIn("is_correct", question["options"][0])
        for call in self.connection.execute.await_args_list:
            statement = str(call.args[0]).lower()
            if statement.lstrip().startswith("select"):
                self.assertNotIn("is_correct", statement)

    async def test_subject_access_is_enforced_for_faculty(self) -> None:
        self.connection.execute.return_value = make_result(scalar=None)

        with self.assertRaises(HTTPException) as raised:
            await authoring_service.create_question(
                self.connection,
                self.actor,
                question_payload(),
            )

        self.assertEqual(raised.exception.status_code, 403)
        _, parameters = self.connection.execute.await_args.args
        self.assertEqual(parameters["college_id"], COLLEGE_ID)
        self.assertEqual(parameters["actor_id"], FACULTY_ID)
        self.connection.commit.assert_not_awaited()

    async def test_question_update_is_blocked_when_linked_to_published_quiz(self) -> None:
        linked_quizzes = make_result(
            rows=[{"id": QUIZ_ID, "status": "PUBLISHED"}]
        )
        self.connection.execute.side_effect = [
            make_result(row=question_row()),
            make_result(scalar=1),
            make_result(),
            linked_quizzes,
        ]

        with self.assertRaises(HTTPException) as raised:
            await authoring_service.update_question(
                self.connection,
                self.actor,
                QUESTION_ID,
                {"question_text": "Changed"},
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.connection.commit.assert_not_awaited()

    async def test_quiz_assembly_preserves_zero_penalty_override(self) -> None:
        question_link = {
            "question_id": QUESTION_ID,
            "sequence_order": 1,
            "marks_override": Decimal("2.5000"),
            "negative_marking_enabled_override": True,
            "negative_penalty_override": Decimal("0.0000"),
        }
        self.connection.execute.side_effect = [
            make_result(row=quiz_row()),
            make_result(rows=[]),
            make_result(scalar=1),
            make_result(row={"status": "DRAFT", "subject_id": SUBJECT_ID, "faculty_user_id": FACULTY_ID}),
            make_result(scalar=QUESTION_ID),
            make_result(scalar=QUESTION_ID),
            make_result(),
            make_result(),
            make_result(row=quiz_row()),
            make_result(rows=[question_link]),
            make_result(rows=[question_link]),
        ]

        updated = await authoring_service.replace_quiz_questions(
            self.connection,
            self.actor,
            QUIZ_ID,
            QuizQuestionsReplace(
                questions=[
                    QuizQuestionInput(
                        question_id=QUESTION_ID,
                        sequence_order=1,
                        marks_override=Decimal("2.5000"),
                        negative_marking_enabled_override=True,
                        negative_penalty_override=Decimal("0.0000"),
                    )
                ]
            ),
        )

        self.assertEqual(updated["questions"][0]["negative_penalty_override"], Decimal("0.0000"))
        insert_call = self.connection.execute.await_args_list[7]
        self.assertEqual(
            insert_call.args[1][0]["negative_penalty_override"],
            Decimal("0.0000"),
        )
        self.connection.commit.assert_awaited_once()

    async def test_quiz_assembly_rejects_non_draft_state(self) -> None:
        self.connection.execute.side_effect = [
            make_result(row=quiz_row()),
            make_result(rows=[]),
            make_result(scalar=1),
            make_result(row={"status": "PUBLISHED", "subject_id": SUBJECT_ID, "faculty_user_id": FACULTY_ID}),
        ]

        with self.assertRaises(HTTPException) as raised:
            await authoring_service.replace_quiz_questions(
                self.connection,
                self.actor,
                QUIZ_ID,
                QuizQuestionsReplace(questions=[]),
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.connection.commit.assert_not_awaited()

    async def test_quiz_cannot_be_archived_with_active_sessions(self) -> None:
        self.connection.execute.side_effect = [
            make_result(row=quiz_row()),
            make_result(rows=[]),
            make_result(row={"status": "PUBLISHED", "faculty_user_id": FACULTY_ID}),
            make_result(scalar=True),
        ]

        with self.assertRaises(HTTPException) as raised:
            await authoring_service.archive_quiz(
                self.connection,
                self.actor,
                QUIZ_ID,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.connection.commit.assert_not_awaited()
        self.connection.rollback.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
