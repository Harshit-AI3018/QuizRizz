import type { SessionMode, SessionStatus } from './session';

export type LobbyStatus =
  | 'WAITING_FOR_TEACHER'
  | 'READY_TO_START'
  | 'SESSION_PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export type SyncStatus =
  | 'ACCEPTED'
  | 'IDEMPOTENT_RETRY'
  | 'VERSION_CONFLICT'
  | 'STALE_REJECTED';

export interface SessionJoinRequest {
  session_code: string;
}

export interface StudentSessionDiscovery {
  session_id: string;
  session_code: string;
  quiz_id: string;
  quiz_title: string;
  quiz_description: string | null;
  subject_id: string;
  subject_name: string;
  subject_code: string;
  class_id: string;
  class_name: string;
  faculty_name: string;
  session_mode: SessionMode;
  status: SessionStatus;
  start_window_time: string;
  end_window_time: string;
  duration_minutes: number;
  is_joined: boolean;
  has_attempt: boolean;
  attempt_status: string | null;
}

export interface StudentLobbyStatus {
  session_id: string;
  session_code: string;
  quiz_id: string;
  quiz_title: string;
  quiz_description: string | null;
  quiz_instructions: string | null;
  subject_name: string;
  subject_code: string;
  class_name: string;
  faculty_name: string;
  session_status: SessionStatus;
  start_window_time: string;
  end_window_time: string;
  duration_minutes: number;
  session_mode: SessionMode;
  is_joined: boolean;
  is_waiting: boolean;
  lobby_status: LobbyStatus;
  message: string;
  attempt_id: string | null;
  attempt_status: string | null;
}

export interface StudentQuestionOption {
  option_id: string;
  option_text: string;
  display_order: number;
}

export interface StudentQuestion {
  question_id: string;
  sequence_order: number;
  question_type: 'MCQ' | 'TRUE_FALSE' | 'MULTIPLE_SELECT';
  question_text: string;
  marks: number | string;
  negative_penalty: number | string;
  options: StudentQuestionOption[];
}

export interface StudentSavedResponse {
  attempt_id: string;
  question_id: string;
  selected_option_ids: string[];
  is_marked_for_review: boolean;
  client_version: number;
  client_submitted_at: string | null;
  server_received_at: string;
}

export interface StudentAttemptRead {
  attempt_id: string;
  session_id: string;
  status: 'IN_PROGRESS' | 'FINALIZED';
  started_at: string;
  deadline: string;
  duration_minutes: number;
  is_expired: boolean;
  time_remaining_seconds: number;
}

export interface StudentAttemptStart {
  attempt_id: string;
  session_id: string;
  status: string;
  deadline: string;
  duration_minutes: number;
  questions: StudentQuestion[];
  saved_responses: StudentSavedResponse[];
}

export interface StudentResponseSaveRequest {
  question_id: string;
  selected_option_ids: string[];
  is_marked_for_review: boolean;
  client_version: number;
  client_submitted_at?: string | null;
}

export interface StudentResponseSaveResult {
  question_id: string;
  sync_status: SyncStatus;
  persisted_version: number;
  server_received_at: string;
}

export interface StudentAttemptFinalized {
  attempt_id: string;
  status: 'FINALIZED';
  submission_type: string;
  finalized_at: string;
  is_results_released: boolean;
  total_score: number | string | null;
  message: string;
}

export interface StudentResultOptionBreakdown {
  option_id: string;
  option_text: string;
  display_order: number;
  is_correct: boolean;
}

export interface StudentResultQuestionBreakdown {
  question_id: string;
  sequence_order: number;
  question_text: string;
  question_type: string;
  marks: number | string;
  awarded_marks: number | string;
  is_correct: boolean;
  selected_option_ids: string[];
  explanation: string | null;
  options: StudentResultOptionBreakdown[];
}

export interface StudentAttemptResult {
  attempt_id: string;
  status: string;
  is_results_released: boolean;
  total_score: number | string | null;
  question_breakdown: StudentResultQuestionBreakdown[] | null;
  message: string;
}
