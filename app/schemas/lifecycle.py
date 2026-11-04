from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.authoring import AuthoringModel, ResultVisibility

SessionMode = Literal["STUDENT_PACED", "TEACHER_CONTROLLED"]
SessionStatus = Literal["SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]


class QuizPublished(AuthoringModel):
    quiz_id: UUID
    status: Literal["PUBLISHED"]
    total_marks: Decimal


class QuizSessionCreate(AuthoringModel):
    quiz_id: UUID
    class_id: UUID
    session_mode: SessionMode = "STUDENT_PACED"
    start_window_time: datetime
    end_window_time: datetime
    duration_minutes: int | None = Field(default=None, ge=1, le=2_147_483_647)
    negative_marking_enabled: bool | None = None
    negative_penalty: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=4)
    result_visibility: ResultVisibility | None = None

    @field_validator("start_window_time", "end_window_time")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Session window timestamps must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_window(self):
        if self.end_window_time <= self.start_window_time:
            raise ValueError("end_window_time must be after start_window_time")
        return self


class QuizSessionRead(AuthoringModel):
    id: UUID
    college_id: UUID
    quiz_id: UUID
    faculty_user_id: UUID
    class_id: UUID
    session_code: Annotated[str, Field(min_length=6, max_length=10)]
    session_mode: SessionMode
    status: SessionStatus
    start_window_time: datetime
    end_window_time: datetime
    actual_started_at: datetime | None
    actual_ended_at: datetime | None
    duration_minutes: int
    negative_marking_enabled: bool | None
    negative_penalty: Decimal | None
    result_visibility: ResultVisibility
    results_released_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TeacherStudentResultItem(AuthoringModel):
    attempt_id: UUID
    student_user_id: UUID
    student_name: str
    enrollment_number: str | None = None
    roll_number: str | None = None
    status: str
    submission_type: str | None = None
    started_at: datetime
    submitted_at: datetime | None = None
    finalized_at: datetime | None = None
    total_score: Decimal | None = None
    total_correct: int | None = None
    total_incorrect: int | None = None
    total_unattempted: int | None = None


class SessionResultsSummary(AuthoringModel):
    session_id: UUID
    session_code: str
    quiz_id: UUID
    quiz_title: str
    class_id: UUID
    class_name: str
    status: SessionStatus
    result_visibility: ResultVisibility
    results_released_at: datetime | None = None
    total_attempts: int
    finalized_attempts: int
    in_progress_attempts: int
    average_score: Decimal | None = None
    highest_score: Decimal | None = None
    lowest_score: Decimal | None = None
    attempts: list[TeacherStudentResultItem] = []
