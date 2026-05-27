'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Pill, PageHeader } from '@/components/ui';
import { getSettings, runTool, type Settings } from '@/lib/api';

export default function Dashboard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pipeline, setPipeline] = useState<number | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
    runTool<{ items?: unknown[] }>('list_pipeline', {})
      .then(r => setPipeline(r.items?.length ?? 0))
      .catch(() => setPipeline(null));
  }, []);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your local career copilot — same engine as the MCP server, now with a GUI."
      />

      {settings && !settings.hasKey && (
        <div className="mb-6 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-5 py-4">
          <div className="font-medium text-[var(--warn)]">No Anthropic API key set</div>
          <div className="text-sm text-[var(--muted)] mt-1">
            Discovery & tracking work without a key. To tailor résumés, score fit, and write cover
            letters, add a key in{' '}
            <Link href="/settings" className="text-[var(--accent)] underline">Settings</Link>.
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card title="Applications">
          <div className="text-3xl font-semibold">{pipeline ?? '—'}</div>
          <div className="text-xs text-[var(--muted)] mt-1">in your pipeline</div>
        </Card>
        <Card title="AI model">
          <div className="text-lg">{settings?.config.model ?? '—'}</div>
          <div className="mt-2">{settings?.hasKey ? <Pill tone="ok">key set</Pill> : <Pill tone="warn">no key</Pill>}</div>
        </Card>
        <Card title="Weekly cap">
          <div className="text-3xl font-semibold">{settings?.config.weeklyCap ?? '—'}</div>
          <div className="text-xs text-[var(--muted)] mt-1">anti-spam guardrail</div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <Card title="Get started">
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-[var(--muted)]">
            <li><Link href="/profile" className="text-[var(--accent)]">Set up your profile</Link></li>
            <li><Link href="/resumes" className="text-[var(--accent)]">Add a résumé</Link></li>
            <li><Link href="/jobs" className="text-[var(--accent)]">Find matching jobs</Link></li>
            <li><Link href="/pipeline" className="text-[var(--accent)]">Track applications</Link></li>
          </ol>
        </Card>
        <Card title="Both ways">
          <p className="text-sm text-[var(--muted)]">
            This GUI and the MCP server share one engine and one database
            (<code className="text-[var(--accent)]">~/.crosswalk/state.db</code>). Use whichever you
            like — your data is the same.
          </p>
        </Card>
      </div>
    </>
  );
}
