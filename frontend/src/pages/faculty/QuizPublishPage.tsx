import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type { QuizRead, QuizPublished } from '../../types/faculty';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Award,
  Clock,
  Layers,
  Send,
  Lock,
} from 'lucide-react';

export const QuizPublishPage: React.FC = () => {
  const navigate = useNavigate();
  const { quizId } = useParams<{ quizId: string }>();
  const { showToast } = useToast();

  const [quiz, setQuiz] = useState<QuizRead | null>(null);
  const [publishedResult, setPublishedResult] = useState<QuizPublished | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadQuiz = useCallback(async () => {
    if (!quizId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await facultyApi.getQuiz(quizId);
      setQuiz(data);
    } catch {
      setError('Failed to load quiz details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    loadQuiz();
  }, [loadQuiz]);

  const handlePublish = async () => {
    if (!quizId) return;
    setIsPublishing(true);
    try {
      const result = await facultyApi.publishQuiz(quizId);
      setPublishedResult(result);
      showToast('Quiz published successfully!', 'success');
    } catch {
      showToast('Failed to publish quiz. Check question requirements.', 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !quiz) {
    return <ErrorDisplay message={error || 'Quiz not found'} onRetry={loadQuiz} />;
  }

  // If already published via this action or previously
  if (publishedResult || quiz.status === 'PUBLISHED') {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pt-6">
        <Card className="p-8 text-center space-y-4 border-green-200 bg-green-50/50">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quiz Published!</h1>
            <p className="text-sm text-gray-600 mt-1">
              <strong>{quiz.title}</strong> is now locked and ready to be scheduled into live test
              sessions.
            </p>
          </div>

          <div className="flex justify-center gap-6 py-3 text-sm">
            <span className="flex items-center gap-1.5 font-semibold text-gray-800">
              <Award className="w-4 h-4 text-green-600" />
              Total Marks:{' '}
              {publishedResult?.total_marks ?? quiz.total_marks}
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-gray-800">
              <Layers className="w-4 h-4 text-blue-600" />
              Questions: {quiz.questions?.length ?? 0}
            </span>
          </div>

          <div className="flex justify-center gap-3 pt-2">
            <Link to="/faculty/quizzes">
              <Button variant="secondary">Back to My Quizzes</Button>
            </Link>
            <Link to={`/faculty/quizzes/${quiz.id}/preview`}>
              <Button>View Quiz Preview</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const questionCount = quiz.questions?.length ?? 0;
  const canPublish = quiz.status === 'DRAFT' && questionCount > 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/faculty/quizzes/${quiz.id}/preview`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Preview
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Publish Assessment</h1>
      </div>

      {/* Summary Card */}
      <Card className="p-6 space-y-5">
        <div className="border-b pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="amber">{quiz.status}</Badge>
            <h2 className="text-lg font-bold text-gray-900">{quiz.title}</h2>
          </div>
          {quiz.topic && <p className="text-xs text-gray-500 mt-1">Topic: {quiz.topic}</p>}
        </div>

        {/* Verification Checklist */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-800">Pre-Publication Validation</h3>

          <div className="divide-y divide-gray-100 text-sm">
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-gray-600 flex items-center gap-2">
                <Layers className="w-4 h-4 text-gray-400" />
                Question Count
              </span>
              <span
                className={`font-semibold ${
                  questionCount > 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {questionCount} {questionCount === 1 ? 'question' : 'questions'}
              </span>
            </div>

            <div className="py-2.5 flex items-center justify-between">
              <span className="text-gray-600 flex items-center gap-2">
                <Award className="w-4 h-4 text-gray-400" />
                Total Marks
              </span>
              <span className="font-semibold text-gray-900">{quiz.total_marks} marks</span>
            </div>

            <div className="py-2.5 flex items-center justify-between">
              <span className="text-gray-600 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                Session Duration
              </span>
              <span className="font-semibold text-gray-900">
                {quiz.default_duration_minutes} minutes
              </span>
            </div>

            <div className="py-2.5 flex items-center justify-between">
              <span className="text-gray-600">Result Visibility</span>
              <Badge variant="blue" size="sm">
                {quiz.default_result_visibility}
              </Badge>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {questionCount === 0 ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-800">
              <p className="font-semibold">Cannot Publish Empty Quiz</p>
              <p className="mt-0.5">
                A quiz must contain at least one question before it can be published.
              </p>
              <Link
                to={`/faculty/quizzes/${quiz.id}/build`}
                className="inline-block mt-2 font-semibold underline text-red-900"
              >
                Assemble questions now &rarr;
              </Link>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 space-y-1">
              <p className="font-semibold">Irreversible Publishing Lock</p>
              <p>
                Once published, this quiz will transition from <code className="font-mono">DRAFT</code> to{' '}
                <code className="font-mono">PUBLISHED</code>. Questions, order, and marks cannot be
                further modified so existing live sessions maintain assessment integrity.
              </p>
            </div>
          </div>
        )}

        {/* Confirm Action */}
        <div className="flex justify-end gap-3 pt-3 border-t">
          <Button
            variant="secondary"
            onClick={() => navigate(`/faculty/quizzes/${quiz.id}/preview`)}
            disabled={isPublishing}
          >
            Cancel
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            disabled={!canPublish}
            isLoading={isPublishing}
            onClick={handlePublish}
          >
            <Send className="w-4 h-4 mr-1.5" />
            Confirm & Publish Quiz
          </Button>
        </div>
      </Card>
    </div>
  );
};
