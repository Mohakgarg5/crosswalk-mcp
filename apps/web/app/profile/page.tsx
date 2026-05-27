'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Textarea, PageHeader, ErrorNote } from '@/components/ui';
import { runTool } from '@/lib/api';

export default function ProfilePage() {
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const res = await fetch('/api/profile');
    const data = await res.json();
    if (data.ok) setProfile(data.profile);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await runTool<{ profile: Record<string, unknown> }>('setup_profile', { description: desc });
      setProfile(r.profile); setDesc('');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Profile" subtitle="Describe yourself; Claude structures it. Used to match jobs and tailor applications." />
      <div className="space-y-4">
        <Card title={profile ? 'Update profile' : 'Set up your profile'}>
          <Textarea rows={5} placeholder="e.g. PM with 3 yrs at Acme building AI infra. Want senior PM roles in NYC or remote. Need H-1B sponsorship."
            value={desc} onChange={e => setDesc(e.target.value)} />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={save} disabled={busy || !desc.trim()}>{busy ? 'Extracting…' : 'Save profile'}</Button>
            <span className="text-xs text-[var(--muted)]">Uses AI — set an API key in Settings.</span>
          </div>
          <ErrorNote>{err}</ErrorNote>
        </Card>

        {profile && (
          <Card title="Current profile">
            <pre className="text-xs text-[var(--muted)] whitespace-pre-wrap break-words">{JSON.stringify(profile, null, 2)}</pre>
          </Card>
        )}
      </div>
    </>
  );
}
