import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type { ResultVisibility, QuizStatus } from '../../types/faculty';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { Badge } from '../../components/common/Badge';
import { ArrowLeft, AlertCircle } from 'lucide-react';

export const QuizFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { quizId } = useParams<{ quizId: string }>();
  const isEdit = Boolean(quizId);
  const { showToast } = useToast();

  const [isLoading, setIsLoading] = useState<boolean>(isEdit);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form State
  const [subjectId, setSubjectId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [instructions, setInstructions] = useState<string>('');
  const [topic, setTopic] = useState<string>('');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [negativeMarkingEnabled, setNegativeMarkingEnabled] = useState<boolean>(false);
  const [negativePenalty, setNegativePenalty] = useState<string>('0.25');
  const [resultVisibility, setResultVisibility] = useState<ResultVisibility>('AFTER_SESSION_ENDS');
  const [quizStatus, setQuizStatus] = useState<QuizStatus>('DRAFT');

  const loadQuiz = useCallback(async () => {
    if (!quizId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const q = await facultyApi.getQuiz(quizId);
      setSubjectId(q.subject_id);
      setTitle(q.title);
      setDescription(q.description || '');
      setInstructions(q.instructions || '');
      setTopic(q.topic || '');
      setDurationMinutes(q.default_duration_minutes);
      setNegativeMarkingEnabled(q.default_negative_marking_enabled);
      setNegativePenalty(q.default_negative_penalty ? String(q.default_negative_penalty) : '0.25');
      setResultVisibility(q.default_result_visibility);
      setQuizStatus(q.status);
    } catch {
      setLoadError('Failed to load quiz details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    if (isEdit) {
      loadQuiz();
    }
  }, [isEdit, loadQuiz]);

  const isLocked = isEdit && quizStatus !== 'DRAFT';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;

    if (!title.trim()) {
      showToast('Quiz title is required', 'error');
      return;
    }
    if (!subjectId.trim()) {
      showToast('Subject UUID is required', 'error');
      return;
    }
    if (durationMinutes < 1) {
      showToast('Duration must be at least 1 minute', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && quizId) {
        await facultyApi.updateQuiz(quizId, {
          subject_id: subjectId.trim(),
          title: title.trim(),
          description: description.trim() || null,
          instructions: instructions.trim() || null,
          topic: topic.trim() || null,
          default_duration_minutes: durationMinutes,
          default_negative_marking_enabled: negativeMarkingEnabled,
          default_negative_penalty: negativeMarkingEnabled ? parseFloat(negativePenalty) : null,
          default_result_visibility: resultVisibility,
        });

        showToast('Quiz updated successfully', 'success');
        navigate('/faculty/quizzes');
      } else {
        const created = await facultyApi.createQuiz({
          subject_id: subjectId.trim(),
          title: title.trim(),
          description: description.trim() || null,
          instructions: instructions.trim() || null,
          topic: topic.trim() || null,
          default_duration_minutes: durationMinutes,
          default_negative_marking_enabled: negativeMarkingEnabled,
          default_negative_penalty: negativeMarkingEnabled ? parseFloat(negativePenalty) : null,
          default_result_visibility: resultVisibility,
        });

        showToast('Quiz created! Now add questions to assemble it.', 'success');
        navigate(`/faculty/quizzes/${created.id}/build`);
      }
    } catch {
      showToast(isEdit ? 'Failed to update quiz' : 'Failed to create quiz', 'error');
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
    return <ErrorDisplay message={loadError} onRetry={loadQuiz} />;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/faculty/quizzes">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Quizzes
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          {isEdit ? 'Edit Quiz' : 'Create New Quiz'}
        </h1>
        {isEdit && (
          <Badge
            variant={
              quizStatus === 'PUBLISHED'
                ? 'green'
                : quizStatus === 'ARCHIVED'
                ? 'gray'
                : 'amber'
            }
          >
            {quizStatus}
          </Badge>
        )}
      </div>

      {isLocked && (
        <Card className="p-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold">Quiz Locked ({quizStatus})</p>
              <p className="text-xs mt-0.5">
                This quiz has already been {quizStatus.toLowerCase()}. Its configuration and
                question structure cannot be modified.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quiz Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              disabled={isLocked}
              placeholder="e.g. Midterm Assessment: Algorithms & Data Structures"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject UUID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                disabled={isLocked}
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
              <input
                type="text"
                disabled={isLocked}
                placeholder="e.g. Graph Theory & Dynamic Programming"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={2}
              disabled={isLocked}
              placeholder="Brief summary of quiz objectives..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instructions for Students
            </label>
            <textarea
              rows={3}
              disabled={isLocked}
              placeholder="e.g. Complete all questions. Calculators not permitted. Each wrong answer incurs penalty..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Duration (Minutes) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={1}
                required
                disabled={isLocked}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 1)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Result Visibility
              </label>
              <select
                disabled={isLocked}
                value={resultVisibility}
                onChange={(e) => setResultVisibility(e.target.value as ResultVisibility)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="AFTER_SESSION_ENDS">After Session Ends (Recommended)</option>
                <option value="IMMEDIATELY">Immediately Upon Submission</option>
                <option value="UPON_FACULTY_RELEASE">Upon Faculty Release</option>
              </select>
            </div>
          </div>

          <div className="pt-2 border-t space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                disabled={isLocked}
                checked={negativeMarkingEnabled}
                onChange={(e) => setNegativeMarkingEnabled(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4 disabled:opacity-50"
              />
              <span className="text-sm font-medium text-gray-700">
                Enable Negative Marking by default
              </span>
            </label>

            {negativeMarkingEnabled && (
              <div className="w-full sm:w-1/2 pl-6">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Default Penalty Deduction
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0.0"
                  disabled={isLocked}
                  value={negativePenalty}
                  onChange={(e) => setNegativePenalty(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
            )}
          </div>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => navigate('/faculty/quizzes')}>
            Cancel
          </Button>
          {!isLocked && (
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? 'Save Changes' : 'Continue to Question Builder'}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};
