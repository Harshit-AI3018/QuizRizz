import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../api/adminApi';
import type { College, AcademicYear } from '../../types/admin';
import { Card } from '../../components/common/Card';
import { Spinner } from '../../components/common/Spinner';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { Badge } from '../../components/common/Badge';
import {
  Users,
  GraduationCap,
  Building2,
  GitFork,
  BookOpen,
  Calendar,
  Landmark,
  ArrowRight,
} from 'lucide-react';

interface OverviewMetrics {
  college: College | null;
  totalStudents: number | null;
  totalFaculty: number | null;
  departmentsCount: number | null;
  branchesCount: number | null;
  classesCount: number | null;
  subjectsCount: number | null;
  activeAcademicYear: AcademicYear | null;
}

export const AdminOverviewPage: React.FC = () => {
  const [metrics, setMetrics] = useState<OverviewMetrics>({
    college: null,
    totalStudents: null,
    totalFaculty: null,
    departmentsCount: null,
    branchesCount: null,
    classesCount: null,
    subjectsCount: null,
    activeAcademicYear: null,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverviewData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [
        collegeRes,
        studentsRes,
        facultyRes,
        deptRes,
        branchRes,
        classesRes,
        subjectsRes,
        yearsRes,
      ] = await Promise.allSettled([
        adminApi.getCollege(),
        adminApi.listStudents({ limit: 500 }),
        adminApi.listFaculty({ limit: 500 }),
        adminApi.listDepartments({ limit: 500 }),
        adminApi.listBranches({ limit: 500 }),
        adminApi.listClasses({ limit: 500 }),
        adminApi.listSubjects({ limit: 500 }),
        adminApi.listAcademicYears({ limit: 100 }),
      ]);

      const college = collegeRes.status === 'fulfilled' ? collegeRes.value : null;
      const totalStudents = studentsRes.status === 'fulfilled' ? studentsRes.value.length : null;
      const totalFaculty = facultyRes.status === 'fulfilled' ? facultyRes.value.length : null;
      const departmentsCount = deptRes.status === 'fulfilled' ? deptRes.value.length : null;
      const branchesCount = branchRes.status === 'fulfilled' ? branchRes.value.length : null;
      const classesCount = classesRes.status === 'fulfilled' ? classesRes.value.length : null;
      const subjectsCount = subjectsRes.status === 'fulfilled' ? subjectsRes.value.length : null;

      let activeAcademicYear: AcademicYear | null = null;
      if (yearsRes.status === 'fulfilled') {
        activeAcademicYear = yearsRes.value.find((y) => y.is_current) || null;
      }

      setMetrics({
        college,
        totalStudents,
        totalFaculty,
        departmentsCount,
        branchesCount,
        classesCount,
        subjectsCount,
        activeAcademicYear,
      });

      // If all critical calls failed
      if (
        collegeRes.status === 'rejected' &&
        studentsRes.status === 'rejected' &&
        facultyRes.status === 'rejected'
      ) {
        setError('Failed to load institutional metrics from backend API.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  if (isLoading) {
    return (
      <div className="py-16 flex flex-col items-center justify-center">
        <Spinner size="lg" label="Loading institutional overview..." />
        <p className="mt-3 text-sm text-gray-500">Retrieving real-time administrative metrics...</p>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Enrolled Students',
      value: metrics.totalStudents !== null ? metrics.totalStudents : 'Unavailable',
      icon: GraduationCap,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      to: '/admin/students',
    },
    {
      title: 'Active Faculty',
      value: metrics.totalFaculty !== null ? metrics.totalFaculty : 'Unavailable',
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      to: '/admin/faculty',
    },
    {
      title: 'Departments',
      value: metrics.departmentsCount !== null ? metrics.departmentsCount : 'Unavailable',
      icon: Building2,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      to: '/admin/departments',
    },
    {
      title: 'Branches',
      value: metrics.branchesCount !== null ? metrics.branchesCount : 'Unavailable',
      icon: GitFork,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      to: '/admin/branches',
    },
    {
      title: 'Class Sections',
      value: metrics.classesCount !== null ? metrics.classesCount : 'Unavailable',
      icon: Landmark,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      to: '/admin/classes',
    },
    {
      title: 'Subjects Taught',
      value: metrics.subjectsCount !== null ? metrics.subjectsCount : 'Unavailable',
      icon: BookOpen,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      to: '/admin/subjects',
    },
  ];

  return (
    <div className="space-y-6">
      {/* College Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              {metrics.college?.name || 'Institution Overview'}
            </h1>
            {metrics.college?.code && (
              <Badge variant="purple" size="md">
                {metrics.college.code}
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Tenant ID: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">{metrics.college?.id || 'N/A'}</code>
          </p>
        </div>

        <div className="flex items-center space-x-3 bg-gray-50 px-4 py-2.5 rounded-lg border border-gray-100">
          <Calendar className="w-5 h-5 text-gray-500" />
          <div className="text-xs">
            <span className="text-gray-500 block">Current Academic Year:</span>
            <span className="font-semibold text-gray-900">
              {metrics.activeAcademicYear ? metrics.activeAcademicYear.name : 'No active year set'}
            </span>
          </div>
        </div>
      </div>

      {error && <ErrorDisplay message={error} onRetry={fetchOverviewData} />}

      {/* Real Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              to={card.to}
              className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:border-gray-300 hover:shadow-md transition-all group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-500">{card.title}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
                </div>
                <div className={`p-3 rounded-xl ${card.bgColor} ${card.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-xs font-medium text-purple-600 group-hover:text-purple-800">
                <span>Manage {card.title}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
      </div>

      {/* Quick Overview Card */}
      <Card title="Administrative Quick Links">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
          <Link
            to="/admin/assignments"
            className="p-3 rounded-lg border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-colors flex items-center justify-between"
          >
            <div>
              <p className="font-semibold text-gray-900">Faculty Assignments</p>
              <p className="text-gray-500 mt-0.5">Link faculty to subjects & classes</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </Link>
          <Link
            to="/admin/enrollments"
            className="p-3 rounded-lg border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-colors flex items-center justify-between"
          >
            <div>
              <p className="font-semibold text-gray-900">Student Enrollments</p>
              <p className="text-gray-500 mt-0.5">Enroll students into class sections</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </Link>
          <Link
            to="/admin/college"
            className="p-3 rounded-lg border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-colors flex items-center justify-between"
          >
            <div>
              <p className="font-semibold text-gray-900">College Profile</p>
              <p className="text-gray-500 mt-0.5">Edit institution name & details</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </Link>
        </div>
      </Card>
    </div>
  );
};
