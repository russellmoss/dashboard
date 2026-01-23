'use client';

import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
import Link from 'next/link';
import Image from 'next/image';
import { 
  BarChart3, Settings, Menu, X, Target,
  Bot, Users, Layers, PhoneCall
} from 'lucide-react';

const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Layers },
  { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot },
  { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
  { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: Target },
  { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
  { id: 11, name: 'SGA Activity', href: '/dashboard/sga-activity', icon: PhoneCall },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const allowedPages = permissions?.allowedPages || [1, 2];

  const filteredPages = PAGES.filter(page => allowedPages.includes(page.id));

  return (
    <aside 
      className={`bg-white border-r border-gray-200 min-h-screen transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header Section with Hamburger */}
      <div className="h-16 flex items-center border-b border-gray-200 px-4">
        <button
          onClick={onToggle}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <Menu className="w-5 h-5 text-gray-600" />
          ) : (
            <X className="w-5 h-5 text-gray-600" />
          )}
        </button>
        
        {!isCollapsed && (
          <div className="ml-3 flex items-center">
            <span className="text-lg font-semibold text-gray-900">Savvy Wealth</span>
          </div>
        )}
      </div>
      
      {/* Navigation */}
      <nav className="p-4">
        <ul className="space-y-1">
          {filteredPages.map((page) => {
            const isActive = pathname === page.href;
            const Icon = page.icon;
            return (
              <li key={page.id}>
                <Link
                  href={page.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  } ${isCollapsed ? 'justify-center' : ''}`}
                  title={isCollapsed ? page.name : undefined}
                >
                  <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
                  {!isCollapsed && (
                    <span className="truncate">{page.name}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
