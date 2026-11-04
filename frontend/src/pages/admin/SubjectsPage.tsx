import React, { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../../api/adminApi';
import type { Subject, SubjectCreate, SubjectUpdate, Department } from '../../types/admin';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Spinner } from '../../components/common/Spinner';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { useToast } from '../../context/ToastContext';
import { Plus, Edit2, Trash2, BookOpen, Search } from 'lucide-react';

export const SubjectsPage: React.FC = () => {
  const { showToast } = useToast();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [subjectData, deptData] = await Promise.all([
        adminApi.listSubjects({ limit: 500 }),
        adminApi.listDepartments({ limit: 500 }),
      ]);
      setSubjects(subjectData);
      setDepartments(deptData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subjects.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreateModal = () => {
    setEditingSubject(null);
    setDepartmentId(departments.length > 0 ? departments[0].id : '');
    setName('');
    setCode('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (s: Subject) => {
    setEditingSubject(s);
    setDepartmentId(s.department_id);
    setName(s.name);
    setCode(s.code);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    if (!departmentId) {
      setFormError('Department is required.');
      return;
    }
    if (!trimmedName) {
      setFormError('Subject name is required.');
      return;
    }
    if (!trimmedCode) {
      setFormError('Subject code is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingSubject) {
        const updatePayload: SubjectUpdate = {
          department_id: departmentId,
          name: trimmedName,
          code: trimmedCode,
        };
        await adminApi.updateSubject(editingSubject.id, updatePayload);
        showToast('Subject updated successfully.', 'success');
      } else {
        const createPayload: SubjectCreate = {
          department_id: departmentId,
          name: trimmedName,
          code: trimmedCode,
        };
        await adminApi.createSubject(createPayload);
        showToast('Subject created successfully.', 'success');
      }

      setIsModalOpen(false);
      fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save subject.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await adminApi.deleteSubject(deleteTarget.id);
      showToast('Subject deleted successfully.', 'success');
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete subject.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));

  const filteredSubjects = subjects.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDept = selectedDeptFilter === 'ALL' || s.department_id === selectedDeptFilter;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Curriculum Subjects</h1>
          <p className="text-xs text-gray-500 mt-1">
            Institutional subjects categorized by department, supporting questions and faculty teaching assignments.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={openCreateModal} disabled={departments.length === 0}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add Subject
        </Button>
      </div>

      {departments.length === 0 && !isLoading && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs font-medium">
          Note: You must have at least one Department before creating subjects.
        </div>
      )}

      {error && <ErrorDisplay message={error} onRetry={fetchData} />}

      <Card
        title={
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-gray-500" />
            <span>Configured Subjects ({subjects.length})</span>
          </div>
        }
        action={
          <div className="flex items-center space-x-2">
            <select
              value={selectedDeptFilter}
              onChange={(e) => setSelectedDeptFilter(e.target.value)}
              className="py-1.5 px-2.5 text-xs rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500 text-gray-700"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <div className="relative w-48 sm:w-60">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search subject..."
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
            <Spinner size="md" label="Loading subjects..." />
          </div>
        ) : filteredSubjects.length === 0 ? (
          <EmptyState
            title="No Subjects Found"
            description={
              searchTerm || selectedDeptFilter !== 'ALL'
                ? 'No subjects match your filter criteria.'
                : 'Define curriculum subjects to enable question bank authoring and faculty teaching assignments.'
            }
            actionLabel={
              searchTerm || selectedDeptFilter !== 'ALL' || departments.length === 0
                ? undefined
                : 'Add Subject'
            }
            onAction={openCreateModal}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Subject Name</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSubjects.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-900">{s.name}</td>
                    <td className="py-3 px-4">
                      <span className="font-mono bg-gray-100 text-gray-800 text-xs px-2 py-0.5 rounded font-semibold">
                        {s.code}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-gray-600">
                      {deptMap.get(s.department_id) || 'Unknown Department'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(s)}
                        title="Edit subject"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(s)}
                        title="Delete subject"
                        className="hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingSubject ? 'Edit Subject' : 'Create Subject'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <ErrorDisplay message={formError} className="mb-2" />}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Parent Department <span className="text-red-500">*</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required
              className="block w-full rounded-md border border-gray-300 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Subject Name"
            type="text"
            placeholder="e.g. Design & Analysis of Algorithms"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="Subject Code"
            type="text"
            placeholder="e.g. CS501"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            helperText="Official course code"
          />

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
              {editingSubject ? 'Save Changes' : 'Create Subject'}
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
            Are you sure you want to delete subject{' '}
            <strong className="text-gray-900">{deleteTarget?.name}</strong>?
          </p>
          <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-100">
            Warning: This action will fail if existing question bank items, quizzes, or faculty assignments reference this subject.
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
