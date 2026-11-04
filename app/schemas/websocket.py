from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.authoring import AuthoringModel

WebSocketEventType = Literal[
    "MONITOR_SYNC_STATE",
    "STUDENT_PRESENCE_UPDATED",
    "ATTEMPT_STATUS_CHANGED",
    "STUDENT_PROGRESS_UPDATED",
    "SESSION_STATUS_CHANGED",
    "PING",
    "PONG",
    "ERROR",
]


class WebSocketTicketRequest(AuthoringModel):
    session_id: UUID | None = None


class WebSocketTicketResponse(AuthoringModel):
    ticket: str
    expires_in: int = 60


class ParticipantSummary(AuthoringModel):
    not_started: int = 0
    in_progress: int = 0
    submitted: int = 0
    timed_out: int = 0


class ParticipantItem(AuthoringModel):
    student_user_id: UUID
    student_name: str
    roll_number: str | None = None
    attempt_id: UUID | None = None
    attempt_status: str = "NOT_STARTED"
    is_connected: bool = False
    last_seen_at: datetime | None = None
    answered_count: int = 0
    total_questions: int = 0
    started_at: datetime | None = None
    time_remaining_seconds: int | None = None


class MonitorSyncStateData(AuthoringModel):
    session_id: UUID
    session_status: str
    total_enrolled: int
    connected_students_count: int
    summary: ParticipantSummary
    participants: list[ParticipantItem] = []


class StudentPresenceData(AuthoringModel):
    student_user_id: UUID
    student_name: str
    roll_number: str | None = None
    is_connected: bool
    last_seen_at: datetime | None = None
    connected_students_count: int


class AttemptStatusChangedData(AuthoringModel):
    student_user_id: UUID
    attempt_id: UUID
    attempt_status: str
    submission_type: str | None = None
    answered_count: int
    total_questions: int
    summary: ParticipantSummary


class StudentProgressData(AuthoringModel):
    student_user_id: UUID
    attempt_id: UUID
    question_id: UUID
    answered_count: int = 0
    total_questions: int = 0
    is_marked_for_review: bool
    client_version: int


class SessionStatusChangedData(AuthoringModel):
    session_id: UUID
    previous_status: str
    new_status: str
    actual_ended_at: datetime | None = None


class WebSocketEventEnvelope(AuthoringModel):
    event: WebSocketEventType
    session_id: UUID
    timestamp: datetime
    data: dict[str, Any] = Field(default_factory=dict)
