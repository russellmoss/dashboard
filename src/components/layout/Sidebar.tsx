'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
import Link from 'next/link';
import Image from 'next/image';
import { useRef, useCallback, ReactNode } from 'react';
import {
  BarChart3, BarChart2, Settings, Menu, X, Target,
  Bot, Users, Layers, Briefcase, MessageSquarePlus, MapPin
} from 'lucide-react';

// Easter egg component - triple-click to access Pipeline Catcher game
function EasterEggTrigger({ children }: { children: ReactNode }) {
  const router = useRouter();
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleClick = useCallback(() => {
    clickCountRef.current++;
    
    // Reset click count after 500ms of no clicks
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    
    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 500);
    
    // Triple-click detected!
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      router.push('/dashboard/games/pipeline-catcher');
    }
  }, [router]);
  
  return (
    <div onClick={handleClick} role="button" tabIndex={-1}>
      {children}
    </div>
  );
}

const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Layers },
  { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot },
  { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: Target },
  { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
  { id: 12, name: 'Recruiter Hub', href: '/dashboard/recruiter-hub', icon: Briefcase },
  { id: 13, name: 'Dashboard Requests', href: '/dashboard/requests', icon: MessageSquarePlus },
  { id: 14, name: 'Chart Builder', href: '/dashboard/chart-builder', icon: BarChart2 },
  { id: 15, name: 'Advisor Map', href: '/dashboard/advisor-map', icon: MapPin },
  { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  allowedPagesOverride?: number[];
}

export function Sidebar({ isCollapsed, onToggle, allowedPagesOverride }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const allowedPages = allowedPagesOverride || permissions?.allowedPages || [1, 2];

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
            <EasterEggTrigger>
              <span className="text-lg font-semibold text-gray-900 dark:text-white cursor-default select-none">
                Savvy Wealth
              </span>
            </EasterEggTrigger>
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
