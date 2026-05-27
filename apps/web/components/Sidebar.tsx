'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: '◆' },
  { href: '/jobs', label: 'Jobs', icon: '⊞' },
  { href: '/pipeline', label: 'Pipeline', icon: '≡' },
  { href: '/alerts', label: 'Alerts', icon: '◔' },
  { href: '/inbox', label: 'Inbox', icon: '✉' },
  { href: '/profile', label: 'Profile', icon: '◉' },
  { href: '/resumes', label: 'Résumés', icon: '📄' },
  { href: '/settings', label: 'Settings', icon: '⚙' }
];

export default function Sidebar() {
  const path = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = () => fetch('/api/notifications?unread=1')
      .then(r => r.json())
      .then(d => { if (alive && d.ok) setUnread(d.unread ?? 0); })
      .catch(() => {});
    tick();
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);

  return (
    <aside className="w-60 shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col">
      <div className="px-5 py-5 border-b border-[var(--border)]">
        <div className="text-lg font-semibold tracking-tight">Crosswalk</div>
        <div className="text-xs text-[var(--muted)]">career copilot · local</div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(item => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? 'bg-[var(--panel-2)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]'
              }`}
            >
              <span className="w-4 text-center opacity-80">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.href === '/alerts' && unread > 0 && (
                <span className="rounded-full bg-[var(--accent)] text-[#0b0e14] text-[10px] font-semibold px-1.5 py-0.5">{unread}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 text-[11px] leading-relaxed text-[var(--muted)] border-t border-[var(--border)]">
        Runs on your machine. Data in <code className="text-[var(--accent)]">~/.crosswalk</code>.
      </div>
    </aside>
  );
}
