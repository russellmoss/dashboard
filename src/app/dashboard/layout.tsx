'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
        <Header />
        <div className="flex">
          <Sidebar isCollapsed={isSidebarCollapsed} onToggle={toggleSidebar} />
          <main className={`flex-1 p-6 transition-all duration-300 ease-in-out`}>
            {children}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
