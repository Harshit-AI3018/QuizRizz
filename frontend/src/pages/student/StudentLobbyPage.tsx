import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { studentApi } from '../../api/studentApi';
import { createManagedWebSocket, type ManagedWebSocket } from '../../utils/websocket';
import type { StudentLobbyStatus } from '../../types/student';
import type { WebSocketEventEnvelope, WebSocketConnectionState } from '../../types/websocket';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import {
  ArrowLeft,
  Clock,
  BookOpen,
  User,
  Play,
  Hourglass,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
} from 'lucide-react';

export const StudentLobbyPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [lobby, setLobby] = useState<StudentLobbyStatus | null>(null);
  const [wsState, setWsState] = useState<WebSocketConnectionState>('DISCONNECTED');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<ManagedWebSocket | null>(null);

  const fetchLobbyStatus = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await studentApi.getSessionLobby(sessionId);
      setLobby(data);
    } catch {
      setError('Failed to enter session lobby. Please verify your access.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchLobbyStatus();
  }, [fetchLobbyStatus]);

  // Connect to student WebSocket for live teacher-controlled transitions
  useEffect(() => {
    if (!sessionId) return;

    const ws = createManagedWebSocket({
      path: `/api/v1/ws/sessions/${sessionId}/student`,
      sessionId,
      onStateChange: (state) => {
        setWsState(state);
      },
      onMessage: (envelope: WebSocketEventEnvelope<any>) => {
        if (envelope.event === 'SESSION_STATUS_CHANGED') {
          // Re-fetch authoritative lobby status from REST
          fetchLobbyStatus();
        }
      },
    });

    wsRef.current = ws;

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [sessionId, fetchLobbyStatus]);

  const handleStartAttempt = async () => {
    if (!sessionId) return;
    setIsStarting(true);
    try {
      const attemptStart = await studentApi.startQuizAttempt(sessionId);
      showToast('Assessment started! Good luck.', 'success');
      navigate(`/student/attempts/${attemptStart.attempt_id}`);
    } catch (err: any) {
      showToast(err.message || 'Unable to start attempt', 'error');
      fetchLobbyStatus();
    } finally {
      setIsStarting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !lobby) {
    return <ErrorDisplay message={error || 'Lobby not accessible'} onRetry={fetchLobbyStatus} />;
  }

  const isLive = lobby.session_status === 'ACTIVE';
  const isScheduled = lobby.session_status === 'SCHEDULED';
  const isPaused = lobby.session_status === 'PAUSED';
  const isCompleted = lobby.session_status === 'COMPLETED';
  const isCancelled = lobby.session_status === 'CANCELLED';

  const hasInProgressAttempt = lobby.attempt_status === 'IN_PROGRESS' && lobby.attempt_id;
  const hasFinalizedAttempt = lobby.attempt_status === 'FINALIZED' && lobby.attempt_id;

  const canStartNewAttempt =
    !hasInProgressAttempt &&
    !hasFinalizedAttempt &&
    (lobby.lobby_status === 'READY_TO_START' || isLive);

  const isWaitingForTeacher =
    isScheduled || lobby.lobby_status === 'WAITING_FOR_TEACHER';

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/student/sessions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Assessments
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{lobby.quiz_title}</h1>
              <Badge
                variant={
                  isLive
                    ? 'green'
                    : isCompleted
                    ? 'gray'
                    : isCancelled
                    ? 'red'
                    : isPaused
                    ? 'amber'
                    : 'blue'
                }
              >
                {isLive ? '● Live / Active' : lobby.session_status}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Subject: {lobby.subject_name} ({lobby.subject_code}) &bull; Class: {lobby.class_name}
            </p>
          </div>
        </div>

        {/* WebSocket presence pill */}
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border self-start sm:self-auto ${
            wsState === 'CONNECTED'
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-gray-100 text-gray-600 border-gray-300'
          }`}
        >
          {wsState === 'CONNECTED' ? (
            <Wifi className="w-3.5 h-3.5 text-green-600" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-gray-400" />
          )}
          <span>{wsState === 'CONNECTED' ? 'Lobby Connected' : wsState}</span>
        </div>
      </div>

      {/* Main Lobby Card */}
      <Card className="p-6 space-y-6">
        {/* Session Code & Mode Banner */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Assessment Access Code
            </span>
            <div className="font-mono text-2xl font-bold text-gray-900 tracking-wider">
              {lobby.session_code}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-emerald-600" />
              Duration: <strong>{lobby.duration_minutes} minutes</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <User className="w-4 h-4 text-blue-600" />
              Instructor: <strong>{lobby.faculty_name}</strong>
            </span>
          </div>
        </div>

        {/* Instructions */}
        {lobby.quiz_instructions && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-gray-500" />
              Assessment Instructions
            </h3>
            <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-100 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
              {lobby.quiz_instructions}
            </div>
          </div>
        )}

        {/* Lobby State Callout */}
        {isWaitingForTeacher && !hasInProgressAttempt && !hasFinalizedAttempt && (
          <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <Hourglass className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5 animate-spin" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-semibold text-sm">Waiting for Instructor to Start</p>
              <p>
                This session is in <strong>Teacher-Controlled</strong> mode. Please remain in the
                lobby. When your instructor starts the session, this page will update automatically.
              </p>
            </div>
          </div>
        )}

        {isPaused && (
          <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-semibold text-sm">Session Paused by Instructor</p>
              <p>
                The instructor has temporarily paused this session. Please wait for the session to resume.
              </p>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="p-5 bg-gray-100 border border-gray-300 rounded-xl flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-gray-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-800 space-y-1">
              <p className="font-semibold text-sm">Session Has Ended</p>
              <p>This assessment session is closed. No new attempts can be started.</p>
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="p-5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 space-y-1">
              <p className="font-semibold text-sm">Session Cancelled</p>
              <p>This assessment session has been cancelled by the instructor.</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Link to="/student/sessions">
            <Button variant="secondary">Back to Sessions</Button>
          </Link>

          {/* If already submitted / finalized */}
          {hasFinalizedAttempt && (
            <Link to={`/student/attempts/${lobby.attempt_id}/result`}>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                View Assessment Result
              </Button>
            </Link>
          )}

          {/* If in progress attempt exists */}
          {hasInProgressAttempt && !hasFinalizedAttempt && (
            <Link to={`/student/attempts/${lobby.attempt_id}`}>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Play className="w-4 h-4 mr-1.5" />
                Resume Assessment
              </Button>
            </Link>
          )}

          {/* If eligible to start a new attempt */}
          {canStartNewAttempt && (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6"
              isLoading={isStarting}
              onClick={handleStartAttempt}
            >
              <Play className="w-4 h-4 mr-1.5" />
              Start Assessment Now
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};
