'use client';

import { useSession, signOut } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';
import Image from 'next/image';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* Savvy Logo */}
        <Image
          src="/savvy-logo.png"
          alt="Savvy Wealth"
          width={120}
          height={32}
          className="h-8 w-auto"
          priority
        />
        <div className="h-6 w-px bg-gray-300" /> {/* Divider */}
        <span className="text-sm text-gray-500">Funnel Dashboard</span>
      </div>

      {session?.user && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-gray-500" />
            <span className="text-sm text-gray-700">{session.user.email}</span>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      )}
    </header>
  );
}
