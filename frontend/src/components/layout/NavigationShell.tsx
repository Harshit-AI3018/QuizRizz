import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ArrowLeftRight, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

export const NavigationShell: React.FC = () => {
  const { user, activeRole, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const roleBadgeVariant = {
    ADMIN: 'purple',
    FACULTY: 'blue',
    STUDENT: 'green',
  }[activeRole || 'STUDENT'] as 'purple' | 'blue' | 'green';

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center text-white font-bold text-lg">
              Q
            </div>
            <span className="text-lg font-bold text-gray-900 tracking-tight">CampusQuiz</span>
          </div>

          {activeRole && (
            <Badge variant={roleBadgeVariant} size="md">
              {activeRole}
            </Badge>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {user.roles.length > 1 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/select-role')}
              title="Switch between your assigned roles"
            >
              <ArrowLeftRight className="w-4 h-4 mr-1 text-gray-500" />
              Switch Role
            </Button>
          )}

          <div className="hidden md:flex items-center space-x-2 pl-2 border-l border-gray-200 text-xs text-gray-600">
            <UserIcon className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-medium text-gray-800">{user.first_name} {user.last_name}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            title="Log out of CampusQuiz"
            className="text-gray-500 hover:text-red-600 hover:bg-red-50"
          >
            <LogOut className="w-4 h-4 mr-1" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
};
