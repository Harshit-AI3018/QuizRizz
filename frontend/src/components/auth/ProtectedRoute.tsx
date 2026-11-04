import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import type { Role } from '../../types/auth';
import { Spinner } from '../common/Spinner';

export interface ProtectedRouteProps {
  allowedRoles?: Role[];
  children?: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const { user, activeRole, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center">
        <Spinner size="lg" label="Validating session..." />
        <p className="mt-3 text-sm text-gray-500 font-medium">Checking authentication...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If user has multiple roles and hasn't selected an active role yet, redirect to selection
  if (user.roles.length > 1 && !activeRole) {
    if (location.pathname !== '/select-role') {
      return <Navigate to="/select-role" replace />;
    }
  }

  // Check role-based gate
  if (allowedRoles && activeRole && !allowedRoles.includes(activeRole)) {
    return <Navigate to="/forbidden" replace />;
  }

  return children ? <>{children}</> : null;
};
