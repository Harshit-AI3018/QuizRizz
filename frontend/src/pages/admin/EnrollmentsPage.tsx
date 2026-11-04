import React, { useEffect, useState, useMemo } from 'react';
import { adminApi } from '../../api/adminApi';
import type {
  StudentEnrollment,
  EnrollmentCreate,
  StudentProfile,
  ClassEntity,
  AcademicYear,
} from '../../types/admin';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Badge } from '../../components/common/Badge';
import { Spinner } from '../../components/common/Spinner';
import { Card } from '../../components/common/Card';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { useToast } from '../../context/ToastContext';
import { Plus, Trash2, Search, UserPlus } from 'lucide-react';

export const EnrollmentsPage: React.FC = () => {
  const { showToast } = useToast();
  const [enrollments, setEnrollments] = useState<StudentEnrollment[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterYear, setFilterYear] = useState<string>('ALL');
  const [filterClass, setFilterClass] = useState<string>('ALL');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StudentEnrollment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form State
  const [studentUserId, setStudentUserId] = useState('');
  const [classId, setClassId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [enrollmentType, setEnrollmentType] = useState<'CORE' | 'ELECTIVE'>('CORE');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [enrRes, stuRes, clsRes, yrRes] = await Promise.all([
        adminApi.listEnrollments({ limit: 500 }),
        adminApi.listStudents({ limit: 500 }),
        adminApi.listClasses({ limit: 500 }),
        adminApi.listAcademicYears(),
      ]);
      setEnrollments(enrRes);
      setStudents(stuRes);
      setClasses(clsRes);
      setAcademicYears(yrRes);

      const currentYear = yrRes.find((y) => y.is_current);
      if (currentYear && !academicYearId) {
        setAcademicYearId(currentYear.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load enrollment data';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Lookups
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const yearMap = useMemo(() => new Map(academicYears.map((y) => [y.id, y])), [academicYears]);

  const filteredEnrollments = useMemo(() => {
    return enrollments.filter((e) => {
      const matchesYear = filterYear === 'ALL' || e.academic_year_id === filterYear;
      const matchesClass = filterClass === 'ALL' || e.class_id === filterClass;

      const student = studentMap.get(e.student_user_id);
      const studentName = student ? `${student.first_name} ${student.last_name}`.toLowerCase() : '';
      const rollNumber = student?.roll_number?.toLowerCase() || '';

      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term || studentName.includes(term) || rollNumber.includes(term);

      return matchesYear && matchesClass && matchesSearch;
    });
  }, [enrollments, filterYear, filterClass, searchTerm, studentMap]);

  const handleOpenCreate = () => {
    setStudentUserId(students.find((s) => s.is_active)?.id || '');
    setClassId(classes[0]?.id || '');
    const currentYear = academicYears.find((y) => y.is_current) || academicYears[0];
    setAcademicYearId(currentYear?.id || '');
    setEnrollmentType('CORE');
    setFormError(null);
    setIsCreateOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentUserId || !classId || !academicYearId) {
      setFormError('Please fill in all required fields');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);
      const payload: EnrollmentCreate = {
        student_user_id: studentUserId,
        class_id: classId,
        academic_year_id: academicYearId,
        enrollment_type: enrollmentType,
      };
      const created = await adminApi.createEnrollment(payload);
      setEnrollments((prev) => [created, ...prev]);
      showToast('Student enrolled successfully', 'success');
      setIsCreateOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create student enrollment';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (enrollment: StudentEnrollment) => {
    try {
      const updated = await adminApi.updateEnrollment(enrollment.id, {
        is_active: !enrollment.is_active,
      });
      setEnrollments((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      showToast(
        `Enrollment marked as ${updated.is_active ? 'active' : 'inactive'}.`,
        'success'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update enrollment status', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await adminApi.deleteEnrollment(deleteTarget.id);
      setEnrollments((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      showToast('Enrollment removed', 'success');
      setDeleteTarget(null);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete enrollment', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Student Enrollments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enroll students into class sections for specific academic years.
          </p>
        </div>
        <Button onClick={handleOpenCreate} variant="primary">
          <Plus className="w-4 h-4 mr-2" />
          Enroll Student
        </Button>
      </div>

      {error && <ErrorDisplay message={error} onRetry={fetchData} />}

      {/* Filter / Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="relative">
          <Input
            label="Search Students"
            value={searchTerm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
            placeholder="Search student or roll number..."
          />
          <Search className="w-4 h-4 text-gray-400 absolute right-3 top-9 pointer-events-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year</label>
          <select
            value={filterYear}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterYear(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="ALL">All Academic Years</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name} {y.is_current ? '(Current)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Class Section</label>
          <select
            value={filterClass}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterClass(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="ALL">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                Year {c.year_of_study}, Sem {c.semester}, Sec {c.section}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <Spinner size="lg" />
        </div>
      ) : filteredEnrollments.length === 0 ? (
        <EmptyState
          icon={<UserPlus className="w-10 h-10 stroke-1" />}
          title="No student enrollments found"
          description={
            searchTerm || filterYear !== 'ALL' || filterClass !== 'ALL'
              ? 'No enrollments match the active search or filters.'
              : 'Enroll students into classes to assign cohorts and enable exam participation.'
          }
          actionLabel="Enroll First Student"
          onAction={handleOpenCreate}
        />
      ) : (
        <Card className="overflow-hidden border border-gray-200 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-6 py-3 text-left">Student</th>
                  <th className="px-6 py-3 text-left">Roll Number</th>
                  <th className="px-6 py-3 text-left">Class Section</th>
                  <th className="px-6 py-3 text-left">Academic Year</th>
                  <th className="px-6 py-3 text-left">Type</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-700">
                {filteredEnrollments.map((e) => {
                  const student = studentMap.get(e.student_user_id);
                  const cls = classMap.get(e.class_id);
                  const year = yearMap.get(e.academic_year_id);

                  return (
                    <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {student ? (
                          <div>
                            <div className="font-semibold text-gray-900">
                              {student.first_name} {student.last_name}
                            </div>
                            <div className="text-xs text-gray-500">{student.email}</div>
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-gray-400">{e.student_user_id}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-xs font-semibold text-gray-800">
                          {student?.roll_number || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {cls ? (
                          <div>
                            <div className="font-medium text-gray-900">
                              Year {cls.year_of_study}, Semester {cls.semester}
                            </div>
                            <div className="text-xs text-gray-500">Section {cls.section}</div>
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-gray-400">{e.class_id}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {year ? (
                          <div className="text-gray-900 font-medium">
                            {year.name} {year.is_current ? '★' : ''}
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-gray-400">{e.academic_year_id}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant={e.enrollment_type === 'CORE' ? 'blue' : 'amber'}>
                          {e.enrollment_type}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant={e.is_active ? 'green' : 'gray'}>
                          {e.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleToggleActive(e)}
                        >
                          {e.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteTarget(e)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Enroll Student in Class"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Student *
            </label>
            <select
              value={studentUserId}
              onChange={(e) => setStudentUserId(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              required
            >
              <option value="" disabled>Select Student</option>
              {students.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.is_active}>
                  {s.first_name} {s.last_name} ({s.roll_number}) {!s.is_active ? '[Inactive]' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Class Section *
            </label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              required
            >
              <option value="" disabled>Select Class Section</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  Year {c.year_of_study}, Sem {c.semester}, Sec {c.section}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Academic Year *
            </label>
            <select
              value={academicYearId}
              onChange={(e) => setAcademicYearId(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              required
            >
              <option value="" disabled>Select Academic Year</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.is_current ? '★ (Current)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Enrollment Type *
            </label>
            <div className="flex gap-4 mt-1">
              <label className="inline-flex items-center text-sm text-gray-700">
                <input
                  type="radio"
                  name="enrollmentType"
                  value="CORE"
                  checked={enrollmentType === 'CORE'}
                  onChange={() => setEnrollmentType('CORE')}
                  className="mr-2 text-purple-600 focus:ring-purple-500"
                />
                CORE
              </label>
              <label className="inline-flex items-center text-sm text-gray-700">
                <input
                  type="radio"
                  name="enrollmentType"
                  value="ELECTIVE"
                  checked={enrollmentType === 'ELECTIVE'}
                  onChange={() => setEnrollmentType('ELECTIVE')}
                  className="mr-2 text-purple-600 focus:ring-purple-500"
                />
                ELECTIVE
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={submitting}>
              Enroll Student
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove Student Enrollment"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to remove this student enrollment?
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={isDeleting}>
              Remove Enrollment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default EnrollmentsPage;
