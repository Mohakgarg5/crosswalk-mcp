'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { onApiKeyNeeded, saveSettings } from '@/lib/api';

/**
 * Globally-mounted modal that runTool awaits when a tool fails with
 * NO_API_KEY. Registers itself via onApiKeyNeeded; concurrent failures
 * share one pending promise so the dialog opens only once.
 */
export default function ApiKeyDialog() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const resolveRef = useRef<((saved: boolean) => void) | null>(null);
  const pendingRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    onApiKeyNeeded(() => {
      if (!pendingRef.current) {
        pendingRef.current = new Promise<boolean>(resolve => { resolveRef.current = resolve; });
        setKey(''); setErr(''); setBusy(false); setOpen(true);
      }
      return pendingRef.current;
    });
    return () => {
      settle(false); // resolve any waiting runTool callers as "cancelled"
      onApiKeyNeeded(null);
    };
  }, []);

  function settle(saved: boolean) {
    resolveRef.current?.(saved);
    resolveRef.current = null;
    pendingRef.current = null;
    setOpen(false);
  }

  // Escape = "Not now"
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') settle(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function save() {
    setErr(''); setBusy(true);
    try {
      await saveSettings({ apiKey: key.trim() });
      settle(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="cw-rise w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--shadow-lg)]" role="dialog" aria-modal="true" aria-labelledby="api-key-dialog-title">
        <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">AI BRAIN</div>
        <h2 id="api-key-dialog-title" className="font-display mt-2 text-[22px] font-semibold leading-tight">Add your Anthropic API key</h2>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          This action needs AI. Get a key at <span className="text-[var(--accent)]">console.anthropic.com</span> — it's
          stored only in <code className="text-[var(--accent)]">~/.crosswalk</code> and never leaves your machine.
        </p>
        <form
          className="mt-5"
          onSubmit={e => { e.preventDefault(); if (key.trim() && !busy) save(); }}
        >
          <Input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="sk-ant-…"
            autoFocus
          />
          {err && <div className="mt-3 rounded-xl border border-[var(--bad)]/30 bg-[var(--bad-bg)] px-3.5 py-2.5 text-sm text-[var(--bad)]">{err}</div>}
          <div className="mt-5 flex items-center gap-4">
            <Button type="submit" disabled={busy || !key.trim()}>
              {busy ? 'Saving…' : 'Save & continue'}
            </Button>
            <button
              type="button"
              onClick={() => settle(false)}
              className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
            >
              Not now
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
