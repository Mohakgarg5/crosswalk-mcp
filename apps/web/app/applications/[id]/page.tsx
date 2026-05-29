'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, Button, Textarea, PageHeader, Pill, ErrorNote } from '@/components/ui';
import { runTool } from '@/lib/api';

type Application = {
  id: string; jobId: string; resumeId: string; status: string;
  fitScore?: number; fitNarrativeMd?: string;
  tailoredResumeMd: string; coverLetterMd: string;
  answerPack: Record<string, string>; deepLink: string;
  createdAt: string; submittedAt?: string;
};
type Event = { id: string; kind: string; payloadJson?: string; payload?: unknown; at: string };
type Preview = { screenshotPngBase64: string; resolvedUrl: string; title: string; filled?: string[]; skipped?: string[]; submitted?: boolean };

const STATUSES = ['draft', 'submitted', 'interviewing', 'rejected', 'offer'];
const TONE: Record<string, 'muted' | 'ok' | 'warn' | 'bad' | 'accent'> = {
  draft: 'muted', submitted: 'accent', interviewing: 'warn', rejected: 'bad', offer: 'ok'
};

function downloadBase64(b64: string, filename: string, mime: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  triggerDownload(new Blob([arr], { type: mime }), filename);
}
function downloadText(text: string, filename: string, mime: string) {
  triggerDownload(new Blob([text], { type: mime }), filename);
}
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<Application | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const res = await fetch(`/api/application/${id}`);
    const data = await res.json();
    if (data.ok) { setApp(data.application); setEvents(data.events ?? []); }
    else setErr(data.error);
  }
  useEffect(() => { load().catch(e => setErr(String(e))); }, [id]);

  async function act<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(name); setErr('');
    try { return await fn(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); }
  }

  async function download(format: 'docx' | 'html') {
    if (!app) return;
    await act(`download-${format}`, async () => {
      const r = await runTool<{ docxBase64?: string; html?: string }>('tailor_resume', { jobId: app.jobId, resumeId: app.resumeId, format });
      if (format === 'docx' && r.docxBase64) downloadBase64(r.docxBase64, 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (format === 'html' && r.html) downloadText(r.html, 'resume.html', 'text/html');
    });
  }

  async function doPreview() {
    if (!app) return;
    const r = await act('preview', () => runTool<Preview>('preview_application', { applicationId: app.id }));
    if (r) setPreview(r);
  }

  async function doApply(submit: boolean) {
    if (!app) return;
    if (submit && !confirm('Auto-fill AND submit this application? This sends it for real.')) return;
    const r = await act('apply', () => runTool<Preview>('apply_application', { applicationId: app.id, submit }));
    if (r) { setPreview(r); await load(); }
  }

  async function doScoreFit() {
    if (!app) return;
    await act('score-fit', async () => {
      await runTool('explain_fit', { jobId: app.jobId, resumeId: app.resumeId });
      await load();
    });
  }

  async function changeStatus(status: string) {
    if (!app) return;
    await act('status', () => runTool('set_status', { applicationId: app.id, status }));
    await load();
  }

  async function addNote() {
    if (!app || !note.trim()) return;
    await act('note', () => runTool('add_note', { applicationId: app.id, text: note }));
    setNote(''); await load();
  }

  if (err && !app) return <><PageHeader title="Application" /><ErrorNote>{err}</ErrorNote><div className="mt-4"><Link href="/pipeline" className="text-[var(--accent)]">← Pipeline</Link></div></>;
  if (!app) return <PageHeader title="Application" subtitle="Loading…" />;

  return (
    <>
      <div className="mb-2"><Link href="/pipeline" className="text-sm text-[var(--accent)]">← Pipeline</Link></div>
      <PageHeader
        title="Application"
        subtitle={app.id}
        actions={<a href={app.deepLink} target="_blank" rel="noreferrer" className="text-sm text-[var(--accent)]">open job ↗</a>}
      />
      <ErrorNote>{err}</ErrorNote>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Status">
          <div className="mb-3"><Pill tone={TONE[app.status] ?? 'muted'}>{app.status}</Pill></div>
          <select value={app.status} onChange={e => changeStatus(e.target.value)} disabled={busy === 'status'}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {app.submittedAt && <div className="text-xs text-[var(--muted)] mt-2">submitted {new Date(app.submittedAt).toLocaleString()}</div>}
        </Card>
        <Card title="Fit">
          {typeof app.fitScore === 'number'
            ? <div className="text-3xl font-semibold">{app.fitScore.toFixed(2)}</div>
            : <div className="text-[var(--muted)] text-sm">not scored</div>}
        </Card>
        <Card title="Export">
          <div className="flex flex-col gap-2">
            <Button variant="ghost" onClick={() => download('docx')} disabled={busy === 'download-docx'}>{busy === 'download-docx' ? '…' : 'Download résumé .docx'}</Button>
            <Button variant="ghost" onClick={() => download('html')} disabled={busy === 'download-html'}>{busy === 'download-html' ? '…' : 'Download résumé .html'}</Button>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Card title="Tailored résumé"><pre className="text-xs whitespace-pre-wrap break-words max-h-96 overflow-auto">{app.tailoredResumeMd}</pre></Card>
        <Card title="Cover letter"><pre className="text-xs whitespace-pre-wrap break-words max-h-96 overflow-auto">{app.coverLetterMd}</pre></Card>
      </div>

      {app.fitNarrativeMd && (
        <div className="mt-4"><Card title="Fit narrative"><pre className="text-xs whitespace-pre-wrap break-words">{app.fitNarrativeMd}</pre></Card></div>
      )}

      <div className="mt-4">
        <Card title="Auto-fill & apply" subtitle="Opens the application form in a local browser. Review before submitting.">
          <div className="flex flex-wrap gap-2 mb-3">
            <Button variant="ghost" onClick={doPreview} disabled={!!busy}>{busy === 'preview' ? 'Loading…' : 'Preview form'}</Button>
            <Button variant="ghost" onClick={() => doApply(false)} disabled={!!busy}>{busy === 'apply' ? 'Filling…' : 'Auto-fill (no submit)'}</Button>
            <Button onClick={() => doApply(true)} disabled={!!busy}>Auto-fill & submit</Button>
          </div>
          <p className="text-xs text-[var(--muted)] mb-3">Requires the browser runtime: <code>npx crosswalk-mcp install-browser</code>.</p>
          {preview && (
            <div>
              <div className="text-xs text-[var(--muted)] mb-2">{preview.title} — {preview.resolvedUrl}
                {preview.filled && <> · filled: {preview.filled.join(', ') || 'none'} · skipped: {preview.skipped?.join(', ') || 'none'}{preview.submitted ? ' · SUBMITTED' : ''}</>}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="form preview" src={`data:image/png;base64,${preview.screenshotPngBase64}`} className="rounded-lg border border-[var(--border)] w-full" />
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Notes & history">
          <div className="flex gap-2 mb-4">
            <Textarea rows={1} placeholder="Add a note (e.g. recruiter emailed back)" value={note} onChange={e => setNote(e.target.value)} />
            <Button onClick={addNote} disabled={busy === 'note' || !note.trim()}>Add</Button>
          </div>
          {events.length === 0 ? <p className="text-sm text-[var(--muted)]">No events yet.</p> : (
            <ul className="space-y-2">
              {events.map(ev => (
                <li key={ev.id} className="text-sm flex items-start gap-3">
                  <Pill>{ev.kind}</Pill>
                  <span className="text-[var(--muted)] text-xs pt-0.5">{new Date(ev.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
