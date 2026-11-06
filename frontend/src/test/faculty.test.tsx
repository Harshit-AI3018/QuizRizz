/**
 * Phase 10D Faculty Dashboard & Quiz Authoring Tests
 *
 * Tests for faculty API module and faculty authoring components.
 * All backend calls are mocked — zero network or database access.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../api/facultyApi', () => ({
  facultyApi: {
    listQuestions: vi.fn(),
    createQuestion: vi.fn(),
    getQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    replaceQuestionOptions: vi.fn(),
    deleteQuestion: vi.fn(),

    listQuizzes: vi.fn(),
    createQuiz: vi.fn(),
    getQuiz: vi.fn(),
    updateQuiz: vi.fn(),
    replaceQuizQuestions: vi.fn(),
    deleteQuiz: vi.fn(),
    publishQuiz: vi.fn(),
    listAssignments: vi.fn().mockResolvedValue([]),
  },
}));

const mockShowToast = vi.fn();
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { facultyApi } from '../api/facultyApi';
import { FacultyOverviewPage } from '../pages/faculty/FacultyOverviewPage';
import { FacultyAssignmentsPage } from '../pages/faculty/FacultyAssignmentsPage';
import { QuestionBankPage } from '../pages/faculty/QuestionBankPage';
import { QuestionFormPage } from '../pages/faculty/QuestionFormPage';
import { QuizzesPage } from '../pages/faculty/QuizzesPage';
import { QuizFormPage } from '../pages/faculty/QuizFormPage';
import { QuizBuilderPage } from '../pages/faculty/QuizBuilderPage';
import { QuizPreviewPage } from '../pages/faculty/QuizPreviewPage';
import { QuizPublishPage } from '../pages/faculty/QuizPublishPage';
import type { QuestionRead, QuizRead } from '../types/faculty';

// ── Sample Test Fixtures ──────────────────────────────────────────────────────

const sampleSubjectId = '11111111-1111-1111-1111-111111111111';

const sampleQuestions: QuestionRead[] = [
  {
    id: 'q-1',
    college_id: 'col-1',
    subject_id: sampleSubjectId,
    created_by_faculty_id: 'fac-1',
    question_type: 'MCQ',
    question_text: 'What is the time complexity of binary search?',
    explanation: 'Binary search halves the search space each step: O(log n).',
    difficulty: 'MEDIUM',
    topic: 'Algorithms',
    default_marks: '2.0',
    default_negative_penalty: '0.5',
    is_bank_question: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    options: [
      { id: 'opt-1', option_text: 'O(log n)', display_order: 1 },
      { id: 'opt-2', option_text: 'O(n)', display_order: 2 },
      { id: 'opt-3', option_text: 'O(n^2)', display_order: 3 },
    ],
  },
  {
    id: 'q-2',
    college_id: 'col-1',
    subject_id: sampleSubjectId,
    created_by_faculty_id: 'fac-1',
    question_type: 'TRUE_FALSE',
    question_text: 'TCP provides reliable, ordered byte streams.',
    explanation: 'TCP includes acknowledgments and retransmissions.',
    difficulty: 'EASY',
    topic: 'Networking',
    default_marks: '1.0',
    default_negative_penalty: '0.0',
    is_bank_question: true,
    is_active: true,
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    options: [
      { id: 'opt-4', option_text: 'True', display_order: 1 },
      { id: 'opt-5', option_text: 'False', display_order: 2 },
    ],
  },
];

const sampleQuizzes: QuizRead[] = [
  {
    id: 'quiz-1',
    college_id: 'col-1',
    faculty_user_id: 'fac-1',
    subject_id: sampleSubjectId,
    title: 'Midterm Algorithms Quiz',
    description: 'Covers searching and sorting algorithms.',
    instructions: 'No calculators allowed.',
    topic: 'Algorithms',
    default_duration_minutes: 45,
    total_marks: '10.0',
    default_negative_marking_enabled: true,
    default_negative_penalty: '0.5',
    default_result_visibility: 'AFTER_SESSION_ENDS',
    status: 'DRAFT',
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
  },
  {
    id: 'quiz-2',
    college_id: 'col-1',
    faculty_user_id: 'fac-1',
    subject_id: sampleSubjectId,
    title: 'Networking Fundamentals',
    description: null,
    instructions: null,
    topic: 'Networking',
    default_duration_minutes: 30,
    total_marks: '5.0',
    default_negative_marking_enabled: false,
    default_negative_penalty: null,
    default_result_visibility: 'IMMEDIATELY',
    status: 'PUBLISHED',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    questions: [
      {
        question_id: 'q-2',
        sequence_order: 1,
        marks_override: null,
        negative_marking_enabled_override: null,
        negative_penalty_override: null,
      },
    ],
  },
];

describe('Phase 10D: Faculty Dashboard & Authoring Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── FacultyOverviewPage Tests ───────────────────────────────────────────────
  describe('FacultyOverviewPage', () => {
    it('renders heading and metrics after loading data', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue(sampleQuizzes);

      render(
        <MemoryRouter>
          <FacultyOverviewPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Faculty Dashboard')).toBeInTheDocument();
      });

      expect(screen.getByText('Total Questions')).toBeInTheDocument();
      expect(screen.getByText('Total Quizzes')).toBeInTheDocument();
      expect(screen.getByText('Published Quizzes')).toBeInTheDocument();
      expect(screen.getByText('Draft Quizzes')).toBeInTheDocument();
      expect(screen.getByText('Midterm Algorithms Quiz')).toBeInTheDocument();
    });

    it('renders empty list messaging when no quizzes or questions exist', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue([]);
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue([]);

      render(
        <MemoryRouter>
          <FacultyOverviewPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('No quizzes created yet.')).toBeInTheDocument();
        expect(screen.getByText('No questions created yet.')).toBeInTheDocument();
      });
    });

    it('renders error display when API calls fail', async () => {
      vi.mocked(facultyApi.listQuestions).mockRejectedValue(new Error('Network error'));
      vi.mocked(facultyApi.listQuizzes).mockRejectedValue(new Error('Network error'));

      render(
        <MemoryRouter>
          <FacultyOverviewPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(
          screen.getByText(/Failed to load faculty dashboard data/i)
        ).toBeInTheDocument();
      });
    });
  });

  // ── FacultyAssignmentsPage Tests ────────────────────────────────────────────
  describe('FacultyAssignmentsPage', () => {
    it('renders backend architecture notice and detected authoring subjects', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue(sampleQuizzes);

      render(
        <MemoryRouter>
          <FacultyAssignmentsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Faculty Assignments')).toBeInTheDocument();
      });

      expect(screen.getByText(/Backend Contract Architecture Notice/i)).toBeInTheDocument();
      expect(screen.getByText(sampleSubjectId)).toBeInTheDocument();
    });

    it('displays empty state when no subjects are detected in questions/quizzes', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue([]);
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue([]);

      render(
        <MemoryRouter>
          <FacultyAssignmentsPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/No authoring subjects found/i)).toBeInTheDocument();
      });
    });
  });

  // ── QuestionBankPage Tests ──────────────────────────────────────────────────
  describe('QuestionBankPage', () => {
    it('renders question bank list with badges and options', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);

      render(
        <MemoryRouter>
          <QuestionBankPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Question Bank')).toBeInTheDocument();
      });

      expect(
        screen.getByText('What is the time complexity of binary search?')
      ).toBeInTheDocument();
      expect(
        screen.getByText('TCP provides reliable, ordered byte streams.')
      ).toBeInTheDocument();
      expect(screen.getByText('O(log n)')).toBeInTheDocument();
    });

    it('filters questions by text search', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);

      render(
        <MemoryRouter>
          <QuestionBankPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(
          screen.getByText('What is the time complexity of binary search?')
        ).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search question text or topic/i);
      fireEvent.change(searchInput, { target: { value: 'binary' } });

      expect(
        screen.getByText('What is the time complexity of binary search?')
      ).toBeInTheDocument();
      expect(
        screen.queryByText('TCP provides reliable, ordered byte streams.')
      ).not.toBeInTheDocument();
    });

    it('filters questions by type', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);

      render(
        <MemoryRouter>
          <QuestionBankPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(
          screen.getByText('What is the time complexity of binary search?')
        ).toBeInTheDocument();
      });

      const typeSelect = screen.getByLabelText('Filter by Type');
      fireEvent.change(typeSelect, { target: { value: 'TRUE_FALSE' } });

      expect(
        screen.getByText('TCP provides reliable, ordered byte streams.')
      ).toBeInTheDocument();
      expect(
        screen.queryByText('What is the time complexity of binary search?')
      ).not.toBeInTheDocument();
    });

    it('opens deactivation modal and calls deleteQuestion', async () => {
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);
      vi.mocked(facultyApi.deleteQuestion).mockResolvedValue();

      render(
        <MemoryRouter>
          <QuestionBankPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(
          screen.getByText('What is the time complexity of binary search?')
        ).toBeInTheDocument();
      });

      const deactivateButtons = screen.getAllByRole('button', { name: /Deactivate/i });
      fireEvent.click(deactivateButtons[0]);

      expect(screen.getByText('Confirm Deactivation')).toBeInTheDocument();

      const confirmButton = screen.getByRole('button', { name: 'Deactivate Question' });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(facultyApi.deleteQuestion).toHaveBeenCalledWith('q-1');
      });
    });
  });

  // ── QuestionFormPage Tests ──────────────────────────────────────────────────
  describe('QuestionFormPage', () => {
    it('renders create question form with default fields', () => {
      render(
        <MemoryRouter initialEntries={['/faculty/questions/new']}>
          <Routes>
            <Route path="/faculty/questions/new" element={<QuestionFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Create New Question')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/123e4567-e89b-12d3/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Enter the complete question prompt/i)).toBeInTheDocument();
    });

    it('switches options structure when changing type to TRUE_FALSE', () => {
      render(
        <MemoryRouter initialEntries={['/faculty/questions/new']}>
          <Routes>
            <Route path="/faculty/questions/new" element={<QuestionFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      const typeSelect = screen.getByRole('combobox', { name: /Question Type/i });
      fireEvent.change(typeSelect, { target: { value: 'TRUE_FALSE' } });

      expect(screen.getByDisplayValue('True')).toBeInTheDocument();
      expect(screen.getByDisplayValue('False')).toBeInTheDocument();
    });

    it('creates new question on form submission', async () => {
      vi.mocked(facultyApi.createQuestion).mockResolvedValue(sampleQuestions[0]);

      render(
        <MemoryRouter initialEntries={['/faculty/questions/new']}>
          <Routes>
            <Route path="/faculty/questions/new" element={<QuestionFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByPlaceholderText(/123e4567-e89b-12d3/i), {
        target: { value: sampleSubjectId },
      });
      fireEvent.change(screen.getByPlaceholderText(/Enter the complete question prompt/i), {
        target: { value: 'What is a stack?' },
      });

      // Fill in option text
      const optionInputs = screen.getAllByPlaceholderText(/Option \d text/i);
      fireEvent.change(optionInputs[0], { target: { value: 'LIFO structure' } });
      fireEvent.change(optionInputs[1], { target: { value: 'FIFO structure' } });
      fireEvent.change(optionInputs[2], { target: { value: 'Random access' } });
      fireEvent.change(optionInputs[3], { target: { value: 'None' } });

      const submitButton = screen.getByRole('button', { name: 'Create Question' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(facultyApi.createQuestion).toHaveBeenCalledWith(
          expect.objectContaining({
            subject_id: sampleSubjectId,
            question_text: 'What is a stack?',
            question_type: 'MCQ',
          })
        );
      });
    });

    it('loads question in edit mode and updates question', async () => {
      vi.mocked(facultyApi.getQuestion).mockResolvedValue(sampleQuestions[0]);
      vi.mocked(facultyApi.updateQuestion).mockResolvedValue(sampleQuestions[0]);
      vi.mocked(facultyApi.replaceQuestionOptions).mockResolvedValue(sampleQuestions[0]);

      render(
        <MemoryRouter initialEntries={['/faculty/questions/q-1/edit']}>
          <Routes>
            <Route path="/faculty/questions/:questionId/edit" element={<QuestionFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Edit Question')).toBeInTheDocument();
        expect(
          screen.getByDisplayValue('What is the time complexity of binary search?')
        ).toBeInTheDocument();
      });

      const submitButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(facultyApi.updateQuestion).toHaveBeenCalledWith(
          'q-1',
          expect.objectContaining({
            question_text: 'What is the time complexity of binary search?',
          })
        );
        expect(facultyApi.replaceQuestionOptions).toHaveBeenCalledWith(
          'q-1',
          expect.objectContaining({
            options: expect.any(Array),
          })
        );
      });
    });
  });

  // ── QuizzesPage Tests ───────────────────────────────────────────────────────
  describe('QuizzesPage', () => {
    it('renders quiz list with status badges and metrics', async () => {
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue(sampleQuizzes);

      render(
        <MemoryRouter>
          <QuizzesPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('My Quizzes')).toBeInTheDocument();
      });

      expect(screen.getByText('Midterm Algorithms Quiz')).toBeInTheDocument();
      expect(screen.getByText('Networking Fundamentals')).toBeInTheDocument();
      expect(screen.getByText('DRAFT')).toBeInTheDocument();
      expect(screen.getByText('PUBLISHED')).toBeInTheDocument();
    });

    it('filters quizzes by status', async () => {
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue(sampleQuizzes);

      render(
        <MemoryRouter>
          <QuizzesPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Midterm Algorithms Quiz')).toBeInTheDocument();
      });

      const statusSelect = screen.getByLabelText('Filter by Status');
      fireEvent.change(statusSelect, { target: { value: 'PUBLISHED' } });

      expect(screen.getByText('Networking Fundamentals')).toBeInTheDocument();
      expect(screen.queryByText('Midterm Algorithms Quiz')).not.toBeInTheDocument();
    });

    it('archives quiz upon confirmation', async () => {
      vi.mocked(facultyApi.listQuizzes).mockResolvedValue(sampleQuizzes);
      vi.mocked(facultyApi.deleteQuiz).mockResolvedValue();

      render(
        <MemoryRouter>
          <QuizzesPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Midterm Algorithms Quiz')).toBeInTheDocument();
      });

      const archiveButton = screen.getByRole('button', { name: /Archive/i });
      fireEvent.click(archiveButton);

      expect(screen.getByText('Confirm Archive')).toBeInTheDocument();

      const confirmButton = screen.getByRole('button', { name: 'Archive Quiz' });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(facultyApi.deleteQuiz).toHaveBeenCalledWith('quiz-1');
      });
    });
  });

  // ── QuizFormPage Tests ──────────────────────────────────────────────────────
  describe('QuizFormPage', () => {
    it('creates new quiz and navigates to question builder', async () => {
      vi.mocked(facultyApi.createQuiz).mockResolvedValue(sampleQuizzes[0]);

      render(
        <MemoryRouter initialEntries={['/faculty/quizzes/new']}>
          <Routes>
            <Route path="/faculty/quizzes/new" element={<QuizFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByPlaceholderText(/e.g. Midterm Assessment/i), {
        target: { value: 'Final Exam: Algorithms' },
      });
      fireEvent.change(screen.getByPlaceholderText(/123e4567-e89b-12d3/i), {
        target: { value: sampleSubjectId },
      });

      const submitBtn = screen.getByRole('button', {
        name: 'Continue to Question Builder',
      });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(facultyApi.createQuiz).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Final Exam: Algorithms',
            subject_id: sampleSubjectId,
          })
        );
      });
    });

    it('renders locked warning for published quiz', async () => {
      vi.mocked(facultyApi.getQuiz).mockResolvedValue(sampleQuizzes[1]); // PUBLISHED quiz

      render(
        <MemoryRouter initialEntries={['/faculty/quizzes/quiz-2/edit']}>
          <Routes>
            <Route path="/faculty/quizzes/:quizId/edit" element={<QuizFormPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Quiz Locked (PUBLISHED)')).toBeInTheDocument();
      });

      expect(
        screen.queryByRole('button', { name: 'Save Changes' })
      ).not.toBeInTheDocument();
    });
  });

  // ── QuizBuilderPage Tests ───────────────────────────────────────────────────
  describe('QuizBuilderPage', () => {
    it('renders builder with assembled questions and computed metrics', async () => {
      vi.mocked(facultyApi.getQuiz).mockResolvedValue(sampleQuizzes[0]);
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);

      render(
        <MemoryRouter initialEntries={['/faculty/quizzes/quiz-1/build']}>
          <Routes>
            <Route path="/faculty/quizzes/:quizId/build" element={<QuizBuilderPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Midterm Algorithms Quiz')).toBeInTheDocument();
      });

      expect(screen.getByText('1 Questions')).toBeInTheDocument();
      expect(
        screen.getAllByText(/What is the time complexity of binary search/i).length
      ).toBeGreaterThan(0);
    });

    it('adds question from bank and saves reordered list', async () => {
      vi.mocked(facultyApi.getQuiz).mockResolvedValue(sampleQuizzes[0]);
      vi.mocked(facultyApi.listQuestions).mockResolvedValue(sampleQuestions);
      vi.mocked(facultyApi.replaceQuizQuestions).mockResolvedValue(sampleQuizzes[0]);

      render(
        <MemoryRouter initialEntries={['/faculty/quizzes/quiz-1/build']}>
          <Routes>
            <Route path="/faculty/quizzes/:quizId/build" element={<QuizBuilderPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Midterm Algorithms Quiz')).toBeInTheDocument();
      });

      // Add second question from bank
      const addButtons = screen.getAllByRole('button', { name: /Add/i });
      fireEvent.click(addButtons[0]);

      // Save questions
      const saveButton = screen.getByRole('button', { name: /Save Questions/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(facultyApi.replaceQuizQuestions).toHaveBeenCalledWith(
          'quiz-1',
          expect.objectContaining({
            questions: expect.arrayContaining([
              expect.objectContaining({ question_id: 'q-1', sequence_order: 1 }),
              expect.objectContaining({ question_id: 'q-2', sequence_order: 2 }),
            ]),
          })
        );
      });
    });
  });

  // ── QuizPreviewPage Tests ───────────────────────────────────────────────────
  describe('QuizPreviewPage', () => {
    it('fetches quiz and question bodies in parallel and renders ordered preview', async () => {
      vi.mocked(facultyApi.getQuiz).mockResolvedValue(sampleQuizzes[0]);
      vi.mocked(facultyApi.getQuestion).mockResolvedValue(sampleQuestions[0]);

      render(
        <MemoryRouter initialEntries={['/faculty/quizzes/quiz-1/preview']}>
          <Routes>
            <Route path="/faculty/quizzes/:quizId/preview" element={<QuizPreviewPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Midterm Algorithms Quiz')).toBeInTheDocument();
      });

      expect(
        screen.getByText('What is the time complexity of binary search?')
      ).toBeInTheDocument();
      expect(screen.getByText('O(log n)')).toBeInTheDocument();
      expect(screen.getByText(/Security Architecture Notice/i)).toBeInTheDocument();
    });
  });

  // ── QuizPublishPage Tests ───────────────────────────────────────────────────
  describe('QuizPublishPage', () => {
    it('renders validation checklist and confirms publish', async () => {
      vi.mocked(facultyApi.getQuiz).mockResolvedValue(sampleQuizzes[0]);
      vi.mocked(facultyApi.publishQuiz).mockResolvedValue({
        quiz_id: 'quiz-1',
        status: 'PUBLISHED',
        total_marks: '10.0',
      });

      render(
        <MemoryRouter initialEntries={['/faculty/quizzes/quiz-1/publish']}>
          <Routes>
            <Route path="/faculty/quizzes/:quizId/publish" element={<QuizPublishPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Publish Assessment')).toBeInTheDocument();
      });

      expect(screen.getByText('Pre-Publication Validation')).toBeInTheDocument();
      expect(screen.getByText('1 question')).toBeInTheDocument();

      const publishButton = screen.getByRole('button', {
        name: 'Confirm & Publish Quiz',
      });
      fireEvent.click(publishButton);

      await waitFor(() => {
        expect(facultyApi.publishQuiz).toHaveBeenCalledWith('quiz-1');
        expect(screen.getByText('Quiz Published!')).toBeInTheDocument();
      });
    });

    it('prevents publishing when question count is zero', async () => {
      const emptyQuiz: QuizRead = {
        ...sampleQuizzes[0],
        questions: [],
      };
      vi.mocked(facultyApi.getQuiz).mockResolvedValue(emptyQuiz);

      render(
        <MemoryRouter initialEntries={['/faculty/quizzes/quiz-1/publish']}>
          <Routes>
            <Route path="/faculty/quizzes/:quizId/publish" element={<QuizPublishPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Cannot Publish Empty Quiz')).toBeInTheDocument();
      });

      const publishButton = screen.getByRole('button', {
        name: 'Confirm & Publish Quiz',
      });
      expect(publishButton).toBeDisabled();
    });
  });
});
