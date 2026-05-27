'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, Pill, ErrorNote } from '@/components/ui';
import { runTool } from '@/lib/api';

type Item = {
  applicationId: string; status: string; jobTitle: string;
  company: string; deepLink: string; createdAt: string; submittedAt?: string;
};

const STATUSES = ['all', 'draft', 'submitted', 'interviewing', 'rejected', 'offer'] as const;
const TONE: Record<string, 'muted' | 'ok' | 'warn' | 'bad' | 'accent'> = {
  draft: 'muted', submitted: 'accent', interviewing: 'warn', rejected: 'bad', offer: 'ok'
};

export default function PipelinePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>('all');
  const [err, setErr] = useState('');

  async function load(status: string) {
    setErr('');
    try {
      const r = await runTool<{ items: Item[] }>('list_pipeline', status === 'all' ? {} : { status });
      setItems(r.items ?? []);
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(filter); }, [filter]);

  return (
    <>
      <PageHeader title="Pipeline" subtitle="Every application, with company and status. Same data as the MCP server." />
      <div className="mb-4 flex gap-2">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs border transition-colors ${filter === s ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {s}
          </button>
        ))}
      </div>
      <Card title={`Applications (${items.length})`}>
        <ErrorNote>{err}</ErrorNote>
        {items.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No applications yet. Draft one from a job to start tracking.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map(it => (
              <li key={it.applicationId} className="flex items-center justify-between py-3">
                <Link href={`/applications/${it.applicationId}`} className="group">
                  <div className="text-sm font-medium group-hover:text-[var(--accent)]">{it.jobTitle}</div>
                  <div className="text-xs text-[var(--muted)]">{it.company} · {new Date(it.createdAt).toLocaleDateString()}</div>
                </Link>
                <div className="flex items-center gap-3">
                  <Pill tone={TONE[it.status] ?? 'muted'}>{it.status}</Pill>
                  <Link href={`/applications/${it.applicationId}`} className="text-xs text-[var(--accent)]">open →</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
