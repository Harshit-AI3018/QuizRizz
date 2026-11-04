import React, { useEffect, useState } from 'react';
import { adminApi } from '../../api/adminApi';
import type { College, CollegeUpdate } from '../../types/admin';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Badge } from '../../components/common/Badge';
import { Spinner } from '../../components/common/Spinner';
import { Card } from '../../components/common/Card';
import { useToast } from '../../context/ToastContext';
import { Building2, Save } from 'lucide-react';

export const CollegeSettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const [college, setCollege] = useState<College | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchCollege = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminApi.getCollege();
      setCollege(data);
      setName(data.name);
      setCode(data.code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load college settings';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCollege();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('College name is required');
      return;
    }
    if (!code.trim()) {
      setFormError('College code is required');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      const payload: CollegeUpdate = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
      };
      const updated = await adminApi.updateCollege(payload);
      setCollege(updated);
      setName(updated.name);
      setCode(updated.code);
      showToast('College profile updated successfully', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update college settings';
      setFormError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !college) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">College Settings</h1>
        <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
          <p className="font-medium">Failed to Load Settings</p>
          <p className="text-sm mt-1">{error || 'College details could not be retrieved.'}</p>
        </div>
        <Button onClick={fetchCollege} variant="secondary">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">College Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your institution&apos;s primary identity and tenant configuration.
        </p>
      </div>

      {/* Profile Overview Card */}
      <Card className="p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-purple-50 text-purple-700 rounded-lg">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{college.name}</h2>
              <p className="text-xs text-gray-500 font-mono mt-0.5">Code: {college.code}</p>
            </div>
          </div>
          <Badge variant={college.is_active ? 'green' : 'gray'}>
            {college.is_active ? 'Active Institution' : 'Inactive'}
          </Badge>
        </div>

        {/* Read-Only Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded-md border border-gray-200">
          <div>
            <span className="text-gray-500 block text-xs">Tenant College ID:</span>
            <span className="font-mono text-gray-800 text-xs break-all">{college.id}</span>
          </div>
          <div>
            <span className="text-gray-500 block text-xs">Tenant Status:</span>
            <span className="text-gray-800 font-medium">{college.is_active ? 'Operational' : 'Suspended'}</span>
          </div>
          <div>
            <span className="text-gray-500 block text-xs">Registered On:</span>
            <span className="text-gray-700">
              {college.created_at ? new Date(college.created_at).toLocaleDateString() : 'N/A'}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block text-xs">Last Updated:</span>
            <span className="text-gray-700">
              {college.updated_at ? new Date(college.updated_at).toLocaleDateString() : 'N/A'}
            </span>
          </div>
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <h3 className="text-md font-semibold text-gray-800">Update Institutional Details</h3>

          {formError && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">
              {formError}
            </div>
          )}

          <Input
            label="College / Institution Name *"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="e.g. Apex Institute of Technology"
            required
          />

          <Input
            label="College Code *"
            value={code}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. APEX"
            helperText="Short uppercase institutional code used in reports and identifiers."
            required
          />

          <div className="pt-2 flex justify-end">
            <Button variant="primary" type="submit" isLoading={saving}>
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default CollegeSettingsPage;
