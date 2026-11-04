import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button } from '../components/common/Button';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 mb-4">
        <FileQuestion className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900">404 — Page Not Found</h1>
      <p className="text-sm text-gray-500 mt-2 max-w-md">
        The page you requested does not exist or has been moved.
      </p>
      <div className="mt-6">
        <Button variant="primary" onClick={() => navigate('/')}>
          Go to Home
        </Button>
      </div>
    </div>
  );
};
