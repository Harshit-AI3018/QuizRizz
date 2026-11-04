import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type {
  QuizRead,
  QuestionRead,
  QuizQuestionInput,
} from '../../types/faculty';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { Badge } from '../../components/common/Badge';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Eye,
  Settings,
  Layers,
  Award,
  Search,
  CheckCircle,
} from 'lucide-react';

interface AssembledQuestion {
  question_id: string;
  sequence_order: number;
  marks_override?: number | string | null;
  negative_marking_enabled_override?: boolean | null;
  negative_penalty_override?: number | string | null;
  // Hydrated details if available
  details?: QuestionRead;
}

export const QuizBuilderPage: React.FC = () => {
  const { quizId } = useParams<{ quizId: string }>();
  const { showToast } = useToast();

  const [quiz, setQuiz] = useState<QuizRead | null>(null);
  const [bankQuestions, setBankQuestions] = useState<QuestionRead[]>([]);
  const [assembledQuestions, setAssembledQuestions] = useState<AssembledQuestion[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Bank search & filter
  const [searchBank, setSearchBank] = useState<string>('');
  const [expandedSettingsId, setExpandedSettingsId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!quizId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [quizData, allQuestions] = await Promise.all([
        facultyApi.getQuiz(quizId),
        facultyApi.listQuestions({ limit: 500 }),
      ]);

      setQuiz(quizData);
      setBankQuestions(allQuestions);

      // Map question details to quiz questions
      const questionMap = new Map(allQuestions.map((q) => [q.id, q]));
      const assembled: AssembledQuestion[] = (quizData.questions || [])
        .sort((a, b) => a.sequence_order - b.sequence_order)
        .map((q, idx) => ({
          question_id: q.question_id,
          sequence_order: idx + 1,
          marks_override: q.marks_override,
          negative_marking_enabled_override: q.negative_marking_enabled_override,
          negative_penalty_override: q.negative_penalty_override,
          details: questionMap.get(q.question_id),
        }));

      setAssembledQuestions(assembled);
    } catch {
      setError('Failed to load quiz question builder data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    setAssembledQuestions((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy.map((q, idx) => ({ ...q, sequence_order: idx + 1 }));
    });
  };

  const handleMoveDown = (index: number) => {
    if (index === assembledQuestions.length - 1) return;
    setAssembledQuestions((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy.map((q, idx) => ({ ...q, sequence_order: idx + 1 }));
    });
  };

  const handleRemove = (questionId: string) => {
    setAssembledQuestions((prev) =>
      prev
        .filter((q) => q.question_id !== questionId)
        .map((q, idx) => ({ ...q, sequence_order: idx + 1 }))
    );
  };

  const handleAddFromBank = (question: QuestionRead) => {
    if (assembledQuestions.some((q) => q.question_id === question.id)) {
      showToast('Question already included in this quiz', 'error');
      return;
    }

    setAssembledQuestions((prev) => [
      ...prev,
      {
        question_id: question.id,
        sequence_order: prev.length + 1,
        marks_override: null,
        negative_marking_enabled_override: null,
        negative_penalty_override: null,
        details: question,
      },
    ]);
  };

  const updateOverride = (
    questionId: string,
    field: 'marks_override' | 'negative_marking_enabled_override' | 'negative_penalty_override',
    value: any
  ) => {
    setAssembledQuestions((prev) =>
      prev.map((q) => (q.question_id === questionId ? { ...q, [field]: value } : q))
    );
  };

  const handleSave = async () => {
    if (!quizId) return;
    setIsSaving(true);
    try {
      const payload: QuizQuestionInput[] = assembledQuestions.map((q, idx) => ({
        question_id: q.question_id,
        sequence_order: idx + 1,
        marks_override: q.marks_override ? Number(q.marks_override) : null,
        negative_marking_enabled_override: q.negative_marking_enabled_override,
        negative_penalty_override:
          q.negative_penalty_override != null ? Number(q.negative_penalty_override) : null,
      }));

      const updated = await facultyApi.replaceQuizQuestions(quizId, { questions: payload });
      setQuiz(updated);
      showToast('Quiz questions saved successfully', 'success');
    } catch {
      showToast('Failed to save quiz questions', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Compute total marks
  const computedTotalMarks = assembledQuestions.reduce((acc, q) => {
    if (q.marks_override != null && q.marks_override !== '') {
      return acc + Number(q.marks_override);
    }
    return acc + Number(q.details?.default_marks ?? 1);
  }, 0);

  const selectedIds = new Set(assembledQuestions.map((q) => q.question_id));

  const filteredBank = bankQuestions.filter((q) => {
    if (!searchBank.trim()) return true;
    const query = searchBank.toLowerCase();
    return (
      q.question_text.toLowerCase().includes(query) ||
      (q.topic && q.topic.toLowerCase().includes(query))
    );
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !quiz) {
    return <ErrorDisplay message={error || 'Quiz not found'} onRetry={loadData} />;
  }

  const isLocked = quiz.status !== 'DRAFT';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/faculty/quizzes">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Quizzes
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
            <p className="text-xs text-gray-500 mt-0.5">
              Sequence, customize mark schemes, and assemble question order.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link to={`/faculty/quizzes/${quiz.id}/preview`}>
            <Button variant="secondary" size="sm">
              <Eye className="w-4 h-4 mr-1.5" />
              Preview Quiz
            </Button>
          </Link>
          {!isLocked && (
            <Button size="sm" onClick={handleSave} isLoading={isSaving}>
              Save Questions ({assembledQuestions.length})
            </Button>
          )}
        </div>
      </div>

      {/* Overview Stats Bar */}
      <Card className="p-4 bg-gray-50 border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5 font-medium text-gray-700">
              <Layers className="w-4 h-4 text-blue-600" />
              {assembledQuestions.length} Questions
            </span>
            <span className="flex items-center gap-1.5 font-medium text-gray-700">
              <Award className="w-4 h-4 text-green-600" />
              {computedTotalMarks} Total Marks
            </span>
            <span className="text-gray-500 text-xs">
              Subject UUID: <code className="font-mono text-gray-700">{quiz.subject_id}</code>
            </span>
          </div>

          {!isLocked && assembledQuestions.length > 0 && (
            <Link to={`/faculty/quizzes/${quiz.id}/publish`}>
              <span className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                Ready to publish? Go to publish review &rarr;
              </span>
            </Link>
          )}
        </div>
      </Card>

      {/* Two Column Layout: Current Questions & Bank Selector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Assembled Questions (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Assembled Quiz Questions ({assembledQuestions.length})
            </h2>
            <span className="text-xs text-gray-500">Ordered 1 to {assembledQuestions.length}</span>
          </div>

          {assembledQuestions.length === 0 ? (
            <Card className="p-8 text-center text-gray-500">
              <Layers className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-700">No questions added yet</p>
              <p className="text-xs text-gray-500 mt-1">
                Select questions from the question bank on the right to add them to this quiz.
              </p>
            </Card>
          ) : (
            assembledQuestions.map((q, index) => {
              const isFirst = index === 0;
              const isLast = index === assembledQuestions.length - 1;
              const isExpanded = expandedSettingsId === q.question_id;

              return (
                <Card
                  key={q.question_id}
                  className="p-4 border-gray-200 hover:border-gray-300 transition-all"
                >
                  <div className="flex items-start gap-3">
                    {/* Order Controls */}
                    {!isLocked && (
                      <div className="flex flex-col gap-1 pt-0.5">
                        <button
                          type="button"
                          disabled={isFirst}
                          onClick={() => handleMoveUp(index)}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 rounded"
                          title="Move up"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-bold text-center text-gray-500">
                          {q.sequence_order}
                        </span>
                        <button
                          type="button"
                          disabled={isLast}
                          onClick={() => handleMoveDown(index)}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20 rounded"
                          title="Move down"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {/* Question Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="blue" size="sm">
                          {q.details?.question_type || 'QUESTION'}
                        </Badge>
                        {q.details?.difficulty && (
                          <Badge
                            variant={
                              q.details.difficulty === 'EASY'
                                ? 'green'
                                : q.details.difficulty === 'HARD'
                                ? 'red'
                                : 'amber'
                            }
                            size="sm"
                          >
                            {q.details.difficulty}
                          </Badge>
                        )}
                        <span className="text-xs font-medium text-gray-700">
                          Marks: {q.marks_override ?? q.details?.default_marks ?? 1}
                          {q.marks_override != null && (
                            <span className="text-blue-600 ml-1">(override)</span>
                          )}
                        </span>
                      </div>

                      <p className="text-sm font-medium text-gray-900 leading-snug">
                        {q.details?.question_text || `Question ID: ${q.question_id}`}
                      </p>

                      {/* Expandable Per-Question Overrides */}
                      {isExpanded && !isLocked && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs space-y-2">
                          <p className="font-semibold text-gray-700">Question Overrides</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-gray-600 mb-0.5">Marks Override</label>
                              <input
                                type="number"
                                step="0.5"
                                min="0.1"
                                placeholder={`Default: ${q.details?.default_marks ?? 1}`}
                                value={q.marks_override ?? ''}
                                onChange={(e) =>
                                  updateOverride(
                                    q.question_id,
                                    'marks_override',
                                    e.target.value ? parseFloat(e.target.value) : null
                                  )
                                }
                                className="w-full px-2 py-1 border border-gray-300 rounded bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-gray-600 mb-0.5">Negative Penalty</label>
                              <input
                                type="number"
                                step="0.25"
                                min="0.0"
                                placeholder="Penalty deduction"
                                value={q.negative_penalty_override ?? ''}
                                onChange={(e) =>
                                  updateOverride(
                                    q.question_id,
                                    'negative_penalty_override',
                                    e.target.value ? parseFloat(e.target.value) : null
                                  )
                                }
                                className="w-full px-2 py-1 border border-gray-300 rounded bg-white"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {!isLocked && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSettingsId(isExpanded ? null : q.question_id)
                          }
                          className={`p-1.5 rounded transition-colors ${
                            isExpanded
                              ? 'bg-blue-100 text-blue-700'
                              : 'text-gray-400 hover:text-gray-600'
                          }`}
                          title="Configure overrides"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(q.question_id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                          title="Remove from quiz"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </div>

        {/* Right: Question Bank Drawer / Picker (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Add from Question Bank</h2>
            <Link
              to="/faculty/questions/new"
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              + Create New Question
            </Link>
          </div>

          <Card className="p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search questions by text or topic..."
                value={searchBank}
                onChange={(e) => setSearchBank(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredBank.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">
                  No questions match your search.
                </p>
              ) : (
                filteredBank.map((bankQ) => {
                  const isAdded = selectedIds.has(bankQ.id);

                  return (
                    <div
                      key={bankQ.id}
                      className={`p-3 rounded-lg border text-xs space-y-1.5 transition-all ${
                        isAdded ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="blue" size="sm">
                            {bankQ.question_type}
                          </Badge>
                          <span className="text-gray-500 font-medium">
                            {bankQ.default_marks} pts
                          </span>
                        </div>
                        {isAdded ? (
                          <span className="flex items-center gap-1 text-green-600 font-medium text-[11px]">
                            <CheckCircle className="w-3.5 h-3.5" /> Added
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="py-0.5 px-2 text-xs"
                            disabled={isLocked}
                            onClick={() => handleAddFromBank(bankQ)}
                          >
                            <Plus className="w-3.5 h-3.5 mr-0.5" /> Add
                          </Button>
                        )}
                      </div>

                      <p className="text-gray-800 line-clamp-2 leading-relaxed font-normal">
                        {bankQ.question_text}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
