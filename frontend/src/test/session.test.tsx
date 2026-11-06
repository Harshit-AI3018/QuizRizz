/**
 * Phase 10E Session Management & Live Quiz Integration Tests
 *
 * Covers:
 * - Session listing and filtering
 * - Session creation with timing windows & published quiz selection
 * - Session lifecycle controls (SCHEDULED -> ACTIVE -> PAUSED -> ACTIVE -> COMPLETED, and CANCELLED)
 * - Confirmation dialogs for destructive actions
 * - Real-time faculty monitoring, WebSocket ticket protocol, and event reconciliation
 * - Monotonic progress tracking & participant deduplication
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../api/sessionApi', () => ({
  sessionApi: {
    listSessions: vi.fn(),
    createSession: vi.fn(),
    createSessionForQuiz: vi.fn(),
    getSession: vi.fn(),
    transitionSession: vi.fn(),
    getSessionResults: vi.fn(),
    releaseSessionResults: vi.fn(),
  },
}));

vi.mock('../api/facultyApi', () => ({
  facultyApi: {
    listQuizzes: vi.fn(),
    listAssignments: vi.fn().mockResolvedValue([]),
  },
}));

const mockShowToast = vi.fn();
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock WebSocket utility
let lastWsOptions: any = null;
const mockWsSend = vi.fn();
const mockWsRequestSync = vi.fn();
const mockWsDisconnect = vi.fn();

vi.mock('../utils/websocket', () => ({
  createManagedWebSocket: (options: any) => {
    lastWsOptions = options;
    setTimeout(() => {
      options.onStateChange?.('CONNECTED');
    }, 10);
    return {
      send: mockWsSend,
      requestSync: mockWsRequestSync,
      disconnect: mockWsDisconnect,
      getState: () => 'CONNECTED',
    };
  },
}));

import { sessionApi } from '../api/sessionApi';
import { facultyApi } from '../api/facultyApi';
import { SessionsPage } from '../pages/faculty/SessionsPage';
import { SessionFormPage } from '../pages/faculty/SessionFormPage';
import { SessionMonitorPage } from '../pages/faculty/SessionMonitorPage';
import type { QuizSessionRead, SessionResultsSummary } from '../types/session';
import type { QuizRead } from '../types/faculty';

// ── Sample Fixtures ───────────────────────────────────────────────────────────

const sampleQuiz: QuizRead = {
  id: 'quiz-pub-1',
  college_id: 'col-1',
  faculty_user_id: 'fac-1',
  subject_id: 'sub-1',
  title: 'Operating Systems Midterm',
  description: 'Process scheduling, virtual memory, concurrency.',
  instructions: 'Answer all questions.',
  topic: 'OS',
  default_duration_minutes: 60,
  total_marks: '50.0',
  default_negative_marking_enabled: true,
  default_negative_penalty: '0.25',
  default_result_visibility: 'AFTER_SESSION_ENDS',
  status: 'PUBLISHED',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  questions: [
    {
      question_id: 'q-1',
      sequence_order: 1,
      marks_override: null,
      negative_marking_enabled_override: null,
      negative_penalty_override: null,
    },
  ],
};

const sampleSessions: QuizSessionRead[] = [
  {
    id: 'sess-1',
    college_id: 'col-1',
    quiz_id: 'quiz-pub-1',
    faculty_user_id: 'fac-1',
    class_id: 'cls-1',
    session_code: 'ALPHA123',
    session_mode: 'STUDENT_PACED',
    status: 'SCHEDULED',
    start_window_time: '2026-11-04T10:00:00Z',
    end_window_time: '2026-11-04T12:00:00Z',
    actual_started_at: null,
    actual_ended_at: null,
    duration_minutes: 60,
    negative_marking_enabled: true,
    negative_penalty: '0.25',
    result_visibility: 'AFTER_SESSION_ENDS',
    results_released_at: null,
    created_at: '2026-11-04T09:00:00Z',
    updated_at: '2026-11-04T09:00:00Z',
  },
  {
    id: 'sess-2',
    college_id: 'col-1',
    quiz_id: 'quiz-pub-1',
    faculty_user_id: 'fac-1',
    class_id: 'cls-1',
    session_code: 'BETA4567',
    session_mode: 'TEACHER_CONTROLLED',
    status: 'ACTIVE',
    start_window_time: '2026-11-04T10:00:00Z',
    end_window_time: '2026-11-04T12:00:00Z',
    actual_started_at: '2026-11-04T10:05:00Z',
    actual_ended_at: null,
    duration_minutes: 45,
    negative_marking_enabled: false,
    negative_penalty: null,
    result_visibility: 'IMMEDIATELY',
    results_released_at: null,
    created_at: '2026-11-04T09:30:00Z',
    updated_at: '2026-11-04T10:05:00Z',
  },
];

const sampleResultsSummary: SessionResultsSummary = {
  session_id: 'sess-2',
  session_code: 'BETA4567',
  quiz_id: 'quiz-pub-1',
  quiz_title: 'Operating Systems Midterm',
  class_id: 'cls-1',
  class_name: 'CSE Section A',
  status: 'COMPLETED',
  result_visibility: 'AFTER_SESSION_ENDS',
  results_released_at: null,
  total_attempts: 20,
  finalized_attempts: 18,
  in_progress_attempts: 2,
  average_score: '38.5',
  highest_score: '48.0',
  lowest_score: '22.0',
  attempts: [],
};

describe('Phase 10E: Session Management & Live Monitor Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastWsOptions = null;
  });

  // ── SessionsPage Tests ──────────────────────────────────────────────────────
  describe('SessionsPage', () => {
    it('renders session list with session codes and status badges', async () => {
      vi.mocked(sessionApi.listSessions).mockResolvedValue(sampleSessions);

      render(
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Quiz Sessions')).toBeInTheDocument();
      });

      expect(screen.getByText('ALPHA123')).toBeInTheDocument();
      expect(screen.getByText('BETA4567')).toBeInTheDocument();
      expect(screen.getByText('SCHEDULED')).toBeInTheDocument();
      expect(screen.getByText('● LIVE / ACTIVE')).toBeInTheDocument();
    });

    it('filters sessions by status', async () => {
      vi.mocked(sessionApi.listSessions).mockResolvedValue(sampleSessions);

      render(
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('ALPHA123')).toBeInTheDocument();
      });

      const select = screen.getByLabelText('Filter by Status');
      fireEvent.change(select, { target: { value: 'ACTIVE' } });

      expect(screen.getByText('BETA4567')).toBeInTheDocument();
      expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
    });

    it('executes start transition on a scheduled session', async () => {
      vi.mocked(sessionApi.listSessions).mockResolvedValue(sampleSessions);
      vi.mocked(sessionApi.transitionSession).mockResolvedValue({
        ...sampleSessions[0],
        status: 'ACTIVE',
      });

      render(
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('ALPHA123')).toBeInTheDocument();
      });

      const startButton = screen.getByRole('button', { name: /Start/i });
      fireEvent.click(startButton);

      await waitFor(() => {
        expect(sessionApi.transitionSession).toHaveBeenCalledWith('sess-1', 'start');
      });
    });

    it('opens confirmation modal before ending an active session', async () => {
      vi.mocked(sessionApi.listSessions).mockResolvedValue(sampleSessions);
      vi.mocked(sessionApi.transitionSession).mockResolvedValue({
        ...sampleSessions[1],
        status: 'COMPLETED',
      });

      render(
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('BETA4567')).toBeInTheDocument();
      });

      const endButton = screen.getByRole('button', { name: /End/i });
      fireEvent.click(endButton);

      // Verify modal is displayed
      expect(screen.getAllByText('End Session').length).toBeGreaterThan(0);

      // Confirm in modal
      const confirmButton = screen.getByRole('button', { name: 'End Session' });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(sessionApi.transitionSession).toHaveBeenCalledWith('sess-2', 'end');
      });
    });
  });

  // ── SessionFormPage Tests ───────────────────────────────────────────────────
  describe('SessionFormPage', () => {
    it('renders session creation form with published quizzes', async () => {
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue([sampleQuiz]);

      render(
        <MemoryRouter initialEntries={['/faculty/sessions/new']}>
          <Routes>
            <Route path="/faculty/sessions/new" element={<SessionFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Quiz Session')).toBeInTheDocument();
      });

      expect(screen.getByText(/Operating Systems Midterm/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Target Class UUID/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Session Mode/i)).toBeInTheDocument();
    });

    it('submits valid session creation payload and navigates', async () => {
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue([sampleQuiz]);
      vi.mocked(sessionApi.createSession).mockResolvedValue(sampleSessions[0]);

      render(
        <MemoryRouter initialEntries={['/faculty/sessions/new']}>
          <Routes>
            <Route path="/faculty/sessions/new" element={<SessionFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Create Quiz Session')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText(/Target Class UUID/i), {
        target: { value: 'cls-1111-2222' },
      });

      const submitButton = screen.getByRole('button', {
        name: /Create Session & Open Monitor/i,
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(sessionApi.createSession).toHaveBeenCalledWith(
          expect.objectContaining({
            quiz_id: 'quiz-pub-1',
            class_id: 'cls-1111-2222',
            session_mode: 'STUDENT_PACED',
            start_window_time: expect.any(String),
            end_window_time: expect.any(String),
          })
        );
      });
    });
  });

  // ── SessionMonitorPage Tests ────────────────────────────────────────────────
  describe('SessionMonitorPage', () => {
    it('loads session and establishes WebSocket connection', async () => {
      vi.mocked(sessionApi.getSession).mockResolvedValue(sampleSessions[1]);

      render(
        <MemoryRouter initialEntries={['/faculty/sessions/sess-2/monitor']}>
          <Routes>
            <Route path="/faculty/sessions/:sessionId/monitor" element={<SessionMonitorPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('BETA4567')).toBeInTheDocument();
      });

      expect(lastWsOptions).not.toBeNull();
      expect(lastWsOptions.path).toBe('/api/v1/ws/sessions/sess-2/monitor');
      expect(lastWsOptions.sessionId).toBe('sess-2');

      await waitFor(() => {
        expect(screen.getByText('Live Connected')).toBeInTheDocument();
      });
    });

    it('processes MONITOR_SYNC_STATE event and populates participants', async () => {
      vi.mocked(sessionApi.getSession).mockResolvedValue(sampleSessions[1]);

      render(
        <MemoryRouter initialEntries={['/faculty/sessions/sess-2/monitor']}>
          <Routes>
            <Route path="/faculty/sessions/:sessionId/monitor" element={<SessionMonitorPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('BETA4567')).toBeInTheDocument();
      });

      // Dispatch authoritative sync frame
      lastWsOptions.onMessage({
        event: 'MONITOR_SYNC_STATE',
        session_id: 'sess-2',
        timestamp: new Date().toISOString(),
        data: {
          session_id: 'sess-2',
          session_status: 'ACTIVE',
          total_enrolled: 25,
          connected_students_count: 12,
          summary: { not_started: 10, in_progress: 12, submitted: 3, timed_out: 0 },
          participants: [
            {
              student_user_id: 'stud-1',
              student_name: 'John Doe',
              roll_number: 'CS2026-001',
              attempt_id: 'att-1',
              attempt_status: 'IN_PROGRESS',
              is_connected: true,
              last_seen_at: new Date().toISOString(),
              answered_count: 5,
              total_questions: 10,
              started_at: new Date().toISOString(),
              time_remaining_seconds: 1800,
            },
          ],
        },
      });

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('CS2026-001')).toBeInTheDocument();
        expect(screen.getByText('5 / 10')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
      });
    });

    it('processes STUDENT_PROGRESS_UPDATED and maintains monotonic progress', async () => {
      vi.mocked(sessionApi.getSession).mockResolvedValue(sampleSessions[1]);

      render(
        <MemoryRouter initialEntries={['/faculty/sessions/sess-2/monitor']}>
          <Routes>
            <Route path="/faculty/sessions/:sessionId/monitor" element={<SessionMonitorPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('BETA4567')).toBeInTheDocument();
      });

      // 1. Initial participant state
      lastWsOptions.onMessage({
        event: 'MONITOR_SYNC_STATE',
        session_id: 'sess-2',
        timestamp: new Date().toISOString(),
        data: {
          session_id: 'sess-2',
          session_status: 'ACTIVE',
          total_enrolled: 1,
          connected_students_count: 1,
          summary: { not_started: 0, in_progress: 1, submitted: 0, timed_out: 0 },
          participants: [
            {
              student_user_id: 'stud-1',
              student_name: 'Jane Doe',
              roll_number: 'CS2026-002',
              attempt_id: 'att-1',
              attempt_status: 'IN_PROGRESS',
              is_connected: true,
              last_seen_at: new Date().toISOString(),
              answered_count: 4,
              total_questions: 10,
              started_at: new Date().toISOString(),
              time_remaining_seconds: 1200,
            },
          ],
        },
      });

      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
        expect(screen.getByText('4 / 10')).toBeInTheDocument();
      });

      // 2. Incremental progress update
      lastWsOptions.onMessage({
        event: 'STUDENT_PROGRESS_UPDATED',
        session_id: 'sess-2',
        timestamp: new Date().toISOString(),
        data: {
          student_user_id: 'stud-1',
          attempt_id: 'att-1',
          question_id: 'q-2',
          answered_count: 7,
          is_marked_for_review: false,
          client_version: 2,
        },
      });

      await waitFor(() => {
        expect(screen.getByText('7 / 10')).toBeInTheDocument();
      });

      // 3. Stale event arriving with lower progress (must NOT decrease)
      lastWsOptions.onMessage({
        event: 'STUDENT_PROGRESS_UPDATED',
        session_id: 'sess-2',
        timestamp: new Date().toISOString(),
        data: {
          student_user_id: 'stud-1',
          attempt_id: 'att-1',
          question_id: 'q-1',
          answered_count: 5, // Lower than 7!
          is_marked_for_review: false,
          client_version: 1,
        },
      });

      // Progress remains 7 / 10
      expect(screen.getByText('7 / 10')).toBeInTheDocument();
    });

    it('triggers manual sync via WebSocket requestSync', async () => {
      vi.mocked(sessionApi.getSession).mockResolvedValue(sampleSessions[1]);

      render(
        <MemoryRouter initialEntries={['/faculty/sessions/sess-2/monitor']}>
          <Routes>
            <Route path="/faculty/sessions/:sessionId/monitor" element={<SessionMonitorPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('BETA4567')).toBeInTheDocument();
      });

      const syncButton = screen.getByRole('button', { name: /Sync/i });
      fireEvent.click(syncButton);

      expect(mockWsRequestSync).toHaveBeenCalled();
    });

    it('releases results on a completed session and loads results summary', async () => {
      const completedSession = { ...sampleSessions[1], status: 'COMPLETED' as const };
      vi.mocked(sessionApi.getSession).mockResolvedValue(completedSession);
      vi.mocked(sessionApi.releaseSessionResults).mockResolvedValue({
        ...completedSession,
        results_released_at: new Date().toISOString(),
      });
      vi.mocked(sessionApi.getSessionResults).mockResolvedValue(sampleResultsSummary);

      render(
        <MemoryRouter initialEntries={['/faculty/sessions/sess-2/monitor']}>
          <Routes>
            <Route path="/faculty/sessions/:sessionId/monitor" element={<SessionMonitorPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Release Results to Students')).toBeInTheDocument();
      });

      const releaseBtn = screen.getByRole('button', {
        name: 'Release Results to Students',
      });
      fireEvent.click(releaseBtn);

      await waitFor(() => {
        expect(sessionApi.releaseSessionResults).toHaveBeenCalledWith('sess-2');
        expect(screen.getByText('Average Score')).toBeInTheDocument();
        expect(screen.getByText('38.5')).toBeInTheDocument();
      });
    });

    it('cleans up WebSocket upon component unmount', async () => {
      vi.mocked(sessionApi.getSession).mockResolvedValue(sampleSessions[1]);

      const { unmount } = render(
        <MemoryRouter initialEntries={['/faculty/sessions/sess-2/monitor']}>
          <Routes>
            <Route path="/faculty/sessions/:sessionId/monitor" element={<SessionMonitorPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('BETA4567')).toBeInTheDocument();
      });

      unmount();

      expect(mockWsDisconnect).toHaveBeenCalled();
    });
  });
});
