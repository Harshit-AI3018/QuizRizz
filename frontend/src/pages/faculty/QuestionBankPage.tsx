import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type { QuestionRead } from '../../types/faculty';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  HelpCircle,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
} from 'lucide-react';

export const QuestionBankPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [questions, setQuestions] = useState<QuestionRead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('ALL');

  // Deletion state
  const [deletingQuestion, setDeletingQuestion] = useState<QuestionRead | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const fetchQuestions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await facultyApi.listQuestions({ limit: 500 });
      setQuestions(data);
    } catch {
      setError('Failed to load question bank. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const handleDelete = async () => {
    if (!deletingQuestion) return;
    setIsDeleting(true);
    try {
      await facultyApi.deleteQuestion(deletingQuestion.id);
      showToast('Question deactivated successfully', 'success');
      setDeletingQuestion(null);
      await fetchQuestions();
    } catch {
      showToast('Failed to deactivate question', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredQuestions = questions.filter((q) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchText = q.question_text.toLowerCase().includes(query);
      const matchTopic = q.topic?.toLowerCase().includes(query) ?? false;
      if (!matchText && !matchTopic) return false;
    }
    if (typeFilter !== 'ALL' && q.question_type !== typeFilter) {
      return false;
    }
    if (difficultyFilter !== 'ALL' && q.difficulty !== difficultyFilter) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Question Bank</h1>
          <p className="text-sm text-gray-500 mt-1">
            Author and organize reusable questions across subjects and formats.
          </p>
        </div>
        <Button onClick={() => navigate('/faculty/questions/new')}>
          <Plus className="w-4 h-4 mr-1.5" />
          Create Question
        </Button>
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search question text or topic..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                aria-label="Filter by Type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="border border-gray-300 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Types</option>
                <option value="MCQ">MCQ</option>
                <option value="TRUE_FALSE">True / False</option>
                <option value="MULTIPLE_SELECT">Multiple Select</option>
              </select>
            </div>

            <select
              aria-label="Filter by Difficulty"
              value={difficultyFilter}
              onChange={(e) => setDifficultyFilter(e.target.value)}
              className="border border-gray-300 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Difficulties</option>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <ErrorDisplay message={error} onRetry={fetchQuestions} />
      ) : filteredQuestions.length === 0 ? (
        <EmptyState
          title={searchQuery || typeFilter !== 'ALL' || difficultyFilter !== 'ALL' ? 'No matching questions' : 'No questions yet'}
          description={
            searchQuery || typeFilter !== 'ALL' || difficultyFilter !== 'ALL'
              ? 'Try adjusting your search filters to find what you are looking for.'
              : 'Start by creating questions for your assigned subjects to build reusable quizzes.'
          }
          icon={<HelpCircle className="w-10 h-10 text-gray-400" />}
          actionLabel="Create Question"
          onAction={() => navigate('/faculty/questions/new')}
        />
      ) : (
        <div className="space-y-3">
          {filteredQuestions.map((question) => (
            <Card key={question.id} className="p-4 hover:border-gray-300 transition-all">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="blue" size="sm">
                      {question.question_type}
                    </Badge>
                    <Badge
                      variant={
                        question.difficulty === 'EASY'
                          ? 'green'
                          : question.difficulty === 'HARD'
                          ? 'red'
                          : 'amber'
                      }
                      size="sm"
                    >
                      {question.difficulty}
                    </Badge>
                    {question.is_bank_question && (
                      <Badge variant="purple" size="sm">
                        Bank Question
                      </Badge>
                    )}
                    {!question.is_active && (
                      <Badge variant="gray" size="sm">
                        Inactive
                      </Badge>
                    )}
                    {question.topic && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        Topic: {question.topic}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-gray-900 leading-snug">
                    {question.question_text}
                  </p>

                  {/* Options Preview */}
                  {question.options && question.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                      {question.options.map((opt) => (
                        <div
                          key={opt.id}
                          className="text-xs text-gray-600 bg-gray-50 px-2.5 py-1.5 rounded border border-gray-100 truncate"
                        >
                          <span className="font-semibold text-gray-400 mr-1.5">
                            {opt.display_order}.
                          </span>
                          {opt.option_text}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-gray-500 pt-1">
                    <span>Marks: <strong className="text-gray-700">{question.default_marks}</strong></span>
                    {Number(question.default_negative_penalty) > 0 && (
                      <span className="text-red-600">
                        Penalty: -{question.default_negative_penalty}
                      </span>
                    )}
                    <span className="font-mono text-gray-400 truncate max-w-xs">
                      Subject: {question.subject_id}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex sm:flex-col items-center sm:items-end gap-2 flex-shrink-0">
                  <Link to={`/faculty/questions/${question.id}/edit`}>
                    <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700">
                      <Edit2 className="w-3.5 h-3.5 mr-1" />
                      Edit
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => setDeletingQuestion(question)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Deactivate
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Deletion / Deactivation Modal */}
      <Modal
        isOpen={Boolean(deletingQuestion)}
        onClose={() => setDeletingQuestion(null)}
        title="Confirm Deactivation"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setDeletingQuestion(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              isLoading={isDeleting}
            >
              Deactivate Question
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Are you sure you want to deactivate this question? It will be marked inactive and
            excluded from future quizzes, but existing quizzes containing it will not be broken.
          </p>
          {deletingQuestion && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs font-mono text-gray-800">
              {deletingQuestion.question_text}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
