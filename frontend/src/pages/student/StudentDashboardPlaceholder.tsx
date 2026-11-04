import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { GraduationCap, Layers } from 'lucide-react';

export const StudentDashboardPlaceholder: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Student Assessment Portal</h1>
          <p className="text-xs text-gray-500 mt-1">
            Enrolled Student: <span className="text-gray-700 font-medium">{user?.email}</span>
          </p>
        </div>
        <Badge variant="green" size="md">
          STUDENT ACCESS
        </Badge>
      </div>

      <Card
        title={
          <div className="flex items-center space-x-2">
            <GraduationCap className="w-5 h-5 text-green-600" />
            <span>Phase 10F Module Scope</span>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            Welcome, <strong className="text-gray-900">{user?.first_name} {user?.last_name}</strong>.
            You are authenticated and ready for student assessments.
          </p>
          <div className="p-4 bg-green-50 rounded-lg border border-green-100">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-green-900 flex items-center mb-2">
              <Layers className="w-4 h-4 mr-1.5" />
              Upcoming Implementation (Phase 10F)
            </h4>
            <ul className="text-xs text-green-800 space-y-1.5 list-disc list-inside">
              <li>Available and joined session discovery</li>
              <li>Session code lobby join & live waiting room</li>
              <li>Real-time quiz attempt interface with server-authoritative countdown timer</li>
              <li>Monotonic response autosave and question review palette</li>
              <li>Attempt submission and instant / released score review</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};
