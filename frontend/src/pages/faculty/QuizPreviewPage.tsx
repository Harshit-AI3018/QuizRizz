import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type { QuizRead, QuestionRead } from '../../types/faculty';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  ArrowLeft,
  Clock,
  Award,
  Layers,
  Send,
  Edit2,
  Info,
  AlertTriangle,
} from 'lucide-react';

interface HydratedQuestion {
  sequence_order: number;
  marks: string | number;
  negative_penalty?: string | number | null;
  question: QuestionRead | null;
  rawQuestionId: string;
}

export const QuizPreviewPage: React.FC = () => {
  const { quizId } = useParams<{ quizId: string }>();

  const [quiz, setQuiz] = useState<QuizRead | null>(null);
  const [questions, setQuestions] = useState<HydratedQuestion[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (!quizId) return;
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch Quiz
      const quizData = await facultyApi.getQuiz(quizId);
      setQuiz(quizData);

      // 2. Fetch all Question bodies in parallel for each quiz question
      const sortedQuizQuestions = [...(quizData.questions || [])].sort(
        (a, b) => a.sequence_order - b.sequence_order
      );

      const questionPromises = sortedQuizQuestions.map(async (qq) => {
        try {
          const detail = await facultyApi.getQuestion(qq.question_id);
          return {
            sequence_order: qq.sequence_order,
            marks: qq.marks_override ?? detail.default_marks,
            negative_penalty:
              qq.negative_penalty_override ?? detail.default_negative_penalty,
            question: detail,
            rawQuestionId: qq.question_id,
          };
        } catch {
          return {
            sequence_order: qq.sequence_order,
            marks: qq.marks_override ?? '—',
            negative_penalty: qq.negative_penalty_override ?? null,
            question: null,
            rawQuestionId: qq.question_id,
          };
        }
      });

      const hydrated = await Promise.all(questionPromises);
      setQuestions(hydrated);
    } catch {
      setError('Failed to load quiz preview. Please verify your connection.');
    } finally {
      setIsLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !quiz) {
    return <ErrorDisplay message={error || 'Quiz not found'} onRetry={loadPreview} />;
  }

  const isDraft = quiz.status === 'DRAFT';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header and Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/faculty/quizzes">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{quiz.title}</h1>
              <Badge
                variant={
                  quiz.status === 'PUBLISHED'
                    ? 'green'
                    : quiz.status === 'ARCHIVED'
                    ? 'gray'
                    : 'amber'
                }
              >
                {quiz.status}
              </Badge>
            </div>
            {quiz.topic && <p className="text-xs text-gray-500 mt-0.5">Topic: {quiz.topic}</p>}
          </div>
        </div>

        {isDraft && (
          <div className="flex items-center gap-2">
            <Link to={`/faculty/quizzes/${quiz.id}/build`}>
              <Button variant="secondary" size="sm">
                <Edit2 className="w-3.5 h-3.5 mr-1" />
                Edit Questions
              </Button>
            </Link>
            <Link to={`/faculty/quizzes/${quiz.id}/publish`}>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                <Send className="w-3.5 h-3.5 mr-1" />
                Publish Quiz
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Quiz Overview Banner */}
      <Card className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center sm:text-left">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Total Marks</p>
            <p className="text-xl font-bold text-gray-900 flex items-center gap-1.5 justify-center sm:justify-start mt-0.5">
              <Award className="w-5 h-5 text-green-600" />
              {quiz.total_marks}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Duration</p>
            <p className="text-xl font-bold text-gray-900 flex items-center gap-1.5 justify-center sm:justify-start mt-0.5">
              <Clock className="w-5 h-5 text-blue-600" />
              {quiz.default_duration_minutes} mins
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Questions</p>
            <p className="text-xl font-bold text-gray-900 flex items-center gap-1.5 justify-center sm:justify-start mt-0.5">
              <Layers className="w-5 h-5 text-indigo-600" />
              {questions.length}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Result Release</p>
            <p className="text-sm font-bold text-gray-900 mt-1">
              {quiz.default_result_visibility}
            </p>
          </div>
        </div>

        {quiz.instructions && (
          <div className="mt-4 pt-4 border-t border-blue-200/60 text-xs text-gray-700">
            <span className="font-semibold text-gray-900 block mb-1">Instructions:</span>
            {quiz.instructions}
          </div>
        )}
      </Card>

      {/* Security notice regarding is_correct */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-gray-600">
        <Info className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-medium text-gray-800">Security Architecture Notice: </span>
          The backend API schema excludes correct answer flags from question inspection responses to
          prevent test leaks. All answer options are rendered in candidate display order.
        </div>
      </div>

      {/* Hydrated Questions List */}
      <div className="space-y-4">
        {questions.length === 0 ? (
          <Card className="p-8 text-center text-gray-500">
            <Layers className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700">No questions in this quiz yet</p>
            {isDraft && (
              <div className="mt-3">
                <Link to={`/faculty/quizzes/${quiz.id}/build`}>
                  <Button size="sm">Add Questions in Builder</Button>
                </Link>
              </div>
            )}
          </Card>
        ) : (
          questions.map((item) => {
            const q = item.question;

            return (
              <Card key={item.rawQuestionId} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {item.sequence_order}
                    </span>
                    {q && (
                      <div className="flex items-center gap-2">
                        <Badge variant="blue" size="sm">
                          {q.question_type}
                        </Badge>
                        <Badge
                          variant={
                            q.difficulty === 'EASY'
                              ? 'green'
                              : q.difficulty === 'HARD'
                              ? 'red'
                              : 'amber'
                          }
                          size="sm"
                        >
                          {q.difficulty}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 font-medium">
                    <span className="text-gray-900 font-bold">{item.marks}</span> marks
                    {Number(item.negative_penalty) > 0 && (
                      <span className="text-red-600 ml-1.5">
                        (-{item.negative_penalty} penalty)
                      </span>
                    )}
                  </div>
                </div>

                {q ? (
                  <>
                    <p className="text-sm font-medium text-gray-900 leading-relaxed pl-8">
                      {q.question_text}
                    </p>

                    {/* Options list */}
                    {q.options && q.options.length > 0 && (
                      <div className="space-y-2 pl-8 pt-1">
                        {q.options.map((opt) => (
                          <div
                            key={opt.id}
                            className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 bg-gray-50/50 text-xs text-gray-800"
                          >
                            <span className="w-5 h-5 rounded-full border border-gray-300 bg-white flex items-center justify-center font-semibold text-gray-500 text-[11px] flex-shrink-0">
                              {opt.display_order}
                            </span>
                            <span>{opt.option_text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {q.explanation && (
                      <div className="pl-8 pt-1 text-xs text-gray-500 italic">
                        Explanation: {q.explanation}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="pl-8 text-xs text-red-500 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Question content could not be retrieved (Question ID: {item.rawQuestionId})
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
