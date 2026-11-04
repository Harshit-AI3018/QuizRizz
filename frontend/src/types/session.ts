import type { ResultVisibility } from './faculty';

export type SessionMode = 'STUDENT_PACED' | 'TEACHER_CONTROLLED';
export type SessionStatus = 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type SessionAction =
  | 'activate'
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'end'
  | 'cancel'
  | 'release';

export interface QuizSessionCreate {
  quiz_id: string;
  class_id: string;
  session_mode?: SessionMode;
  start_window_time: string; // ISO 8601 with timezone offset
  end_window_time: string;   // ISO 8601 with timezone offset
  duration_minutes?: number | null;
  negative_marking_enabled?: boolean | null;
  negative_penalty?: number | string | null;
  result_visibility?: ResultVisibility | null;
}

export interface QuizSessionRead {
  id: string;
  college_id: string;
  quiz_id: string;
  faculty_user_id: string;
  class_id: string;
  session_code: string;
  session_mode: SessionMode;
  status: SessionStatus;
  start_window_time: string;
  end_window_time: string;
  actual_started_at: string | null;
  actual_ended_at: string | null;
  duration_minutes: number;
  negative_marking_enabled: boolean | null;
  negative_penalty: number | string | null;
  result_visibility: ResultVisibility;
  results_released_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitorParticipant {
  student_user_id: string;
  student_name: string;
  roll_number: string | null;
  attempt_id: string | null;
  attempt_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINALIZED';
  is_connected: boolean;
  last_seen_at: string | null;
  answered_count: number;
  total_questions: number;
  started_at: string | null;
  time_remaining_seconds: number | null;
}

export interface MonitorSyncSummary {
  not_started: number;
  in_progress: number;
  submitted: number;
  timed_out: number;
}

export interface MonitorSyncData {
  session_id: string;
  session_status: SessionStatus;
  total_enrolled: number;
  connected_students_count: number;
  summary: MonitorSyncSummary;
  participants: MonitorParticipant[];
}

export interface StudentPresenceUpdatedData {
  student_user_id: string;
  student_name: string;
  roll_number: string | null;
  is_connected: boolean;
  last_seen_at: string;
  connected_students_count: number;
}

export interface AttemptStatusChangedData {
  student_user_id: string;
  attempt_id: string;
  attempt_status: 'IN_PROGRESS' | 'FINALIZED';
  submission_type?: string | null;
  answered_count?: number;
}

export interface StudentProgressUpdatedData {
  student_user_id: string;
  attempt_id: string;
  question_id: string;
  answered_count: number;
  is_marked_for_review: boolean;
  client_version: number;
}

export interface SessionStatusChangedData {
  session_id: string;
  previous_status: SessionStatus;
  new_status: SessionStatus;
  actual_ended_at?: string | null;
}

export interface TeacherStudentResultItem {
  attempt_id: string;
  student_user_id: string;
  student_name: string;
  enrollment_number: string | null;
  roll_number: string | null;
  status: string;
  submission_type: string | null;
  started_at: string;
  submitted_at: string | null;
  finalized_at: string | null;
  total_score: number | string | null;
  total_correct: number | null;
  total_incorrect: number | null;
  total_unattempted: number | null;
}

export interface SessionResultsSummary {
  session_id: string;
  session_code: string;
  quiz_id: string;
  quiz_title: string;
  class_id: string;
  class_name: string;
  status: SessionStatus;
  result_visibility: ResultVisibility;
  results_released_at: string | null;
  total_attempts: number;
  finalized_attempts: number;
  in_progress_attempts: number;
  average_score: number | string | null;
  highest_score: number | string | null;
  lowest_score: number | string | null;
  attempts: TeacherStudentResultItem[];
}
