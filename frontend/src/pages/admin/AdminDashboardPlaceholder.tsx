import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { ShieldCheck, Layers } from 'lucide-react';

export const AdminDashboardPlaceholder: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Institutional Administration</h1>
          <p className="text-xs text-gray-500 mt-1">
            College Scope: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">{user?.college_id}</code>
          </p>
        </div>
        <Badge variant="purple" size="md">
          ADMIN ACCESS
        </Badge>
      </div>

      <Card
        title={
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-purple-600" />
            <span>Phase 10C Module Scope</span>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            Welcome, <strong className="text-gray-900">{user?.first_name} {user?.last_name}</strong>.
            The frontend foundation and authenticated API client are active.
          </p>
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-900 flex items-center mb-2">
              <Layers className="w-4 h-4 mr-1.5" />
              Upcoming Implementation (Phase 10C)
            </h4>
            <ul className="text-xs text-purple-800 space-y-1.5 list-disc list-inside">
              <li>Academic structures management (Academic Years, Departments, Branches, Classes, Subjects)</li>
              <li>Faculty profile provisioning and subject teaching assignments</li>
              <li>Student enrollment rosters and section management</li>
              <li>Tenant-isolated college settings and updates</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
};
