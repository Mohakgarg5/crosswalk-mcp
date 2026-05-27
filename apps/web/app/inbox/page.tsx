'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Button, Input, Textarea, Field, PageHeader, Pill, ErrorNote } from '@/components/ui';

type InboundEmail = {
  id: string; fromAddr: string; subject: string; receivedAt: string;
  applicationId?: string; matchedBy?: string;
};

export default function InboxPage() {
  const [emails, setEmails] = useState<InboundEmail[]>([]);
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lastMatch, setLastMatch] = useState('');

  async function load() {
    const r = await fetch('/api/email').then(x => x.json());
    if (r.ok) setEmails(r.emails ?? []);
  }
  useEffect(() => { load(); }, []);

  async function ingest() {
    setBusy(true); setErr(''); setLastMatch('');
    try {
      const r = await fetch('/api/email', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, subject, body })
      }).then(x => x.json());
      if (!r.ok) throw new Error(r.error);
      setLastMatch(r.result.applicationId ? `Routed to application (${r.result.matchedBy}).` : 'Stored — no matching application found.');
      setFrom(''); setSubject(''); setBody(''); await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Inbox" subtitle="Paste a recruiter email; Crosswalk routes it to the matching application. (Live Gmail/IMAP sync is configurable separately.)" />
      <div className="space-y-4">
        <Card title="Ingest an email">
          <div className="grid grid-cols-2 gap-4">
            <Field label="From"><Input placeholder="recruiter@stripe.com" value={from} onChange={e => setFrom(e.target.value)} /></Field>
            <Field label="Subject"><Input placeholder="Your application to Stripe" value={subject} onChange={e => setSubject(e.target.value)} /></Field>
          </div>
          <Field label="Body"><Textarea rows={4} placeholder="Email body…" value={body} onChange={e => setBody(e.target.value)} /></Field>
          <div className="flex items-center gap-3">
            <Button onClick={ingest} disabled={busy || !from.trim() || !subject.trim()}>{busy ? 'Routing…' : 'Route email'}</Button>
            {lastMatch && <span className="text-sm text-[var(--ok)]">{lastMatch}</span>}
          </div>
          <ErrorNote>{err}</ErrorNote>
        </Card>

        <Card title={`Received (${emails.length})`}>
          {emails.length === 0 ? <p className="text-sm text-[var(--muted)]">No emails yet.</p> : (
            <ul className="divide-y divide-[var(--border)]">
              {emails.map(e => (
                <li key={e.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm">{e.subject}</div>
                    <div className="text-xs text-[var(--muted)]">{e.fromAddr} · {new Date(e.receivedAt).toLocaleString()}</div>
                  </div>
                  {e.applicationId
                    ? <Link href={`/applications/${e.applicationId}`} className="text-xs text-[var(--accent)]">{e.matchedBy} → view</Link>
                    : <Pill>unrouted</Pill>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
