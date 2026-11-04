import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { facultyApi } from '../../api/facultyApi';
import type { QuizRead } from '../../types/faculty';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  FileQuestion,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Layers,
  Eye,
  Send,
  Clock,
  Award,
} from 'lucide-react';

export const QuizzesPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [quizzes, setQuizzes] = useState<QuizRead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Deletion state
  const [deletingQuiz, setDeletingQuiz] = useState<QuizRead | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const fetchQuizzes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await facultyApi.listQuizzes({ limit: 500 });
      setQuizzes(data);
    } catch {
      setError('Failed to load quizzes. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuizzes();
  }, [fetchQuizzes]);

  const handleDelete = async () => {
    if (!deletingQuiz) return;
    setIsDeleting(true);
    try {
      await facultyApi.deleteQuiz(deletingQuiz.id);
      showToast('Quiz archived successfully', 'success');
      setDeletingQuiz(null);
      await fetchQuizzes();
    } catch {
      showToast('Failed to archive quiz', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredQuizzes = quizzes.filter((q) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchTitle = q.title.toLowerCase().includes(query);
      const matchTopic = q.topic?.toLowerCase().includes(query) ?? false;
      if (!matchTitle && !matchTopic) return false;
    }
    if (statusFilter !== 'ALL' && q.status !== statusFilter) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Quizzes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Build, configure, assemble and publish reusable assessments.
          </p>
        </div>
        <Button onClick={() => navigate('/faculty/quizzes/new')}>
          <Plus className="w-4 h-4 mr-1.5" />
          Create Quiz
        </Button>
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search quiz title or topic..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              aria-label="Filter by Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
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
        <ErrorDisplay message={error} onRetry={fetchQuizzes} />
      ) : filteredQuizzes.length === 0 ? (
        <EmptyState
          title={searchQuery || statusFilter !== 'ALL' ? 'No matching quizzes' : 'No quizzes created yet'}
          description={
            searchQuery || statusFilter !== 'ALL'
              ? 'Try adjusting your search criteria or status filter.'
              : 'Create your first quiz to start assembling questions and setting mark schemes.'
          }
          icon={<FileQuestion className="w-10 h-10 text-gray-400" />}
          actionLabel="Create Quiz"
          onAction={() => navigate('/faculty/quizzes/new')}
        />
      ) : (
        <div className="space-y-3">
          {filteredQuizzes.map((quiz) => (
            <Card key={quiz.id} className="p-4 hover:border-gray-300 transition-all">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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
                    {quiz.topic && (
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        Topic: {quiz.topic}
                      </span>
                    )}
                    <Badge variant="blue" size="sm">
                      {quiz.default_result_visibility}
                    </Badge>
                  </div>

                  <h3 className="text-base font-semibold text-gray-900 leading-snug">
                    {quiz.title}
                  </h3>

                  {quiz.description && (
                    <p className="text-xs text-gray-600 line-clamp-1">{quiz.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 pt-1">
                    <span className="flex items-center gap-1 font-medium text-gray-700">
                      <Layers className="w-3.5 h-3.5 text-gray-400" />
                      {quiz.questions?.length ?? 0} questions
                    </span>
                    <span className="flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-gray-400" />
                      {quiz.total_marks} total marks
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      {quiz.default_duration_minutes} mins
                    </span>
                    {quiz.default_negative_marking_enabled && (
                      <span className="text-red-600 font-medium">
                        Negative Marking ({quiz.default_negative_penalty ?? 'default'})
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 flex-shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                  <Link to={`/faculty/quizzes/${quiz.id}/preview`}>
                    <Button variant="ghost" size="sm" className="text-gray-700 hover:text-gray-900">
                      <Eye className="w-3.5 h-3.5 mr-1" />
                      Preview
                    </Button>
                  </Link>

                  {quiz.status === 'DRAFT' && (
                    <>
                      <Link to={`/faculty/quizzes/${quiz.id}/build`}>
                        <Button variant="secondary" size="sm">
                          <Layers className="w-3.5 h-3.5 mr-1" />
                          Questions ({quiz.questions?.length ?? 0})
                        </Button>
                      </Link>
                      <Link to={`/faculty/quizzes/${quiz.id}/publish`}>
                        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                          <Send className="w-3.5 h-3.5 mr-1" />
                          Publish
                        </Button>
                      </Link>
                      <Link to={`/faculty/quizzes/${quiz.id}/edit`}>
                        <Button variant="ghost" size="sm">
                          <Edit2 className="w-3.5 h-3.5 mr-1" />
                          Edit
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => setDeletingQuiz(quiz)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Archive
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Archive / Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingQuiz)}
        onClose={() => setDeletingQuiz(null)}
        title="Confirm Archive"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setDeletingQuiz(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              isLoading={isDeleting}
            >
              Archive Quiz
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Are you sure you want to archive this quiz? Archived quizzes cannot be published or
            used for new testing sessions.
          </p>
          {deletingQuiz && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs font-mono text-gray-800">
              {deletingQuiz.title}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
