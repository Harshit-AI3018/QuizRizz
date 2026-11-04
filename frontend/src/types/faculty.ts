export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'MULTIPLE_SELECT';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type ResultVisibility = 'IMMEDIATELY' | 'AFTER_SESSION_ENDS' | 'UPON_FACULTY_RELEASE';
export type QuizStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface QuestionOptionRead {
  id: string;
  option_text: string;
  display_order: number;
  // Backend hides is_correct in read responses; may be tracked locally or optional
  is_correct?: boolean;
}

export interface QuestionOptionCreate {
  option_text: string;
  is_correct: boolean;
  display_order: number;
}

export interface QuestionRead {
  id: string;
  college_id: string;
  subject_id: string;
  created_by_faculty_id: string;
  question_type: QuestionType;
  question_text: string;
  explanation?: string | null;
  difficulty: Difficulty;
  topic?: string | null;
  default_marks: string | number;
  default_negative_penalty: string | number;
  is_bank_question: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  options: QuestionOptionRead[];
}

export interface QuestionCreate {
  subject_id: string;
  question_type: QuestionType;
  question_text: string;
  explanation?: string | null;
  difficulty?: Difficulty;
  topic?: string | null;
  default_marks?: number | string;
  default_negative_penalty?: number | string;
  is_bank_question?: boolean;
  options: QuestionOptionCreate[];
}

export interface QuestionUpdate {
  question_text?: string;
  explanation?: string | null;
  difficulty?: Difficulty;
  topic?: string | null;
  default_marks?: number | string;
  default_negative_penalty?: number | string;
  is_bank_question?: boolean;
}

export interface QuestionOptionsReplace {
  options: QuestionOptionCreate[];
}

export interface QuizQuestionRead {
  question_id: string;
  sequence_order: number;
  marks_override?: string | number | null;
  negative_marking_enabled_override?: boolean | null;
  negative_penalty_override?: string | number | null;
}

export interface QuizRead {
  id: string;
  college_id: string;
  faculty_user_id: string;
  subject_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  topic?: string | null;
  default_duration_minutes: number;
  total_marks: string | number;
  default_negative_marking_enabled: boolean;
  default_negative_penalty?: string | number | null;
  default_result_visibility: ResultVisibility;
  status: QuizStatus;
  created_at: string;
  updated_at: string;
  questions: QuizQuestionRead[];
}

export interface QuizCreate {
  subject_id: string;
  title: string;
  description?: string | null;
  instructions?: string | null;
  topic?: string | null;
  default_duration_minutes: number;
  default_negative_marking_enabled?: boolean;
  default_negative_penalty?: number | string | null;
  default_result_visibility?: ResultVisibility;
}

export interface QuizUpdate {
  subject_id?: string;
  title?: string;
  description?: string | null;
  instructions?: string | null;
  topic?: string | null;
  default_duration_minutes?: number;
  default_negative_marking_enabled?: boolean;
  default_negative_penalty?: number | string | null;
  default_result_visibility?: ResultVisibility;
}

export interface QuizQuestionInput {
  question_id: string;
  sequence_order: number;
  marks_override?: number | string | null;
  negative_marking_enabled_override?: boolean | null;
  negative_penalty_override?: number | string | null;
}

export interface QuizQuestionsReplace {
  questions: QuizQuestionInput[];
}

export interface QuizPublished {
  quiz_id: string;
  status: 'PUBLISHED';
  total_marks: string | number;
}
