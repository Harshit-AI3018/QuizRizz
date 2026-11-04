import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { LoginRequest, Role, UserProfile } from '../types/auth';
import { authApi } from '../api/authApi';
import {
  setAccessToken,
  setRefreshToken,
  getRefreshToken,
  clearTokens,
  registerAuthFailureCallback,
  unregisterAuthFailureCallback,
} from '../api/client';

export interface AuthContextType {
  user: UserProfile | null;
  activeRole: Role | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  selectRole: (role: Role) => void;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuthFailure = useCallback(() => {
    clearTokens();
    setUser(null);
    setActiveRole(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    registerAuthFailureCallback(handleAuthFailure);
    return () => {
      unregisterAuthFailureCallback();
    };
  }, [handleAuthFailure]);

  // Initial session restoration attempt on mount
  useEffect(() => {
    let isMounted = true;

    async function initializeSession() {
      const existingRefreshToken = getRefreshToken();
      if (!existingRefreshToken) {
        if (isMounted) setIsLoading(false);
        return;
      }

      try {
        const refreshResult = await authApi.refresh({ refresh_token: existingRefreshToken });
        setAccessToken(refreshResult.access_token);
        if (refreshResult.refresh_token) {
          setRefreshToken(refreshResult.refresh_token);
        }

        const profile = await authApi.getCurrentUser();
        if (isMounted) {
          setUser(profile);
          if (profile.roles.length === 1) {
            setActiveRole(profile.roles[0]);
          } else {
            setActiveRole(null);
          }
        }
      } catch {
        if (isMounted) {
          handleAuthFailure();
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initializeSession();

    return () => {
      isMounted = false;
    };
  }, [handleAuthFailure]);

  const login = useCallback(async (credentials: LoginRequest) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authApi.login(credentials);
      setAccessToken(response.access_token);
      setRefreshToken(response.refresh_token);

      setUser(response.user);
      if (response.user.roles.length === 1) {
        setActiveRole(response.user.roles[0]);
      } else {
        // Multi-role user must pick their active role on the role selection page
        setActiveRole(null);
      }
    } catch (err) {
      clearTokens();
      setUser(null);
      setActiveRole(null);
      const msg = err instanceof Error ? err.message : 'Login failed. Please check your credentials.';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    const currentRefreshToken = getRefreshToken();
    try {
      if (currentRefreshToken) {
        await authApi.logout({ refresh_token: currentRefreshToken });
      }
    } catch {
      // Backend token revocation attempted; continue clearing client state
    } finally {
      clearTokens();
      setUser(null);
      setActiveRole(null);
      setError(null);
      setIsLoading(false);
    }
  }, []);

  const selectRole = useCallback((role: Role) => {
    if (user && user.roles.includes(role)) {
      setActiveRole(role);
    } else {
      setError(`User is not authorized for role ${role}`);
    }
  }, [user]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      activeRole,
      isAuthenticated: Boolean(user),
      isLoading,
      error,
      login,
      logout,
      selectRole,
      clearError,
    }),
    [user, activeRole, isLoading, error, login, logout, selectRole, clearError]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
