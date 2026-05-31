'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

/** Full-bleed routes (their own chrome) skip the sidebar shell. */
const FULL_BLEED = ['/onboarding'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (FULL_BLEED.some(p => path.startsWith(p))) {
    return <div className="min-h-screen">{children}</div>;
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
