'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

function Icon({ path, fill }: { path: ReactNode; fill?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  jobs: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  pipeline: <><path d="M4 6h16" /><path d="M7 12h13" /><path d="M10 18h10" /></>,
  alerts: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  inbox: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  resumes: <><path d="M14 3v5h5" /><path d="M7 3h8l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M9 13h6M9 17h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>
};

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/jobs', label: 'Jobs', icon: 'jobs' },
  { href: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
  { href: '/alerts', label: 'Alerts', icon: 'alerts' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
  { href: '/resumes', label: 'Résumés', icon: 'resumes' },
  { href: '/settings', label: 'Settings', icon: 'settings' }
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
    <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-[var(--panel)]/70 backdrop-blur flex flex-col">
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-sm)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="m15 9-3 3-3-3 3 8z" fill="currentColor" />
            </svg>
          </span>
          <div>
            <div className="font-display text-[19px] font-semibold leading-none">Crosswalk</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">career copilot · local</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map(item => {
          const active = item.href === '/' ? path === '/' : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                active ? 'bg-[var(--panel-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]'
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--accent)]" />}
              <span className={active ? 'text-[var(--accent)]' : 'text-[var(--faint)] group-hover:text-[var(--muted)]'}>
                <Icon path={ICONS[item.icon]} />
              </span>
              <span className="flex-1">{item.label}</span>
              {item.href === '/alerts' && unread > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-[var(--on-accent)]">{unread}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="m-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <span className="h-2 w-2 rounded-full bg-[var(--ok)]" />
          Running locally
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
          Your data stays in <code className="text-[var(--accent)]">~/.crosswalk</code>. Nothing is uploaded.
        </p>
      </div>
    </aside>
  );
}
