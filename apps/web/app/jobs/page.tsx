'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, Input, Field, PageHeader, ErrorNote, Pill } from '@/components/ui';
import { runTool } from '@/lib/api';

type Job = {
  id: string; company: string; title: string; location?: string;
  locationType?: string; url: string; h1bConfidence?: number;
};
type FetchResult = { jobs: Job[]; meta: { fetched: number; afterFilters: number; companiesQueried: number; errors: string[] } };

export default function JobsPage() {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [h1bOnly, setH1bOnly] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();

  async function draft(jobId: string) {
    setDrafting(jobId); setErr('');
    try {
      const r = await runTool<{ applicationId: string }>('draft_application', { jobId });
      router.push(`/applications/${r.applicationId}`);
    } catch (e) { setErr((e as Error).message); }
    finally { setDrafting(''); }
  }

  async function search() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await runTool<FetchResult>('fetch_jobs', {
        titleContains: title || undefined,
        locationContains: location || undefined,
        remoteOnly: remoteOnly || undefined,
        h1bSponsorOnly: h1bOnly || undefined,
        limit: 50
      });
      setResult(r);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Jobs" subtitle="Live roles across 10 ATSs (115 companies). Queries run from your machine." />
      <Card title="Search">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Title contains"><Input placeholder="product manager" value={title} onChange={e => setTitle(e.target.value)} /></Field>
          <Field label="Location contains"><Input placeholder="New York" value={location} onChange={e => setLocation(e.target.value)} /></Field>
        </div>
        <div className="flex items-center gap-5 mb-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} /> Remote only</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={h1bOnly} onChange={e => setH1bOnly(e.target.checked)} /> H-1B sponsors only</label>
        </div>
        <Button onClick={search} disabled={busy}>{busy ? 'Searching live…' : 'Search jobs'}</Button>
        <ErrorNote>{err}</ErrorNote>
      </Card>

      {result && (
        <Card title={`Results (${result.jobs.length})`} subtitle={`queried ${result.meta.companiesQueried} companies · ${result.meta.fetched} fetched · ${result.meta.errors.length} errors`}>
          {result.jobs.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No matches. Try broader filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[var(--muted)] text-xs">
                  <tr><th className="py-2">Title</th><th>Company</th><th>Location</th><th>H-1B</th><th></th><th></th></tr>
                </thead>
                <tbody>
                  {result.jobs.map(j => (
                    <tr key={j.id} className="border-t border-[var(--border)]">
                      <td className="py-2.5 pr-3">{j.title}</td>
                      <td className="pr-3">{j.company}</td>
                      <td className="pr-3 text-[var(--muted)]">{j.location ?? '—'}{j.locationType ? ` · ${j.locationType}` : ''}</td>
                      <td className="pr-3">{typeof j.h1bConfidence === 'number' ? <Pill tone={j.h1bConfidence >= 0.5 ? 'ok' : 'muted'}>{j.h1bConfidence.toFixed(2)}</Pill> : '—'}</td>
                      <td className="pr-3"><a href={j.url} target="_blank" rel="noreferrer" className="text-[var(--accent)]">open ↗</a></td>
                      <td><button onClick={() => draft(j.id)} disabled={drafting === j.id} className="text-[var(--accent)] disabled:opacity-50">{drafting === j.id ? 'drafting…' : 'draft →'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
