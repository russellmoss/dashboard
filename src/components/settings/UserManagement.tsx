'use client';

import { useState, useEffect } from 'react';
import { Card, Title, Text, Button } from '@tremor/react';
import { Plus, Pencil, Trash2, Key, UserCheck, UserX } from 'lucide-react';
import { SafeUser } from '@/types/user';
import { UserModal } from './UserModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { ResetPasswordModal } from './ResetPasswordModal';

interface UserManagementProps {
  currentUserEmail: string;
}

const ROLE_COLOR_CLASSES: Record<string, string> = {
  admin: 'text-red-600 dark:text-red-400',
  manager: 'text-blue-600 dark:text-blue-400',
  sgm: 'text-green-600 dark:text-green-400',
  sga: 'text-yellow-600 dark:text-yellow-400',
  viewer: 'text-gray-600 dark:text-gray-400',
};

export function UserManagement({ currentUserEmail }: UserManagementProps) {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal states
  const [showUserModal, setShowUserModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SafeUser | null>(null);
  
  // Fetch users
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data.users);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchUsers();
  }, []);
  
  const handleAddUser = () => {
    setSelectedUser(null);
    setShowUserModal(true);
  };
  
  const handleEditUser = (user: SafeUser) => {
    setSelectedUser(user);
    setShowUserModal(true);
  };
  
  const handleDeleteUser = (user: SafeUser) => {
    setSelectedUser(user);
    setShowDeleteModal(true);
  };
  
  const handleResetPassword = (user: SafeUser) => {
    setSelectedUser(user);
    setShowResetModal(true);
  };
  
  const handleUserSaved = () => {
    setShowUserModal(false);
    setSelectedUser(null);
    fetchUsers();
  };
  
  const handleUserDeleted = () => {
    setShowDeleteModal(false);
    setSelectedUser(null);
    fetchUsers();
  };
  
  const handlePasswordReset = () => {
    setShowResetModal(false);
    setSelectedUser(null);
  };
  
  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Card>
        <div className="text-center py-8">
          <Text className="text-red-600">{error}</Text>
          <Button onClick={fetchUsers} className="mt-4">Retry</Button>
        </div>
      </Card>
    );
  }
  
  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-6">
          <div>
            <Title>User Management</Title>
            <Text>{users.length} users total</Text>
          </div>
          <Button icon={Plus} onClick={handleAddUser}>
            Add User
          </Button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Name</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Email</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Role</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Status</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Created</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="py-3 px-4">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{user.name}</span>
                    {user.email === currentUserEmail && (
                      <span className="ml-2 text-blue-600 dark:text-blue-400">You</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-600 dark:text-gray-300">{user.email}</td>
                  <td className="py-3 px-4">
                    <span className={`font-semibold ${ROLE_COLOR_CLASSES[user.role] || 'text-gray-600 dark:text-gray-400'}`}>
                      {user.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {user.isActive ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <UserCheck className="w-4 h-4" /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
                        <UserX className="w-4 h-4" /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-500 dark:text-gray-400 text-sm">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleResetPassword(user)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Reset Password"
                      >
                        <Key className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleEditUser(user)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit User"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {user.email !== currentUserEmail && (
                        <button
                          onClick={() => handleDeleteUser(user)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      
      {/* Modals */}
      <UserModal
        isOpen={showUserModal}
        onClose={() => setShowUserModal(false)}
        onSaved={handleUserSaved}
        user={selectedUser}
      />
      
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleUserDeleted}
        user={selectedUser}
      />
      
      <ResetPasswordModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        onReset={handlePasswordReset}
        user={selectedUser}
      />
    </>
  );
}
