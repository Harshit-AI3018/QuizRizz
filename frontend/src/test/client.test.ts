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
  buildUrl,
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

  describe('buildUrl and Base URL Handling', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('preserves relative URLs for local development', () => {
      vi.stubEnv('VITE_API_BASE_URL', '/api/v1');
      expect(buildUrl('/questions')).toBe('/api/v1/questions');
      expect(buildUrl('questions')).toBe('/api/v1/questions');
    });

    it('preserves absolute Render API URLs without stripping hostname or scheme', () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://quizrizz-backend.onrender.com/api/v1');
      expect(buildUrl('/auth/login')).toBe('https://quizrizz-backend.onrender.com/api/v1/auth/login');
      expect(buildUrl('auth/login')).toBe('https://quizrizz-backend.onrender.com/api/v1/auth/login');
    });

    it('correctly handles trailing slashes on base URL and leading/duplicate slashes on paths', () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://quizrizz-backend.onrender.com/api/v1///');
      expect(buildUrl('///students/sessions///')).toBe('https://quizrizz-backend.onrender.com/api/v1/students/sessions///');

      vi.stubEnv('VITE_API_BASE_URL', '/api/v1/');
      expect(buildUrl('///students/sessions')).toBe('/api/v1/students/sessions');
    });

    it('appends and serializes query parameters correctly on both relative and absolute URLs', () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://quizrizz-backend.onrender.com/api/v1');
      const absUrl = buildUrl('/questions', { limit: 10, offset: 0, active: true, skipped: undefined, ignored: null });
      expect(absUrl).toBe('https://quizrizz-backend.onrender.com/api/v1/questions?limit=10&offset=0&active=true');

      vi.stubEnv('VITE_API_BASE_URL', '/api/v1');
      const relUrl = buildUrl('/quizzes', { search: 'biology', page: 2 });
      expect(relUrl).toBe('/api/v1/quizzes?search=biology&page=2');
    });

    it('uses the absolute backend origin during apiRequest and token refresh', async () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://quizrizz-backend.onrender.com/api/v1');
      setAccessToken('expired-token');
      setRefreshToken('valid-refresh-token');

      const fetchCalls: string[] = [];
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url);
        if (url.includes('/auth/refresh')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              access_token: 'new-token',
              refresh_token: 'new-refresh',
              token_type: 'bearer',
              expires_in: 900,
            }),
          };
        }
        if (fetchCalls.length === 1) {
          return {
            ok: false,
            status: 401,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ detail: 'Token expired' }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ success: true }),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      await api.get('/student/sessions');

      expect(fetchCalls[0]).toBe('https://quizrizz-backend.onrender.com/api/v1/student/sessions');
      expect(fetchCalls[1]).toBe('https://quizrizz-backend.onrender.com/api/v1/auth/refresh');
      expect(fetchCalls[2]).toBe('https://quizrizz-backend.onrender.com/api/v1/student/sessions');
    });
  });
});
