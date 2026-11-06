import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { studentApi } from '../../api/studentApi';
import type {
  StudentAttemptRead,
  StudentQuestion,
  StudentSavedResponse,
  StudentAttemptStart,
} from '../../types/student';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  Clock,
  CheckCircle2,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Send,
  AlertTriangle,
} from 'lucide-react';

interface QuestionState {
  selected_option_ids: string[];
  is_marked_for_review: boolean;
  client_version: number;
  saveStatus: 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR';
}

export const StudentAttemptPage: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  const initialAttemptStart = (location.state as { attemptStart?: StudentAttemptStart } | null)?.attemptStart;

  const [attempt, setAttempt] = useState<StudentAttemptRead | null>(() => {
    if (initialAttemptStart && initialAttemptStart.attempt_id === attemptId) {
      return {
        attempt_id: initialAttemptStart.attempt_id,
        session_id: initialAttemptStart.session_id,
        status: initialAttemptStart.status as 'IN_PROGRESS' | 'FINALIZED',
        started_at: new Date().toISOString(),
        deadline: initialAttemptStart.deadline,
        duration_minutes: initialAttemptStart.duration_minutes,
        is_expired: false,
        time_remaining_seconds: initialAttemptStart.duration_minutes * 60,
      };
    }
    return null;
  });

  const [questions, setQuestions] = useState<StudentQuestion[]>(() => {
    if (initialAttemptStart && initialAttemptStart.attempt_id === attemptId && initialAttemptStart.questions) {
      return [...initialAttemptStart.questions].sort((a, b) => a.sequence_order - b.sequence_order);
    }
    return [];
  });

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);

  const [answers, setAnswers] = useState<Record<string, QuestionState>>(() => {
    if (initialAttemptStart && initialAttemptStart.attempt_id === attemptId && initialAttemptStart.questions) {
      const initialMap: Record<string, QuestionState> = {};
      initialAttemptStart.questions.forEach((q) => {
        initialMap[q.question_id] = {
          selected_option_ids: [],
          is_marked_for_review: false,
          client_version: 1,
          saveStatus: 'IDLE',
        };
      });
      (initialAttemptStart.saved_responses || []).forEach((resp) => {
        if (initialMap[resp.question_id]) {
          initialMap[resp.question_id] = {
            selected_option_ids: resp.selected_option_ids || [],
            is_marked_for_review: resp.is_marked_for_review || false,
            client_version: resp.client_version || 1,
            saveStatus: 'SAVED',
          };
        }
      });
      return initialMap;
    }
    return {};
  });

  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(() => {
    if (initialAttemptStart && initialAttemptStart.attempt_id === attemptId && initialAttemptStart.deadline) {
      const deadlineMs = new Date(initialAttemptStart.deadline).getTime();
      return Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
    }
    return null;
  });

  const [isLoading, setIsLoading] = useState<boolean>(() => {
    return !(initialAttemptStart && initialAttemptStart.attempt_id === attemptId && initialAttemptStart.questions?.length > 0);
  });
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Submission confirmation modal state
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState<boolean>(false);

  // Debounce timers per question
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isSubmittingRef = useRef<boolean>(false);
  const pendingChangesRef = useRef<Record<string, QuestionState>>({});

  const flushPendingSaves = async () => {
    Object.values(saveTimersRef.current).forEach(clearTimeout);
    saveTimersRef.current = {};

    const pending = Object.entries(pendingChangesRef.current);
    if (pending.length > 0 && attemptId) {
      await Promise.all(
        pending.map(async ([questionId, stateToSave]) => {
          try {
            await studentApi.saveStudentResponse(attemptId, {
              question_id: questionId,
              selected_option_ids: stateToSave.selected_option_ids,
              is_marked_for_review: stateToSave.is_marked_for_review,
              client_version: stateToSave.client_version,
              client_submitted_at: new Date().toISOString(),
            });
            delete pendingChangesRef.current[questionId];
          } catch {
            // Ignore - will be handled by submit
          }
        })
      );
    }
  };

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach(clearTimeout);
      saveTimersRef.current = {};
    };
  }, []);

  // 1. Initial Load of Attempt, Questions, and Previously Saved Responses
  const loadAttemptData = useCallback(async () => {
    if (!attemptId) return;
    setLoadError(null);
    try {
      const [attemptData, questionsData, responsesData] = await Promise.all([
        studentApi.getAttempt(attemptId),
        studentApi.getAttemptQuestions(attemptId),
        studentApi.getSavedResponses(attemptId),
      ]);

      if (attemptData.status === 'FINALIZED') {
        navigate(`/student/attempts/${attemptId}/result`, { replace: true });
        return;
      }

      setAttempt(attemptData);
      setQuestions(questionsData.sort((a, b) => a.sequence_order - b.sequence_order));

      // Calculate initial countdown from server deadline
      const deadlineMs = new Date(attemptData.deadline).getTime();
      const remainingSec = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
      setSecondsRemaining(remainingSec);

      // Hydrate answers from saved_responses
      const initialMap: Record<string, QuestionState> = {};
      questionsData.forEach((q) => {
        initialMap[q.question_id] = {
          selected_option_ids: [],
          is_marked_for_review: false,
          client_version: 1,
          saveStatus: 'IDLE',
        };
      });

      responsesData.forEach((resp: StudentSavedResponse) => {
        if (initialMap[resp.question_id]) {
          initialMap[resp.question_id] = {
            selected_option_ids: resp.selected_option_ids || [],
            is_marked_for_review: resp.is_marked_for_review || false,
            client_version: resp.client_version || 1,
            saveStatus: 'SAVED',
          };
        }
      });

      setAnswers(initialMap);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load quiz attempt. Please refresh or check connection.');
    } finally {
      setIsLoading(false);
    }
  }, [attemptId, navigate]);

  useEffect(() => {
    loadAttemptData();
  }, [loadAttemptData]);

  // 2. Authoritative Timer Loop based on server deadline
  useEffect(() => {
    if (!attempt || secondsRemaining == null || attempt.status === 'FINALIZED') return;

    const timer = setInterval(() => {
      const deadlineMs = new Date(attempt.deadline).getTime();
      const remaining = Math.max(0, Math.floor((deadlineMs - Date.now()) / 1000));
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(timer);
        handleAutoExpire();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [attempt]);

  // Auto-expire when timer hits 0
  const handleAutoExpire = async () => {
    if (!attemptId || isSubmittingRef.current) return;
    setIsSubmitting(true);
    await flushPendingSaves();
    isSubmittingRef.current = true;
    showToast('Time has expired! Submitting your attempt...', 'info');
    try {
      await studentApi.submitAttempt(attemptId);
      navigate(`/student/attempts/${attemptId}/result`, { replace: true });
    } catch {
      navigate(`/student/attempts/${attemptId}/result`, { replace: true });
    }
  };

  // 3. Answer Selection & Autosave
  const executeSave = async (questionId: string, stateToSave: QuestionState) => {
    if (!attemptId || isSubmittingRef.current || attempt?.status === 'FINALIZED') return;

    setAnswers((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], saveStatus: 'SAVING' },
    }));

    try {
      await studentApi.saveStudentResponse(attemptId, {
        question_id: questionId,
        selected_option_ids: stateToSave.selected_option_ids,
        is_marked_for_review: stateToSave.is_marked_for_review,
        client_version: stateToSave.client_version,
        client_submitted_at: new Date().toISOString(),
      });

      delete pendingChangesRef.current[questionId];

      setAnswers((prev) => ({
        ...prev,
        [questionId]: { ...prev[questionId], saveStatus: 'SAVED' },
      }));
    } catch (err: any) {
      if (err?.status === 409 || String(err?.message || '').toLowerCase().includes('finalized')) {
        navigate(`/student/attempts/${attemptId}/result`, { replace: true });
        return;
      }
      setAnswers((prev) => ({
        ...prev,
        [questionId]: { ...prev[questionId], saveStatus: 'ERROR' },
      }));
    }
  };

  const handleOptionSelect = (questionId: string, optionId: string, questionType: string) => {
    setAnswers((prev) => {
      const current = prev[questionId] || {
        selected_option_ids: [],
        is_marked_for_review: false,
        client_version: 1,
        saveStatus: 'IDLE',
      };

      let nextSelected: string[];

      if (questionType === 'MULTIPLE_SELECT') {
        // Toggle option in set
        if (current.selected_option_ids.includes(optionId)) {
          nextSelected = current.selected_option_ids.filter((id) => id !== optionId);
        } else {
          nextSelected = [...current.selected_option_ids, optionId];
        }
      } else {
        // Single select (MCQ / TRUE_FALSE)
        nextSelected = [optionId];
      }

      const nextVersion = current.client_version + 1;
      const nextState: QuestionState = {
        ...current,
        selected_option_ids: nextSelected,
        client_version: nextVersion,
        saveStatus: 'SAVING',
      };

      pendingChangesRef.current[questionId] = nextState;

      // Debounce autosave by 300ms
      if (saveTimersRef.current[questionId]) {
        clearTimeout(saveTimersRef.current[questionId]);
      }
      saveTimersRef.current[questionId] = setTimeout(() => {
        executeSave(questionId, nextState);
      }, 300);

      return {
        ...prev,
        [questionId]: nextState,
      };
    });
  };

  const handleToggleReview = (questionId: string) => {
    setAnswers((prev) => {
      const current = prev[questionId];
      if (!current) return prev;

      const nextVersion = current.client_version + 1;
      const nextState: QuestionState = {
        ...current,
        is_marked_for_review: !current.is_marked_for_review,
        client_version: nextVersion,
        saveStatus: 'SAVING',
      };

      pendingChangesRef.current[questionId] = nextState;

      if (saveTimersRef.current[questionId]) {
        clearTimeout(saveTimersRef.current[questionId]);
      }
      saveTimersRef.current[questionId] = setTimeout(() => {
        executeSave(questionId, nextState);
      }, 300);

      return {
        ...prev,
        [questionId]: nextState,
      };
    });
  };

  // 4. Final Submission
  const handleFinalSubmit = async () => {
    if (!attemptId || isSubmittingRef.current) return;
    setIsSubmitting(true);
    await flushPendingSaves();
    isSubmittingRef.current = true;
    try {
      await studentApi.submitAttempt(attemptId);
      showToast('Assessment submitted successfully!', 'success');
      navigate(`/student/attempts/${attemptId}/result`, { replace: true });
    } catch (err: any) {
      if (err?.status === 409 || String(err?.message || '').toLowerCase().includes('finalized')) {
        showToast('Assessment submitted successfully!', 'success');
        navigate(`/student/attempts/${attemptId}/result`, { replace: true });
        return;
      }
      showToast(err.message || 'Failed to submit attempt', 'error');
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setIsSubmitModalOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError || !attempt || questions.length === 0) {
    return (
      <ErrorDisplay
        message={loadError || 'Assessment questions could not be loaded.'}
        onRetry={loadAttemptData}
      />
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const currentState = answers[currentQuestion?.question_id] || {
    selected_option_ids: [],
    is_marked_for_review: false,
    client_version: 1,
    saveStatus: 'IDLE',
  };

  // Stats for progress & submission confirmation
  const totalQuestions = questions.length;
  const answeredCount = questions.filter(
    (q) => (answers[q.question_id]?.selected_option_ids.length ?? 0) > 0
  ).length;
  const unansweredCount = totalQuestions - answeredCount;
  const reviewCount = questions.filter((q) => answers[q.question_id]?.is_marked_for_review).length;

  // Format countdown
  const minutesLeft = secondsRemaining != null ? Math.floor(secondsRemaining / 60) : 0;
  const secondsLeft = secondsRemaining != null ? secondsRemaining % 60 : 0;
  const isUrgent = secondsRemaining != null && secondsRemaining < 300; // < 5 mins

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Top Fixed Progress & Timer Bar */}
      <Card className="p-4 bg-white shadow-sm border-gray-200 sticky top-16 z-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-900">
              Question {currentQuestionIndex + 1} of {totalQuestions}
            </span>
            <Badge variant="blue" size="sm">
              {answeredCount} Answered
            </Badge>
            {reviewCount > 0 && (
              <Badge variant="purple" size="sm">
                {reviewCount} for Review
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Authoritative Timer */}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-sm font-bold ${
                isUrgent ? 'bg-red-50 text-red-600 animate-pulse border border-red-200' : 'bg-gray-100 text-gray-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>
                {String(minutesLeft).padStart(2, '0')}:{String(secondsLeft).padStart(2, '0')}
              </span>
            </div>

            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setIsSubmitModalOpen(true)}
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              Submit Test
            </Button>
          </div>
        </div>
      </Card>

      {/* Main Two-Column Quiz Interface: Question Area (8 cols) & Question Palette (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Question Area (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="p-6 space-y-5">
            {/* Question Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center">
                  {currentQuestion.sequence_order}
                </span>
                <Badge variant="blue" size="sm">
                  {currentQuestion.question_type.replace('_', ' ')}
                </Badge>
                <span className="text-xs text-gray-500 font-medium">
                  {currentQuestion.marks} {Number(currentQuestion.marks) === 1 ? 'mark' : 'marks'}
                </span>
                {Number(currentQuestion.negative_penalty) > 0 && (
                  <span className="text-xs text-red-600 font-medium">
                    (-{currentQuestion.negative_penalty} penalty)
                  </span>
                )}
              </div>

              {/* Mark for review toggle */}
              <button
                type="button"
                onClick={() => handleToggleReview(currentQuestion.question_id)}
                className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md border transition-colors ${
                  currentState.is_marked_for_review
                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                    : 'text-gray-500 hover:bg-gray-50 border-gray-200'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                {currentState.is_marked_for_review ? 'Marked for Review' : 'Mark for Review'}
              </button>
            </div>

            {/* Prompt Text */}
            <p className="text-base font-medium text-gray-900 leading-relaxed whitespace-pre-wrap">
              {currentQuestion.question_text}
            </p>

            {/* Helper guidance for question types */}
            {currentQuestion.question_type === 'MULTIPLE_SELECT' && (
              <p className="text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded border border-blue-100">
                Multiple select question: Check all options that apply.
              </p>
            )}

            {/* Options List */}
            <div className="space-y-2.5 pt-2">
              {currentQuestion.options.map((opt) => {
                const isSelected = currentState.selected_option_ids.includes(opt.option_id);
                const isMulti = currentQuestion.question_type === 'MULTIPLE_SELECT';

                return (
                  <div
                    key={opt.option_id}
                    onClick={() =>
                      handleOptionSelect(
                        currentQuestion.question_id,
                        opt.option_id,
                        currentQuestion.question_type
                      )
                    }
                    className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer select-none transition-all ${
                      isSelected
                        ? 'bg-emerald-50/80 border-emerald-400 text-emerald-950 font-medium'
                        : 'bg-white border-gray-200 hover:border-gray-300 text-gray-800'
                    }`}
                  >
                    {/* Selector indicator (Radio or Checkbox) */}
                    <div
                      className={`w-5 h-5 flex items-center justify-center flex-shrink-0 transition-colors ${
                        isMulti ? 'rounded-md' : 'rounded-full'
                      } border ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>

                    <span className="text-xs font-semibold text-gray-400 w-4 text-center">
                      {opt.display_order}.
                    </span>

                    <span className="text-sm flex-1">{opt.option_text}</span>
                  </div>
                );
              })}
            </div>

            {/* Question Footer: Autosave Status & Navigation Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t">
              {/* Autosave status indicator */}
              <div className="text-xs">
                {currentState.saveStatus === 'SAVING' && (
                  <span className="text-amber-600 flex items-center gap-1 font-medium">
                    <Spinner size="sm" /> Autosaving response...
                  </span>
                )}
                {currentState.saveStatus === 'SAVED' && (
                  <span className="text-emerald-600 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Response saved
                  </span>
                )}
                {currentState.saveStatus === 'ERROR' && (
                  <span className="text-red-600 font-medium">
                    Save failed. Check network connection.
                  </span>
                )}
              </div>

              {/* Prev / Next Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentQuestionIndex === 0}
                  onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentQuestionIndex === totalQuestions - 1}
                  onClick={() =>
                    setCurrentQuestionIndex((prev) => Math.min(totalQuestions - 1, prev + 1))
                  }
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Question Palette Grid (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 border-b pb-2">
              Question Palette
            </h3>

            <div className="grid grid-cols-5 gap-2 max-h-80 overflow-y-auto p-1">
              {questions.map((q, idx) => {
                const qState = answers[q.question_id];
                const hasAnswer = (qState?.selected_option_ids.length ?? 0) > 0;
                const isReview = qState?.is_marked_for_review;
                const isCurrent = idx === currentQuestionIndex;

                let bgClass = 'bg-gray-100 text-gray-700 hover:bg-gray-200';
                if (hasAnswer) {
                  bgClass = 'bg-emerald-600 text-white hover:bg-emerald-700';
                }
                if (isReview) {
                  bgClass = 'bg-purple-600 text-white hover:bg-purple-700';
                }

                return (
                  <button
                    key={q.question_id}
                    type="button"
                    onClick={() => setCurrentQuestionIndex(idx)}
                    className={`w-9 h-9 rounded-lg font-bold text-xs flex items-center justify-center transition-all ${bgClass} ${
                      isCurrent ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="pt-3 border-t text-[11px] text-gray-600 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-emerald-600" />
                <span>Answered ({answeredCount})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-purple-600" />
                <span>Marked for review ({reviewCount})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-gray-200" />
                <span>Unanswered ({unansweredCount})</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Submit Confirmation Modal */}
      <Modal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        title="Submit Assessment"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setIsSubmitModalOpen(false)}
              disabled={isSubmitting}
            >
              Continue Working
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleFinalSubmit}
              isLoading={isSubmitting}
            >
              Confirm & Submit
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to finalize and submit your assessment? Once submitted, your
            answers will be locked and cannot be changed.
          </p>

          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-gray-500">Answered Questions:</span>
              <p className="font-bold text-emerald-700 text-base">{answeredCount} of {totalQuestions}</p>
            </div>
            <div>
              <span className="text-gray-500">Unanswered Questions:</span>
              <p className={`font-bold text-base ${unansweredCount > 0 ? 'text-amber-600' : 'text-gray-700'}`}>
                {unansweredCount}
              </p>
            </div>
          </div>

          {unansweredCount > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span>
                You still have {unansweredCount} unanswered question(s). You can go back to answer them before submitting.
              </span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
