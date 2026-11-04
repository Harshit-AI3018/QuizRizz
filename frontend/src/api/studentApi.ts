import { api } from './client';
import type {
  StudentSessionDiscovery,
  StudentLobbyStatus,
  StudentAttemptStart,
  StudentAttemptRead,
  StudentQuestion,
  StudentSavedResponse,
  StudentResponseSaveRequest,
  StudentResponseSaveResult,
  StudentAttemptFinalized,
  StudentAttemptResult,
} from '../types/student';

export const studentApi = {
  // Session Discovery
  listAvailableSessions(params?: { limit?: number; offset?: number }): Promise<StudentSessionDiscovery[]> {
    return api.get<StudentSessionDiscovery[]>('/student/sessions', { params });
  },

  listJoinedSessions(params?: { limit?: number; offset?: number }): Promise<StudentSessionDiscovery[]> {
    return api.get<StudentSessionDiscovery[]>('/student/sessions/joined', { params });
  },

  joinSession(sessionCode: string): Promise<StudentLobbyStatus> {
    return api.post<StudentLobbyStatus>('/student/sessions/join', {
      session_code: sessionCode,
    });
  },

  getSessionLobby(sessionId: string): Promise<StudentLobbyStatus> {
    return api.get<StudentLobbyStatus>(`/student/sessions/${sessionId}/lobby`);
  },

  // Attempt Lifecycle
  startQuizAttempt(sessionId: string): Promise<StudentAttemptStart> {
    return api.post<StudentAttemptStart>(`/student/sessions/${sessionId}/start`);
  },

  getAttempt(attemptId: string): Promise<StudentAttemptRead> {
    return api.get<StudentAttemptRead>(`/student/attempts/${attemptId}`);
  },

  getAttemptQuestions(attemptId: string): Promise<StudentQuestion[]> {
    return api.get<StudentQuestion[]>(`/student/attempts/${attemptId}/questions`);
  },

  getSavedResponses(attemptId: string): Promise<StudentSavedResponse[]> {
    return api.get<StudentSavedResponse[]>(`/student/attempts/${attemptId}/responses`);
  },

  saveStudentResponse(
    attemptId: string,
    payload: StudentResponseSaveRequest
  ): Promise<StudentResponseSaveResult> {
    return api.post<StudentResponseSaveResult>(
      `/student/attempts/${attemptId}/responses`,
      payload
    );
  },

  submitAttempt(attemptId: string): Promise<StudentAttemptFinalized> {
    return api.post<StudentAttemptFinalized>(`/student/attempts/${attemptId}/submit`);
  },

  getAttemptResult(attemptId: string): Promise<StudentAttemptResult> {
    return api.get<StudentAttemptResult>(`/student/attempts/${attemptId}/result`);
  },
};
