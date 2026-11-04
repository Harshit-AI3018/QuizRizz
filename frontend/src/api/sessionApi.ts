import { api } from './client';
import type {
  QuizSessionCreate,
  QuizSessionRead,
  SessionAction,
  SessionStatus,
  SessionResultsSummary,
} from '../types/session';

export const sessionApi = {
  listSessions(params?: {
    limit?: number;
    offset?: number;
    quiz_id?: string;
    class_id?: string;
    status?: SessionStatus;
  }): Promise<QuizSessionRead[]> {
    return api.get<QuizSessionRead[]>('/sessions', { params });
  },

  createSession(data: QuizSessionCreate): Promise<QuizSessionRead> {
    return api.post<QuizSessionRead>('/sessions', data);
  },

  createSessionForQuiz(quizId: string, data: QuizSessionCreate): Promise<QuizSessionRead> {
    return api.post<QuizSessionRead>(`/quizzes/${quizId}/sessions`, data);
  },

  getSession(id: string): Promise<QuizSessionRead> {
    return api.get<QuizSessionRead>(`/sessions/${id}`);
  },

  transitionSession(id: string, action: SessionAction): Promise<QuizSessionRead> {
    return api.post<QuizSessionRead>(`/sessions/${id}/${action}`);
  },

  getSessionResults(id: string): Promise<SessionResultsSummary> {
    return api.get<SessionResultsSummary>(`/sessions/${id}/results`);
  },

  releaseSessionResults(id: string): Promise<QuizSessionRead> {
    return api.post<QuizSessionRead>(`/sessions/${id}/results/release`);
  },
};
