import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { sessionApi } from '../../api/sessionApi';
import type { QuizSessionRead, SessionAction } from '../../types/session';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  Radio,
  Plus,
  Search,
  Filter,
  Play,
  Pause,
  StopCircle,
  XCircle,
  Eye,
  Clock,
  Calendar,
} from 'lucide-react';

export const SessionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [sessions, setSessions] = useState<QuizSessionRead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Transition confirmation dialog state
  const [confirmAction, setConfirmAction] = useState<{
    session: QuizSessionRead;
    action: SessionAction;
    title: string;
    message: string;
    danger?: boolean;
  } | null>(null);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await sessionApi.listSessions({ limit: 500 });
      setSessions(data);
    } catch {
      setError('Failed to load quiz sessions. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleAction = async (session: QuizSessionRead, action: SessionAction) => {
    // For ending or cancelling, require explicit confirmation
    if (action === 'complete' || action === 'end') {
      setConfirmAction({
        session,
        action: 'end',
        title: 'End Session',
        message:
          'Are you sure you want to end this session? All in-progress student attempts will be finalized and no further submissions will be accepted.',
        danger: true,
      });
      return;
    }

    if (action === 'cancel') {
      setConfirmAction({
        session,
        action: 'cancel',
        title: 'Cancel Session',
        message:
          'Are you sure you want to cancel this session? This action is irreversible. The reusable quiz itself will remain untouched.',
        danger: true,
      });
      return;
    }

    // Direct transitions for start/pause/resume
    try {
      await sessionApi.transitionSession(session.id, action);
      showToast(`Session ${action === 'start' ? 'started' : action + 'd'} successfully`, 'success');
      await fetchSessions();
    } catch (err: any) {
      showToast(err.message || `Failed to ${action} session`, 'error');
    }
  };

  const handleConfirmedTransition = async () => {
    if (!confirmAction) return;
    setIsTransitioning(true);
    try {
      await sessionApi.transitionSession(confirmAction.session.id, confirmAction.action);
      showToast(
        `Session ${confirmAction.action === 'end' ? 'ended' : 'cancelled'} successfully`,
        'success'
      );
      setConfirmAction(null);
      await fetchSessions();
    } catch (err: any) {
      showToast(err.message || `Failed to execute ${confirmAction.action}`, 'error');
    } finally {
      setIsTransitioning(false);
    }
  };

  const filteredSessions = sessions.filter((s) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const codeMatch = s.session_code.toLowerCase().includes(q);
      const idMatch = s.id.toLowerCase().includes(q);
      if (!codeMatch && !idMatch) return false;
    }
    if (statusFilter !== 'ALL' && s.status !== statusFilter) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quiz Sessions</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage live assessment sessions, monitor real-time lobbies, and execute teacher lifecycle controls.
          </p>
        </div>
        <Button onClick={() => navigate('/faculty/sessions/new')}>
          <Plus className="w-4 h-4 mr-1.5" />
          Create Session
        </Button>
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search by 8-char session code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <option value="SCHEDULED">Scheduled</option>
              <option value="ACTIVE">Active (Live)</option>
              <option value="PAUSED">Paused</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
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
        <ErrorDisplay message={error} onRetry={fetchSessions} />
      ) : filteredSessions.length === 0 ? (
        <EmptyState
          title={searchQuery || statusFilter !== 'ALL' ? 'No matching sessions' : 'No quiz sessions created'}
          description={
            searchQuery || statusFilter !== 'ALL'
              ? 'Try adjusting your search code or status filter.'
              : 'Create a session from any published quiz to generate an access code and admit students.'
          }
          icon={<Radio className="w-10 h-10 text-gray-400" />}
          actionLabel="Create Session"
          onAction={() => navigate('/faculty/sessions/new')}
        />
      ) : (
        <div className="space-y-3">
          {filteredSessions.map((session) => {
            const isLive = session.status === 'ACTIVE';
            const isPaused = session.status === 'PAUSED';
            const isScheduled = session.status === 'SCHEDULED';
            const isCompleted = session.status === 'COMPLETED';

            return (
              <Card key={session.id} className="p-5 hover:border-gray-300 transition-all">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Session Details */}
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-base font-bold bg-blue-50 text-blue-800 px-3 py-1 rounded-md border border-blue-200 tracking-wider">
                        {session.session_code}
                      </span>

                      <Badge
                        variant={
                          isLive
                            ? 'green'
                            : isPaused
                            ? 'amber'
                            : isScheduled
                            ? 'blue'
                            : session.status === 'CANCELLED'
                            ? 'red'
                            : 'gray'
                        }
                      >
                        {isLive ? '● LIVE / ACTIVE' : session.status}
                      </Badge>

                      <Badge variant="purple" size="sm">
                        {session.session_mode.replace('_', ' ')}
                      </Badge>

                      {session.results_released_at && (
                        <Badge variant="green" size="sm">
                          Results Released
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 pt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        Duration: <strong className="text-gray-700">{session.duration_minutes}m</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-gray-400" />
                        Window: {new Date(session.start_window_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &ndash; {new Date(session.end_window_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="font-mono text-gray-400">
                        Class UUID: {session.class_id}
                      </span>
                    </div>
                  </div>

                  {/* Actions & Lifecycle Controls */}
                  <div className="flex flex-wrap items-center gap-2 flex-shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                    <Link to={`/faculty/sessions/${session.id}/monitor`}>
                      <Button
                        size="sm"
                        className={isLive ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
                        variant={isLive ? 'primary' : 'secondary'}
                      >
                        <Eye className="w-4 h-4 mr-1.5" />
                        {isCompleted ? 'View Results & Activity' : 'Live Monitor'}
                      </Button>
                    </Link>

                    {/* Teacher Lifecycle Controls */}
                    {isScheduled && (
                      <>
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => handleAction(session, 'start')}
                        >
                          <Play className="w-3.5 h-3.5 mr-1" />
                          Start
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleAction(session, 'cancel')}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" />
                          Cancel
                        </Button>
                      </>
                    )}

                    {isLive && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="text-amber-700 hover:bg-amber-50 border-amber-300"
                          onClick={() => handleAction(session, 'pause')}
                        >
                          <Pause className="w-3.5 h-3.5 mr-1" />
                          Pause
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleAction(session, 'end')}
                        >
                          <StopCircle className="w-3.5 h-3.5 mr-1" />
                          End
                        </Button>
                      </>
                    )}

                    {isPaused && (
                      <>
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleAction(session, 'resume')}
                        >
                          <Play className="w-3.5 h-3.5 mr-1" />
                          Resume
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleAction(session, 'end')}
                        >
                          <StopCircle className="w-3.5 h-3.5 mr-1" />
                          End
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal
        isOpen={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.title}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmAction(null)}
              disabled={isTransitioning}
            >
              Cancel
            </Button>
            <Button
              variant={confirmAction?.danger ? 'danger' : 'primary'}
              onClick={handleConfirmedTransition}
              isLoading={isTransitioning}
            >
              {confirmAction?.title}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{confirmAction?.message}</p>
          {confirmAction?.session && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs font-mono text-gray-800 flex items-center justify-between">
              <span>Session Code: {confirmAction.session.session_code}</span>
              <Badge variant="blue" size="sm">
                {confirmAction.session.status}
              </Badge>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
