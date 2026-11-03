from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.administration import PatchModel

QuestionType = Literal["MCQ", "TRUE_FALSE", "MULTIPLE_SELECT"]
Difficulty = Literal["EASY", "MEDIUM", "HARD"]
ResultVisibility = Literal[
    "IMMEDIATELY",
    "AFTER_SESSION_ENDS",
    "UPON_FACULTY_RELEASE",
]


class AuthoringModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuestionOptionCreate(AuthoringModel):
    option_text: Annotated[str, Field(min_length=1, max_length=5000)]
    is_correct: bool
    display_order: int = Field(ge=1, le=32767)

    @field_validator("option_text")
    @classmethod
    def trim_option_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Option text cannot be empty")
        return value.strip()


class QuestionOptionRead(BaseModel):
    id: UUID
    option_text: str
    display_order: int


class QuestionCreate(AuthoringModel):
    subject_id: UUID
    question_type: QuestionType
    question_text: Annotated[str, Field(min_length=1, max_length=20000)]
    explanation: str | None = None
    difficulty: Difficulty = "MEDIUM"
    topic: str | None = Field(default=None, max_length=100)
    default_marks: Decimal = Field(default=Decimal("1.0000"), gt=0, max_digits=8, decimal_places=4)
    default_negative_penalty: Decimal = Field(
        default=Decimal("0.0000"), ge=0, max_digits=8, decimal_places=4
    )
    is_bank_question: bool = True
    options: Annotated[list[QuestionOptionCreate], Field(min_length=2, max_length=100)]

    @field_validator("question_text")
    @classmethod
    def trim_question_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Question text cannot be empty")
        return value.strip()

    @field_validator("topic")
    @classmethod
    def trim_topic(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Topic cannot be empty")
        return value

    @model_validator(mode="after")
    def validate_options(self):
        orders = [option.display_order for option in self.options]
        if len(orders) != len(set(orders)):
            raise ValueError("Option display_order values must be unique")
        correct_count = sum(option.is_correct for option in self.options)
        if self.question_type in {"MCQ", "TRUE_FALSE"} and correct_count != 1:
            raise ValueError("MCQ and TRUE_FALSE questions require exactly one correct option")
        if self.question_type == "TRUE_FALSE" and len(self.options) != 2:
            raise ValueError("TRUE_FALSE questions require exactly two options")
        if self.question_type == "MULTIPLE_SELECT" and correct_count < 1:
            raise ValueError("MULTIPLE_SELECT questions require at least one correct option")
        return self


class QuestionUpdate(PatchModel):
    question_text: str | None = Field(default=None, min_length=1, max_length=20000)
    explanation: str | None = None
    difficulty: Difficulty | None = None
    topic: str | None = Field(default=None, max_length=100)
    default_marks: Decimal | None = Field(default=None, gt=0, max_digits=8, decimal_places=4)
    default_negative_penalty: Decimal | None = Field(
        default=None, ge=0, max_digits=8, decimal_places=4
    )
    is_bank_question: bool | None = None
    nullable_patch_fields = frozenset({"explanation", "topic"})

    @field_validator("question_text")
    @classmethod
    def trim_question_text(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Question text cannot be empty")
        return value.strip() if value is not None else value

    @field_validator("topic")
    @classmethod
    def trim_topic(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Topic cannot be empty")
        return value


class QuestionRead(BaseModel):
    id: UUID
    college_id: UUID
    subject_id: UUID
    created_by_faculty_id: UUID
    question_type: QuestionType
    question_text: str
    explanation: str | None
    difficulty: Difficulty
    topic: str | None
    default_marks: Decimal
    default_negative_penalty: Decimal
    is_bank_question: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    options: list[QuestionOptionRead]


class QuestionOptionsReplace(AuthoringModel):
    options: Annotated[list[QuestionOptionCreate], Field(min_length=2, max_length=100)]


class QuizCreate(AuthoringModel):
    subject_id: UUID
    title: Annotated[str, Field(min_length=1, max_length=255)]
    description: str | None = None
    instructions: str | None = None
    topic: str | None = Field(default=None, max_length=100)
    default_duration_minutes: int = Field(ge=1, le=2_147_483_647)
    default_negative_marking_enabled: bool = False
    default_negative_penalty: Decimal | None = Field(
        default=None, ge=0, max_digits=8, decimal_places=4
    )
    default_result_visibility: ResultVisibility = "AFTER_SESSION_ENDS"

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Quiz title cannot be empty")
        return value.strip()

    @field_validator("topic")
    @classmethod
    def trim_topic(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Topic cannot be empty")
        return value


class QuizUpdate(PatchModel):
    subject_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    instructions: str | None = None
    topic: str | None = Field(default=None, max_length=100)
    default_duration_minutes: int | None = Field(default=None, ge=1, le=2_147_483_647)
    default_negative_marking_enabled: bool | None = None
    default_negative_penalty: Decimal | None = Field(
        default=None, ge=0, max_digits=8, decimal_places=4
    )
    default_result_visibility: ResultVisibility | None = None
    nullable_patch_fields = frozenset({"description", "instructions", "topic", "default_negative_penalty"})

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Quiz title cannot be empty")
        return value.strip() if value is not None else value

    @field_validator("topic")
    @classmethod
    def trim_topic(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("Topic cannot be empty")
        return value


class QuizQuestionInput(AuthoringModel):
    question_id: UUID
    sequence_order: int = Field(ge=1, le=32767)
    marks_override: Decimal | None = Field(
        default=None, gt=0, max_digits=8, decimal_places=4
    )
    negative_marking_enabled_override: bool | None = None
    negative_penalty_override: Decimal | None = Field(
        default=None, ge=0, max_digits=8, decimal_places=4
    )


class QuizQuestionsReplace(AuthoringModel):
    questions: Annotated[list[QuizQuestionInput], Field(max_length=32767)]

    @model_validator(mode="after")
    def validate_unique_questions_and_order(self):
        question_ids = [item.question_id for item in self.questions]
        orders = [item.sequence_order for item in self.questions]
        if len(question_ids) != len(set(question_ids)):
            raise ValueError("A quiz cannot contain the same question more than once")
        if len(orders) != len(set(orders)):
            raise ValueError("Question sequence_order values must be unique")
        return self


class QuizQuestionRead(BaseModel):
    question_id: UUID
    sequence_order: int
    marks_override: Decimal | None
    negative_marking_enabled_override: bool | None
    negative_penalty_override: Decimal | None


class QuizRead(BaseModel):
    id: UUID
    college_id: UUID
    faculty_user_id: UUID
    subject_id: UUID
    title: str
    description: str | None
    instructions: str | None
    topic: str | None
    default_duration_minutes: int
    total_marks: Decimal
    default_negative_marking_enabled: bool
    default_negative_penalty: Decimal | None
    default_result_visibility: ResultVisibility
    status: Literal["DRAFT", "PUBLISHED", "ARCHIVED"]
    created_at: datetime
    updated_at: datetime
    questions: list[QuizQuestionRead] = Field(default_factory=list)
