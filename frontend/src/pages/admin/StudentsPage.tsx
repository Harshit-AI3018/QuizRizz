import React, { useEffect, useState, useCallback } from 'react';
import { adminApi } from '../../api/adminApi';
import type { StudentProfile, StudentCreate, StudentUpdate } from '../../types/admin';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Modal } from '../../components/common/Modal';
import { Spinner } from '../../components/common/Spinner';
import { Badge } from '../../components/common/Badge';
import { EmptyState } from '../../components/common/EmptyState';
import { ErrorDisplay } from '../../components/common/ErrorDisplay';
import { useToast } from '../../context/ToastContext';
import { Plus, Edit2, UserX, GraduationCap, Search } from 'lucide-react';

export const StudentsPage: React.FC = () => {
  const { showToast } = useToast();
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentProfile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');

  // Deactivate State
  const [deactivateTarget, setDeactivateTarget] = useState<StudentProfile | null>(null);
  const [isDeactivating, setIsDeactivating] = useState(false);

  const fetchStudents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminApi.listStudents({ limit: 500 });
      setStudents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const openCreateModal = () => {
    setEditingStudent(null);
    setEmail('');
    setPassword('');
    setFirstName('');
    setLastName('');
    setRollNumber('');
    setRegistrationNumber('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (student: StudentProfile) => {
    setEditingStudent(student);
    setEmail(student.email);
    setPassword('');
    setFirstName(student.first_name);
    setLastName(student.last_name);
    setRollNumber(student.roll_number);
    setRegistrationNumber(student.registration_number || '');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedRoll = rollNumber.trim().toUpperCase();

    if (!trimmedEmail) {
      setFormError('Email is required.');
      return;
    }
    if (!trimmedFirst || !trimmedLast) {
      setFormError('First and last names are required.');
      return;
    }
    if (!trimmedRoll) {
      setFormError('Roll number is required.');
      return;
    }
    if (!editingStudent && (!password || password.length < 12)) {
      setFormError('Initial password must be at least 12 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingStudent) {
        const updatePayload: StudentUpdate = {
          email: trimmedEmail,
          first_name: trimmedFirst,
          last_name: trimmedLast,
          roll_number: trimmedRoll,
          registration_number: registrationNumber.trim() || null,
        };
        await adminApi.updateStudent(editingStudent.id, updatePayload);
        showToast('Student profile updated successfully.', 'success');
      } else {
        const createPayload: StudentCreate = {
          email: trimmedEmail,
          password,
          first_name: trimmedFirst,
          last_name: trimmedLast,
          roll_number: trimmedRoll,
          registration_number: registrationNumber.trim() || null,
        };
        await adminApi.createStudent(createPayload);
        showToast('Student profile created successfully.', 'success');
      }

      setIsModalOpen(false);
      fetchStudents();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save student.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setIsDeactivating(true);
    try {
      await adminApi.deactivateStudent(deactivateTarget.id);
      showToast('Student deactivated and access revoked.', 'success');
      setDeactivateTarget(null);
      fetchStudents();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to deactivate student.', 'error');
    } finally {
      setIsDeactivating(false);
    }
  };

  const filteredStudents = students.filter((s) => {
    const searchTarget = `${s.first_name} ${s.last_name} ${s.email} ${s.roll_number} ${s.registration_number || ''}`.toLowerCase();
    return searchTarget.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Student Roster</h1>
          <p className="text-xs text-gray-500 mt-1">
            Enrolled student accounts, roll numbers, and institutional identity records.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={openCreateModal}>
          <Plus className="w-4 h-4 mr-1.5" />
          Enroll New Student
        </Button>
      </div>

      {error && <ErrorDisplay message={error} onRetry={fetchStudents} />}

      <Card
        title={
          <div className="flex items-center space-x-2">
            <GraduationCap className="w-5 h-5 text-gray-500" />
            <span>Student Accounts ({students.length})</span>
          </div>
        }
        action={
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, roll, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="md" label="Loading students..." />
          </div>
        ) : filteredStudents.length === 0 ? (
          <EmptyState
            title="No Students Found"
            description={
              searchTerm
                ? 'No student profiles match your search criteria.'
                : 'Enroll students to grant access to assessment sessions and waiting lobbies.'
            }
            actionLabel={searchTerm ? undefined : 'Enroll New Student'}
            onAction={openCreateModal}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="text-xs uppercase bg-gray-50 text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Roll Number</th>
                  <th className="py-3 px-4">Reg Number</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStudents.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-gray-900">
                        {s.first_name} {s.last_name}
                      </div>
                      <div className="text-xs text-gray-500">{s.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono bg-gray-100 text-gray-800 text-xs px-2 py-0.5 rounded font-semibold">
                        {s.roll_number}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-600 font-mono">
                      {s.registration_number || '—'}
                    </td>
                    <td className="py-3 px-4">
                      {s.is_active ? (
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
                        onClick={() => openEditModal(s)}
                        title="Edit student profile"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-gray-600" />
                      </Button>
                      {s.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeactivateTarget(s)}
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
        title={editingStudent ? 'Edit Student Profile' : 'Enroll New Student'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <ErrorDisplay message={formError} className="mb-2" />}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              type="text"
              placeholder="e.g. Grace"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <Input
              label="Last Name"
              type="text"
              placeholder="e.g. Hopper"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>

          <Input
            label="Institutional Email"
            type="email"
            placeholder="grace.hopper@college.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Roll Number"
              type="text"
              placeholder="e.g. 23CS042"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
              required
            />
            <Input
              label="Registration Number"
              type="text"
              placeholder="e.g. REG-2026-904"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              helperText="Optional university number"
            />
          </div>

          {!editingStudent && (
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
              {editingStudent ? 'Save Changes' : 'Enroll Student'}
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
            Are you sure you want to deactivate student{' '}
            <strong className="text-gray-900">
              {deactivateTarget?.first_name} {deactivateTarget?.last_name}
            </strong>{' '}
            ({deactivateTarget?.roll_number})?
          </p>
          <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-100">
            This will immediately invalidate their sessions and prevent them from attempting quizzes.
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
