'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PipelineCatcher } from '@/components/games/pipeline-catcher';
import { AudioProvider } from '@/components/games/pipeline-catcher/AudioContext';

export default function PipelineCatcherPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);
  
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-emerald-500"></div>
      </div>
    );
  }
  
  if (!session) {
    return null;
  }
  
  return (
    <AudioProvider>
      <PipelineCatcher />
    </AudioProvider>
  );
}
