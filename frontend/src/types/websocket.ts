export type WebSocketEventType =
  | 'MONITOR_SYNC_STATE'
  | 'STUDENT_PRESENCE_UPDATED'
  | 'ATTEMPT_STATUS_CHANGED'
  | 'STUDENT_PROGRESS_UPDATED'
  | 'SESSION_STATUS_CHANGED'
  | 'PING'
  | 'PONG'
  | 'ERROR';

export interface WebSocketTicketRequest {
  session_id?: string;
}

export interface WebSocketTicketResponse {
  ticket: string;
  expires_in: number;
}

export interface WebSocketEventEnvelope<T = Record<string, unknown>> {
  event: WebSocketEventType;
  session_id: string;
  timestamp: string;
  data: T;
}

export type WebSocketConnectionState =
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECTING';
