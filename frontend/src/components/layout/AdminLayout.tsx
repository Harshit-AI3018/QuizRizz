import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar,
  Building2,
  GitFork,
  GraduationCap,
  BookOpen,
  Users,
  UserCheck,
  UserPlus,
  Landmark,
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const navItems = [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/academic-years', label: 'Academic Years', icon: Calendar },
    { to: '/admin/departments', label: 'Departments', icon: Building2 },
    { to: '/admin/branches', label: 'Branches', icon: GitFork },
    { to: '/admin/classes', label: 'Classes', icon: Landmark },
    { to: '/admin/subjects', label: 'Subjects', icon: BookOpen },
    { to: '/admin/faculty', label: 'Faculty', icon: Users },
    { to: '/admin/students', label: 'Students', icon: GraduationCap },
    { to: '/admin/assignments', label: 'Assignments', icon: UserCheck },
    { to: '/admin/enrollments', label: 'Enrollments', icon: UserPlus },
    { to: '/admin/college', label: 'College Settings', icon: Building2 },
  ];

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 flex-shrink-0">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sticky top-20">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-3 pb-2 mb-2 border-b border-gray-100">
            Admin Management
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
                        ? 'bg-purple-50 text-purple-700 font-semibold'
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
