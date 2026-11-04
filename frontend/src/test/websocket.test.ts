import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createManagedWebSocket } from '../utils/websocket';
import { authApi } from '../api/authApi';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = WebSocket.CONNECTING;
  sentMessages: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Auto-trigger open on next tick
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 10);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = 'Normal Closure') {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

describe('ManagedWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('obtains a fresh ticket and transmits first-frame AUTH on open', async () => {
    let ticketCounter = 0;
    vi.spyOn(authApi, 'createWsTicket').mockImplementation(async () => {
      ticketCounter += 1;
      return { ticket: `ticket-token-${ticketCounter}`, expires_in: 60 };
    });

    const onOpenSpy = vi.fn();
    const managedWs = createManagedWebSocket({
      path: '/api/v1/ws/sessions/session-123/monitor',
      sessionId: 'session-123',
      onOpen: onOpenSpy,
    });

    // Advance to resolve ticket promise and trigger socket open
    await vi.advanceTimersByTimeAsync(20);

    expect(authApi.createWsTicket).toHaveBeenCalledTimes(1);
    expect(authApi.createWsTicket).toHaveBeenCalledWith({ session_id: 'session-123' });

    const wsInstance = MockWebSocket.instances[0];
    expect(wsInstance).toBeDefined();
    expect(wsInstance.sentMessages).toHaveLength(1);
    expect(JSON.parse(wsInstance.sentMessages[0])).toEqual({
      action: 'AUTH',
      ticket: 'ticket-token-1',
    });
    expect(onOpenSpy).toHaveBeenCalledTimes(1);

    managedWs.disconnect();
  });

  it('obtains a NEW ticket upon reconnect after unexpected disconnect', async () => {
    let ticketCounter = 0;
    vi.spyOn(authApi, 'createWsTicket').mockImplementation(async () => {
      ticketCounter += 1;
      return { ticket: `fresh-ticket-${ticketCounter}`, expires_in: 60 };
    });

    const managedWs = createManagedWebSocket({
      path: '/api/v1/ws/sessions/session-123/monitor',
      sessionId: 'session-123',
      autoReconnect: true,
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(JSON.parse(MockWebSocket.instances[0].sentMessages[0])).toEqual({
      action: 'AUTH',
      ticket: 'fresh-ticket-1',
    });

    // Simulate unexpected server disconnect with code 1006 (abnormal closure)
    MockWebSocket.instances[0].close(1006, 'Abnormal closure');

    // Advance through the backoff timer (1s) and reconnect
    await vi.advanceTimersByTimeAsync(1100);

    // Verify a SECOND ticket was requested (never reuse expired or consumed tickets!)
    expect(authApi.createWsTicket).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(JSON.parse(MockWebSocket.instances[1].sentMessages[0])).toEqual({
      action: 'AUTH',
      ticket: 'fresh-ticket-2',
    });

    managedWs.disconnect();
  });

  it('stops heartbeat and closes socket cleanly on disconnect', async () => {
    vi.spyOn(authApi, 'createWsTicket').mockResolvedValue({
      ticket: 'test-ticket',
      expires_in: 60,
    });

    const managedWs = createManagedWebSocket({
      path: '/api/v1/ws/sessions/session-123/student',
      sessionId: 'session-123',
    });

    await vi.advanceTimersByTimeAsync(20);
    const wsInstance = MockWebSocket.instances[0];

    // Trigger PING after 20s
    await vi.advanceTimersByTimeAsync(20000);
    expect(wsInstance.sentMessages).toContain(JSON.stringify({ event: 'PING' }));

    managedWs.disconnect();
    expect(wsInstance.readyState).toBe(WebSocket.CLOSED);
  });
});
