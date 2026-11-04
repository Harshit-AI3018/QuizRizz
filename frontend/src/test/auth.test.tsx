import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { authApi } from '../api/authApi';
import { clearTokens, getAccessToken, getRefreshToken } from '../api/client';
import type { Role, TokenResponse } from '../types/auth';

describe('AuthContext', () => {
  beforeEach(() => {
    clearTokens();
    vi.restoreAllMocks();
  });

  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  it('sets state and default activeRole for a single-role user upon login', async () => {
    const singleRoleUser = {
      id: 'student-id-1',
      college_id: 'college-id-1',
      email: 'student@example.edu',
      first_name: 'Alex',
      last_name: 'Smith',
      roles: ['STUDENT'] as Role[],
      must_change_password: false,
    };

    const tokenResponse: TokenResponse = {
      access_token: 'student-access-token',
      refresh_token: 'student-refresh-token',
      token_type: 'bearer',
      expires_in: 900,
      user: singleRoleUser,
    };

    vi.spyOn(authApi, 'login').mockResolvedValue(tokenResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login({
        college_id: 'college-id-1',
        email: 'student@example.edu',
        password: 'password123',
      });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(singleRoleUser);
    expect(result.current.activeRole).toBe('STUDENT');
    expect(getAccessToken()).toBe('student-access-token');
    expect(getRefreshToken()).toBe('student-refresh-token');
  });

  it('leaves activeRole null for multi-role users until selectRole is called', async () => {
    const multiRoleUser = {
      id: 'faculty-admin-id',
      college_id: 'college-id-1',
      email: 'teacher@example.edu',
      first_name: 'Professor',
      last_name: 'Oak',
      roles: ['FACULTY', 'ADMIN'] as Role[],
      must_change_password: false,
    };

    const tokenResponse: TokenResponse = {
      access_token: 'multi-access-token',
      refresh_token: 'multi-refresh-token',
      token_type: 'bearer',
      expires_in: 900,
      user: multiRoleUser,
    };

    vi.spyOn(authApi, 'login').mockResolvedValue(tokenResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login({
        college_id: 'college-id-1',
        email: 'teacher@example.edu',
        password: 'password123',
      });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.activeRole).toBeNull();

    // Select FACULTY
    act(() => {
      result.current.selectRole('FACULTY');
    });
    expect(result.current.activeRole).toBe('FACULTY');

    // Switch to ADMIN without re-authenticating
    act(() => {
      result.current.selectRole('ADMIN');
    });
    expect(result.current.activeRole).toBe('ADMIN');
  });

  it('clears state, in-memory tokens, and activeRole upon logout', async () => {
    const mockUser = {
      id: 'admin-id-1',
      college_id: 'college-id-1',
      email: 'admin@example.edu',
      first_name: 'Admin',
      last_name: 'User',
      roles: ['ADMIN'] as Role[],
      must_change_password: false,
    };

    vi.spyOn(authApi, 'login').mockResolvedValue({
      access_token: 'admin-token',
      refresh_token: 'admin-refresh',
      token_type: 'bearer',
      expires_in: 900,
      user: mockUser,
    });
    const logoutSpy = vi.spyOn(authApi, 'logout').mockResolvedValue(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login({
        college_id: 'college-id-1',
        email: 'admin@example.edu',
        password: 'password123',
      });
    });

    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(logoutSpy).toHaveBeenCalledWith({ refresh_token: 'admin-refresh' });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.activeRole).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});
