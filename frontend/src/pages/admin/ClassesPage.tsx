import React, { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../../api/adminApi';
import type { ClassEntity, ClassCreate, ClassUpdate, Branch, AcademicYear } from '../../types/admin';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Spinner } from '../../components/common/Spinner';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { useToast } from '../../context/ToastContext';
import { Plus, Edit2, Trash2, Landmark, Search } from 'lucide-react';

export const ClassesPage: React.FC = () => {
  const { showToast } = useToast();
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedYearFilter, setSelectedYearFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassEntity | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [branchId, setBranchId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [yearOfStudy, setYearOfStudy] = useState(1);
  const [semester, setSemester] = useState(1);
  const [section, setSection] = useState('A');

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState<ClassEntity | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [classData, branchData, yearData] = await Promise.all([
        adminApi.listClasses({ limit: 500 }),
        adminApi.listBranches({ limit: 500 }),
        adminApi.listAcademicYears({ limit: 100 }),
      ]);
      setClasses(classData);
      setBranches(branchData);
      setAcademicYears(yearData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load classes.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreateModal = () => {
    setEditingClass(null);
    setBranchId(branches.length > 0 ? branches[0].id : '');
    const currentYear = academicYears.find((y) => y.is_current) || academicYears[0];
    setAcademicYearId(currentYear ? currentYear.id : '');
    setYearOfStudy(1);
    setSemester(1);
    setSection('A');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (c: ClassEntity) => {
    setEditingClass(c);
    setBranchId(c.branch_id);
    setAcademicYearId(c.academic_year_id);
    setYearOfStudy(c.year_of_study);
    setSemester(c.semester);
    setSection(c.section);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedSection = section.trim().toUpperCase();

    if (!branchId) {
      setFormError('Branch is required.');
      return;
    }
    if (!academicYearId) {
      setFormError('Academic Year is required.');
      return;
    }
    if (!trimmedSection) {
      setFormError('Section is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingClass) {
        const updatePayload: ClassUpdate = {
          branch_id: branchId,
          academic_year_id: academicYearId,
          year_of_study: Number(yearOfStudy),
          semester: Number(semester),
          section: trimmedSection,
        };
        await adminApi.updateClass(editingClass.id, updatePayload);
        showToast('Class updated successfully.', 'success');
      } else {
        const createPayload: ClassCreate = {
          branch_id: branchId,
          academic_year_id: academicYearId,
          year_of_study: Number(yearOfStudy),
          semester: Number(semester),
          section: trimmedSection,
        };
        await adminApi.createClass(createPayload);
        showToast('Class created successfully.', 'success');
      }

      setIsModalOpen(false);
      fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save class.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await adminApi.deleteClass(deleteTarget.id);
      showToast('Class deleted successfully.', 'success');
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete class.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const branchMap = new Map(branches.map((b) => [b.id, b]));
  const yearMap = new Map(academicYears.map((y) => [y.id, y]));

  const filteredClasses = classes.filter((c) => {
    const branch = branchMap.get(c.branch_id);
    const searchStr = `${branch?.name || ''} ${branch?.code || ''} Sec-${c.section} Year-${c.year_of_study} Sem-${c.semester}`.toLowerCase();
    const matchesSearch = searchStr.includes(searchTerm.toLowerCase());
    const matchesYear = selectedYearFilter === 'ALL' || c.academic_year_id === selectedYearFilter;
    return matchesSearch && matchesYear;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Classes & Sections</h1>
          <p className="text-xs text-gray-500 mt-1">
            Student cohort sections categorized by academic year, branch, year of study, and semester.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={openCreateModal}
          disabled={branches.length === 0 || academicYears.length === 0}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add Class Section
        </Button>
      </div>

      {(branches.length === 0 || academicYears.length === 0) && !isLoading && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs font-medium">
          Note: You must have at least one Branch and one Academic Year before creating class sections.
        </div>
      )}

      {error && <ErrorDisplay message={error} onRetry={fetchData} />}

      <Card
        title={
          <div className="flex items-center space-x-2">
            <Landmark className="w-5 h-5 text-gray-500" />
            <span>Configured Class Sections ({classes.length})</span>
          </div>
        }
        action={
          <div className="flex items-center space-x-2">
            <select
              value={selectedYearFilter}
              onChange={(e) => setSelectedYearFilter(e.target.value)}
              className="py-1.5 px-2.5 text-xs rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500 text-gray-700"
            >
              <option value="ALL">All Academic Years</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.is_current ? '(Current)' : ''}
                </option>
              ))}
            </select>

            <div className="relative w-48 sm:w-60">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search class section..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
          </div>
        }
      >
        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="md" label="Loading classes..." />
          </div>
        ) : filteredClasses.length === 0 ? (
          <EmptyState
            title="No Class Sections Found"
            description={
              searchTerm || selectedYearFilter !== 'ALL'
                ? 'No classes match your filter criteria.'
                : 'Define classes and sections to enroll students and schedule quiz sessions.'
            }
            actionLabel={
              searchTerm || selectedYearFilter !== 'ALL' || branches.length === 0 || academicYears.length === 0
                ? undefined
                : 'Add Class Section'
            }
            onAction={openCreateModal}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Class Designation</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4">Academic Year</th>
                  <th className="py-3 px-4">Year / Semester</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredClasses.map((c) => {
                  const branch = branchMap.get(c.branch_id);
                  const year = yearMap.get(c.academic_year_id);
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 font-semibold text-gray-900">
                        {branch?.code || 'Class'} - Sec {c.section}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-gray-600">
                        {branch?.name || 'Unknown Branch'}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-gray-600">
                        {year?.name || 'Unknown Year'}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-700">
                        Year {c.year_of_study}, Sem {c.semester}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(c)}
                          title="Edit class"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(c)}
                          title="Delete class"
                          className="hover:text-red-600"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingClass ? 'Edit Class Section' : 'Create Class Section'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <ErrorDisplay message={formError} className="mb-2" />}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Branch <span className="text-red-500">*</span>
            </label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              required
              className="block w-full rounded-md border border-gray-300 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Academic Year <span className="text-red-500">*</span>
            </label>
            <select
              value={academicYearId}
              onChange={(e) => setAcademicYearId(e.target.value)}
              required
              className="block w-full rounded-md border border-gray-300 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.is_current ? '(Active Cycle)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Year of Study"
              type="number"
              min={1}
              max={6}
              value={yearOfStudy}
              onChange={(e) => setYearOfStudy(Number(e.target.value))}
              required
            />
            <Input
              label="Semester"
              type="number"
              min={1}
              max={12}
              value={semester}
              onChange={(e) => setSemester(Number(e.target.value))}
              required
            />
            <Input
              label="Section"
              type="text"
              placeholder="e.g. A"
              value={section}
              onChange={(e) => setSection(e.target.value.toUpperCase())}
              required
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {editingClass ? 'Save Changes' : 'Create Class'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Confirm Deletion"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete this class section?
          </p>
          <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-100">
            Warning: This action will fail if student enrollments, faculty assignments, or quiz sessions are linked to this class.
          </p>
          <div className="flex justify-end space-x-3 pt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDelete}
              isLoading={isDeleting}
            >
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
