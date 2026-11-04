import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { studentApi } from '../../api/studentApi';
import type { StudentSessionDiscovery } from '../../types/student';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  BookOpen,
  ArrowRight,
  Clock,
  User,
  CheckCircle2,
  Play,
  KeyRound,
} from 'lucide-react';

export const StudentDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [availableSessions, setAvailableSessions] = useState<StudentSessionDiscovery[]>([]);
  const [joinedSessions, setJoinedSessions] = useState<StudentSessionDiscovery[]>([]);
  const [sessionCodeInput, setSessionCodeInput] = useState<string>('');
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async () => {
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
      setError('Failed to load assessment sessions. Please verify your connection.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

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

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorDisplay message={error} onRetry={loadDashboardData} />;
  }

  const liveSessions = availableSessions.filter((s) => s.status === 'ACTIVE' || s.status === 'SCHEDULED');
  const recentAttempts = joinedSessions.filter((s) => s.has_attempt);

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.first_name || 'Student'}!
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Join assessment sessions, take quizzes, and track your performance results.
        </p>
      </div>

      {/* Join Session Card */}
      <Card className="p-6 bg-gradient-to-r from-emerald-50 via-teal-50/40 to-blue-50/30 border-emerald-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-emerald-700" />
              <h2 className="text-base font-bold text-gray-900">Have an Assessment Code?</h2>
            </div>
            <p className="text-xs text-gray-600">
              Enter the 8-character access code provided by your instructor to enter the test lobby.
            </p>
          </div>

          <form onSubmit={handleJoinByCode} className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Enter session code (e.g. ALPHA123)"
              maxLength={10}
              value={sessionCodeInput}
              onChange={(e) => setSessionCodeInput(e.target.value.toUpperCase())}
              className="w-full sm:w-44 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
            <Button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0"
              isLoading={isJoining}
            >
              Join Session
            </Button>
          </form>
        </div>
      </Card>

      {/* Two Column Layout: Available Live Sessions & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Available Live Sessions */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-600" />
              <h2 className="text-base font-semibold text-gray-900">Available Assessments</h2>
            </div>
            <Link
              to="/student/sessions"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 flex items-center gap-1"
            >
              View all ({availableSessions.length}) <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {liveSessions.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              <p>No active assessment sessions at this time.</p>
              <p className="text-xs text-gray-400 mt-1">
                Sessions scheduled for your enrolled classes will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {liveSessions.slice(0, 4).map((sess) => (
                <div
                  key={sess.session_id}
                  className="p-3.5 rounded-lg border border-gray-200 hover:border-emerald-300 transition-all bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={sess.status === 'ACTIVE' ? 'green' : 'blue'}
                          size="sm"
                        >
                          {sess.status === 'ACTIVE' ? '● Live Now' : 'Scheduled'}
                        </Badge>
                        <span className="text-xs text-gray-500">{sess.subject_name}</span>
                      </div>

                      <h3 className="text-sm font-semibold text-gray-900 truncate">
                        {sess.quiz_title}
                      </h3>

                      <div className="flex items-center gap-3 text-xs text-gray-500 pt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          {sess.duration_minutes} mins
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          {sess.faculty_name}
                        </span>
                      </div>
                    </div>

                    <Link to={`/student/sessions/${sess.session_id}/lobby`}>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        <Play className="w-3.5 h-3.5 mr-1" />
                        {sess.has_attempt ? 'Resume' : 'Lobby'}
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Attempts & Results */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-900">Recent Attempts & Results</h2>
            </div>
            <Link
              to="/student/sessions"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 flex items-center gap-1"
            >
              History <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentAttempts.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              <p>No attempts recorded yet.</p>
              <p className="text-xs text-gray-400 mt-1">
                Completed tests and score reports will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentAttempts.slice(0, 4).map((sess) => {
                const isFinalized = sess.attempt_status === 'FINALIZED';

                return (
                  <div
                    key={sess.session_id}
                    className="p-3.5 rounded-lg border border-gray-100 hover:border-gray-200 transition-all bg-gray-50/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={isFinalized ? 'gray' : 'blue'} size="sm">
                            {sess.attempt_status || 'Attempt'}
                          </Badge>
                          <span className="text-xs text-gray-500">{sess.subject_name}</span>
                        </div>

                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {sess.quiz_title}
                        </h3>

                        <p className="text-xs text-gray-500">
                          Class: {sess.class_name} &bull; Code: {sess.session_code}
                        </p>
                      </div>

                      {sess.has_attempt && (
                        <Link to={`/student/sessions/${sess.session_id}/lobby`}>
                          <Button size="sm" variant="secondary">
                            {isFinalized ? 'View Result' : 'Continue'}
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
