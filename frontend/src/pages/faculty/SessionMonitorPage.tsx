import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { sessionApi } from '../../api/sessionApi';
import { createManagedWebSocket, type ManagedWebSocket } from '../../utils/websocket';
import type {
  QuizSessionRead,
  SessionAction,
  MonitorParticipant,
  MonitorSyncData,
  SessionResultsSummary,
} from '../../types/session';
import type {
  WebSocketConnectionState,
  WebSocketEventEnvelope,
} from '../../types/websocket';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { Modal } from '../../components/common/Modal';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  ArrowLeft,
  Play,
  Pause,
  StopCircle,
  XCircle,
  RefreshCw,
  Users,
  CheckCircle2,
  Clock,
  Award,
  Send,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';

export const SessionMonitorPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { showToast } = useToast();

  const [session, setSession] = useState<QuizSessionRead | null>(null);
  const [participants, setParticipants] = useState<MonitorParticipant[]>([]);
  const [connectedCount, setConnectedCount] = useState<number>(0);
  const [totalEnrolled, setTotalEnrolled] = useState<number>(0);
  const [wsState, setWsState] = useState<WebSocketConnectionState>('DISCONNECTED');
  const [resultsSummary, setResultsSummary] = useState<SessionResultsSummary | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters for participant list
  const [participantSearch, setParticipantSearch] = useState<string>('');
  const [presenceFilter, setPresenceFilter] = useState<string>('ALL');

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    action: SessionAction;
    title: string;
    message: string;
    danger?: boolean;
  } | null>(null);

  // WebSocket reference
  const wsRef = useRef<ManagedWebSocket | null>(null);

  // 1. Initial REST fetch
  const fetchSessionData = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const sess = await sessionApi.getSession(sessionId);
      setSession(sess);

      // If already completed, load results summary
      if (sess.status === 'COMPLETED') {
        try {
          const results = await sessionApi.getSessionResults(sessionId);
          setResultsSummary(results);
        } catch {
          // Non-blocking if results aren't ready
        }
      }
    } catch {
      setLoadError('Failed to load session details. Please verify your connection.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);

  // 2. WebSocket Connection and Event Handling
  useEffect(() => {
    if (!sessionId) return;

    const ws = createManagedWebSocket({
      path: `/api/v1/ws/sessions/${sessionId}/monitor`,
      sessionId,
      onStateChange: (state) => {
        setWsState(state);
      },
      onMessage: (envelope: WebSocketEventEnvelope<any>) => {
        const { event, data } = envelope;

        if (event === 'MONITOR_SYNC_STATE') {
          const syncData = data as MonitorSyncData;
          setSession((prev) => (prev ? { ...prev, status: syncData.session_status } : null));
          setTotalEnrolled(syncData.total_enrolled);
          setConnectedCount(syncData.connected_students_count);

          // Overwrite with authoritative list from PostgreSQL
          setParticipants(syncData.participants || []);
        } else if (event === 'SESSION_STATUS_CHANGED') {
          setSession((prev) => (prev ? { ...prev, status: data.new_status } : null));
          if (data.new_status === 'COMPLETED') {
            sessionApi.getSessionResults(sessionId).then(setResultsSummary).catch(() => {});
          }
        } else if (event === 'STUDENT_PRESENCE_UPDATED') {
          if (typeof data.connected_students_count === 'number') {
            setConnectedCount(data.connected_students_count);
          }
          setParticipants((prev) =>
            prev.map((p) =>
              p.student_user_id === data.student_user_id
                ? {
                    ...p,
                    is_connected: data.is_connected,
                    last_seen_at: data.last_seen_at,
                  }
                : p
            )
          );
        } else if (event === 'ATTEMPT_STATUS_CHANGED') {
          setParticipants((prev) =>
            prev.map((p) =>
              p.student_user_id === data.student_user_id
                ? {
                    ...p,
                    attempt_id: data.attempt_id,
                    attempt_status: data.attempt_status,
                    answered_count:
                      data.answered_count !== undefined ? data.answered_count : p.answered_count,
                  }
                : p
            )
          );
        } else if (event === 'STUDENT_PROGRESS_UPDATED') {
          // Progress update: ensure progress is strictly monotonic (never decreased by stale event)
          setParticipants((prev) =>
            prev.map((p) => {
              if (p.student_user_id === data.student_user_id) {
                const newAnswered = Math.max(p.answered_count, data.answered_count ?? 0);
                return { ...p, answered_count: newAnswered };
              }
              return p;
            })
          );
        }
      },
    });

    wsRef.current = ws;

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [sessionId]);

  // 3. Lifecycle Transitions
  const handleAction = async (action: SessionAction) => {
    if (!sessionId) return;

    if (action === 'end' || action === 'complete') {
      setConfirmModal({
        action: 'end',
        title: 'End Session Now',
        message:
          'Are you sure you want to end this live session? All current student attempts will be finalized and the session will be closed permanently.',
        danger: true,
      });
      return;
    }

    if (action === 'cancel') {
      setConfirmModal({
        action: 'cancel',
        title: 'Cancel Session',
        message:
          'Are you sure you want to cancel this scheduled session? This action cannot be undone.',
        danger: true,
      });
      return;
    }

    setIsActionPending(true);
    try {
      const updated = await sessionApi.transitionSession(sessionId, action);
      setSession(updated);
      showToast(`Session ${action === 'start' ? 'started' : action + 'd'} successfully`, 'success');
    } catch (err: any) {
      showToast(err.message || `Failed to ${action} session`, 'error');
    } finally {
      setIsActionPending(false);
    }
  };

  const executeConfirmedAction = async () => {
    if (!sessionId || !confirmModal) return;
    setIsActionPending(true);
    try {
      const updated = await sessionApi.transitionSession(sessionId, confirmModal.action);
      setSession(updated);
      showToast(
        `Session ${confirmModal.action === 'end' ? 'ended' : 'cancelled'} successfully`,
        'success'
      );
      setConfirmModal(null);
      if (confirmModal.action === 'end') {
        sessionApi.getSessionResults(sessionId).then(setResultsSummary).catch(() => {});
      }
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    } finally {
      setIsActionPending(false);
    }
  };

  // 4. Manual Sync Trigger
  const handleManualSync = () => {
    wsRef.current?.requestSync();
    fetchSessionData();
    showToast('Reconciling live session state with server...', 'info');
  };

  // 5. Release Results Action
  const handleReleaseResults = async () => {
    if (!sessionId) return;
    setIsActionPending(true);
    try {
      const updated = await sessionApi.releaseSessionResults(sessionId);
      setSession(updated);
      showToast('Session results successfully released to candidates!', 'success');
      const results = await sessionApi.getSessionResults(sessionId);
      setResultsSummary(results);
    } catch (err: any) {
      showToast(err.message || 'Failed to release results', 'error');
    } finally {
      setIsActionPending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError || !session) {
    return <ErrorDisplay message={loadError || 'Session not found'} onRetry={fetchSessionData} />;
  }

  const isScheduled = session.status === 'SCHEDULED';
  const isActive = session.status === 'ACTIVE';
  const isPaused = session.status === 'PAUSED';
  const isCompleted = session.status === 'COMPLETED';

  // Compute stats
  const notStartedCount = participants.filter((p) => p.attempt_status === 'NOT_STARTED').length;
  const inProgressCount = participants.filter((p) => p.attempt_status === 'IN_PROGRESS').length;
  const submittedCount = participants.filter((p) => p.attempt_status === 'FINALIZED').length;

  // Filter participants
  const filteredParticipants = participants.filter((p) => {
    if (participantSearch.trim()) {
      const q = participantSearch.toLowerCase();
      const nameMatch = p.student_name.toLowerCase().includes(q);
      const rollMatch = p.roll_number?.toLowerCase().includes(q) ?? false;
      if (!nameMatch && !rollMatch) return false;
    }
    if (presenceFilter === 'ONLINE' && !p.is_connected) return false;
    if (presenceFilter === 'IN_PROGRESS' && p.attempt_status !== 'IN_PROGRESS') return false;
    if (presenceFilter === 'FINALIZED' && p.attempt_status !== 'FINALIZED') return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner: Navigation, Session Code & WebSocket Connection Indicator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/faculty/sessions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Sessions
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xl font-black bg-blue-100 text-blue-900 px-3.5 py-1 rounded-lg tracking-widest border border-blue-300">
                {session.session_code}
              </span>
              <Badge
                variant={
                  isActive
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
                {isActive ? '● LIVE / ACTIVE' : session.status}
              </Badge>
              <Badge variant="purple" size="sm">
                {session.session_mode.replace('_', ' ')}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Class UUID: <code className="font-mono text-gray-700">{session.class_id}</code>
            </p>
          </div>
        </div>

        {/* Real-time Connection Pill and Actions */}
        <div className="flex items-center gap-2">
          {/* WebSocket state indicator */}
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
              wsState === 'CONNECTED'
                ? 'bg-green-50 text-green-700 border-green-200'
                : wsState === 'CONNECTING' || wsState === 'AUTHENTICATING' || wsState === 'RECONNECTING'
                ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                : 'bg-gray-100 text-gray-600 border-gray-300'
            }`}
          >
            {wsState === 'CONNECTED' ? (
              <Wifi className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-gray-400" />
            )}
            <span>{wsState === 'CONNECTED' ? 'Live Connected' : wsState}</span>
          </div>

          <Button variant="secondary" size="sm" onClick={handleManualSync}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Sync
          </Button>
        </div>
      </div>

      {/* Teacher Lifecycle Controls Toolbar */}
      <Card className="p-4 bg-gradient-to-r from-gray-50 to-blue-50/30 border-blue-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Session Lifecycle Controls</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Teacher-controlled transitions are applied immediately to all connected candidates.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isScheduled && (
              <>
                <Button
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  isLoading={isActionPending}
                  onClick={() => handleAction('start')}
                >
                  <Play className="w-4 h-4 mr-1.5" />
                  Start Session Now
                </Button>
                <Button
                  variant="ghost"
                  className="text-red-600 hover:text-red-700"
                  disabled={isActionPending}
                  onClick={() => handleAction('cancel')}
                >
                  <XCircle className="w-4 h-4 mr-1.5" />
                  Cancel Session
                </Button>
              </>
            )}

            {isActive && (
              <>
                <Button
                  variant="secondary"
                  className="text-amber-700 hover:bg-amber-50 border-amber-300"
                  isLoading={isActionPending}
                  onClick={() => handleAction('pause')}
                >
                  <Pause className="w-4 h-4 mr-1.5" />
                  Pause Session
                </Button>
                <Button
                  variant="danger"
                  isLoading={isActionPending}
                  onClick={() => handleAction('end')}
                >
                  <StopCircle className="w-4 h-4 mr-1.5" />
                  End Session
                </Button>
              </>
            )}

            {isPaused && (
              <>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  isLoading={isActionPending}
                  onClick={() => handleAction('resume')}
                >
                  <Play className="w-4 h-4 mr-1.5" />
                  Resume Session
                </Button>
                <Button
                  variant="danger"
                  isLoading={isActionPending}
                  onClick={() => handleAction('end')}
                >
                  <StopCircle className="w-4 h-4 mr-1.5" />
                  End Session
                </Button>
              </>
            )}

            {isCompleted && (
              <>
                {!session.results_released_at ? (
                  <Button
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    isLoading={isActionPending}
                    onClick={handleReleaseResults}
                  >
                    <Send className="w-4 h-4 mr-1.5" />
                    Release Results to Students
                  </Button>
                ) : (
                  <Badge variant="green" size="md">
                    Results Released
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Real-time Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Online Students
          </p>
          <div className="flex items-center justify-between mt-1">
            <h4 className="text-2xl font-bold text-green-600">{connectedCount}</h4>
            <div className="p-2.5 bg-green-50 text-green-600 rounded-lg">
              <Wifi className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">out of {totalEnrolled || participants.length} enrolled</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            In Progress
          </p>
          <div className="flex items-center justify-between mt-1">
            <h4 className="text-2xl font-bold text-blue-600">{inProgressCount}</h4>
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">actively answering questions</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Submitted / Finalized
          </p>
          <div className="flex items-center justify-between mt-1">
            <h4 className="text-2xl font-bold text-indigo-600">{submittedCount}</h4>
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">attempts completed</p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Not Started
          </p>
          <div className="flex items-center justify-between mt-1">
            <h4 className="text-2xl font-bold text-gray-700">{notStartedCount}</h4>
            <div className="p-2.5 bg-gray-100 text-gray-600 rounded-lg">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">awaiting candidate start</p>
        </Card>
      </div>

      {/* Completed Session Results Summary Banner */}
      {isCompleted && resultsSummary && (
        <Card className="p-6 bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-5 h-5 text-indigo-700" />
            <h3 className="text-base font-bold text-indigo-950">Assessment Results Summary</h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center sm:text-left pt-2">
            <div>
              <p className="text-xs font-medium text-indigo-700 uppercase">Average Score</p>
              <p className="text-xl font-extrabold text-indigo-950 mt-0.5">
                {resultsSummary.average_score ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-indigo-700 uppercase">Highest Score</p>
              <p className="text-xl font-extrabold text-green-700 mt-0.5">
                {resultsSummary.highest_score ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-indigo-700 uppercase">Lowest Score</p>
              <p className="text-xl font-extrabold text-amber-700 mt-0.5">
                {resultsSummary.lowest_score ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-indigo-700 uppercase">Finalized Attempts</p>
              <p className="text-xl font-extrabold text-indigo-950 mt-0.5">
                {resultsSummary.finalized_attempts} / {resultsSummary.total_attempts}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Live Participants Table */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Enrolled Candidates</h3>
            <span className="text-xs text-gray-500">({participants.length} students)</span>
          </div>

          {/* Table Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search name or roll number..."
                value={participantSearch}
                onChange={(e) => setParticipantSearch(e.target.value)}
                className="pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              aria-label="Filter Presence"
              value={presenceFilter}
              onChange={(e) => setPresenceFilter(e.target.value)}
              className="border border-gray-300 rounded-lg text-xs px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Participants</option>
              <option value="ONLINE">Online Only</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="FINALIZED">Finalized</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        {filteredParticipants.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">
            {participants.length === 0
              ? 'No candidates enrolled in this class session yet.'
              : 'No candidates match the filter criteria.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Connection</th>
                  <th className="px-4 py-3">Attempt Status</th>
                  <th className="px-4 py-3">Questions Answered</th>
                  <th className="px-4 py-3">Time Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredParticipants.map((p) => {
                  const percent =
                    p.total_questions > 0
                      ? Math.round((p.answered_count / p.total_questions) * 100)
                      : 0;

                  return (
                    <tr key={p.student_user_id} className="hover:bg-gray-50/70 transition-colors">
                      {/* Name & Roll */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.student_name}</div>
                        {p.roll_number && (
                          <div className="text-gray-400 font-mono text-[11px]">{p.roll_number}</div>
                        )}
                      </td>

                      {/* Connection Presence */}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              p.is_connected ? 'bg-green-500' : 'bg-gray-300'
                            }`}
                          />
                          <span className={p.is_connected ? 'text-green-700' : 'text-gray-500'}>
                            {p.is_connected ? 'Online' : 'Offline'}
                          </span>
                        </span>
                      </td>

                      {/* Attempt Status */}
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            p.attempt_status === 'FINALIZED'
                              ? 'green'
                              : p.attempt_status === 'IN_PROGRESS'
                              ? 'blue'
                              : 'gray'
                          }
                          size="sm"
                        >
                          {p.attempt_status}
                        </Badge>
                      </td>

                      {/* Progress */}
                      <td className="px-4 py-3">
                        <div className="w-36 space-y-1">
                          <div className="flex justify-between text-[11px] text-gray-600 font-medium">
                            <span>
                              {p.answered_count} / {p.total_questions}
                            </span>
                            <span>{percent}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Time Remaining */}
                      <td className="px-4 py-3 font-mono text-gray-600">
                        {p.time_remaining_seconds != null
                          ? `${Math.floor(p.time_remaining_seconds / 60)}m ${
                              p.time_remaining_seconds % 60
                            }s`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Confirmation Modal */}
      <Modal
        isOpen={Boolean(confirmModal)}
        onClose={() => setConfirmModal(null)}
        title={confirmModal?.title}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmModal(null)}
              disabled={isActionPending}
            >
              Cancel
            </Button>
            <Button
              variant={confirmModal?.danger ? 'danger' : 'primary'}
              onClick={executeConfirmedAction}
              isLoading={isActionPending}
            >
              Confirm
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">{confirmModal?.message}</p>
      </Modal>
    </div>
  );
};
