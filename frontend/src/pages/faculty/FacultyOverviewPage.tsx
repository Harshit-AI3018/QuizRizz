import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type { QuestionRead, QuizRead, FacultyAssignment } from '../../types/faculty';
import { Card } from '../../components/common/Card';
import { Spinner } from '../../components/common/Spinner';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import {
  HelpCircle,
  FileQuestion,
  CheckCircle2,
  Clock,
  Plus,
  ArrowRight,
  Info,
} from 'lucide-react';

export const FacultyOverviewPage: React.FC = () => {
  const [questions, setQuestions] = useState<QuestionRead[]>([]);
  const [quizzes, setQuizzes] = useState<QuizRead[]>([]);
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverviewData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [questionsRes, quizzesRes, assignmentsRes] = await Promise.allSettled([
        facultyApi.listQuestions({ limit: 500 }),
        facultyApi.listQuizzes({ limit: 500 }),
        facultyApi.listAssignments(),
      ]);

      if (questionsRes.status === 'fulfilled') {
        setQuestions(questionsRes.value);
      }
      if (quizzesRes.status === 'fulfilled') {
        setQuizzes(quizzesRes.value);
      }
      if (assignmentsRes.status === 'fulfilled') {
        setAssignments(assignmentsRes.value);
      }

      if (questionsRes.status === 'rejected' && quizzesRes.status === 'rejected') {
        setError('Failed to load faculty dashboard data. Please try again.');
      }
    } catch {
      setError('An unexpected error occurred while loading dashboard metrics.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorDisplay message={error} onRetry={fetchOverviewData} />;
  }

  const totalQuestions = questions.length;
  const bankQuestions = questions.filter((q) => q.is_bank_question).length;
  const totalQuizzes = quizzes.length;
  const publishedQuizzes = quizzes.filter((q) => q.status === 'PUBLISHED').length;
  const draftQuizzes = quizzes.filter((q) => q.status === 'DRAFT').length;

  const recentQuizzes = quizzes.slice(0, 5);
  const recentQuestions = questions.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Faculty Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Author questions, assemble reusable quizzes, and manage assessment publishing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/faculty/questions/new">
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1.5" />
              New Question
            </Button>
          </Link>
          <Link to="/faculty/quizzes/new">
            <Button size="sm" variant="secondary">
              <Plus className="w-4 h-4 mr-1.5" />
              New Quiz
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Total Questions
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{totalQuestions}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{bankQuestions} in question bank</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <HelpCircle className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Total Quizzes
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{totalQuizzes}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{draftQuizzes} draft</p>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
              <FileQuestion className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Published Quizzes
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{publishedQuizzes}</h3>
              <p className="text-xs text-gray-500 mt-0.5">Ready for sessions</p>
            </div>
            <div className="p-3 bg-green-50 text-green-600 rounded-lg">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Draft Quizzes
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">{draftQuizzes}</h3>
              <p className="text-xs text-gray-500 mt-0.5">In progress</p>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="w-6 h-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* Faculty Class & Subject Assignments Status */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold">Faculty Class & Subject Assignments</p>
            <p className="mt-0.5 text-blue-700">
              {assignments.length > 0
                ? `You are actively assigned to ${assignments.length} class and subject ${assignments.length === 1 ? 'context' : 'contexts'}. Questions and quizzes created will be scoped to these courses.`
                : 'No active subject assignments found. Please contact your college administrator to assign you to your teaching courses.'}
            </p>
          </div>
        </div>
        <Link
          to="/faculty/assignments"
          className="inline-flex items-center text-xs font-semibold text-blue-700 hover:text-blue-900 underline whitespace-nowrap"
        >
          View assignments &rarr;
        </Link>
      </div>

      {/* Two Column Section: Recent Quizzes and Recent Questions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Quizzes */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Recent Quizzes</h2>
            <Link
              to="/faculty/quizzes"
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentQuizzes.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No quizzes created yet.</p>
          ) : (
            <div className="space-y-3">
              {recentQuizzes.map((quiz) => (
                <div
                  key={quiz.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="text-sm font-medium text-gray-900 truncate">{quiz.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {quiz.questions?.length ?? 0} questions &bull; {quiz.default_duration_minutes} mins
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        quiz.status === 'PUBLISHED'
                          ? 'green'
                          : quiz.status === 'ARCHIVED'
                          ? 'gray'
                          : 'amber'
                      }
                      size="sm"
                    >
                      {quiz.status}
                    </Badge>
                    <Link
                      to={`/faculty/quizzes/${quiz.id}/preview`}
                      className="text-xs font-medium text-gray-600 hover:text-gray-900"
                    >
                      Preview
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Questions */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Recent Questions</h2>
            <Link
              to="/faculty/questions"
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentQuestions.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No questions created yet.</p>
          ) : (
            <div className="space-y-3">
              {recentQuestions.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="text-sm font-medium text-gray-900 truncate">{q.question_text}</p>
                    <div className="flex items-center gap-2 mt-1">
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
                      <span className="text-xs text-gray-500">{q.default_marks} marks</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
