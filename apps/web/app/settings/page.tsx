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

  const [answers, setAnswers] = useState<Array<{ id: string; label: string; answer: string }>>([]);
  const [ansLabel, setAnsLabel] = useState('');
  const [ansAnswer, setAnsAnswer] = useState('');
  function loadAnswers() {
    fetch('/api/answers').then(r => r.json()).then(d => { if (d.ok) setAnswers(d.answers); }).catch(() => {});
  }
  useEffect(() => { loadAnswers(); }, []);
  async function addAnswerEntry() {
    const r = await fetch('/api/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: ansLabel, answer: ansAnswer }) }).then(x => x.json());
    if (r.ok) { setAnsLabel(''); setAnsAnswer(''); setAnswers(r.answers); }
  }
  async function loadAnswerDefaults() {
    const r = await fetch('/api/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'load-defaults' }) }).then(x => x.json());
    if (r.ok) setAnswers(r.answers);
  }
  async function deleteAnswerEntry(id: string) {
    await fetch(`/api/answers?id=${id}`, { method: 'DELETE' });
    loadAnswers();
  }

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

  // Email inbox (verification codes)
  const [emailProvider, setEmailProvider] = useState<'gmail' | 'outlook' | 'icloud' | 'custom'>('gmail');
  const [emailAddress, setEmailAddress] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailHost, setEmailHost] = useState('');
  const [emailPort, setEmailPort] = useState(993);
  const [emailSecure, setEmailSecure] = useState(true);
  const [emailHasPassword, setEmailHasPassword] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');

  function loadEmailAccount() {
    fetch('/api/email-account').then(r => r.json()).then(d => {
      if (d.ok && d.account) {
        const a = d.account as { provider: string; address: string; hasPassword: boolean };
        if (a.provider === 'gmail' || a.provider === 'outlook' || a.provider === 'icloud' || a.provider === 'custom') setEmailProvider(a.provider);
        setEmailAddress(a.address);
        setEmailHasPassword(Boolean(a.hasPassword));
      }
    }).catch(() => {});
  }
  useEffect(() => { loadEmailAccount(); }, []);

  function emailBody(test: boolean) {
    return {
      provider: emailProvider,
      address: emailAddress,
      ...(emailPassword ? { appPassword: emailPassword } : {}),
      ...(emailProvider === 'custom' ? { host: emailHost, port: emailPort, secure: emailSecure } : {}),
      ...(test ? { test: true } : {})
    };
  }

  async function saveEmailAccount() {
    setEmailSaving(true); setEmailMsg('');
    try {
      const r = await fetch('/api/email-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(emailBody(false)) }).then(x => x.json());
      if (!r.ok) throw new Error(r.error);
      setEmailMsg('Saved.'); setEmailPassword(''); loadEmailAccount();
    } catch (e) { setEmailMsg(`Error: ${(e as Error).message}`); }
    finally { setEmailSaving(false); }
  }

  async function testEmailConnection() {
    setEmailTesting(true); setEmailMsg('');
    try {
      const r = await fetch('/api/email-account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(emailBody(true)) }).then(x => x.json());
      setEmailMsg(r.ok ? 'Connection OK.' : `Failed: ${r.error}`);
    } catch (e) { setEmailMsg(`Error: ${(e as Error).message}`); }
    finally { setEmailTesting(false); }
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
          <Field label="Weekly application cap — set 0 for UNLIMITED (hands-off high volume)">
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

        <Card title={`Answer bank (${answers.length})`}
          subtitle="Your canonical answers to common application questions (work auth, EEO, salary, “how did you hear”). Matched to dropdowns, radios, checkboxes, and text questions; the AI fills anything not here."
          actions={<Button variant="ghost" onClick={loadAnswerDefaults}>Load common defaults</Button>}>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-3">
            <Input placeholder='question keyword (e.g. "sponsorship")' value={ansLabel} onChange={e => setAnsLabel(e.target.value)} />
            <Input placeholder='your answer (e.g. "No")' value={ansAnswer} onChange={e => setAnsAnswer(e.target.value)} />
            <Button onClick={addAnswerEntry} disabled={!ansLabel.trim() || !ansAnswer.trim()}>Add</Button>
          </div>
          {answers.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">None yet. Click “Load common defaults” for safe EEO/work-auth answers, then add your own.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {answers.map(a => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span><span className="text-[var(--muted)]">{a.label}</span> → {a.answer}</span>
                  <button onClick={() => deleteAnswerEntry(a.id)} className="text-xs text-[var(--muted)] hover:text-[var(--bad)]">delete</button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Email inbox (for verification codes)" subtitle="Lets the auto-apply flow read one-time verification codes sent during sign-up/apply.">
          <div className="mb-2">{emailHasPassword ? <Pill tone="ok">inbox configured</Pill> : <Pill tone="warn">no inbox set</Pill>}</div>
          <Field label="Provider">
            <select value={emailProvider} onChange={e => setEmailProvider(e.target.value as 'gmail' | 'outlook' | 'icloud' | 'custom')}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
              <option value="gmail">gmail</option>
              <option value="outlook">outlook</option>
              <option value="icloud">icloud</option>
              <option value="custom">custom</option>
            </select>
          </Field>
          <Field label="Email address">
            <Input type="email" placeholder="you@example.com" value={emailAddress} onChange={e => setEmailAddress(e.target.value)} />
          </Field>
          <Field label="App password">
            <Input type="password" placeholder={emailHasPassword ? '••••• (saved)' : 'app password'} value={emailPassword} onChange={e => setEmailPassword(e.target.value)} />
          </Field>
          {emailProvider === 'custom' && (
            <>
              <Field label="IMAP host">
                <Input placeholder="imap.example.com" value={emailHost} onChange={e => setEmailHost(e.target.value)} />
              </Field>
              <Field label="Port">
                <Input type="number" min={1} value={emailPort} onChange={e => setEmailPort(Number(e.target.value))} />
              </Field>
              <Field label="Secure (TLS)">
                <input type="checkbox" checked={emailSecure} onChange={e => setEmailSecure(e.target.checked)} />
              </Field>
              {!emailSecure && (
                <p className="text-xs text-[var(--danger,#c00)]">⚠️ With TLS off, your app password is sent in clear text — only use this on a trusted network, or leave Secure (TLS) on.</p>
              )}
            </>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={saveEmailAccount} disabled={emailSaving || !emailAddress.trim()}>{emailSaving ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" onClick={testEmailConnection} disabled={emailTesting || !emailAddress.trim()}>{emailTesting ? 'Testing…' : 'Test connection'}</Button>
            {emailMsg && <span className="text-sm text-[var(--muted)]">{emailMsg}</span>}
          </div>
          <p className="text-xs text-[var(--muted)] mt-2">Gmail/iCloud need an app password, not your login password — generate one in your account&apos;s security settings.</p>
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
