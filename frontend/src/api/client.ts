import { ApiError, type ApiErrorResponse, type RequestOptions } from '../types/api';
import type { TokenResponse } from '../types/auth';

/**
 * In-memory token storage.
 * Strictly adheres to project constraints: zero localStorage, zero sessionStorage.
 */
let inMemoryAccessToken: string | null = null;
let inMemoryRefreshToken: string | null = null;

// Auth failure callback registered by AuthProvider
type AuthFailureCallback = () => void;
let authFailureCallback: AuthFailureCallback | null = null;

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setRefreshToken(token: string | null): void {
  inMemoryRefreshToken = token;
}

export function getRefreshToken(): string | null {
  return inMemoryRefreshToken;
}

export function clearTokens(): void {
  inMemoryAccessToken = null;
  inMemoryRefreshToken = null;
}

export function registerAuthFailureCallback(callback: AuthFailureCallback): void {
  authFailureCallback = callback;
}

export function unregisterAuthFailureCallback(): void {
  authFailureCallback = null;
}

// Global promise lock to prevent concurrent refresh storms
let refreshPromise: Promise<string> | null = null;

export function getBaseUrl(): string {
  // Vite injects environment variables under import.meta.env
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }
  return '/api/v1';
}

export function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined | null>): string {
  const baseUrl = getBaseUrl();
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const trimmed = path.replace(/^\/+/, '');
  const cleanPath = trimmed ? `/${trimmed}` : '';
  const isAbsolute = /^https?:\/\//i.test(cleanBase);
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';
  const url = new URL(`${cleanBase}${cleanPath}`, origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return isAbsolute ? url.toString() : url.pathname + url.search;
}

/**
 * Shared silent token refresh operation.
 * Concurrent 401 responses wait on the exact same promise.
 */
async function performTokenRefresh(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearTokens();
    authFailureCallback?.();
    throw new ApiError(401, 'No refresh token available');
  }

  const url = buildUrl('/auth/refresh');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    clearTokens();
    authFailureCallback?.();
    let errorDetail = 'Session expired. Please log in again.';
    try {
      const errorJson = (await response.json()) as ApiErrorResponse;
      if (typeof errorJson.detail === 'string') {
        errorDetail = errorJson.detail;
      }
    } catch {
      // ignore parsing failure
    }
    throw new ApiError(response.status, errorDetail);
  }

  const data = (await response.json()) as TokenResponse;
  setAccessToken(data.access_token);
  if (data.refresh_token) {
    setRefreshToken(data.refresh_token);
  }
  return data.access_token;
}

/**
 * Centralized typed API request client.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, params, skipAuth = false, headers: customHeaders, ...restOptions } = options;

  const url = buildUrl(path, params);
  const headers = new Headers(customHeaders);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  // Attach in-memory access token unless explicitly skipped
  const token = getAccessToken();
  if (!skipAuth && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...restOptions,
    headers,
    body: requestBody,
  });

  // Handle 401 Unauthorized with single-promise refresh lock
  const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
  if (response.status === 401 && !skipAuth && !isAuthEndpoint) {
    if (!refreshPromise) {
      refreshPromise = performTokenRefresh().finally(() => {
        refreshPromise = null;
      });
    }

    try {
      const newAccessToken = await refreshPromise;
      // Retry original request with newly refreshed token
      const retryHeaders = new Headers(headers);
      retryHeaders.set('Authorization', `Bearer ${newAccessToken}`);

      const retryResponse = await fetch(url, {
        ...restOptions,
        headers: retryHeaders,
        body: requestBody,
      });

      return handleResponse<T>(retryResponse);
    } catch (refreshErr) {
      if (refreshErr instanceof ApiError) {
        throw refreshErr;
      }
      throw new ApiError(401, 'Session refresh failed');
    }
  }

  return handleResponse<T>(response);
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  if (!response.ok) {
    let errorData: ApiErrorResponse | undefined;
    let errorMessage = `HTTP error ${response.status}: ${response.statusText}`;

    if (isJson) {
      try {
        errorData = (await response.json()) as ApiErrorResponse;
        if (typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        } else if (Array.isArray(errorData.detail)) {
          errorMessage = errorData.detail.map((d) => d.msg).join('; ');
        }
      } catch {
        // fallback to status text
      }
    } else {
      try {
        const text = await response.text();
        if (text) errorMessage = text;
      } catch {
        // ignore
      }
    }

    throw new ApiError(response.status, errorMessage, errorData);
  }

  if (isJson) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}

// Convenience REST methods
export const api = {
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'POST', body });
  },
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'PATCH', body });
  },
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'PUT', body });
  },
  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return apiRequest<T>(path, { ...options, method: 'DELETE' });
  },
};
