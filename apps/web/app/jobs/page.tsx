'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, Input, Field, PageHeader, ErrorNote, Pill } from '@/components/ui';
import { runTool, getSettings } from '@/lib/api';

const JOB_TINTS = ['var(--tint-butter)', 'var(--tint-sky)', 'var(--tint-mint)', 'var(--tint-lav)', 'var(--tint-blush)'];

type AutoApplySummary = { total: number; submitted: number; applied: number; drafted: number; skipped: number; results: { jobId: string; status: string; applicationId?: string; message?: string }[] };

type SavedSearch = { id: string; name: string; filters: Record<string, unknown>; source?: string; autoApply?: boolean; resumeId?: string; minFit?: number; weeklyCap?: number; autoSubmit?: boolean; lastCheckedAt?: string };

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
  const [mode, setMode] = useState<'web' | 'companies'>('web');
  const [pages, setPages] = useState(3);
  const [saveAutoApply, setSaveAutoApply] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchMsg, setWatchMsg] = useState('');
  const [autoRun, setAutoRun] = useState(false);
  const [resumes, setResumes] = useState<{ id: string; label: string }[]>([]);
  const [watchResumeId, setWatchResumeId] = useState<string>('');
  const [watchMinFit, setWatchMinFit] = useState<number>(0.6);
  const [watchCap, setWatchCap] = useState<string>('');        // '' = use global
  const [watchAutoSubmit, setWatchAutoSubmit] = useState<boolean>(false);

  async function runWatchNow() {
    setWatchBusy(true); setWatchMsg('');
    try {
      const r = await fetch('/api/watch', { method: 'POST' }).then(x => x.json());
      if (!r.ok) throw new Error(r.error);
      setWatchMsg(`${r.totalNew} new match(es), ${r.totalSubmitted} auto-submitted. (See Alerts / Pipeline.)`);
      await loadSearches();
    } catch (e) { setWatchMsg(`Error: ${(e as Error).message}`); }
    finally { setWatchBusy(false); }
  }

  async function toggleAuto(id: string, current: boolean) {
    await fetch('/api/searches', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'set-auto', id, autoApply: !current })
    });
    await loadSearches();
  }

  // Continuous watcher: while enabled and this tab is open, run every 10 min.
  useEffect(() => {
    if (!autoRun) return;
    const t = setInterval(() => { runWatchNow(); }, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [autoRun]);

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
  useEffect(() => {
    runTool<{ resumes: { id: string; label: string }[] }>('list_resumes', {})
      .then(r => setResumes(r.resumes ?? []))
      .catch(() => {});
  }, []);

  function currentFilters() {
    return {
      titleContains: title || undefined,
      locationContains: location || undefined,
      remoteOnly: remoteOnly || undefined,
      h1bSponsorOnly: h1bOnly || undefined
    };
  }

  async function saveSearch() {
    const name = (title || location || 'All roles') + (mode === 'web' ? ' · web' : '') + (saveAutoApply ? ' · auto' : '');
    await fetch('/api/searches', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name, filters: currentFilters(), source: mode, autoApply: saveAutoApply,
        resumeId: watchResumeId || undefined,
        minFit: watchMinFit,
        weeklyCap: watchCap === '' ? undefined : Number(watchCap),
        autoSubmit: watchAutoSubmit
      })
    });
    setSaveAutoApply(false);
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
    setBusy(true); setErr(''); setResult(null); setAutoResult(null);
    try {
      if (mode === 'web') {
        const r = await fetch('/api/search-roles', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: title || undefined, location: location || undefined, pages })
        }).then(x => x.json());
        if (!r.ok) throw new Error(r.error);
        setResult({ jobs: r.jobs, meta: { fetched: r.meta.fetched, afterFilters: r.meta.afterFilters, companiesQueried: r.meta.total, errors: [] } });
      } else {
        const r = await runTool<FetchResult>('fetch_jobs', {
          titleContains: title || undefined,
          locationContains: location || undefined,
          remoteOnly: remoteOnly || undefined,
          h1bSponsorOnly: h1bOnly || undefined,
          limit: 50
        });
        setResult(r);
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Jobs" subtitle="Search by role across thousands of companies (the open web), or just your watched ATS companies." />
      <Card title="Search">
        <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] p-1 text-sm">
          <button onClick={() => setMode('web')}
            className={`rounded-md px-3 py-1.5 ${mode === 'web' ? 'bg-[var(--accent)] text-[#0b0e14]' : 'text-[var(--muted)]'}`}>
            Across the web (role-based)
          </button>
          <button onClick={() => setMode('companies')}
            className={`rounded-md px-3 py-1.5 ${mode === 'companies' ? 'bg-[var(--accent)] text-[#0b0e14]' : 'text-[var(--muted)]'}`}>
            My ATS companies
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role / title contains"><Input placeholder="product manager" value={title} onChange={e => setTitle(e.target.value)} /></Field>
          <Field label="Location contains"><Input placeholder="New York" value={location} onChange={e => setLocation(e.target.value)} /></Field>
        </div>
        {mode === 'companies' ? (
          <div className="flex items-center gap-5 mb-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} /> Remote only</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={h1bOnly} onChange={e => setH1bOnly(e.target.checked)} /> H-1B sponsors only</label>
          </div>
        ) : (
          <div className="mb-4 text-sm flex items-center gap-3">
            <span className="text-[var(--muted)]">Depth</span>
            <input type="number" min={1} max={20} value={pages} onChange={e => setPages(Number(e.target.value))}
              className="w-20 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 outline-none" />
            <span className="text-[var(--muted)] text-xs">pages (~20 roles each) — more = more to apply to</span>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={search} disabled={busy}>{busy ? 'Searching live…' : 'Search jobs'}</Button>
          <Button variant="ghost" onClick={saveSearch}>Save as watch</Button>
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={saveAutoApply} onChange={e => setSaveAutoApply(e.target.checked)} /> auto-apply new matches
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap text-sm">
          <span className="text-xs text-[var(--muted)]">Watch settings →</span>
          <select
            value={watchResumeId}
            onChange={e => setWatchResumeId(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 outline-none"
            title="Résumé this watch tailors from"
          >
            <option value="">Auto-pick résumé</option>
            {resumes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-[var(--muted)]" title="Minimum fit to auto-apply">
            min-fit {watchMinFit.toFixed(2)}
            <input type="range" min={0} max={1} step={0.05}
              value={watchMinFit} onChange={e => setWatchMinFit(Number(e.target.value))} />
          </label>
          <input
            type="number" min={0} placeholder="cap (blank=global)"
            value={watchCap} onChange={e => setWatchCap(e.target.value)}
            className="w-36 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 outline-none"
            title="Per-watch weekly cap (0 = unlimited, blank = use global)"
          />
          <label className="flex items-center gap-1 text-[var(--muted)]" title="Submit automatically for this watch">
            <input type="checkbox" checked={watchAutoSubmit} onChange={e => setWatchAutoSubmit(e.target.checked)} />
            auto-submit
          </label>
        </div>
        <ErrorNote>{err}</ErrorNote>
      </Card>

      <div className="mt-4">
        <Card title={`Watches (${searches.length})`}
          subtitle="Each watch re-checks for newly-posted role matches and (if auto-apply is on) applies them for you."
          actions={
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} /> auto-run /10 min
              </label>
              <Button onClick={runWatchNow} disabled={watchBusy}>{watchBusy ? 'Watching…' : 'Run watch now'}</Button>
            </div>
          }>
          {(searchMsg || watchMsg) && <div className="mb-3 text-sm text-[var(--accent)]">{watchMsg || searchMsg}</div>}
          {searches.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No watches yet. Search a role above, then “Save as watch” (tick auto-apply to make it hands-off).</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {searches.map(s => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-sm flex items-center gap-2">
                      {s.name}
                      <Pill tone={s.source === 'web' ? 'accent' : 'muted'}>{s.source === 'web' ? 'open web' : 'ATS'}</Pill>
                      {s.autoApply && <Pill tone="ok">auto-apply</Pill>}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {s.resumeId ? 'résumé set' : 'auto-pick résumé'}
                      {typeof s.minFit === 'number' ? ` · min-fit ${s.minFit.toFixed(2)}` : ' · min-fit (global)'}
                      {typeof s.weeklyCap === 'number' ? ` · cap ${s.weeklyCap}` : ''}
                      {s.autoSubmit ? ' · auto-submit' : ''}
                    </div>
                    <div className="text-xs text-[var(--muted)]">{s.lastCheckedAt ? `last checked ${new Date(s.lastCheckedAt).toLocaleString()}` : 'never checked'}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggleAuto(s.id, Boolean(s.autoApply))} className="text-xs text-[var(--accent)]">
                      {s.autoApply ? 'turn off auto' : 'turn on auto'}
                    </button>
                    <button onClick={() => removeSearch(s.id)} className="text-xs text-[var(--muted)] hover:text-[var(--bad)]">delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {result && (
        <Card title={`Results (${result.jobs.length})`}
          subtitle={mode === 'web'
            ? `${result.jobs.length} role matches · ${result.meta.companiesQueried.toLocaleString()} open roles indexed across the web`
            : `queried ${result.meta.companiesQueried} companies · ${result.meta.fetched} fetched · ${result.meta.errors.length} errors`}
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.jobs.map((j, i) => (
                <div key={j.id}
                  className="flex flex-col rounded-2xl border border-[var(--border)] p-4 shadow-[var(--shadow-sm)] transition-transform hover:-translate-y-0.5"
                  style={{ background: JOB_TINTS[i % JOB_TINTS.length] }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[12px] text-[var(--muted)]">
                      {j.location ?? 'Location N/A'}{j.locationType ? ` · ${j.locationType}` : ''}
                    </div>
                    {typeof j.h1bConfidence === 'number' && j.h1bConfidence >= 0.5 && (
                      <Pill tone="ok">H‑1B</Pill>
                    )}
                  </div>
                  <a href={j.url} target="_blank" rel="noreferrer"
                    className="mt-2.5 font-display text-[16px] font-semibold leading-tight hover:underline">
                    {j.title}
                  </a>
                  <div className="mt-1 text-[13px] text-[var(--muted)]">{j.company}</div>
                  <div className="mt-auto flex items-center gap-2 pt-4">
                    <Button size="sm" onClick={() => draft(j.id)} disabled={drafting === j.id}>
                      {drafting === j.id ? 'Drafting…' : 'Apply →'}
                    </Button>
                    <a href={j.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">open ↗</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
