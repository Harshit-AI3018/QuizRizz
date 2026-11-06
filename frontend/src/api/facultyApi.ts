import { api } from './client';
import type {
  QuestionRead,
  QuestionCreate,
  QuestionUpdate,
  QuestionOptionsReplace,
  QuizRead,
  QuizCreate,
  QuizUpdate,
  QuizQuestionsReplace,
  QuizPublished,
  FacultyAssignment,
} from '../types/faculty';

export const facultyApi = {
  // Assignments
  listAssignments(): Promise<FacultyAssignment[]> {
    return api.get<FacultyAssignment[]>('/faculty/assignments');
  },

  // Questions
  listQuestions(params?: { subject_id?: string; limit?: number; offset?: number }): Promise<QuestionRead[]> {
    return api.get<QuestionRead[]>('/questions', { params });
  },

  createQuestion(data: QuestionCreate): Promise<QuestionRead> {
    return api.post<QuestionRead>('/questions', data);
  },

  getQuestion(id: string): Promise<QuestionRead> {
    return api.get<QuestionRead>(`/questions/${id}`);
  },

  updateQuestion(id: string, data: QuestionUpdate): Promise<QuestionRead> {
    return api.patch<QuestionRead>(`/questions/${id}`, data);
  },

  replaceQuestionOptions(id: string, data: QuestionOptionsReplace): Promise<QuestionRead> {
    return api.put<QuestionRead>(`/questions/${id}/options`, data);
  },

  deleteQuestion(id: string): Promise<void> {
    return api.delete<void>(`/questions/${id}`);
  },

  // Quizzes
  listQuizzes(params?: { limit?: number; offset?: number }): Promise<QuizRead[]> {
    return api.get<QuizRead[]>('/quizzes', { params });
  },

  createQuiz(data: QuizCreate): Promise<QuizRead> {
    return api.post<QuizRead>('/quizzes', data);
  },

  getQuiz(id: string): Promise<QuizRead> {
    return api.get<QuizRead>(`/quizzes/${id}`);
  },

  updateQuiz(id: string, data: QuizUpdate): Promise<QuizRead> {
    return api.patch<QuizRead>(`/quizzes/${id}`, data);
  },

  replaceQuizQuestions(id: string, data: QuizQuestionsReplace): Promise<QuizRead> {
    return api.put<QuizRead>(`/quizzes/${id}/questions`, data);
  },

  deleteQuiz(id: string): Promise<void> {
    return api.delete<void>(`/quizzes/${id}`);
  },

  publishQuiz(id: string): Promise<QuizPublished> {
    return api.post<QuizPublished>(`/quizzes/${id}/publish`);
  },
};
