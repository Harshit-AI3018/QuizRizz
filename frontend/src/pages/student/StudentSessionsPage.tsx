import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { studentApi } from '../../api/studentApi';
import type { StudentSessionDiscovery } from '../../types/student';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  BookOpen,
  Search,
  Clock,
  User,
  Play,
  KeyRound,
} from 'lucide-react';

export const StudentSessionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'available' | 'joined'>('available');
  const [availableSessions, setAvailableSessions] = useState<StudentSessionDiscovery[]>([]);
  const [joinedSessions, setJoinedSessions] = useState<StudentSessionDiscovery[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sessionCodeInput, setSessionCodeInput] = useState<string>('');
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [available, joined] = await Promise.all([
        studentApi.listAvailableSessions({ limit: 100 }),
        studentApi.listJoinedSessions({ limit: 100 }),
      ]);
      setAvailableSessions(available);
      setJoinedSessions(joined);
    } catch {
      setError('Failed to load assessment sessions. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sessionCodeInput.trim().toUpperCase();
    if (!clean || clean.length < 6 || clean.length > 10) {
      showToast('Session code must be 6 to 10 alphanumeric characters', 'error');
      return;
    }

    setIsJoining(true);
    try {
      const lobby = await studentApi.joinSession(clean);
      showToast('Successfully joined session!', 'success');
      navigate(`/student/sessions/${lobby.session_id}/lobby`);
    } catch (err: any) {
      showToast(err.message || 'Invalid session code or session not accessible', 'error');
    } finally {
      setIsJoining(false);
    }
  };

  const currentList = activeTab === 'available' ? availableSessions : joinedSessions;

  const filteredSessions = currentList.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.quiz_title.toLowerCase().includes(q) ||
      s.subject_name.toLowerCase().includes(q) ||
      s.subject_code.toLowerCase().includes(q) ||
      s.session_code.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Assessments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Browse live sessions open for your classes or join with an assessment code.
          </p>
        </div>

        {/* Quick Join Inline */}
        <form onSubmit={handleJoinByCode} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Enter session code (e.g. ALPHA123)"
            maxLength={10}
            value={sessionCodeInput}
            onChange={(e) => setSessionCodeInput(e.target.value.toUpperCase())}
            className="w-48 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
          />
          <Button
            type="submit"
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            isLoading={isJoining}
          >
            <KeyRound className="w-3.5 h-3.5 mr-1" />
            Join
          </Button>
        </form>
      </div>

      {/* Tabs & Search Bar */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Tabs */}
          <div className="flex items-center space-x-1 border-b sm:border-b-0 pb-2 sm:pb-0">
            <button
              type="button"
              onClick={() => setActiveTab('available')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'available'
                  ? 'bg-emerald-50 text-emerald-700 font-semibold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Available Assessments ({availableSessions.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('joined')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'joined'
                  ? 'bg-emerald-50 text-emerald-700 font-semibold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              My Joined Sessions ({joinedSessions.length})
            </button>
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search quiz, subject or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
          </div>
        </div>
      </Card>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <ErrorDisplay message={error} onRetry={loadSessions} />
      ) : filteredSessions.length === 0 ? (
        <EmptyState
          title={searchQuery ? 'No matching assessments' : 'No assessments found'}
          description={
            searchQuery
              ? 'Try adjusting your search terms.'
              : activeTab === 'available'
              ? 'There are currently no active or scheduled quizzes available for your enrolled classes.'
              : 'You have not joined any assessment sessions yet. Enter an access code above to join one.'
          }
          icon={<BookOpen className="w-10 h-10 text-gray-400" />}
        />
      ) : (
        <div className="space-y-3">
          {filteredSessions.map((sess) => {
            const isLive = sess.status === 'ACTIVE';
            const isCompleted = sess.status === 'COMPLETED';

            return (
              <Card key={sess.session_id} className="p-5 hover:border-gray-300 transition-all">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          isLive
                            ? 'green'
                            : isCompleted
                            ? 'gray'
                            : sess.status === 'CANCELLED'
                            ? 'red'
                            : 'blue'
                        }
                      >
                        {isLive ? '● Live Now' : sess.status}
                      </Badge>

                      <span className="font-mono text-xs font-bold text-gray-700 bg-gray-100 px-2.5 py-0.5 rounded border border-gray-200">
                        {sess.session_code}
                      </span>

                      <Badge variant="purple" size="sm">
                        {sess.session_mode.replace('_', ' ')}
                      </Badge>

                      {sess.attempt_status && (
                        <Badge
                          variant={sess.attempt_status === 'FINALIZED' ? 'green' : 'amber'}
                          size="sm"
                        >
                          Attempt: {sess.attempt_status}
                        </Badge>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-gray-900 leading-snug">
                      {sess.quiz_title}
                    </h3>

                    {sess.quiz_description && (
                      <p className="text-xs text-gray-600 line-clamp-1">{sess.quiz_description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 pt-1">
                      <span className="flex items-center gap-1 font-medium text-gray-700">
                        <BookOpen className="w-3.5 h-3.5 text-gray-400" />
                        {sess.subject_name} ({sess.subject_code})
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        {sess.duration_minutes} minutes
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-gray-400" />
                        Instructor: {sess.faculty_name}
                      </span>
                      <span className="flex items-center gap-1 text-gray-400">
                        Class: {sess.class_name}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                    <Link to={`/student/sessions/${sess.session_id}/lobby`}>
                      <Button
                        className={isLive ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
                        variant={isLive ? 'primary' : 'secondary'}
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        {sess.attempt_status === 'FINALIZED'
                          ? 'View Result'
                          : sess.has_attempt
                          ? 'Resume Attempt'
                          : 'Enter Lobby'}
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
