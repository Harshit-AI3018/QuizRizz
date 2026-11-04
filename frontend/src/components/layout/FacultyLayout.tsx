import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  HelpCircle,
  FileQuestion,
  UserCheck,
  Radio,
} from 'lucide-react';

export const FacultyLayout: React.FC = () => {
  const navItems = [
    { to: '/faculty', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/faculty/sessions', label: 'Sessions', icon: Radio },
    { to: '/faculty/questions', label: 'Question Bank', icon: HelpCircle },
    { to: '/faculty/quizzes', label: 'My Quizzes', icon: FileQuestion },
    { to: '/faculty/assignments', label: 'My Assignments', icon: UserCheck },
  ];

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 flex-shrink-0">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sticky top-20">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-3 pb-2 mb-2 border-b border-gray-100">
            Faculty Workspace
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 mr-2.5 flex-shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="flex-1 min-w-0">
        <Outlet />
      </section>
    </div>
  );
};
