'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Button, MatchRing, Pill, Tabs } from '@/components/ui';
import { getSettings, runTool, type Settings } from '@/lib/api';

type Item = {
  applicationId: string; status: string; jobTitle: string;
  company: string; deepLink: string; createdAt: string; submittedAt?: string;
};

type Match = {
  jobId: string; title: string; company: string; location?: string;
  url: string; postedAt?: string; score: number; topStrengths: string[];
};

const STATUS_TONE: Record<string, 'muted' | 'ok' | 'warn' | 'bad' | 'info'> = {
  draft: 'muted', submitted: 'info', interviewing: 'warn', rejected: 'bad', offer: 'ok'
};
const TINTS = ['var(--tint-butter)', 'var(--tint-sky)', 'var(--tint-mint)', 'var(--tint-lav)', 'var(--tint-blush)'];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Dashboard() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [chips, setChips] = useState<string[]>(['product manager']);
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<string>('all');
  const [setUp, setSetUp] = useState<boolean | null>(null); // profile + résumé exist
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [scoring, setScoring] = useState(false);
  const [matchErr, setMatchErr] = useState('');

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
    runTool<{ items?: Item[] }>('list_pipeline', {})
      .then(r => setItems(r.items ?? []))
      .catch(() => setItems([]));
    Promise.all([
      fetch('/api/profile').then(r => r.json()),
      runTool<{ resumes?: unknown[] }>('list_resumes', {})
    ])
      .then(([p, r]) => {
        const prof = (p?.profile ?? {}) as Record<string, unknown>;
        setSetUp(Boolean(prof.name || prof.email) && (r.resumes?.length ?? 0) > 0);
      })
      .catch(() => setSetUp(false));
    // Cached scores only — free and instant. Fresh scoring is the button below.
    runTool<{ matches: Match[] }>('top_matches', { limit: 4 })
      .then(r => setMatches(r.matches))
      .catch(() => setMatches([]));
  }, []);

  // "Find new matches" must actually pull NEW jobs off the web first — scoring
  // alone only re-ranks the cache, so a stale cache yields nothing new (that's
  // the "I scored twice and saw no new jobs" trap). Fetch for the user's roles,
  // THEN score the freshly-fetched ones.
  async function scoreMatches() {
    setScoring(true); setMatchErr('');
    try {
      const queries = chips.length ? chips : ['product manager'];
      let fetched = 0;
      for (const q of queries) {
        const sr = await fetch('/api/search-roles', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: q, pages: 3 })
        }).then(x => x.json()).catch(() => null);
        if (sr?.ok) fetched += sr.meta?.fetched ?? sr.jobs?.length ?? 0;
      }
      const r = await runTool<{ matches: Match[]; scored: number }>('top_matches', { limit: 4, scoreMissing: true, maxToScore: 12 });
      setMatches(r.matches);
      if ((r.matches?.length ?? 0) === 0) {
        setMatchErr(fetched > 0
          ? `Fetched ${fetched} jobs but none scored high enough yet — try a broader role, or “Browse all jobs”.`
          : 'No new jobs found for those roles right now. Try a different/broader role above.');
      }
    } catch (e) { setMatchErr((e as Error).message); }
    finally { setScoring(false); }
  }

  const [applying, setApplying] = useState(''); // jobId being applied to
  async function applyTo(jobId: string) {
    setApplying(jobId); setMatchErr('');
    try {
      const r = await fetch('/api/auto-apply', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobIds: [jobId] })
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error);
      const outcome = r.summary?.results?.[0];
      if (outcome?.applicationId) { router.push(`/applications/${outcome.applicationId}`); return; }
      throw new Error(outcome?.message || 'could not start the application');
    } catch (e) { setMatchErr((e as Error).message); }
    finally { setApplying(''); }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items?.length ?? 0 };
    for (const it of items ?? []) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);

  const inFlight = (counts.submitted ?? 0) + (counts.interviewing ?? 0);
  const visible = (items ?? []).filter(it => tab === 'all' || it.status === tab);

  function addChip() {
    const v = draft.trim();
    if (v && !chips.includes(v)) setChips([...chips, v]);
    setDraft('');
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addChip(); }
    else if (e.key === 'Backspace' && !draft && chips.length) setChips(chips.slice(0, -1));
  }

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'submitted', label: 'Submitted', count: counts.submitted ?? 0 },
    { key: 'draft', label: 'Drafts', count: counts.draft ?? 0 },
    { key: 'interviewing', label: 'Interviewing', count: counts.interviewing ?? 0 },
    { key: 'offer', label: 'Offers', count: counts.offer ?? 0 }
  ];

  return (
    <div className="space-y-6">
      {/* Hero + search */}
      <section className="cw-rise rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-sm)] overflow-hidden">
        <div className="relative px-6 pt-6 pb-5">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: 'radial-gradient(600px 200px at 90% -40%, rgba(31,77,56,0.10), transparent 60%)' }}
          />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[30px] font-semibold tracking-tight leading-none">
                {greeting()}.
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {items === null ? 'Loading your pipeline…'
                  : items.length === 0 ? 'No applications yet — pick a role and let Crosswalk start applying.'
                  : <>You have <span className="text-[var(--text)] font-medium">{inFlight}</span> application{inFlight === 1 ? '' : 's'} in flight.</>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {settings && (settings.hasKey
                ? <Pill tone="ok" dot>AI ready · {settings.config.model.replace('claude-', '')}</Pill>
                : <Pill tone="warn" dot>No API key</Pill>)}
            </div>
          </div>

          {/* Role search with chips */}
          <div className="relative mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]/60 px-3 py-2.5">
            <svg className="ml-1 text-[var(--faint)]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            {chips.map(c => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1 text-[13px] font-medium shadow-[var(--shadow-sm)]">
                {c}
                <button onClick={() => setChips(chips.filter(x => x !== c))} className="text-[var(--faint)] hover:text-[var(--bad)]">×</button>
              </span>
            ))}
            <input
              value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
              placeholder={chips.length ? 'Add another role…' : 'Search a role, e.g. product manager'}
              className="flex-1 min-w-40 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--faint)]"
            />
            <Button size="sm" onClick={() => router.push('/jobs')}>Search jobs →</Button>
          </div>
        </div>
      </section>

      {/* Stat strip */}
      <section className="cw-rise grid grid-cols-2 gap-4 sm:grid-cols-4" style={{ animationDelay: '60ms' }}>
        <Stat label="In pipeline" value={items === null ? '—' : String(counts.all)} hint="total applications" />
        <Stat label="In flight" value={items === null ? '—' : String(inFlight)} hint="submitted · interviewing" tone="info" />
        <Stat label="Offers" value={items === null ? '—' : String(counts.offer ?? 0)} hint="🎉 keep going" tone="ok" />
        <Stat label="Weekly cap" value={settings ? String(settings.config.weeklyCap || '∞') : '—'} hint="anti-spam guardrail" />
      </section>

      {/* Top matches */}
      <section className="cw-rise" style={{ animationDelay: '120ms' }}>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-[19px] font-semibold">Top matches</h2>
          <div className="flex items-center gap-4">
            {matches && matches.length > 0 && (
              <button onClick={scoreMatches} disabled={scoring}
                className="text-[13px] font-medium text-[var(--accent)] hover:underline disabled:opacity-50">
                {scoring ? 'Finding new jobs…' : '↻ Find new matches'}
              </button>
            )}
            <Link href="/jobs" className="text-[13px] font-medium text-[var(--accent)] hover:underline">Browse all jobs →</Link>
          </div>
        </div>
        {matchErr && <div className="mb-3 rounded-xl border border-[var(--bad)]/30 bg-[var(--bad-bg)] px-3.5 py-2.5 text-sm text-[var(--bad)]">{matchErr}</div>}
        {matches && matches.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {matches.map((m, i) => (
              <div key={m.jobId}
                className="flex flex-col rounded-2xl border border-[var(--border)] p-4 shadow-[var(--shadow-sm)] transition-transform hover:-translate-y-0.5"
                style={{ background: TINTS[i % TINTS.length] }}>
                <div className="flex items-start justify-between">
                  <div className="text-[12px] text-[var(--muted)]">
                    {m.location ?? '—'}
                    {m.postedAt && <span className="ml-1.5 text-[var(--faint)]">· {timeAgo(m.postedAt)}</span>}
                  </div>
                  <MatchRing value={Math.round(m.score * 100)} />
                </div>
                <a href={m.url} target="_blank" rel="noreferrer"
                  className="mt-3 font-display text-[17px] font-semibold leading-tight hover:underline">
                  {m.title}
                </a>
                <div className="mt-1 text-[13px] text-[var(--muted)]">{m.company}</div>
                {m.topStrengths.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {m.topStrengths.slice(0, 2).map(t => (
                      <span key={t} className="rounded-full bg-[var(--panel)]/70 px-2 py-0.5 text-[11px] text-[var(--muted)]">{t}</span>
                    ))}
                  </div>
                )}
                <div className="mt-auto pt-4">
                  <Button size="sm" onClick={() => applyTo(m.jobId)} disabled={!!applying}>
                    {applying === m.jobId ? 'Applying…' : 'Apply →'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyMatches
            hasKey={!!settings?.hasKey}
            setUp={!!setUp}
            scoring={scoring}
            onScore={scoreMatches}
            canScore={!!setUp && (items !== null)}
          />
        )}
      </section>

      {/* All applications */}
      <section className="cw-rise" style={{ animationDelay: '180ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[19px] font-semibold">All applications</h2>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-sm)] overflow-hidden">
          {items === null ? (
            <div className="p-10 text-center text-sm text-[var(--muted)]">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--panel-2)] text-[var(--faint)]">▦</div>
              <p className="text-sm font-medium">No applications {tab === 'all' ? 'yet' : `in “${tab}”`}</p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">Draft one from a job and it shows up here with live status.</p>
              <div className="mt-4"><Link href="/jobs"><Button size="sm" variant="ghost">Find jobs</Button></Link></div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--faint)]">
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Applied</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map(it => (
                  <tr key={it.applicationId} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]/50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={it.company} size={32} />
                        <span className="font-medium">{it.company}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[var(--muted)]">{it.jobTitle}</td>
                    <td className="px-5 py-3"><Pill tone={STATUS_TONE[it.status] ?? 'muted'} dot>{it.status}</Pill></td>
                    <td className="px-5 py-3 text-[var(--muted)]">{timeAgo(it.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link href={`/applications/${it.applicationId}`} className="text-[13px] font-medium text-[var(--accent)] hover:underline">open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'ok' | 'info' }) {
  const accent = tone === 'ok' ? 'text-[var(--ok)]' : tone === 'info' ? 'text-[var(--info)]' : 'text-[var(--text)]';
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-[var(--shadow-sm)]">
      <div className="text-[12px] font-medium text-[var(--muted)]">{label}</div>
      <div className={`mt-1 font-display text-[28px] font-semibold leading-none ${accent}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}

/* Illustrative match cards shown only while there are no real scored matches.
   Before setup the CTA sends you to onboarding; once profile + résumé exist
   it scores your fetched jobs right here (or sends you to search if none). */
function EmptyMatches({ hasKey, setUp, scoring, onScore, canScore }: {
  hasKey: boolean; setUp: boolean; scoring: boolean; onScore: () => void; canScore: boolean;
}) {
  const samples = [
    { role: 'Senior Product Manager', loc: 'Remote', match: 73, tags: ['product', 'b2b saas'] },
    { role: 'AI Product Manager', loc: 'New York, NY', match: 71, tags: ['llm', '0→1'] },
    { role: 'Program Manager', loc: 'Austin, TX', match: 68, tags: ['ops', 'cross-fn'] },
    { role: 'Group PM', loc: 'Mountain View, CA', match: 66, tags: ['platform'] }
  ];
  return (
    <div className="relative">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {samples.map((s, i) => (
          <div key={i} className="rounded-2xl border border-[var(--border)] p-4 shadow-[var(--shadow-sm)]" style={{ background: TINTS[i % TINTS.length] }}>
            <div className="flex items-start justify-between">
              <div className="text-[12px] text-[var(--muted)]">{s.loc}</div>
              <MatchRing value={s.match} />
            </div>
            <div className="mt-3 font-display text-[17px] font-semibold leading-tight">{s.role}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.tags.map(t => <span key={t} className="rounded-full bg-[var(--panel)]/70 px-2 py-0.5 text-[11px] text-[var(--muted)]">{t}</span>)}
            </div>
          </div>
        ))}
      </div>
      {/* Soft overlay CTA — the cards above are a preview of the real thing */}
      <div className="absolute inset-0 grid place-items-center rounded-2xl bg-[var(--bg)]/55 backdrop-blur-[2px]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-6 py-5 text-center shadow-[var(--shadow-lg)]">
          {setUp ? (
            <>
              <p className="font-display text-[17px] font-semibold">
                {canScore ? 'Score your jobs to see real matches' : 'You’re all set — find roles to score'}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-[13px] text-[var(--muted)]">
                Crosswalk rates each fetched job against your résumé (a few cents per batch).
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {canScore && (
                  <Button size="sm" onClick={onScore} disabled={scoring}>
                    {scoring ? 'Finding new jobs…' : 'Find new matches'}
                  </Button>
                )}
                <Link href="/jobs"><Button size="sm" variant="ghost">Search jobs →</Button></Link>
              </div>
            </>
          ) : (
            <>
              <p className="font-display text-[17px] font-semibold">Set up to see your real matches</p>
              <p className="mx-auto mt-1 max-w-xs text-[13px] text-[var(--muted)]">
                Add a profile and résumé{hasKey ? '' : ', plus an API key,'} and Crosswalk scores live roles for you.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Link href="/onboarding"><Button size="sm">Get set up — 2 min</Button></Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
