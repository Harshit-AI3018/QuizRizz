import React, { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../../api/adminApi';
import type { AcademicYear, AcademicYearCreate, AcademicYearUpdate } from '../../types/admin';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { useToast } from '../../context/ToastContext';
import { Plus, Edit2, Trash2, Calendar, Search } from 'lucide-react';

export const AcademicYearsPage: React.FC = () => {
  const { showToast } = useToast();
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);

  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<AcademicYear | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchYears = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminApi.listAcademicYears({ limit: 100 });
      setYears(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load academic years.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchYears();
  }, [fetchYears]);

  const openCreateModal = () => {
    setEditingYear(null);
    setName('');
    setStartDate('');
    setEndDate('');
    setIsCurrent(false);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (year: AcademicYear) => {
    setEditingYear(year);
    setName(year.name);
    setStartDate(year.start_date);
    setEndDate(year.end_date);
    setIsCurrent(year.is_current);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Academic year name is required.');
      return;
    }
    if (!startDate || !endDate) {
      setFormError('Both start date and end date are required.');
      return;
    }
    if (new Date(endDate) <= new Date(startDate)) {
      setFormError('End date must be strictly after start date.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingYear) {
        const updatePayload: AcademicYearUpdate = {
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
          is_current: isCurrent,
        };
        await adminApi.updateAcademicYear(editingYear.id, updatePayload);
        showToast('Academic year updated successfully.', 'success');
      } else {
        const createPayload: AcademicYearCreate = {
          name: name.trim(),
          start_date: startDate,
          end_date: endDate,
          is_current: isCurrent,
        };
        await adminApi.createAcademicYear(createPayload);
        showToast('Academic year created successfully.', 'success');
      }

      setIsModalOpen(false);
      fetchYears();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save academic year.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await adminApi.deleteAcademicYear(deleteTarget.id);
      showToast('Academic year deleted successfully.', 'success');
      setDeleteTarget(null);
      fetchYears();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete academic year.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredYears = years.filter((y) =>
    y.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Academic Years</h1>
          <p className="text-xs text-gray-500 mt-1">
            Define institutional academic cycles, session date boundaries, and active status.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={openCreateModal}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add Academic Year
        </Button>
      </div>

      {error && <ErrorDisplay message={error} onRetry={fetchYears} />}

      {/* Main Content Card */}
      <Card
        title={
          <div className="flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-gray-500" />
            <span>Configured Academic Cycles ({years.length})</span>
          </div>
        }
        action={
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search academic years..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="md" label="Loading academic years..." />
          </div>
        ) : filteredYears.length === 0 ? (
          <EmptyState
            title="No Academic Years Found"
            description={
              searchTerm
                ? 'No records match your search criteria.'
                : 'Start by creating the first academic cycle for your institution.'
            }
            actionLabel={searchTerm ? undefined : 'Add Academic Year'}
            onAction={searchTerm ? undefined : openCreateModal}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Cycle Name</th>
                  <th className="py-3 px-4">Start Date</th>
                  <th className="py-3 px-4">End Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredYears.map((year) => (
                  <tr key={year.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-900">{year.name}</td>
                    <td className="py-3 px-4 text-xs">{year.start_date}</td>
                    <td className="py-3 px-4 text-xs">{year.end_date}</td>
                    <td className="py-3 px-4">
                      {year.is_current ? (
                        <Badge variant="green" size="sm">
                          CURRENT ACTIVE
                        </Badge>
                      ) : (
                        <Badge variant="gray" size="sm">
                          ARCHIVED
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(year)}
                        title="Edit academic year"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(year)}
                        title="Delete academic year"
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
        title={editingYear ? 'Edit Academic Year' : 'Create Academic Year'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <ErrorDisplay message={formError} className="mb-2" />}

          <Input
            label="Academic Year Name"
            type="text"
            placeholder="e.g. 2026-2027"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            helperText="Standard institutional nomenclature"
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <input
              type="checkbox"
              id="is_current"
              checked={isCurrent}
              onChange={(e) => setIsCurrent(e.target.checked)}
              className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
            />
            <label htmlFor="is_current" className="text-sm font-medium text-gray-700 cursor-pointer">
              Mark as Current Active Academic Year
            </label>
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
              {editingYear ? 'Save Changes' : 'Create Academic Year'}
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
            Are you sure you want to delete academic year{' '}
            <strong className="text-gray-900">{deleteTarget?.name}</strong>?
          </p>
          <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-100">
            Warning: This action will fail if active classes or enrollments depend on this year.
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
