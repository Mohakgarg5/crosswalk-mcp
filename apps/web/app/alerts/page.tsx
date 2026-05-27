'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Button, PageHeader, Pill, ErrorNote } from '@/components/ui';

type Notification = { id: string; kind: string; title: string; body?: string; refId?: string; read: boolean; createdAt: string };

const TONE: Record<string, 'accent' | 'ok' | 'muted'> = { new_match: 'accent', recruiter_email: 'ok', email_unrouted: 'muted' };

export default function AlertsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/notifications').then(x => x.json());
      if (r.ok) setItems(r.items ?? []); else setErr(r.error);
    } catch (e) { setErr(String(e)); }
  }
  useEffect(() => { load(); }, []);

  async function markRead() {
    await fetch('/api/notifications', { method: 'POST' });
    await load();
  }

  function hrefFor(n: Notification): string | null {
    if (n.kind === 'recruiter_email' && n.refId) return `/applications/${n.refId}`;
    return null;
  }

  return (
    <>
      <PageHeader title="Alerts" subtitle="New job matches and routed recruiter emails."
        actions={<Button variant="ghost" onClick={markRead}>Mark all read</Button>} />
      <ErrorNote>{err}</ErrorNote>
      <Card title={`Notifications (${items.length})`}>
        {items.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing yet. Save a job search on the Jobs page and run a refresh to get new-match alerts.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map(n => {
              const href = hrefFor(n);
              const inner = (
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    {!n.read && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
                    <div>
                      <div className="text-sm">{n.title}</div>
                      {n.body && <div className="text-xs text-[var(--muted)]">{n.body}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Pill tone={TONE[n.kind] ?? 'muted'}>{n.kind.replace('_', ' ')}</Pill>
                    <span className="text-xs text-[var(--muted)]">{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              );
              return <li key={n.id}>{href ? <Link href={href} className="block hover:opacity-80">{inner}</Link> : inner}</li>;
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
