import { authApi } from '../api/authApi';
import type {
  WebSocketConnectionState,
  WebSocketEventEnvelope,
} from '../types/websocket';

export interface ManagedWebSocketOptions<T = Record<string, unknown>> {
  /**
   * Endpoint path relative to host, e.g.:
   * `/api/v1/ws/sessions/${sessionId}/monitor` or `/api/v1/ws/sessions/${sessionId}/student`
   */
  path: string;
  sessionId?: string;
  onOpen?: () => void;
  onMessage?: (event: WebSocketEventEnvelope<T>) => void;
  onError?: (error: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onStateChange?: (state: WebSocketConnectionState) => void;
  /**
   * Maximum backoff delay in ms for reconnection (default: 30000)
   */
  maxReconnectDelayMs?: number;
  autoReconnect?: boolean;
}

export interface ManagedWebSocket {
  send: (data: unknown) => void;
  requestSync: () => void;
  disconnect: () => void;
  getState: () => WebSocketConnectionState;
}

export function createManagedWebSocket<T = Record<string, unknown>>(
  options: ManagedWebSocketOptions<T>
): ManagedWebSocket {
  const {
    path,
    sessionId,
    onOpen,
    onMessage,
    onError,
    onClose,
    onStateChange,
    maxReconnectDelayMs = 30000,
    autoReconnect = true,
  } = options;

  let ws: WebSocket | null = null;
  let state: WebSocketConnectionState = 'DISCONNECTED';
  let isExplicitlyClosed = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function updateState(newState: WebSocketConnectionState) {
    state = newState;
    onStateChange?.(newState);
  }

  function getWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${protocol}//${host}${cleanPath}`;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'PING' }));
      }
    }, 20000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function connect() {
    if (isExplicitlyClosed) return;

    updateState(reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING');

    // 1. Obtain a fresh single-use ticket before EVERY connection attempt.
    // Never reuse an expired or previously consumed ticket.
    let ticket: string;
    try {
      const ticketResponse = await authApi.createWsTicket(
        sessionId ? { session_id: sessionId } : undefined
      );
      ticket = ticketResponse.ticket;
    } catch {
      // If ticket creation fails (e.g. auth revoked or network offline), schedule retry
      if (autoReconnect && !isExplicitlyClosed) {
        scheduleReconnect();
      } else {
        updateState('DISCONNECTED');
      }
      return;
    }

    try {
      const url = getWsUrl();
      ws = new WebSocket(url);
    } catch (e) {
      onError?.(e as Event);
      if (autoReconnect && !isExplicitlyClosed) {
        scheduleReconnect();
      }
      return;
    }

    ws.onopen = () => {
      updateState('AUTHENTICATING');

      // 2. Transmit first-frame authentication within 5 seconds.
      // Payload: {"action": "AUTH", "ticket": ticket}
      // Never log the ticket value.
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'AUTH', ticket }));
        updateState('CONNECTED');
        reconnectAttempts = 0;
        startHeartbeat();
        onOpen?.();
      }
    };

    ws.onmessage = (rawEvent) => {
      try {
        const parsed = JSON.parse(rawEvent.data) as WebSocketEventEnvelope<T>;
        // Filter out internal PONG responses from client handlers
        if (parsed.event === 'PONG') {
          return;
        }
        onMessage?.(parsed);
      } catch {
        // Discard malformed frames
      }
    };

    ws.onerror = (e) => {
      onError?.(e);
    };

    ws.onclose = (e) => {
      stopHeartbeat();
      updateState('DISCONNECTED');
      onClose?.(e);

      // Codes: 1000 = Normal, 4401 = Unauthorized, 4403 = Forbidden
      const isAuthReject = e.code === 4401 || e.code === 4403;
      if (!isExplicitlyClosed && autoReconnect && !isAuthReject) {
        scheduleReconnect();
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);

    // Exponential backoff: 1s, 2s, 4s, 8s ... up to maxReconnectDelayMs
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelayMs);
    reconnectAttempts += 1;

    reconnectTimer = setTimeout(() => {
      connect();
    }, delay);
  }

  function disconnect() {
    isExplicitlyClosed = true;
    stopHeartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close(1000, 'Component unmounted');
      ws = null;
    }
    updateState('DISCONNECTED');
  }

  function send(data: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  function requestSync() {
    send({ event: 'REQUEST_SYNC' });
  }

  // Initial connect call
  connect();

  return {
    send,
    requestSync,
    disconnect,
    getState: () => state,
  };
}
