'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { UserPermissions } from '@/types/user';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(true);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  useEffect(() => {
    let cancelled = false;

    async function loadPermissions() {
      if (status !== 'authenticated' || !session?.user?.email) {
        setPermissions(null);
        setPermissionsLoading(status === 'loading');
        return;
      }

      setPermissionsLoading(true);
      try {
        const res = await fetch('/api/auth/permissions');
        if (!res.ok) {
          throw new Error(`Failed to fetch permissions (${res.status})`);
        }
        const data = (await res.json()) as UserPermissions;
        if (!cancelled) setPermissions(data);
      } catch {
        if (!cancelled) setPermissions(null);
      } finally {
        if (!cancelled) setPermissionsLoading(false);
      }
    }

    loadPermissions();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, status]);

  // Client-side route protection for recruiters (prevents accessing other dashboard pages via direct URL)
  useEffect(() => {
    if (permissionsLoading) return;
    if (!permissions) return;
    if (permissions.role !== 'recruiter') return;

    const allowed =
      pathname.startsWith('/dashboard/recruiter-hub') ||
      pathname.startsWith('/dashboard/settings');

    if (!allowed) {
      router.replace('/dashboard/recruiter-hub');
    }
  }, [permissions, permissionsLoading, pathname, router]);

  // Client-side route protection for capital partners
  useEffect(() => {
    if (permissionsLoading) return;
    if (!permissions) return;
    if (permissions.role !== 'capital_partner') return;

    const allowed =
      pathname.startsWith('/dashboard/gc-hub') ||
      pathname.startsWith('/dashboard/settings');

    if (!allowed) {
      router.replace('/dashboard/gc-hub');
    }
  }, [permissions, permissionsLoading, pathname, router]);

  // Avoid rendering restricted pages for recruiters (prevents UI flash)
  if (!permissionsLoading && permissions?.role === 'recruiter') {
    const allowed =
      pathname.startsWith('/dashboard/recruiter-hub') ||
      pathname.startsWith('/dashboard/settings');
    if (!allowed) return null;
  }

  // Avoid rendering restricted pages for capital partners (prevents UI flash)
  if (!permissionsLoading && permissions?.role === 'capital_partner') {
    const allowed =
      pathname.startsWith('/dashboard/gc-hub') ||
      pathname.startsWith('/dashboard/settings');
    if (!allowed) return null;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors overflow-x-hidden">
        <Header />
        <div className="flex overflow-x-hidden">
          <Sidebar
            isCollapsed={isSidebarCollapsed}
            onToggle={toggleSidebar}
            allowedPagesOverride={permissions?.allowedPages}
          />
          <main className={`flex-1 p-6 transition-all duration-300 ease-in-out min-w-0 overflow-x-hidden`}>
            {status === 'authenticated' && permissionsLoading ? <LoadingSpinner /> : children}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
