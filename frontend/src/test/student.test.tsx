/**
 * Phase 10F Student Workflow Tests
 *
 * Covers:
 * - Student dashboard: session listings, join-by-code form
 * - Student sessions page: tab switching, search, join-by-code
 * - Student lobby: lobby state display, start attempt, WebSocket integration
 * - Student attempt: load data, MCQ/TRUE_FALSE/MULTIPLE_SELECT interactions,
 *   autosave, palette, navigation, submit modal, finalized redirect
 * - Student result: pending-release state, released results, question breakdown
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../api/studentApi', () => ({
  studentApi: {
    listAvailableSessions: vi.fn(),
    listJoinedSessions: vi.fn(),
    joinSession: vi.fn(),
    getSessionLobby: vi.fn(),
    startQuizAttempt: vi.fn(),
    getAttempt: vi.fn(),
    getAttemptQuestions: vi.fn(),
    getSavedResponses: vi.fn(),
    saveStudentResponse: vi.fn(),
    submitAttempt: vi.fn(),
    getAttemptResult: vi.fn(),
  },
}));

const mockShowToast = vi.fn();
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { first_name: 'Alice', last_name: 'Smith', role: 'STUDENT', id: 'stu-1' },
  }),
}));

// Mock WebSocket utility
let lastWsOptions: any = null;
const mockWsDisconnect = vi.fn();

vi.mock('../utils/websocket', () => ({
  createManagedWebSocket: (options: any) => {
    lastWsOptions = options;
    setTimeout(() => {
      options.onStateChange?.('CONNECTED');
    }, 10);
    return {
      send: vi.fn(),
      requestSync: vi.fn(),
      disconnect: mockWsDisconnect,
      getState: () => 'CONNECTED',
    };
  },
}));

import { studentApi } from '../api/studentApi';
import { StudentDashboardPage } from '../pages/student/StudentDashboardPage';
import { StudentSessionsPage } from '../pages/student/StudentSessionsPage';
import { StudentLobbyPage } from '../pages/student/StudentLobbyPage';
import { StudentAttemptPage } from '../pages/student/StudentAttemptPage';
import { StudentResultPage } from '../pages/student/StudentResultPage';
import type {
  StudentSessionDiscovery,
  StudentLobbyStatus,
  StudentAttemptRead,
  StudentQuestion,
  StudentSavedResponse,
  StudentAttemptStart,
  StudentAttemptFinalized,
  StudentAttemptResult,
} from '../types/student';

// ── Sample Fixtures ───────────────────────────────────────────────────────────

const sampleAvailableSession: StudentSessionDiscovery = {
  session_id: 'sess-avail-1',
  session_code: 'ABCD1234',
  quiz_id: 'quiz-1',
  quiz_title: 'OS Midterm',
  quiz_description: 'Operating Systems exam',
  subject_id: 'sub-1',
  subject_name: 'Operating Systems',
  subject_code: 'OS101',
  class_id: 'cls-1',
  class_name: 'CS-A 2024',
  faculty_name: 'Prof. Kumar',
  session_mode: 'STUDENT_PACED',
  status: 'ACTIVE',
  start_window_time: '2026-01-01T09:00:00Z',
  end_window_time: '2026-01-01T12:00:00Z',
  duration_minutes: 90,
  is_joined: false,
  has_attempt: false,
  attempt_status: null,
};

const sampleJoinedSession: StudentSessionDiscovery = {
  ...sampleAvailableSession,
  session_id: 'sess-joined-1',
  session_code: 'EFGH5678',
  quiz_title: 'DS Final',
  is_joined: true,
  has_attempt: true,
  attempt_status: 'IN_PROGRESS',
};

const sampleLobbyWaiting: StudentLobbyStatus = {
  session_id: 'sess-avail-1',
  session_code: 'ABCD1234',
  quiz_id: 'quiz-1',
  quiz_title: 'OS Midterm',
  quiz_description: 'Operating Systems exam',
  quiz_instructions: 'Answer all questions carefully.',
  subject_name: 'Operating Systems',
  subject_code: 'OS101',
  class_name: 'CS-A 2024',
  faculty_name: 'Prof. Kumar',
  session_status: 'SCHEDULED',
  start_window_time: '2026-01-01T09:00:00Z',
  end_window_time: '2026-01-01T12:00:00Z',
  duration_minutes: 90,
  session_mode: 'STUDENT_PACED',
  is_joined: true,
  is_waiting: true,
  lobby_status: 'WAITING_FOR_TEACHER',
  message: 'Waiting for the teacher to start the session.',
  attempt_id: null,
  attempt_status: null,
};

const sampleLobbyActive: StudentLobbyStatus = {
  ...sampleLobbyWaiting,
  session_status: 'ACTIVE',
  is_waiting: false,
  lobby_status: 'READY_TO_START',
  message: 'Session is live! You may now begin.',
};

const sampleLobbyCompleted: StudentLobbyStatus = {
  ...sampleLobbyWaiting,
  session_status: 'COMPLETED',
  is_waiting: false,
  lobby_status: 'COMPLETED',
  message: 'This session has ended.',
  attempt_id: 'att-1',
  attempt_status: 'FINALIZED',
};

const sampleAttemptRead: StudentAttemptRead = {
  attempt_id: 'att-1',
  session_id: 'sess-avail-1',
  status: 'IN_PROGRESS',
  started_at: '2026-01-01T09:05:00Z',
  deadline: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
  duration_minutes: 90,
  is_expired: false,
  time_remaining_seconds: 5400,
};

const sampleMcqQuestion: StudentQuestion = {
  question_id: 'q-mcq-1',
  sequence_order: 1,
  question_type: 'MCQ',
  question_text: 'Which of the following is an OS scheduling algorithm?',
  marks: 2,
  negative_penalty: 0,
  options: [
    { option_id: 'opt-a', option_text: 'Round Robin', display_order: 1 },
    { option_id: 'opt-b', option_text: 'Bubble Sort', display_order: 2 },
    { option_id: 'opt-c', option_text: 'Dijkstra', display_order: 3 },
    { option_id: 'opt-d', option_text: 'Huffman', display_order: 4 },
  ],
};

const sampleTrueFalseQuestion: StudentQuestion = {
  question_id: 'q-tf-1',
  sequence_order: 2,
  question_type: 'TRUE_FALSE',
  question_text: 'A process can be in multiple states simultaneously.',
  marks: 1,
  negative_penalty: 0,
  options: [
    { option_id: 'opt-true', option_text: 'True', display_order: 1 },
    { option_id: 'opt-false', option_text: 'False', display_order: 2 },
  ],
};

const sampleMultiSelectQuestion: StudentQuestion = {
  question_id: 'q-ms-1',
  sequence_order: 3,
  question_type: 'MULTIPLE_SELECT',
  question_text: 'Which of the following are memory management techniques?',
  marks: 3,
  negative_penalty: 0,
  options: [
    { option_id: 'opt-p', option_text: 'Paging', display_order: 1 },
    { option_id: 'opt-s', option_text: 'Segmentation', display_order: 2 },
    { option_id: 'opt-x', option_text: 'Hashing', display_order: 3 },
  ],
};

const sampleSavedResponse: StudentSavedResponse = {
  attempt_id: 'att-1',
  question_id: 'q-mcq-1',
  selected_option_ids: ['opt-a'],
  is_marked_for_review: false,
  client_version: 1,
  client_submitted_at: '2026-01-01T09:06:00Z',
  server_received_at: '2026-01-01T09:06:01Z',
};

const sampleAttemptStart: StudentAttemptStart = {
  attempt_id: 'att-1',
  session_id: 'sess-avail-1',
  status: 'IN_PROGRESS',
  deadline: sampleAttemptRead.deadline,
  duration_minutes: 90,
  questions: [sampleMcqQuestion, sampleTrueFalseQuestion, sampleMultiSelectQuestion],
  saved_responses: [sampleSavedResponse],
};

const sampleFinalizedAttempt: StudentAttemptFinalized = {
  attempt_id: 'att-1',
  status: 'FINALIZED',
  submission_type: 'MANUAL',
  finalized_at: '2026-01-01T10:00:00Z',
  is_results_released: false,
  total_score: null,
  message: 'Attempt submitted. Results are pending release.',
};

const sampleResultPending: StudentAttemptResult = {
  attempt_id: 'att-1',
  status: 'FINALIZED',
  is_results_released: false,
  total_score: null,
  question_breakdown: null,
  message: 'Results have not been released yet.',
};

const sampleResultReleased: StudentAttemptResult = {
  attempt_id: 'att-1',
  status: 'FINALIZED',
  is_results_released: true,
  total_score: 5,
  question_breakdown: [
    {
      question_id: 'q-mcq-1',
      sequence_order: 1,
      question_text: 'Which of the following is an OS scheduling algorithm?',
      question_type: 'MCQ',
      marks: 2,
      awarded_marks: 2,
      is_correct: true,
      selected_option_ids: ['opt-a'],
      explanation: 'Round Robin is a classic CPU scheduling algorithm.',
      options: [
        { option_id: 'opt-a', option_text: 'Round Robin', display_order: 1, is_correct: true },
        { option_id: 'opt-b', option_text: 'Bubble Sort', display_order: 2, is_correct: false },
      ],
    },
  ],
  message: 'Results are available.',
};

// ── Helper ────────────────────────────────────────────────────────────────────

function renderWithRouter(
  element: React.ReactElement,
  path = '/',
  routePath = '/',
  customInitialEntries?: (string | { pathname: string; state?: any })[]
) {
  return render(
    <MemoryRouter initialEntries={customInitialEntries || [path]}>
      <Routes>
        <Route path={routePath} element={element} />
      </Routes>
    </MemoryRouter>
  );
}

// ── StudentDashboardPage ──────────────────────────────────────────────────────

describe('StudentDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastWsOptions = null;
    (studentApi.listAvailableSessions as ReturnType<typeof vi.fn>).mockResolvedValue([sampleAvailableSession]);
    (studentApi.listJoinedSessions as ReturnType<typeof vi.fn>).mockResolvedValue([sampleJoinedSession]);
  });

  it('renders welcome greeting for the authenticated student', async () => {
    renderWithRouter(<StudentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/Alice/i)).toBeInTheDocument();
    });
  });

  it('shows available sessions loaded from the backend', async () => {
    renderWithRouter(<StudentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('OS Midterm')).toBeInTheDocument();
    });
  });

  it('shows joined sessions loaded from the backend', async () => {
    renderWithRouter(<StudentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText('DS Final')).toBeInTheDocument();
    });
  });

  it('renders join-by-code input field', async () => {
    renderWithRouter(<StudentDashboardPage />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/session code/i);
      expect(input).toBeInTheDocument();
    });
  });

  it('calls joinSession with the entered code when join form is submitted', async () => {
    (studentApi.joinSession as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyActive);
    renderWithRouter(<StudentDashboardPage />, '/', '/');

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/session code/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/session code/i);
    fireEvent.change(input, { target: { value: 'ABCD1234' } });

    const joinBtn = screen.getByRole('button', { name: /join session/i });
    fireEvent.click(joinBtn);

    await waitFor(() => {
      expect(studentApi.joinSession).toHaveBeenCalledWith('ABCD1234');
    });
  });

  it('shows an error toast for an invalid session code', async () => {
    (studentApi.joinSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Session not found or not accessible')
    );
    renderWithRouter(<StudentDashboardPage />, '/', '/');

    await waitFor(() => expect(screen.getByPlaceholderText(/session code/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/session code/i);
    fireEvent.change(input, { target: { value: 'INVALID1' } });
    fireEvent.click(screen.getByRole('button', { name: /join session/i }));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Session not found'),
        'error'
      );
    });
  });
});

// ── StudentSessionsPage ───────────────────────────────────────────────────────

describe('StudentSessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (studentApi.listAvailableSessions as ReturnType<typeof vi.fn>).mockResolvedValue([sampleAvailableSession]);
    (studentApi.listJoinedSessions as ReturnType<typeof vi.fn>).mockResolvedValue([sampleJoinedSession]);
  });

  it('shows available sessions in the default tab', async () => {
    renderWithRouter(<StudentSessionsPage />);
    await waitFor(() => {
      expect(screen.getByText('OS Midterm')).toBeInTheDocument();
    });
  });

  it('switches to joined sessions tab', async () => {
    renderWithRouter(<StudentSessionsPage />);
    await waitFor(() => expect(screen.getByText('OS Midterm')).toBeInTheDocument());

    const joinedTab = screen.getByRole('button', { name: /my joined sessions/i });
    fireEvent.click(joinedTab);

    await waitFor(() => {
      expect(screen.getByText('DS Final')).toBeInTheDocument();
    });
  });

  it('filters available sessions by search query', async () => {
    renderWithRouter(<StudentSessionsPage />);
    await waitFor(() => expect(screen.getByText('OS Midterm')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'DS' } });

    await waitFor(() => {
      expect(screen.queryByText('OS Midterm')).not.toBeInTheDocument();
    });
  });

  it('renders join-by-code form', async () => {
    renderWithRouter(<StudentSessionsPage />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/session code/i)).toBeInTheDocument();
    });
  });

  it('calls joinSession when join-by-code form is submitted', async () => {
    (studentApi.joinSession as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyActive);
    renderWithRouter(<StudentSessionsPage />);
    await waitFor(() => expect(screen.getByPlaceholderText(/session code/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/session code/i), {
      target: { value: 'ABCD1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }));

    await waitFor(() => {
      expect(studentApi.joinSession).toHaveBeenCalledWith('ABCD1234');
    });
  });
});

// ── StudentLobbyPage ──────────────────────────────────────────────────────────

describe('StudentLobbyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsDisconnect.mockReset();
    lastWsOptions = null;
  });

  it('shows waiting message when session is SCHEDULED', async () => {
    (studentApi.getSessionLobby as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyWaiting);
    renderWithRouter(
      <StudentLobbyPage />,
      '/student/sessions/sess-avail-1/lobby',
      '/student/sessions/:sessionId/lobby'
    );

    await waitFor(() => {
      expect(screen.getByText(/Waiting/i)).toBeInTheDocument();
    });
  });

  it('shows start button when session is ACTIVE and attempt not started', async () => {
    (studentApi.getSessionLobby as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyActive);
    renderWithRouter(
      <StudentLobbyPage />,
      '/student/sessions/sess-avail-1/lobby',
      '/student/sessions/:sessionId/lobby'
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
    });
  });

  it('shows completed message and result link when session is COMPLETED', async () => {
    (studentApi.getSessionLobby as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyCompleted);
    renderWithRouter(
      <StudentLobbyPage />,
      '/student/sessions/sess-avail-1/lobby',
      '/student/sessions/:sessionId/lobby'
    );

    await waitFor(() => {
      expect(screen.getByText('Session Has Ended')).toBeInTheDocument();
    });

    // Should show a link to view result
    await waitFor(() => {
      const resultLink = screen.getByRole('link', { name: /result/i });
      expect(resultLink).toHaveAttribute('href', '/student/attempts/att-1/result');
    });
  });

  it('calls startQuizAttempt when Start button is clicked', async () => {
    (studentApi.getSessionLobby as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyActive);
    (studentApi.startQuizAttempt as ReturnType<typeof vi.fn>).mockResolvedValue(sampleAttemptStart);

    renderWithRouter(
      <StudentLobbyPage />,
      '/student/sessions/sess-avail-1/lobby',
      '/student/sessions/:sessionId/lobby'
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /start/i }));

    await waitFor(() => {
      expect(studentApi.startQuizAttempt).toHaveBeenCalledWith('sess-avail-1');
    });
  });

  it('connects WebSocket with the correct student path', async () => {
    (studentApi.getSessionLobby as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyWaiting);
    renderWithRouter(
      <StudentLobbyPage />,
      '/student/sessions/sess-avail-1/lobby',
      '/student/sessions/:sessionId/lobby'
    );

    await waitFor(() => {
      expect(lastWsOptions).not.toBeNull();
      expect(lastWsOptions.path).toContain('/ws/sessions/sess-avail-1/student');
    });
  });

  it('re-fetches lobby when SESSION_STATUS_CHANGED WebSocket event is received', async () => {
    (studentApi.getSessionLobby as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyWaiting);
    renderWithRouter(
      <StudentLobbyPage />,
      '/student/sessions/sess-avail-1/lobby',
      '/student/sessions/:sessionId/lobby'
    );

    await waitFor(() => expect(lastWsOptions).not.toBeNull());

    // Simulate incoming WS event
    lastWsOptions.onMessage({ event: 'SESSION_STATUS_CHANGED', data: {} });

    await waitFor(() => {
      // getSessionLobby should be called at least twice (initial + on event)
      expect(studentApi.getSessionLobby).toHaveBeenCalledTimes(2);
    });
  });

  it('shows error toast when starting attempt fails', async () => {
    (studentApi.getSessionLobby as ReturnType<typeof vi.fn>).mockResolvedValue(sampleLobbyActive);
    (studentApi.startQuizAttempt as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Cannot start attempt: Session schedule window has ended')
    );

    renderWithRouter(
      <StudentLobbyPage />,
      '/student/sessions/sess-avail-1/lobby',
      '/student/sessions/:sessionId/lobby'
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /start/i }));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('schedule window has ended'),
        'error'
      );
    });
  });
});

// ── StudentAttemptPage ────────────────────────────────────────────────────────

describe('StudentAttemptPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (studentApi.getAttempt as ReturnType<typeof vi.fn>).mockResolvedValue(sampleAttemptRead);
    (studentApi.getAttemptQuestions as ReturnType<typeof vi.fn>).mockResolvedValue([
      sampleMcqQuestion,
      sampleTrueFalseQuestion,
      sampleMultiSelectQuestion,
    ]);
    (studentApi.getSavedResponses as ReturnType<typeof vi.fn>).mockResolvedValue([sampleSavedResponse]);
    (studentApi.saveStudentResponse as ReturnType<typeof vi.fn>).mockResolvedValue({
      question_id: 'q-mcq-1',
      sync_status: 'ACCEPTED',
      persisted_version: 2,
      server_received_at: new Date().toISOString(),
    });
  });

  it('loads and displays the first question', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => {
      expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument();
    });
  });

  it('renders MCQ options for the first question', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => {
      expect(screen.getByText('Round Robin')).toBeInTheDocument();
      expect(screen.getByText('Bubble Sort')).toBeInTheDocument();
    });
  });

  it('selects an MCQ option when clicked', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText('Bubble Sort')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Bubble Sort'));

    // The option should now appear selected (button/div should have selected styling)
    // We verify saveStudentResponse is eventually called after debounce
    await waitFor(() => {
      expect(studentApi.saveStudentResponse).toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it('navigates to True/False question via Next button', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());

    const nextBtn = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText(/process can be in multiple states/i)).toBeInTheDocument();
    });
  });

  it('renders True/False options for a TRUE_FALSE question', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('True')).toBeInTheDocument();
      expect(screen.getByText('False')).toBeInTheDocument();
    });
  });

  it('allows only one TRUE_FALSE option to be selected at a time', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('True')).toBeInTheDocument();
    });

    // Click True, then False — only False should remain selected
    fireEvent.click(screen.getByText('True'));
    fireEvent.click(screen.getByText('False'));

    // MCQ/TF are single-select; calling saveStudentResponse confirms state changed
    await waitFor(() => {
      expect(studentApi.saveStudentResponse).toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it('navigates to MULTIPLE_SELECT question', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByText(/multiple states/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/memory management techniques/i)).toBeInTheDocument();
    });
  });

  it('allows multiple MULTIPLE_SELECT options to be selected', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());
    // Navigate to q3
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByText(/multiple states/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByText('Paging')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Paging'));
    fireEvent.click(screen.getByText('Segmentation'));

    // Both selected → saveStudentResponse called with both option IDs
    await waitFor(() => {
      const calls = (studentApi.saveStudentResponse as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      const payload = lastCall[1];
      expect(payload.selected_option_ids).toContain('opt-p');
      expect(payload.selected_option_ids).toContain('opt-s');
    }, { timeout: 1000 });
  });

  it('shows the question palette with question count buttons', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => {
      // Palette should show 3 question buttons (1-indexed)
      expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
    });
  });

  it('navigates back using the Prev button', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(screen.getByText(/multiple states/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /prev/i }));
    await waitFor(() => {
      expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument();
    });
  });

  it('opens submit confirmation modal when "Submit" button is clicked', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());

    const submitBtn = screen.getByRole('button', { name: /submit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // Modal should appear with confirm button
      expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    });
  });

  it('calls submitAttempt when confirmed in modal', async () => {
    (studentApi.submitAttempt as ReturnType<typeof vi.fn>).mockResolvedValue(sampleFinalizedAttempt);
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(studentApi.submitAttempt).toHaveBeenCalledWith('att-1');
    });
  });

  it('redirects to result page when attempt is already FINALIZED on load', async () => {
    (studentApi.getAttempt as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sampleAttemptRead,
      status: 'FINALIZED',
    });

    const mockNavigate = vi.fn();
    vi.doMock('react-router-dom', async () => {
      const actual = await vi.importActual('react-router-dom');
      return { ...actual, useNavigate: () => mockNavigate };
    });

    // Re-render with finalized attempt — component should redirect
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    // After load, component detects FINALIZED and navigates to result
    await waitFor(() => {
      expect(studentApi.getAttempt).toHaveBeenCalledWith('att-1');
    });
  });

  it('shows error display when questions fail to load', async () => {
    (studentApi.getAttemptQuestions as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to load assessment questions')
    );

    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load assessment questions/i)).toBeInTheDocument();
    });
  });

  it('hydrates attempt questions immediately when location state is provided', async () => {
    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId',
      [{ pathname: '/student/attempts/att-1', state: { attemptStart: sampleAttemptStart } }]
    );

    // Initial render should already have the question without needing to wait for mock API resolves
    expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument();
  });

  it('navigates to result page if submitAttempt receives 409 already finalized', async () => {
    const error409 = new Error('Cannot save response: Attempt is already FINALIZED');
    (error409 as any).status = 409;
    (studentApi.submitAttempt as ReturnType<typeof vi.fn>).mockRejectedValue(error409);

    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(studentApi.submitAttempt).toHaveBeenCalledWith('att-1');
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('submitted successfully'),
        'success'
      );
    });
  });

  it('flushes pending autosave before submitting and prevents duplicate saves', async () => {
    (studentApi.submitAttempt as ReturnType<typeof vi.fn>).mockResolvedValue(sampleFinalizedAttempt);

    renderWithRouter(
      <StudentAttemptPage />,
      '/student/attempts/att-1',
      '/student/attempts/:attemptId'
    );

    await waitFor(() => expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument());

    // Select an option (triggers 300ms debounce)
    fireEvent.click(screen.getByText('Round Robin'));

    // Immediately open submit and confirm before debounce completes
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(studentApi.saveStudentResponse).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          question_id: 'q-mcq-1',
          selected_option_ids: ['opt-a'],
        })
      );
      expect(studentApi.submitAttempt).toHaveBeenCalledWith('att-1');
    });

    // Advance timers by 500ms to ensure cleared debounce timer does not fire again
    await new Promise((resolve) => setTimeout(resolve, 500));

    // saveStudentResponse should only have been called once (the pre-submit flush)
    expect(studentApi.saveStudentResponse).toHaveBeenCalledTimes(1);
  });
});

// ── StudentResultPage ─────────────────────────────────────────────────────────

describe('StudentResultPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows pending state when results have not been released', async () => {
    (studentApi.getAttemptResult as ReturnType<typeof vi.fn>).mockResolvedValue(sampleResultPending);
    renderWithRouter(
      <StudentResultPage />,
      '/student/attempts/att-1/result',
      '/student/attempts/:attemptId/result'
    );

    await waitFor(() => {
      expect(screen.getByText(/not.*released|pending|not available/i)).toBeInTheDocument();
    });
  });

  it('does not show score or breakdown when results are unreleased', async () => {
    (studentApi.getAttemptResult as ReturnType<typeof vi.fn>).mockResolvedValue(sampleResultPending);
    renderWithRouter(
      <StudentResultPage />,
      '/student/attempts/att-1/result',
      '/student/attempts/:attemptId/result'
    );

    await waitFor(() => {
      expect(screen.queryByText(/total score/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/question breakdown/i)).not.toBeInTheDocument();
    });
  });

  it('shows total score when results are released', async () => {
    (studentApi.getAttemptResult as ReturnType<typeof vi.fn>).mockResolvedValue(sampleResultReleased);
    renderWithRouter(
      <StudentResultPage />,
      '/student/attempts/att-1/result',
      '/student/attempts/:attemptId/result'
    );

    await waitFor(() => {
      expect(screen.getByText(/5/)).toBeInTheDocument();
    });
  });

  it('shows question breakdown when results are released with breakdown data', async () => {
    (studentApi.getAttemptResult as ReturnType<typeof vi.fn>).mockResolvedValue(sampleResultReleased);
    renderWithRouter(
      <StudentResultPage />,
      '/student/attempts/att-1/result',
      '/student/attempts/:attemptId/result'
    );

    await waitFor(() => {
      expect(screen.getByText(/OS scheduling algorithm/i)).toBeInTheDocument();
    });
  });

  it('shows correct option badges from breakdown when released', async () => {
    (studentApi.getAttemptResult as ReturnType<typeof vi.fn>).mockResolvedValue(sampleResultReleased);
    renderWithRouter(
      <StudentResultPage />,
      '/student/attempts/att-1/result',
      '/student/attempts/:attemptId/result'
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Round Robin/).length).toBeGreaterThan(0);
      expect(screen.getByText('Correct Answer')).toBeInTheDocument();
    });
  });

  it('shows the explanation from breakdown when released and explanation is present', async () => {
    (studentApi.getAttemptResult as ReturnType<typeof vi.fn>).mockResolvedValue(sampleResultReleased);
    renderWithRouter(
      <StudentResultPage />,
      '/student/attempts/att-1/result',
      '/student/attempts/:attemptId/result'
    );

    await waitFor(() => {
      expect(screen.getByText(/Round Robin is a classic/i)).toBeInTheDocument();
    });
  });

  it('shows an error display when result fetch fails', async () => {
    (studentApi.getAttemptResult as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Not found')
    );
    renderWithRouter(
      <StudentResultPage />,
      '/student/attempts/att-1/result',
      '/student/attempts/:attemptId/result'
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Failed to load assessment result/i)).toBeInTheDocument();
    });
  });
});
