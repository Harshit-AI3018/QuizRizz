import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import * as AuthContextModule from '../context/AuthContext';
import type { UserProfile } from '../types/auth';

describe('ProtectedRoute', () => {
  const mockUser: UserProfile = {
    id: 'user-1',
    college_id: 'college-1',
    email: 'user@example.edu',
    first_name: 'Test',
    last_name: 'User',
    roles: ['STUDENT'],
    must_change_password: false,
  };

  function mockAuth(overrides: Partial<AuthContextModule.AuthContextType> = {}) {
    const defaultAuth: AuthContextModule.AuthContextType = {
      user: null,
      activeRole: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      selectRole: vi.fn(),
      clearError: vi.fn(),
      ...overrides,
    };
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(defaultAuth);
  }

  it('renders loading spinner when auth state is loading', () => {
    mockAuth({ isLoading: true });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute>
                <div>Protected Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login', () => {
    mockAuth({ isAuthenticated: false, user: null });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute>
                <div>Protected Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects multi-role user with no active role to /select-role', () => {
    mockAuth({
      isAuthenticated: true,
      user: { ...mockUser, roles: ['FACULTY', 'ADMIN'] },
      activeRole: null,
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <div>Admin Dashboard</div>
              </ProtectedRoute>
            }
          />
          <Route path="/select-role" element={<div>Role Selection Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Role Selection Page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
  });

  it('redirects to /forbidden when activeRole is not in allowedRoles', () => {
    mockAuth({
      isAuthenticated: true,
      user: mockUser, // role is STUDENT
      activeRole: 'STUDENT',
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <div>Admin Dashboard</div>
              </ProtectedRoute>
            }
          />
          <Route path="/forbidden" element={<div>Forbidden Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Forbidden Page')).toBeInTheDocument();
    expect(screen.queryByText('Admin Dashboard')).not.toBeInTheDocument();
  });

  it('renders content when role matches allowedRoles', () => {
    mockAuth({
      isAuthenticated: true,
      user: mockUser,
      activeRole: 'STUDENT',
    });

    render(
      <MemoryRouter initialEntries={['/student']}>
        <Routes>
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={['STUDENT']}>
                <div>Student Portal Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Student Portal Content')).toBeInTheDocument();
  });
});
