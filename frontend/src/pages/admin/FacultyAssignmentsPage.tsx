import React, { useEffect, useState, useMemo } from 'react';
import { adminApi } from '../../api/adminApi';
import type {
  FacultyAssignment,
  FacultyAssignmentCreate,
  FacultyProfile,
  Subject,
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
import { Plus, Trash2, Search, UserCheck } from 'lucide-react';

export const FacultyAssignmentsPage: React.FC = () => {
  const { showToast } = useToast();
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterYear, setFilterYear] = useState<string>('ALL');
  const [filterSubject, setFilterSubject] = useState<string>('ALL');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FacultyAssignment | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form State
  const [facultyUserId, setFacultyUserId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [classId, setClassId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [assRes, facRes, subRes, clsRes, yrRes] = await Promise.all([
        adminApi.listFacultyAssignments({ limit: 500 }),
        adminApi.listFaculty({ limit: 500 }),
        adminApi.listSubjects({ limit: 500 }),
        adminApi.listClasses({ limit: 500 }),
        adminApi.listAcademicYears(),
      ]);
      setAssignments(assRes);
      setFacultyList(facRes);
      setSubjects(subRes);
      setClasses(clsRes);
      setAcademicYears(yrRes);

      const currentYear = yrRes.find((y) => y.is_current);
      if (currentYear && !academicYearId) {
        setAcademicYearId(currentYear.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load assignments data';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Lookups
  const facultyMap = useMemo(() => new Map(facultyList.map((f) => [f.id, f])), [facultyList]);
  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const yearMap = useMemo(() => new Map(academicYears.map((y) => [y.id, y])), [academicYears]);

  const filteredAssignments = useMemo(() => {
    return assignments.filter((a) => {
      const matchesYear = filterYear === 'ALL' || a.academic_year_id === filterYear;
      const matchesSubj = filterSubject === 'ALL' || a.subject_id === filterSubject;

      const faculty = facultyMap.get(a.faculty_user_id);
      const facultyName = faculty ? `${faculty.first_name} ${faculty.last_name}`.toLowerCase() : '';
      const subject = subjectMap.get(a.subject_id);
      const subjectText = subject ? `${subject.name} ${subject.code}`.toLowerCase() : '';
      const cls = classMap.get(a.class_id);
      const classText = cls ? `yr ${cls.year_of_study} sem ${cls.semester} sec ${cls.section}`.toLowerCase() : '';

      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        facultyName.includes(term) ||
        subjectText.includes(term) ||
        classText.includes(term);

      return matchesYear && matchesSubj && matchesSearch;
    });
  }, [assignments, filterYear, filterSubject, searchTerm, facultyMap, subjectMap, classMap]);

  const handleOpenCreate = () => {
    setFacultyUserId(facultyList.find((f) => f.is_active)?.id || '');
    setSubjectId(subjects[0]?.id || '');
    setClassId(classes[0]?.id || '');
    const currentYear = academicYears.find((y) => y.is_current) || academicYears[0];
    setAcademicYearId(currentYear?.id || '');
    setFormError(null);
    setIsCreateOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facultyUserId || !subjectId || !classId || !academicYearId) {
      setFormError('Please select all required fields');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);
      const payload: FacultyAssignmentCreate = {
        faculty_user_id: facultyUserId,
        subject_id: subjectId,
        class_id: classId,
        academic_year_id: academicYearId,
      };
      const created = await adminApi.createFacultyAssignment(payload);
      setAssignments((prev) => [created, ...prev]);
      showToast('Faculty assignment created successfully', 'success');
      setIsCreateOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create faculty assignment';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (assignment: FacultyAssignment) => {
    try {
      const updated = await adminApi.updateFacultyAssignment(assignment.id, {
        is_active: !assignment.is_active,
      });
      setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      showToast(
        `Assignment marked as ${updated.is_active ? 'active' : 'inactive'}.`,
        'success'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update assignment status', 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await adminApi.deleteFacultyAssignment(deleteTarget.id);
      setAssignments((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      showToast('Faculty assignment removed', 'success');
      setDeleteTarget(null);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete assignment', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Faculty Assignments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Assign instructors to specific subjects, classes, and academic years.
          </p>
        </div>
        <Button onClick={handleOpenCreate} variant="primary">
          <Plus className="w-4 h-4 mr-2" />
          New Assignment
        </Button>
      </div>

      {error && <ErrorDisplay message={error} onRetry={fetchData} />}

      {/* Filter / Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="relative">
          <Input
            label="Search Assignments"
            value={searchTerm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
            placeholder="Search faculty, subject, class..."
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <select
            value={filterSubject}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterSubject(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <option value="ALL">All Subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
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
      ) : filteredAssignments.length === 0 ? (
        <EmptyState
          icon={<UserCheck className="w-10 h-10 stroke-1" />}
          title="No faculty assignments found"
          description={
            searchTerm || filterYear !== 'ALL' || filterSubject !== 'ALL'
              ? 'No assignments match the active search or filters.'
              : 'Link faculty members with subjects and class sections to begin quiz scheduling.'
          }
          actionLabel="Create First Assignment"
          onAction={handleOpenCreate}
        />
      ) : (
        <Card className="overflow-hidden border border-gray-200 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-600 font-medium">
                <tr>
                  <th className="px-6 py-3 text-left">Faculty Member</th>
                  <th className="px-6 py-3 text-left">Subject</th>
                  <th className="px-6 py-3 text-left">Class Section</th>
                  <th className="px-6 py-3 text-left">Academic Year</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-700">
                {filteredAssignments.map((a) => {
                  const faculty = facultyMap.get(a.faculty_user_id);
                  const subject = subjectMap.get(a.subject_id);
                  const cls = classMap.get(a.class_id);
                  const year = yearMap.get(a.academic_year_id);

                  return (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {faculty ? (
                          <div>
                            <div className="font-semibold text-gray-900">
                              {faculty.first_name} {faculty.last_name}
                            </div>
                            <div className="text-xs text-gray-500">
                              ID: {faculty.employee_id} • {faculty.email}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-gray-400">{a.faculty_user_id}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {subject ? (
                          <div>
                            <div className="font-medium text-gray-900">{subject.name}</div>
                            <div className="text-xs font-mono text-gray-500">{subject.code}</div>
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-gray-400">{a.subject_id}</span>
                        )}
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
                          <span className="text-xs font-mono text-gray-400">{a.class_id}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {year ? (
                          <div className="text-gray-900 font-medium">
                            {year.name} {year.is_current ? '★' : ''}
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-gray-400">{a.academic_year_id}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant={a.is_active ? 'green' : 'gray'}>
                          {a.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleToggleActive(a)}
                        >
                          {a.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteTarget(a)}
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
        title="Assign Faculty Member"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
              {formError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Faculty Member *
            </label>
            <select
              value={facultyUserId}
              onChange={(e) => setFacultyUserId(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              required
            >
              <option value="" disabled>Select Faculty</option>
              {facultyList.map((f) => (
                <option key={f.id} value={f.id} disabled={!f.is_active}>
                  {f.first_name} {f.last_name} ({f.employee_id}) {!f.is_active ? '[Inactive]' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject *
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              required
            >
              <option value="" disabled>Select Subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} - {s.name}
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

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={submitting}>
              Assign Faculty
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Remove Faculty Assignment"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to remove this faculty assignment?
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} isLoading={isDeleting}>
              Remove Assignment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default FacultyAssignmentsPage;
