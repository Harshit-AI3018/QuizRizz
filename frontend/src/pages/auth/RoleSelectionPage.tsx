import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import type { Role } from '../../types/auth';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { ShieldCheck, GraduationCap, BookOpen } from 'lucide-react';

interface RoleOption {
  role: Role;
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
}

export const RoleSelectionPage: React.FC = () => {
  const { user, selectRole } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const roleDefinitions: Record<Role, Omit<RoleOption, 'role'>> = {
    ADMIN: {
      title: 'Institutional Administration',
      description: 'Manage departments, branches, academic years, classes, faculty, and student rosters.',
      icon: <ShieldCheck className="w-8 h-8 text-purple-600" />,
      path: '/admin',
    },
    FACULTY: {
      title: 'Faculty Studio & Live Monitor',
      description: 'Author questions, build quizzes, schedule assessments, and monitor live student attempts.',
      icon: <BookOpen className="w-8 h-8 text-blue-600" />,
      path: '/faculty',
    },
    STUDENT: {
      title: 'Student Portal',
      description: 'Discover scheduled quizzes, join live waiting lobbies, and take timed examinations.',
      icon: <GraduationCap className="w-8 h-8 text-green-600" />,
      path: '/student',
    },
  };

  const handleSelect = (role: Role, path: string) => {
    selectRole(role);
    navigate(path);
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="text-center mb-10">
        <h1 className="text-2xl font-bold text-gray-900">Select Active Workspace</h1>
        <p className="text-sm text-gray-500 mt-1">
          Welcome back, {user.first_name}. Your account holds multiple authorized roles.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {user.roles.map((role) => {
          const config = roleDefinitions[role];
          if (!config) return null;

          return (
            <Card key={role} className="flex flex-col justify-between hover:border-gray-300 transition-all">
              <div>
                <div className="p-3 bg-gray-50 rounded-xl w-fit mb-4">{config.icon}</div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">{config.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed mb-6">{config.description}</p>
              </div>

              <Button
                variant="primary"
                size="md"
                className="w-full"
                onClick={() => handleSelect(role, config.path)}
              >
                Enter as {role}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
