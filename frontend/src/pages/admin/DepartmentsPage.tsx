import React, { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../../api/adminApi';
import type { Department, DepartmentCreate, DepartmentUpdate } from '../../types/admin';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Spinner } from '../../components/common/Spinner';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { useToast } from '../../context/ToastContext';
import { Plus, Edit2, Trash2, Building2, Search } from 'lucide-react';

export const DepartmentsPage: React.FC = () => {
  const { showToast } = useToast();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchDepartments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminApi.listDepartments({ limit: 500 });
      setDepartments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load departments.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const openCreateModal = () => {
    setEditingDept(null);
    setName('');
    setCode('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (dept: Department) => {
    setEditingDept(dept);
    setName(dept.name);
    setCode(dept.code);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    if (!trimmedName) {
      setFormError('Department name is required.');
      return;
    }
    if (!trimmedCode) {
      setFormError('Department code is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingDept) {
        const updatePayload: DepartmentUpdate = {
          name: trimmedName,
          code: trimmedCode,
        };
        await adminApi.updateDepartment(editingDept.id, updatePayload);
        showToast('Department updated successfully.', 'success');
      } else {
        const createPayload: DepartmentCreate = {
          name: trimmedName,
          code: trimmedCode,
        };
        await adminApi.createDepartment(createPayload);
        showToast('Department created successfully.', 'success');
      }

      setIsModalOpen(false);
      fetchDepartments();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save department.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await adminApi.deleteDepartment(deleteTarget.id);
      showToast('Department deleted successfully.', 'success');
      setDeleteTarget(null);
      fetchDepartments();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete department.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredDepts = departments.filter(
    (d) =>
      d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Departments</h1>
          <p className="text-xs text-gray-500 mt-1">
            Institutional academic departments, faculty homes, and subject categorization.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={openCreateModal}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add Department
        </Button>
      </div>

      {error && <ErrorDisplay message={error} onRetry={fetchDepartments} />}

      <Card
        title={
          <div className="flex items-center space-x-2">
            <Building2 className="w-5 h-5 text-gray-500" />
            <span>Configured Departments ({departments.length})</span>
          </div>
        }
        action={
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="md" label="Loading departments..." />
          </div>
        ) : filteredDepts.length === 0 ? (
          <EmptyState
            title="No Departments Found"
            description={
              searchTerm
                ? 'No departments match your search term.'
                : 'Create departments to organize faculties, branches, and subjects.'
            }
            actionLabel={searchTerm ? undefined : 'Add Department'}
            onAction={searchTerm ? undefined : openCreateModal}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Department Name</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDepts.map((dept) => (
                  <tr key={dept.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-900">{dept.name}</td>
                    <td className="py-3 px-4">
                      <span className="font-mono bg-gray-100 text-gray-800 text-xs px-2 py-0.5 rounded font-semibold">
                        {dept.code}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">
                      {dept.created_at ? new Date(dept.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(dept)}
                        title="Edit department"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(dept)}
                        title="Delete department"
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
        title={editingDept ? 'Edit Department' : 'Create Department'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <ErrorDisplay message={formError} className="mb-2" />}

          <Input
            label="Department Name"
            type="text"
            placeholder="e.g. Computer Science and Engineering"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="Department Code"
            type="text"
            placeholder="e.g. CSE"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            helperText="Short uppercase department code"
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
              {editingDept ? 'Save Changes' : 'Create Department'}
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
            Are you sure you want to delete department{' '}
            <strong className="text-gray-900">{deleteTarget?.name}</strong>?
          </p>
          <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-100">
            Warning: This action will fail if active branches, faculty members, or subjects belong to this department.
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
