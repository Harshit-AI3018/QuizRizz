import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { BookOpen, Layers } from 'lucide-react';

export const FacultyDashboardPlaceholder: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Faculty Studio</h1>
          <p className="text-xs text-gray-500 mt-1">
            Authoring & Live Monitoring Portal
          </p>
        </div>
        <Badge variant="blue" size="md">
          FACULTY ACCESS
        </Badge>
      </div>

      <Card
        title={
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <span>Phases 10D & 10E Module Scope</span>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            Welcome, Professor <strong className="text-gray-900">{user?.first_name} {user?.last_name}</strong>.
            Authentication and API connectivity are established.
          </p>
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-900 flex items-center mb-2">
              <Layers className="w-4 h-4 mr-1.5" />
              Upcoming Implementation (Phases 10D & 10E)
            </h4>
            <ul className="text-xs text-blue-800 space-y-1.5 list-disc list-inside">
              <li>Question Bank builder (MCQ, True/False, Multiple Select with proportional scoring)</li>
              <li>Quiz Assembly, sequencing, and mark overrides</li>
              <li>Session Scheduling, time-window constraints, and session code generation</li>
              <li>Real-time WebSocket Live Teacher Monitor with presence and attempt status tracking</li>
              <li>Faculty results release and score review</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};
