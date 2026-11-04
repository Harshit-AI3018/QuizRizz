import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  api,
  setAccessToken,
  setRefreshToken,
  getAccessToken,
  getRefreshToken,
  clearTokens,
  registerAuthFailureCallback,
  unregisterAuthFailureCallback,
} from '../api/client';
import { ApiError } from '../types/api';

describe('API Client', () => {
  beforeEach(() => {
    clearTokens();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    unregisterAuthFailureCallback();
  });

  it('attaches Authorization header when access token is present', async () => {
    setAccessToken('test-access-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'success' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.get<{ message: string }>('/questions');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/questions');
    expect(options.headers.get('Authorization')).toBe('Bearer test-access-token');
    expect(result).toEqual({ message: 'success' });
  });

  it('throws ApiError with status and details on 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'Resource not found' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/quizzes/nonexistent')).rejects.toThrow(ApiError);
    try {
      await api.get('/quizzes/nonexistent');
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.isNotFound).toBe(true);
      expect(apiErr.message).toBe('Resource not found');
    }
  });

  it('parses 422 validation error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        detail: [
          { loc: ['body', 'title'], msg: 'Field required', type: 'value_error.missing' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await api.post('/quizzes', {});
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(422);
      expect(apiErr.isValidationError).toBe(true);
      expect(apiErr.validationErrors).toHaveLength(1);
      expect(apiErr.validationErrors[0].msg).toBe('Field required');
    }
  });

  it('handles 401 by calling refresh and retrying the request', async () => {
    setAccessToken('expired-token');
    setRefreshToken('valid-refresh-token');

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            token_type: 'bearer',
            expires_in: 900,
          }),
        };
      }

      callCount += 1;
      if (callCount === 1) {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ detail: 'Token expired' }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'authenticated data' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.get<{ data: string }>('/protected-resource');

    expect(result).toEqual({ data: 'authenticated data' });
    expect(getAccessToken()).toBe('new-access-token');
    expect(getRefreshToken()).toBe('new-refresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1. Initial (401), 2. Refresh, 3. Retry (200)
  });

  it('de-duplicates concurrent 401 requests into a single refresh call', async () => {
    setAccessToken('expired-token');
    setRefreshToken('valid-refresh-token');

    let refreshCallCount = 0;
    let resource1Calls = 0;
    let resource2Calls = 0;

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCallCount += 1;
        // Simulate network delay for refresh
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            access_token: 'concurrent-new-token',
            refresh_token: 'concurrent-new-refresh',
            token_type: 'bearer',
            expires_in: 900,
          }),
        };
      }

      if (url.includes('/resource-1')) {
        resource1Calls += 1;
        if (resource1Calls === 1) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ detail: 'Expired' }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id: 1, val: 'res1' }),
        };
      }

      if (url.includes('/resource-2')) {
        resource2Calls += 1;
        if (resource2Calls === 1) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ detail: 'Expired' }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id: 2, val: 'res2' }),
        };
      }

      throw new Error(`Unhandled path: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    // Launch two requests simultaneously
    const [res1, res2] = await Promise.all([
      api.get<{ id: number; val: string }>('/resource-1'),
      api.get<{ id: number; val: string }>('/resource-2'),
    ]);

    expect(res1).toEqual({ id: 1, val: 'res1' });
    expect(res2).toEqual({ id: 2, val: 'res2' });
    // Crucial check: /auth/refresh was called EXACTLY once!
    expect(refreshCallCount).toBe(1);
    expect(getAccessToken()).toBe('concurrent-new-token');
  });

  it('triggers onAuthFailure callback and clears tokens if refresh fails', async () => {
    setAccessToken('bad-token');
    setRefreshToken('bad-refresh');

    const authFailureSpy = vi.fn();
    registerAuthFailureCallback(authFailureSpy);

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ detail: 'Invalid refresh token' }),
        };
      }
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ detail: 'Unauthorized' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/protected')).rejects.toThrow();
    expect(authFailureSpy).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});
