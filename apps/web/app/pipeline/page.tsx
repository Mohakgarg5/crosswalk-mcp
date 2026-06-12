'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, Pill, Button, ErrorNote } from '@/components/ui';
import { runTool } from '@/lib/api';

type Item = {
  applicationId: string; status: string; jobTitle: string;
  company: string; deepLink: string; createdAt: string; submittedAt?: string;
};

type Tab = 'all' | 'submitted' | 'needs_you' | 'in_progress' | 'closed';

const TONE: Record<string, 'muted' | 'ok' | 'warn' | 'bad' | 'accent'> = {
  draft: 'muted', submitted: 'accent', interviewing: 'warn', rejected: 'bad', offer: 'ok'
};

export default function PipelinePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [needsIds, setNeedsIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('all');
  const [err, setErr] = useState('');
  const [finishMsg, setFinishMsg] = useState('');
  const [finishing, setFinishing] = useState('');

  async function load() {
    setErr('');
    try {
      const r = await runTool<{ items: Item[] }>('list_pipeline', {});
      setItems(r.items ?? []);
      const nr = await fetch('/api/needs-action').then(x => x.json());
      if (nr.ok) setNeedsIds(new Set((nr.items ?? []).map((n: { refId?: string }) => n.refId).filter(Boolean)));
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); }, []);

  // A draft that has a needs-action alert = "needs you"; a draft without one is
  // still in progress (or left for review). Submitted is done; the rest closed.
  const bucketOf = (it: Item): Tab => {
    if (it.status === 'submitted') return 'submitted';
    if (it.status === 'draft') return needsIds.has(it.applicationId) ? 'needs_you' : 'in_progress';
    return 'closed'; // interviewing / rejected / offer
  };

  const counts = useMemo(() => {
    const c = { all: items.length, submitted: 0, needs_you: 0, in_progress: 0, closed: 0 } as Record<Tab, number>;
    for (const it of items) c[bucketOf(it)]++;
    return c;
  }, [items, needsIds]);

  const shown = items.filter(it => tab === 'all' || bucketOf(it) === tab);

  async function finishInBrowser(applicationId: string) {
    setFinishing(applicationId); setFinishMsg('');
    try {
      const r = await fetch('/api/finish', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicationId })
      }).then(x => x.json());
      setFinishMsg(r.ok ? (r.message ?? 'Opening a browser window…') : `Error: ${r.error}`);
    } catch (e) { setFinishMsg(`Error: ${(e as Error).message}`); }
    finally { setFinishing(''); }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'needs_you', label: 'Needs you' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'closed', label: 'Closed' }
  ];

  return (
    <>
      <PageHeader title="Applications" subtitle="Everything Crosswalk has applied to — what's submitted, and what needs one quick step from you." />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs border transition-colors ${tab === t.key ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {t.label} <span className="opacity-70">{counts[t.key]}</span>
          </button>
        ))}
      </div>
      {finishMsg && <div className="mb-3 text-sm text-[var(--accent)]">{finishMsg}</div>}
      <Card title={tab === 'needs_you' ? `Needs you (${shown.length})` : `Applications (${shown.length})`}>
        <ErrorNote>{err}</ErrorNote>
        {shown.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {tab === 'needs_you' ? 'Nothing waiting on you — anything that couldn\'t finish on its own shows up here with a Finish button.' : 'No applications in this view yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {shown.map(it => {
              const needsYou = needsIds.has(it.applicationId) && it.status === 'draft';
              return (
                <li key={it.applicationId} className="flex items-center justify-between py-3 gap-3">
                  <Link href={`/applications/${it.applicationId}`} className="group min-w-0">
                    <div className="text-sm font-medium group-hover:text-[var(--accent)] truncate">{it.company}</div>
                    <div className="text-xs text-[var(--muted)] truncate">{it.jobTitle} · {new Date(it.createdAt).toLocaleDateString()}</div>
                  </Link>
                  <div className="flex items-center gap-3 shrink-0">
                    {needsYou ? (
                      <>
                        <Pill tone="warn">needs you</Pill>
                        <Button onClick={() => finishInBrowser(it.applicationId)} disabled={finishing === it.applicationId}>
                          {finishing === it.applicationId ? 'Opening…' : 'Finish in browser'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Pill tone={TONE[it.status] ?? 'muted'}>{it.status}</Pill>
                        <Link href={`/applications/${it.applicationId}`} className="text-xs text-[var(--accent)]">open →</Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
