'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { SafeUser, UserRole } from '@/types/user';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  user: SafeUser | null;
}

export function UserModal({ isOpen, onClose, onSaved, user }: UserModalProps) {
  const [formData, setFormData] = useState<{
    email: string;
    name: string;
    password: string;
    role: UserRole;
    isActive: boolean;
    externalAgency: string;
    externalAgencyIsOther: boolean;
  }>({
    email: '',
    name: '',
    password: '',
    role: 'viewer',
    isActive: true,
    externalAgency: '',
    externalAgencyIsOther: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agencies, setAgencies] = useState<string[]>([]);
  const [agenciesLoading, setAgenciesLoading] = useState(false);

  const isEditing = !!user;

  useEffect(() => {
    if (isOpen && formData.role === 'recruiter') {
      setAgenciesLoading(true);
      fetch('/api/recruiter-hub/external-agencies')
        .then((res) => res.json())
        .then((data) => {
          setAgencies(data.agencies || []);
        })
        .catch((err) => {
          console.error('Failed to fetch agencies:', err);
        })
        .finally(() => {
          setAgenciesLoading(false);
        });
    }
  }, [isOpen, formData.role]);

  // When opening for Add User (no user), set initial form once. Do not depend on agencies
  // so that selecting Recruiter and then agencies loading doesn't reset the form.
  useEffect(() => {
    if (!isOpen) return;
    if (!user) {
      setFormData({
        email: '',
        name: '',
        password: '',
        role: 'viewer',
        isActive: true,
        externalAgency: '',
        externalAgencyIsOther: false,
      });
      setError(null);
    }
  }, [isOpen, user]);

  // When editing a user, sync form from user. When agencies load, update externalAgencyIsOther.
  useEffect(() => {
    if (!user) return;
    const agencyInList = user.externalAgency && agencies.includes(user.externalAgency);
    setFormData({
      email: user.email,
      name: user.name,
      password: '',
      role: user.role,
      isActive: user.isActive,
      externalAgency: user.externalAgency ?? '',
      externalAgencyIsOther: user.externalAgency ? !agencyInList : false,
    });
    setError(null);
  }, [user, isOpen, agencies]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const url = isEditing ? `/api/users/${user.id}` : '/api/users';
      const method = isEditing ? 'PUT' : 'POST';
      
      const body: Record<string, unknown> = {
        email: formData.email,
        name: formData.name,
        role: formData.role,
        isActive: formData.isActive,
      };
      if (formData.role === 'recruiter') {
        body.externalAgency = formData.externalAgency.trim();
      }
      if (formData.password) {
        body.password = formData.password;
      }
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save user');
      }
      
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = (newRole: typeof formData.role) => {
    setFormData((prev) => ({
      ...prev,
      role: newRole,
      externalAgency: newRole === 'recruiter' ? prev.externalAgency : '',
      externalAgencyIsOther: false,
    }));
  };

  const handleAgencySelect = (value: string) => {
    if (value === '__OTHER__') {
      setFormData((prev) => ({
        ...prev,
        externalAgency: '',
        externalAgencyIsOther: true,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        externalAgency: value,
        externalAgencyIsOther: false,
      }));
    }
  };

  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            {isEditing ? 'Edit User' : 'Add New User'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email *
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              placeholder="user@savvywealth.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password {isEditing ? '(leave blank to keep current)' : '(optional for Google sign-in only)'}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              minLength={formData.password ? 8 : undefined}
              placeholder={isEditing ? '••••••••' : 'Min 8 characters, or leave blank'}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role *
            </label>
            <select
              value={formData.role}
              onChange={(e) => handleRoleChange(e.target.value as typeof formData.role)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="revops_admin">RevOps Admin - Full access + manage Dashboard Requests</option>
              <option value="admin">Admin - Full access, can manage users</option>
              <option value="manager">Manager - Full access, can manage users</option>
              <option value="sgm">SGM - Team data, pages 1-3 & 6</option>
              <option value="sga">SGA - Own data only, pages 1-2 & 6</option>
              <option value="viewer">Viewer - Read-only, pages 1-2</option>
              <option value="recruiter">Recruiter - Recruiter Hub only, filtered by agency</option>
            </select>
          </div>

          {formData.role === 'recruiter' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                External Agency *
              </label>
              {agenciesLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading agencies...</div>
              ) : (
                <>
                  <select
                    value={formData.externalAgencyIsOther ? '__OTHER__' : formData.externalAgency}
                    onChange={(e) => handleAgencySelect(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">-- Select Agency --</option>
                    {agencies.map((agency) => (
                      <option key={agency} value={agency}>
                        {agency}
                      </option>
                    ))}
                    <option value="__OTHER__">Other (enter manually)</option>
                  </select>
                  {formData.externalAgencyIsOther && (
                    <input
                      type="text"
                      value={formData.externalAgency}
                      onChange={(e) => setFormData({ ...formData, externalAgency: e.target.value })}
                      required
                      placeholder="Enter agency name exactly as in Salesforce"
                      className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  )}
                </>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                This recruiter will only see data for this agency.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">
              Active (can log in)
            </label>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (formData.role === 'recruiter' && !formData.externalAgency.trim())}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
