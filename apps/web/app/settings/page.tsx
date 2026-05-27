'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Input, Field, PageHeader, Pill, ErrorNote } from '@/components/ui';
import { getSettings, saveSettings, type Settings } from '@/lib/api';

const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [weeklyCap, setWeeklyCap] = useState(10);
  const [submitPolicy, setSubmitPolicy] = useState<'review' | 'auto'>('review');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(v => {
      setS(v);
      setModel(v.config.model);
      setWeeklyCap(v.config.weeklyCap);
      setSubmitPolicy(v.config.submitPolicy);
    }).catch(e => setErr(String(e)));
  }, []);

  async function save() {
    setSaving(true); setErr(''); setSaved(false);
    try {
      const next = await saveSettings({ apiKey: apiKey || undefined, model, weeklyCap, submitPolicy });
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

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
          {saved && <span className="text-sm text-[var(--ok)]">Saved.</span>}
        </div>
        <ErrorNote>{err}</ErrorNote>
      </div>
    </>
  );
}
