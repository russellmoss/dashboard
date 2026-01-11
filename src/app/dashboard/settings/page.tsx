'use client';

import { useSession } from 'next-auth/react';
import { Title, Text } from '@tremor/react';
import { UserManagement } from '@/components/settings/UserManagement';
import { ShieldAlert } from 'lucide-react';
import { getSessionPermissions } from '@/types/auth';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const permissions = getSessionPermissions(session);
  
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  if (!permissions?.canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <ShieldAlert className="w-16 h-16 text-gray-400 mb-4" />
        <Title>Access Denied</Title>
        <Text>You don&apos;t have permission to manage users.</Text>
      </div>
    );
  }
  
  return (
    <div>
      <div className="mb-6">
        <Title>Settings</Title>
        <Text>Manage users and system settings</Text>
      </div>
      
      <UserManagement currentUserEmail={session?.user?.email || ''} />
    </div>
  );
}
