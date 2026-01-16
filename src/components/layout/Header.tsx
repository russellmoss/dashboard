'use client';

import { useSession, signOut } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';
import Image from 'next/image';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { DataFreshnessIndicator } from '@/components/dashboard/DataFreshnessIndicator';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 flex items-center justify-between transition-colors">
      <div className="flex items-center gap-4">
        {/* Savvy Logo */}
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-gray-900 dark:text-white">Savvy</span>
        </div>
        <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" /> {/* Divider */}
        <span className="text-sm text-gray-500 dark:text-gray-400">Funnel Dashboard</span>
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        <DataFreshnessIndicator variant="compact" className="hidden sm:flex" />
        
        {session?.user && (
          <>
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{session.user.email}</span>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
