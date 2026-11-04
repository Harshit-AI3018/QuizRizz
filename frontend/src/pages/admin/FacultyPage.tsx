import React, { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../../api/adminApi';
import type { FacultyProfile, FacultyCreate, FacultyUpdate, Department } from '../../types/admin';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { useToast } from '../../context/ToastContext';
import { Plus, Edit2, UserX, Users, Search } from 'lucide-react';

export const FacultyPage: React.FC = () => {
  const { showToast } = useToast();
  const [facultyList, setFacultyList] = useState<FacultyProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFaculty, setEditingFaculty] = useState<FacultyProfile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [designation, setDesignation] = useState('');

  // Deactivate State
  const [deactivateTarget, setDeactivateTarget] = useState<FacultyProfile | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [facData, deptData] = await Promise.all([
        adminApi.listFaculty({ limit: 500 }),
        adminApi.listDepartments({ limit: 500 }),
      ]);
      setFacultyList(facData);
      setDepartments(deptData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load faculty profiles.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreateModal = () => {
    setEditingFaculty(null);
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    setEmployeeId('');
    setDepartmentId(departments.length > 0 ? departments[0].id : '');
    setDesignation('Assistant Professor');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (faculty: FacultyProfile) => {
    setEditingFaculty(faculty);
    setEmail(faculty.email);
    setPassword('');
    setFirstName(faculty.first_name);
    setLastName(faculty.last_name);
    setEmployeeId(faculty.employee_id);
    setDepartmentId(faculty.department_id);
    setDesignation(faculty.designation || '');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmpId = employeeId.trim().toUpperCase();

    if (!trimmedEmail) {
      setFormError('Email is required.');
      return;
    }
    if (!trimmedFirst || !trimmedLast) {
      setFormError('First and last names are required.');
      return;
    }
    if (!trimmedEmpId) {
      setFormError('Employee ID is required.');
      return;
    }
    if (!departmentId) {
      setFormError('Department is required.');
      return;
    }
    if (!editingFaculty && (!password || password.length < 12)) {
      setFormError('Initial password must be at least 12 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingFaculty) {
        const updatePayload: FacultyUpdate = {
          email: trimmedEmail,
          first_name: trimmedFirst,
          last_name: trimmedLast,
          employee_id: trimmedEmpId,
          department_id: departmentId,
          designation: designation.trim() || null,
        };
        await adminApi.updateFaculty(editingFaculty.id, updatePayload);
        showToast('Faculty profile updated successfully.', 'success');
      } else {
        const createPayload: FacultyCreate = {
          email: trimmedEmail,
          password,
          first_name: trimmedFirst,
          last_name: trimmedLast,
          employee_id: trimmedEmpId,
          department_id: departmentId,
          designation: designation.trim() || null,
        };
        await adminApi.createFaculty(createPayload);
        showToast('Faculty profile created successfully.', 'success');
      }

      setIsModalOpen(false);
      fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save faculty profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setIsDeactivating(true);
    try {
      await adminApi.deactivateFaculty(deactivateTarget.id);
      showToast('Faculty member deactivated and access revoked.', 'success');
      setDeactivateTarget(null);
      fetchData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to deactivate faculty.', 'error');
    } finally {
      setIsDeactivating(false);
    }
  };

  const deptMap = new Map(departments.map((d) => [d.id, d.name]));

  const filteredFaculty = facultyList.filter((f) => {
    const searchTarget = `${f.first_name} ${f.last_name} ${f.email} ${f.employee_id}`.toLowerCase();
    const matchesSearch = searchTarget.includes(searchTerm.toLowerCase());
    const matchesDept = selectedDeptFilter === 'ALL' || f.department_id === selectedDeptFilter;
    return matchesSearch && matchesDept;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Faculty Directory</h1>
          <p className="text-xs text-gray-500 mt-1">
            Provision faculty accounts, department affiliations, and designations.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={openCreateModal} disabled={departments.length === 0}>
          <Plus className="w-4 h-4 mr-1.5" />
          Add Faculty Member
        </Button>
      </div>

      {departments.length === 0 && !isLoading && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs font-medium">
          Note: You must have at least one Department before provisioning faculty accounts.
        </div>
      )}

      {error && <ErrorDisplay message={error} onRetry={fetchData} />}

      <Card
        title={
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-gray-500" />
            <span>Faculty Members ({facultyList.length})</span>
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
                placeholder="Search faculty..."
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
            <Spinner size="md" label="Loading faculty..." />
          </div>
        ) : filteredFaculty.length === 0 ? (
          <EmptyState
            title="No Faculty Members Found"
            description={
              searchTerm || selectedDeptFilter !== 'ALL'
                ? 'No faculty profiles match your filter criteria.'
                : 'Provision faculty accounts to begin question authoring and session supervision.'
            }
            actionLabel={
              searchTerm || selectedDeptFilter !== 'ALL' || departments.length === 0 ? undefined : 'Add Faculty Member'
            }
            onAction={openCreateModal}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Faculty Name</th>
                  <th className="py-3 px-4">Employee ID</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Designation</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredFaculty.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-gray-900">
                        {f.first_name} {f.last_name}
                      </div>
                      <div className="text-xs text-gray-500">{f.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono bg-gray-100 text-gray-800 text-xs px-2 py-0.5 rounded font-semibold">
                        {f.employee_id}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-gray-600">
                      {deptMap.get(f.department_id) || 'Unknown'}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-600">{f.designation || 'Faculty'}</td>
                    <td className="py-3 px-4">
                      {f.is_active ? (
                        <Badge variant="green" size="sm">
                          ACTIVE
                        </Badge>
                      ) : (
                        <Badge variant="red" size="sm">
                          DEACTIVATED
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(f)}
                        title="Edit faculty profile"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                      </Button>
                      {f.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeactivateTarget(f)}
                          title="Deactivate account"
                          className="hover:text-red-600"
                        >
                          <UserX className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                      )}
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
        title={editingFaculty ? 'Edit Faculty Profile' : 'Add Faculty Member'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <ErrorDisplay message={formError} className="mb-2" />}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              type="text"
              placeholder="e.g. Alan"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <Input
              label="Last Name"
              type="text"
              placeholder="e.g. Turing"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Institutional Email"
              type="email"
              placeholder="turing@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Employee ID"
              type="text"
              placeholder="e.g. FAC-001"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
              required
            />
          </div>

          {!editingFaculty && (
            <Input
              label="Initial Password"
              type="password"
              placeholder="At least 12 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              helperText="Minimum 12 characters; Argon2id hashed upon storage"
            />
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Department <span className="text-red-500">*</span>
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
            label="Designation"
            type="text"
            placeholder="e.g. Associate Professor"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
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
              {editingFaculty ? 'Save Changes' : 'Create Faculty Member'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Deactivate Confirmation Modal */}
      <Modal
        isOpen={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        title="Confirm Deactivation"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to deactivate faculty member{' '}
            <strong className="text-gray-900">
              {deactivateTarget?.first_name} {deactivateTarget?.last_name}
            </strong>{' '}
            ({deactivateTarget?.email})?
          </p>
          <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-100">
            This will immediately revoke their authentication tokens and disable access to authoring and monitoring tools.
          </p>
          <div className="flex justify-end space-x-3 pt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeactivateTarget(null)}
              disabled={isDeactivating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeactivate}
              isLoading={isDeactivating}
            >
              Confirm Deactivate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
