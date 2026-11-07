import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/common/Card';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { Footer } from '../../components/layout/Footer';

export const LoginPage: React.FC = () => {
  const { login, user, activeRole, error: authError, clearError } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // If already authenticated, redirect
  React.useEffect(() => {
    if (user) {
      if (user.roles.length > 1 && !activeRole) {
        navigate('/select-role', { replace: true });
      } else if (activeRole) {
        const dest =
          activeRole === 'ADMIN'
            ? '/admin'
            : activeRole === 'FACULTY'
            ? '/faculty'
            : '/student';
        navigate(dest, { replace: true });
      }
    }
  }, [user, activeRole, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    clearError();

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setValidationError('Email address is required.');
      return;
    }
    if (!password) {
      setValidationError('Password is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login({
        email: trimmedEmail,
        password,
      });

      // Navigation is triggered by the useEffect above once user state updates
    } catch {
      // Error is populated in authError / state
    } finally {
      setIsSubmitting(false);
    }
  };

  const errorMessage = validationError || authError;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 relative">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex w-12 h-12 rounded-xl bg-green-600 items-center justify-center text-white font-extrabold text-2xl shadow-md mb-3">
              Q
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">QuizRizz Portal</h1>
            <p className="text-xs text-gray-500 mt-1">Institutional assessment system</p>
          </div>

          <Card>
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMessage && (
                <ErrorDisplay message={errorMessage} className="mb-4" />
              )}

              <Input
                label="Institutional Email"
                type="email"
                name="email"
                placeholder="user@college.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
              />

              <Input
                label="Password"
                type="password"
                name="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
              />

              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={isSubmitting}
                className="w-full mt-2"
              >
                Sign In
              </Button>
            </form>
          </Card>

          <p className="text-center text-xs text-gray-400 mt-6">
            Access tokens are kept strictly in memory for maximum security.
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
};
