'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Title, Text } from '@tremor/react';
import { UserManagement } from '@/components/settings/UserManagement';
import { ChangePasswordModal } from '@/components/settings/ChangePasswordModal';
import { ShieldAlert } from 'lucide-react';
import { getSessionPermissions } from '@/types/auth';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const permissions = getSessionPermissions(session);
  const [showChangePassword, setShowChangePassword] = useState(false);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <ShieldAlert className="w-16 h-16 text-gray-400 mb-4" />
        <Title>Sign in required</Title>
        <Text>Please sign in to access settings.</Text>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Title>Settings</Title>
        <Text>Manage your account and, if applicable, users and system settings.</Text>
      </div>

      <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">My Account</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Update your personal account settings.
        </p>
        <button
          type="button"
          onClick={() => setShowChangePassword(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Change My Password
        </button>
      </div>

      {permissions?.canManageUsers && (
        <UserManagement currentUserEmail={session?.user?.email || ''} />
      )}

      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  );
}
