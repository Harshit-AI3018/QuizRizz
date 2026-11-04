import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../context/AuthContext';

export const ForbiddenPage: React.FC = () => {
  const { activeRole } = useAuth();
  const navigate = useNavigate();

  const handleReturn = () => {
    if (activeRole === 'ADMIN') navigate('/admin');
    else if (activeRole === 'FACULTY') navigate('/faculty');
    else if (activeRole === 'STUDENT') navigate('/student');
    else navigate('/login');
  };

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-4">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900">403 — Access Forbidden</h1>
      <p className="text-sm text-gray-500 mt-2 max-w-md">
        Your current active role ({activeRole || 'None'}) does not have permission to view this resource.
      </p>
      <div className="mt-6 flex space-x-3">
        <Button variant="secondary" onClick={() => navigate('/select-role')}>
          Switch Role
        </Button>
        <Button variant="primary" onClick={handleReturn}>
          Return to Dashboard
        </Button>
      </div>
    </div>
  );
};
