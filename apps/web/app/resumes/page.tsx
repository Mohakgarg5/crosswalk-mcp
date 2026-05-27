'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Input, Textarea, Field, PageHeader, ErrorNote, Pill } from '@/components/ui';
import { runTool } from '@/lib/api';

type Resume = { id: string; label: string; createdAt?: string };

export default function ResumesPage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await runTool<{ resumes: Resume[] }>('list_resumes', {});
      setResumes(r.resumes ?? []);
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true); setErr('');
    try {
      await runTool('add_resume', { label, rawText: text });
      setLabel(''); setText(''); await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Résumés" subtitle="Paste a résumé; Claude structures it. Store several versions and tailor per job." />
      <div className="space-y-4">
        <Card title="Add a résumé">
          <Field label="Label"><Input placeholder="Generic PM" value={label} onChange={e => setLabel(e.target.value)} /></Field>
          <Field label="Résumé text"><Textarea rows={8} placeholder="Paste your résumé text here…" value={text} onChange={e => setText(e.target.value)} /></Field>
          <div className="flex items-center gap-3">
            <Button onClick={add} disabled={busy || !label.trim() || !text.trim()}>{busy ? 'Parsing…' : 'Add résumé'}</Button>
            <span className="text-xs text-[var(--muted)]">Uses AI — set an API key in Settings.</span>
          </div>
          <ErrorNote>{err}</ErrorNote>
        </Card>

        <Card title={`Stored résumés (${resumes.length})`}>
          {resumes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">None yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {resumes.map(r => (
                <li key={r.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm">{r.label}</span>
                  <Pill>{r.id.slice(0, 8)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
