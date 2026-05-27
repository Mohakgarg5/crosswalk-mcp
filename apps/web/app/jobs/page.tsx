'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, Input, Field, PageHeader, ErrorNote, Pill } from '@/components/ui';
import { runTool, getSettings } from '@/lib/api';

type AutoApplySummary = { total: number; submitted: number; applied: number; drafted: number; skipped: number; results: { jobId: string; status: string; applicationId?: string; message?: string }[] };

type SavedSearch = { id: string; name: string; filters: Record<string, unknown>; lastCheckedAt?: string };

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

  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [searchMsg, setSearchMsg] = useState('');
  const [policy, setPolicy] = useState<'review' | 'auto'>('review');
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoResult, setAutoResult] = useState<AutoApplySummary | null>(null);

  useEffect(() => { getSettings().then(s => setPolicy(s.config.submitPolicy)).catch(() => {}); }, []);

  async function autoApplyAll() {
    if (!result) return;
    const ids = result.jobs.map(j => j.id);
    const willSubmit = policy === 'auto';
    const ok = confirm(
      `${willSubmit ? 'SUBMIT' : 'Auto-fill (no submit)'} applications to ${ids.length} job(s)?\n\n` +
      `This tailors a résumé + cover letter for each${willSubmit ? ' and submits it on your behalf' : ', leaving them for your review'}.\n` +
      `Submit policy is "${policy}" (change it in Settings).`
    );
    if (!ok) return;
    setAutoBusy(true); setAutoResult(null); setErr('');
    try {
      const r = await fetch('/api/auto-apply', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobIds: ids })
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error);
      setAutoResult(r.summary as AutoApplySummary);
    } catch (e) { setErr((e as Error).message); }
    finally { setAutoBusy(false); }
  }

  async function loadSearches() {
    const r = await fetch('/api/searches').then(x => x.json());
    if (r.ok) setSearches(r.searches ?? []);
  }
  useEffect(() => { loadSearches(); }, []);

  function currentFilters() {
    return {
      titleContains: title || undefined,
      locationContains: location || undefined,
      remoteOnly: remoteOnly || undefined,
      h1bSponsorOnly: h1bOnly || undefined
    };
  }

  async function saveSearch() {
    const name = (title || location || 'All jobs') + (remoteOnly ? ' · remote' : '') + (h1bOnly ? ' · H-1B' : '');
    await fetch('/api/searches', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, filters: currentFilters() })
    });
    await loadSearches();
  }

  async function removeSearch(id: string) {
    await fetch(`/api/searches?id=${id}`, { method: 'DELETE' });
    await loadSearches();
  }

  async function refreshAll() {
    setSearchMsg('Refreshing…');
    const r = await fetch('/api/searches', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'refresh' })
    }).then(x => x.json());
    setSearchMsg(r.ok ? `${r.result.total} new match(es) — see Alerts.` : (r.error ?? 'failed'));
    await loadSearches();
  }

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
        <div className="flex items-center gap-3">
          <Button onClick={search} disabled={busy}>{busy ? 'Searching live…' : 'Search jobs'}</Button>
          <Button variant="ghost" onClick={saveSearch}>Save this search</Button>
        </div>
        <ErrorNote>{err}</ErrorNote>
      </Card>

      <div className="mt-4">
        <Card title={`Saved searches (${searches.length})`}
          subtitle="Run a refresh to detect newly-posted matches and raise alerts."
          actions={<Button variant="ghost" onClick={refreshAll}>Refresh all</Button>}>
          {searchMsg && <div className="mb-3 text-sm text-[var(--accent)]">{searchMsg}</div>}
          {searches.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">None saved. Set filters above and click “Save this search”.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {searches.map(s => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-sm">{s.name}</div>
                    <div className="text-xs text-[var(--muted)]">{s.lastCheckedAt ? `last checked ${new Date(s.lastCheckedAt).toLocaleString()}` : 'never checked'}</div>
                  </div>
                  <button onClick={() => removeSearch(s.id)} className="text-xs text-[var(--muted)] hover:text-[var(--bad)]">delete</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {result && (
        <Card title={`Results (${result.jobs.length})`}
          subtitle={`queried ${result.meta.companiesQueried} companies · ${result.meta.fetched} fetched · ${result.meta.errors.length} errors`}
          actions={result.jobs.length > 0 && (
            <Button onClick={autoApplyAll} disabled={autoBusy}>
              {autoBusy ? 'Applying…' : `${policy === 'auto' ? 'Auto-apply & submit' : 'Auto-fill'} (${result.jobs.length})`}
            </Button>
          )}>
          {autoResult && (
            <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-sm">
              <div className="font-medium mb-1">Auto-apply run complete</div>
              <div className="flex flex-wrap gap-3 text-xs">
                <Pill tone="ok">{autoResult.submitted} submitted</Pill>
                <Pill tone="accent">{autoResult.applied} filled</Pill>
                <Pill tone="muted">{autoResult.drafted} drafted</Pill>
                <Pill tone="warn">{autoResult.skipped} skipped</Pill>
              </div>
              <p className="text-xs text-[var(--muted)] mt-2">See Pipeline for drafts and Alerts for the run summary.</p>
            </div>
          )}
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
