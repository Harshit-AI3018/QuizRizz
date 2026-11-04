import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import { sessionApi } from '../../api/sessionApi';
import type { QuizRead } from '../../types/faculty';
import type { SessionMode, QuizSessionCreate } from '../../types/session';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  ArrowLeft,
  Clock,
  Award,
  AlertTriangle,
  Info,
} from 'lucide-react';

export const SessionFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedQuizId = searchParams.get('quiz_id');
  const { showToast } = useToast();

  const [quizzes, setQuizzes] = useState<QuizRead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form State
  const [selectedQuizId, setSelectedQuizId] = useState<string>(preselectedQuizId || '');
  const [classId, setClassId] = useState<string>('');
  const [sessionMode, setSessionMode] = useState<SessionMode>('STUDENT_PACED');

  // Timestamps (HTML datetime-local inputs)
  const defaultStartTime = new Date();
  defaultStartTime.setMinutes(defaultStartTime.getMinutes() + 5);
  const defaultEndTime = new Date(defaultStartTime.getTime() + 120 * 60000); // 2 hours later

  const formatForInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [startWindowInput, setStartWindowInput] = useState<string>(formatForInput(defaultStartTime));
  const [endWindowInput, setEndWindowInput] = useState<string>(formatForInput(defaultEndTime));

  // Overrides
  const [durationMinutes, setDurationMinutes] = useState<string>('30');
  const [negativeMarkingEnabled, setNegativeMarkingEnabled] = useState<boolean>(false);
  const [negativePenalty, setNegativePenalty] = useState<string>('0.25');
  const [resultVisibility, setResultVisibility] = useState<string>('AFTER_SESSION_ENDS');

  const loadQuizzes = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await facultyApi.listQuizzes({ limit: 500 });
      // Only PUBLISHED quizzes can be scheduled into live sessions
      const published = data.filter((q) => q.status === 'PUBLISHED');
      setQuizzes(published);

      if (preselectedQuizId && published.some((q) => q.id === preselectedQuizId)) {
        setSelectedQuizId(preselectedQuizId);
      } else if (published.length > 0 && !selectedQuizId) {
        setSelectedQuizId(published[0].id);
      }
    } catch {
      setLoadError('Failed to load published quizzes. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [preselectedQuizId, selectedQuizId]);

  useEffect(() => {
    loadQuizzes();
  }, [loadQuizzes]);

  // Sync defaults when selected quiz changes
  const activeQuiz = quizzes.find((q) => q.id === selectedQuizId);

  useEffect(() => {
    if (activeQuiz) {
      setDurationMinutes(String(activeQuiz.default_duration_minutes));
      setNegativeMarkingEnabled(activeQuiz.default_negative_marking_enabled);
      setNegativePenalty(
        activeQuiz.default_negative_penalty ? String(activeQuiz.default_negative_penalty) : '0.25'
      );
      setResultVisibility(activeQuiz.default_result_visibility);
    }
  }, [activeQuiz]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedQuizId) {
      showToast('Please select a published quiz', 'error');
      return;
    }
    if (!classId.trim()) {
      showToast('Class UUID is required', 'error');
      return;
    }

    const start = new Date(startWindowInput);
    const end = new Date(endWindowInput);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      showToast('Invalid start or end date', 'error');
      return;
    }
    if (end <= start) {
      showToast('End window time must be strictly after start window time', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: QuizSessionCreate = {
        quiz_id: selectedQuizId,
        class_id: classId.trim(),
        session_mode: sessionMode,
        // Send full ISO string with timezone information
        start_window_time: start.toISOString(),
        end_window_time: end.toISOString(),
        duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
        negative_marking_enabled: negativeMarkingEnabled,
        negative_penalty: negativeMarkingEnabled ? parseFloat(negativePenalty) : null,
        result_visibility: resultVisibility as any,
      };

      const created = await sessionApi.createSession(payload);
      showToast('Session created successfully! Session code generated.', 'success');
      navigate(`/faculty/sessions/${created.id}/monitor`);
    } catch (err: any) {
      showToast(err.message || 'Failed to create session. Verify class assignment.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorDisplay message={loadError} onRetry={loadQuizzes} />;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/faculty/sessions">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Sessions
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Create Quiz Session</h1>
      </div>

      {quizzes.length === 0 ? (
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h3 className="text-base font-semibold text-gray-900">No Published Quizzes Available</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            You need at least one published quiz to create a live testing session. Draft quizzes cannot be scheduled.
          </p>
          <div className="pt-2">
            <Link to="/faculty/quizzes">
              <Button size="sm">Go to My Quizzes to Publish</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Quiz Selection Card */}
          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900 border-b pb-2">
              Select Published Assessment
            </h2>

            <div>
              <label htmlFor="quiz-select" className="block text-sm font-medium text-gray-700 mb-1">
                Published Quiz <span className="text-red-500">*</span>
              </label>
              <select
                id="quiz-select"
                aria-label="Published Quiz"
                required
                value={selectedQuizId}
                onChange={(e) => setSelectedQuizId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {quizzes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.title} ({q.questions?.length ?? 0} questions &bull; {q.total_marks} marks)
                  </option>
                ))}
              </select>
            </div>

            {/* Selected Quiz Metadata Badge Strip */}
            {activeQuiz && (
              <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100 flex flex-wrap items-center gap-4 text-xs text-gray-700">
                <span className="flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-green-600" />
                  Total Marks: <strong>{activeQuiz.total_marks}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  Default Duration: <strong>{activeQuiz.default_duration_minutes}m</strong>
                </span>
                <span className="font-mono text-gray-500">
                  Subject UUID: {activeQuiz.subject_id}
                </span>
              </div>
            )}
          </Card>

          {/* Target Class & Access Card */}
          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900 border-b pb-2">
              Target Class & Delivery Mode
            </h2>

            <div>
              <label htmlFor="class-id" className="block text-sm font-medium text-gray-700 mb-1">
                Target Class UUID <span className="text-red-500">*</span>
              </label>
              <input
                id="class-id"
                type="text"
                required
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-gray-400" />
                Backend requires an active faculty assignment for this class and the quiz's subject.
              </p>
            </div>

            <div>
              <label htmlFor="session-mode" className="block text-sm font-medium text-gray-700 mb-1">
                Session Mode
              </label>
              <select
                id="session-mode"
                aria-label="Session Mode"
                value={sessionMode}
                onChange={(e) => setSessionMode(e.target.value as SessionMode)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="STUDENT_PACED">Student Paced (Standard quiz experience)</option>
                <option value="TEACHER_CONTROLLED">Teacher Controlled (Synchronized lobby)</option>
              </select>
            </div>
          </Card>

          {/* Window & Timing Card */}
          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900 border-b pb-2">
              Schedule & Timing Window
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="start-window" className="block text-sm font-medium text-gray-700 mb-1">
                  Start Window Time <span className="text-red-500">*</span>
                </label>
                <input
                  id="start-window"
                  type="datetime-local"
                  required
                  value={startWindowInput}
                  onChange={(e) => setStartWindowInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="end-window" className="block text-sm font-medium text-gray-700 mb-1">
                  End Window Time <span className="text-red-500">*</span>
                </label>
                <input
                  id="end-window"
                  type="datetime-local"
                  required
                  value={endWindowInput}
                  onChange={(e) => setEndWindowInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label htmlFor="duration-minutes" className="block text-sm font-medium text-gray-700 mb-1">
                  Duration (Minutes)
                </label>
                <input
                  id="duration-minutes"
                  type="number"
                  min={1}
                  required
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="result-visibility" className="block text-sm font-medium text-gray-700 mb-1">
                  Result Visibility
                </label>
                <select
                  id="result-visibility"
                  value={resultVisibility}
                  onChange={(e) => setResultVisibility(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="AFTER_SESSION_ENDS">After Session Ends (Default)</option>
                  <option value="IMMEDIATELY">Immediately</option>
                  <option value="UPON_FACULTY_RELEASE">Upon Faculty Release</option>
                </select>
              </div>
            </div>

            <div className="pt-2 border-t space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={negativeMarkingEnabled}
                  onChange={(e) => setNegativeMarkingEnabled(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <span className="text-sm font-medium text-gray-700">
                  Enable Negative Marking override
                </span>
              </label>

              {negativeMarkingEnabled && (
                <div className="w-full sm:w-1/2 pl-6">
                  <label htmlFor="negative-penalty" className="block text-xs font-medium text-gray-600 mb-1">
                    Penalty Deduction
                  </label>
                  <input
                    id="negative-penalty"
                    type="number"
                    step="0.25"
                    min="0.0"
                    value={negativePenalty}
                    onChange={(e) => setNegativePenalty(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => navigate('/faculty/sessions')} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting} onClick={handleSubmit}>
              Create Session & Open Monitor
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
