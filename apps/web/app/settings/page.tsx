'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Input, Textarea, Field, PageHeader, Pill, ErrorNote } from '@/components/ui';
import { getSettings, saveSettings, type Settings } from '@/lib/api';

const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [weeklyCap, setWeeklyCap] = useState(10);
  const [submitPolicy, setSubmitPolicy] = useState<'review' | 'auto'>('review');
  const [applyMaxSteps, setApplyMaxSteps] = useState(1);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  const [companies, setCompanies] = useState<{ total: number; byAts: Record<string, number> } | null>(null);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);

  function loadCompanies() {
    fetch('/api/companies').then(r => r.json()).then(d => { if (d.ok) setCompanies({ total: d.total, byAts: d.byAts }); }).catch(() => {});
  }
  useEffect(() => { loadCompanies(); }, []);

  async function importCompanies() {
    setImporting(true); setImportMsg('');
    try {
      const entries = JSON.parse(importText);
      const r = await fetch('/api/companies', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries })
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error);
      setImportMsg(`Imported ${r.imported}, skipped ${r.skipped.length}. Registry now ${r.total} companies.`);
      setImportText(''); loadCompanies();
    } catch (e) { setImportMsg(`Error: ${(e as Error).message}`); }
    finally { setImporting(false); }
  }

  useEffect(() => {
    getSettings().then(v => {
      setS(v);
      setModel(v.config.model);
      setWeeklyCap(v.config.weeklyCap);
      setSubmitPolicy(v.config.submitPolicy);
      setApplyMaxSteps(v.config.applyMaxSteps ?? 1);
    }).catch(e => setErr(String(e)));
  }, []);

  async function save() {
    setSaving(true); setErr(''); setSaved(false);
    try {
      const next = await saveSettings({ apiKey: apiKey || undefined, model, weeklyCap, submitPolicy, applyMaxSteps });
      setS(next); setApiKey(''); setSaved(true);
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Stored locally in ~/.crosswalk. The API key never leaves your machine except to Anthropic." />
      <div className="space-y-4">
        <Card title="Anthropic API key" subtitle="Required for AI features (tailoring, fit, cover letters). Discovery & tracking work without it.">
          <div className="mb-2">{s?.hasKey ? <Pill tone="ok">key configured</Pill> : <Pill tone="warn">no key set</Pill>}</div>
          <Field label="API key">
            <Input type="password" placeholder="sk-ant-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
          </Field>
          <p className="text-xs text-[var(--muted)]">Leave blank to keep the existing key. Or set <code>ANTHROPIC_API_KEY</code> in your environment.</p>
        </Card>

        <Card title="Model & policy">
          <Field label="Model">
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
              {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Weekly application cap (anti-spam guardrail)">
            <Input type="number" min={0} value={weeklyCap} onChange={e => setWeeklyCap(Number(e.target.value))} />
          </Field>
          <Field label="Default submit policy">
            <select value={submitPolicy} onChange={e => setSubmitPolicy(e.target.value as 'review' | 'auto')}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
              <option value="review">review then submit (safe)</option>
              <option value="auto">auto-submit (opt-in)</option>
            </select>
          </Field>
        </Card>

        <Card title={`Open Job Graph — companies (${companies?.total ?? '…'})`}
          subtitle="Per-company ATS coverage. Grow it to thousands via bulk import. (Role search across the web doesn't need this.)">
          {companies && (
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(companies.byAts).map(([ats, n]) => <Pill key={ats}>{ats}: {n}</Pill>)}
            </div>
          )}
          <Field label='Bulk import (JSON array of {"name","ats","slug","h1bConfidence?"})'>
            <Textarea rows={4} placeholder='[{"name":"Stripe","ats":"greenhouse","slug":"stripe"}, {"name":"Brex","ats":"lever","slug":"brex"}]'
              value={importText} onChange={e => setImportText(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3">
            <Button onClick={importCompanies} disabled={importing || !importText.trim()}>{importing ? 'Importing…' : 'Import companies'}</Button>
            {importMsg && <span className="text-sm text-[var(--muted)]">{importMsg}</span>}
          </div>
          <p className="text-xs text-[var(--muted)] mt-2">Valid ATSes: greenhouse, lever, ashby, workable, smartrecruiters, bamboohr, recruitee, personio, workday, icims.</p>
        </Card>

        <Card title="Autonomous apply (browser)" subtitle="How “apply on your behalf” works, and how to unlock login-walled ATSes.">
          <p className="text-sm text-[var(--muted)] mb-3">
            With <strong>submit policy = auto</strong>, the Jobs page “Auto-apply & submit” button tailors a
            résumé + cover letter for every result and submits it for you (respecting your weekly cap).
          </p>
          <Field label="Multi-step wizard depth (max pages to navigate per application)">
            <Input type="number" min={1} max={15} value={applyMaxSteps} onChange={e => setApplyMaxSteps(Number(e.target.value))} />
          </Field>
          <p className="text-xs text-[var(--muted)] mb-3">1 = single-page forms only. Set ~8 to navigate multi-page wizards (Workday-style): fill → Next → … → Submit on the last page.</p>
          <p className="text-sm text-[var(--muted)] mb-2">To apply to sites that require a login (Workday, etc.), run the GUI with a persistent browser profile so you sign in once:</p>
          <pre className="text-xs bg-[var(--panel-2)] border border-[var(--border)] rounded-lg p-3 whitespace-pre-wrap">{`# one-time: install the browser runtime
npx crosswalk-mcp install-browser

# run the GUI with a visible, persistent browser profile
CROSSWALK_BROWSER_PROFILE=~/.crosswalk/chrome \\
CROSSWALK_BROWSER_HEADED=1 npm run gui`}</pre>
          <p className="text-xs text-[var(--muted)] mt-2">Log into your ATS accounts once in that window; sessions persist for future auto-applies.</p>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
          {saved && <span className="text-sm text-[var(--ok)]">Saved.</span>}
        </div>
        <ErrorNote>{err}</ErrorNote>
      </div>
    </>
  );
}
