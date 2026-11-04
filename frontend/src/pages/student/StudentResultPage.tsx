import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { studentApi } from '../../api/studentApi';
import type { StudentAttemptResult } from '../../types/student';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  CheckCircle2,
  Clock,
  Award,
  ArrowLeft,
  XCircle,
  BookOpen,
} from 'lucide-react';

export const StudentResultPage: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();

  const [result, setResult] = useState<StudentAttemptResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadResult = useCallback(async () => {
    if (!attemptId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await studentApi.getAttemptResult(attemptId);
      setResult(data);
    } catch {
      setError('Failed to load assessment result. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [attemptId]);

  useEffect(() => {
    loadResult();
  }, [loadResult]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !result) {
    return <ErrorDisplay message={error || 'Result not available'} onRetry={loadResult} />;
  }

  // 1. Pending Release State (is_results_released === false)
  if (!result.is_results_released) {
    return (
      <div className="max-w-xl mx-auto space-y-6 pt-6">
        <Card className="p-8 text-center space-y-5 border-blue-200 bg-blue-50/40">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <Badge variant="amber" size="md">
              Results Pending Release
            </Badge>
            <h1 className="text-2xl font-bold text-gray-900">Attempt Submitted!</h1>
            <p className="text-sm text-gray-600 max-w-md mx-auto">
              Your answers have been recorded securely on the server.
            </p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-blue-100 text-xs text-gray-600 space-y-2 text-left">
            <div className="flex items-center gap-2 font-semibold text-gray-800">
              <Clock className="w-4 h-4 text-blue-600" />
              Score Release Policy
            </div>
            <p>
              Scores and performance feedback will be released in accordance with this assessment's
              policy (e.g. after the testing session window closes or upon release by your instructor).
            </p>
          </div>

          <div className="pt-2">
            <Link to="/student">
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Back to Student Dashboard
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // 2. Released Results State (is_results_released === true)
  const breakdown = result.question_breakdown || [];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link to="/student">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Dashboard
          </Button>
        </Link>
        <Badge variant="green" size="md">
          Results Released
        </Badge>
      </div>

      {/* Score Summary Card */}
      <Card className="p-6 bg-gradient-to-r from-emerald-50 via-teal-50/40 to-blue-50/30 border-emerald-200 text-center space-y-2">
        <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-1">
          <Award className="w-7 h-7" />
        </div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Your Total Score
        </p>
        <h1 className="text-4xl font-extrabold text-emerald-800">
          {result.total_score != null ? String(result.total_score) : '—'}
        </h1>
        {result.message && <p className="text-xs text-gray-600">{result.message}</p>}
      </Card>

      {/* Question Breakdown (if provided by backend) */}
      {breakdown.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-600" />
            Question Breakdown
          </h2>

          <div className="space-y-3">
            {breakdown.map((q) => {
              const isCorrect = q.is_correct;

              return (
                <Card key={q.question_id} className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-800 font-bold text-xs flex items-center justify-center flex-shrink-0">
                        {q.sequence_order}
                      </span>
                      <span className="text-sm font-semibold text-gray-900">
                        Question {q.sequence_order}
                      </span>
                      <Badge variant="blue" size="sm">
                        {q.question_type.replace('_', ' ')}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant={isCorrect ? 'green' : 'amber'} size="sm">
                        {isCorrect ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Correct
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Incorrect
                          </span>
                        )}
                      </Badge>
                      <span className="text-xs font-bold text-gray-700">
                        {q.awarded_marks} / {q.marks} pts
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-gray-800 pl-8 leading-relaxed whitespace-pre-wrap">
                    {q.question_text}
                  </p>

                  {/* Options with correctness indication */}
                  {q.options && q.options.length > 0 && (
                    <div className="space-y-1.5 pl-8 pt-1">
                      {q.options.map((opt) => {
                        const isSelected = q.selected_option_ids?.includes(opt.option_id);
                        const isCorrectOption = opt.is_correct;

                        let optClass = 'bg-gray-50 border-gray-200 text-gray-700';
                        if (isCorrectOption) {
                          optClass = 'bg-green-50 border-green-300 text-green-900 font-medium';
                        } else if (isSelected && !isCorrectOption) {
                          optClass = 'bg-red-50 border-red-200 text-red-900';
                        }

                        return (
                          <div
                            key={opt.option_id}
                            className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${optClass}`}
                          >
                            <span>
                              {opt.display_order}. {opt.option_text}
                            </span>
                            <div className="flex items-center gap-2 font-medium">
                              {isSelected && <Badge variant="blue" size="sm">Your Choice</Badge>}
                              {isCorrectOption && (
                                <Badge variant="green" size="sm">Correct Answer</Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Explanation if provided */}
                  {q.explanation && (
                    <div className="pl-8 pt-1 text-xs text-gray-500 italic">
                      Explanation: {q.explanation}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer Navigation */}
      <div className="flex justify-center pt-4">
        <Link to="/student">
          <Button variant="secondary">Back to Student Dashboard</Button>
        </Link>
      </div>
    </div>
  );
};
