from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.authoring import AuthoringModel
from app.schemas.lifecycle import SessionMode, SessionStatus

LobbyStatus = Literal[
    "WAITING_FOR_TEACHER",
    "READY_TO_START",
    "SESSION_PAUSED",
    "COMPLETED",
    "CANCELLED",
]

SyncStatus = Literal[
    "ACCEPTED",
    "IDEMPOTENT_RETRY",
    "VERSION_CONFLICT",
    "STALE_REJECTED",
]


class SessionJoinRequest(AuthoringModel):
    session_code: Annotated[str, Field(min_length=6, max_length=10)]

    @field_validator("session_code", mode="before")
    @classmethod
    def normalize_code(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("Session code must be a string")
        clean = value.strip().upper()
        if not clean.isalnum() or len(clean) < 6 or len(clean) > 10:
            raise ValueError("Session code must be 6 to 10 alphanumeric characters")
        return clean


class StudentSessionDiscovery(AuthoringModel):
    session_id: UUID
    session_code: str
    quiz_id: UUID
    quiz_title: str
    quiz_description: str | None
    subject_id: UUID
    subject_name: str
    subject_code: str
    class_id: UUID
    class_name: str
    faculty_name: str
    session_mode: SessionMode
    status: SessionStatus
    start_window_time: datetime
    end_window_time: datetime
    duration_minutes: int
    is_joined: bool = False
    has_attempt: bool = False
    attempt_status: str | None = None


class StudentLobbyStatus(AuthoringModel):
    session_id: UUID
    session_code: str
    quiz_id: UUID
    quiz_title: str
    quiz_description: str | None
    quiz_instructions: str | None
    subject_name: str
    subject_code: str
    class_name: str
    faculty_name: str
    session_status: SessionStatus
    start_window_time: datetime
    end_window_time: datetime
    duration_minutes: int
    session_mode: SessionMode
    is_joined: bool
    is_waiting: bool
    lobby_status: LobbyStatus
    message: str
    attempt_id: UUID | None = None
    attempt_status: str | None = None


class StudentQuestionOption(AuthoringModel):
    option_id: UUID
    option_text: str
    display_order: int


class StudentQuestion(AuthoringModel):
    question_id: UUID
    sequence_order: int
    question_type: str
    question_text: str
    marks: Decimal
    negative_penalty: Decimal
    options: list[StudentQuestionOption]


class StudentSavedResponse(AuthoringModel):
    attempt_id: UUID
    question_id: UUID
    selected_option_ids: list[UUID]
    is_marked_for_review: bool
    client_version: int
    client_submitted_at: datetime | None
    server_received_at: datetime


class StudentAttemptRead(AuthoringModel):
    attempt_id: UUID
    session_id: UUID
    status: str
    started_at: datetime
    deadline: datetime
    duration_minutes: int
    is_expired: bool
    time_remaining_seconds: int


class StudentAttemptStart(AuthoringModel):
    attempt_id: UUID
    session_id: UUID
    status: str
    deadline: datetime
    duration_minutes: int
    questions: list[StudentQuestion]
    saved_responses: list[StudentSavedResponse] = []


class StudentResponseSaveRequest(AuthoringModel):
    question_id: UUID
    selected_option_ids: list[UUID] = []
    is_marked_for_review: bool = False
    client_version: int = Field(..., gt=0)
    client_submitted_at: datetime | None = None

    @field_validator("selected_option_ids")
    @classmethod
    def require_unique_options(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("Duplicate option IDs are not permitted")
        return value


class StudentResponseSaveResult(AuthoringModel):
    question_id: UUID
    sync_status: SyncStatus
    persisted_version: int
    server_received_at: datetime


# =============================================================================
# Phase 8: Finalization and Result Schemas
# =============================================================================

class StudentAttemptFinalized(AuthoringModel):
    attempt_id: UUID
    status: Literal["FINALIZED"]
    submission_type: str
    finalized_at: datetime
    is_results_released: bool
    total_score: Decimal | None = None
    message: str


class StudentResultOptionBreakdown(AuthoringModel):
    option_id: UUID
    option_text: str
    display_order: int
    is_correct: bool


class StudentResultQuestionBreakdown(AuthoringModel):
    question_id: UUID
    sequence_order: int
    question_text: str
    question_type: str
    marks: Decimal
    awarded_marks: Decimal
    is_correct: bool
    selected_option_ids: list[UUID]
    explanation: str | None = None
    options: list[StudentResultOptionBreakdown] = []


class StudentAttemptResult(AuthoringModel):
    attempt_id: UUID
    status: str
    is_results_released: bool
    total_score: Decimal | None = None
    question_breakdown: list[StudentResultQuestionBreakdown] | None = None
    message: str
