# Inline API-Key Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an AI tool call fails for lack of an Anthropic API key, prompt for the key in a dialog right there, save it, and retry the call — no detour to Settings.

**Architecture:** The engine tags the missing-key error with a stable `NO_API_KEY` code; the `/api/tool` route forwards the code; the client's `runTool` intercepts it, awaits a globally-mounted `ApiKeyDialog` (registered via a module-level hook in `lib/api.ts`), and retries the original call exactly once after a key is saved.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind v4 with CSS variables. The web app has no unit-test infra (`lint` = `tsc --noEmit`); verification is typecheck + a scripted end-to-end drive against the dev server.

**Spec:** `docs/superpowers/specs/2026-06-04-inline-api-key-prompt-design.md`

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `apps/web/lib/engine.ts` | Modify (~line 66) | Throw the missing-key error with `code = 'NO_API_KEY'` |
| `apps/web/app/api/tool/route.ts` | Modify (catch block) | Forward `code` in the error JSON |
| `apps/web/lib/api.ts` | Modify (`runTool`) | `onApiKeyNeeded` registration hook + single retry |
| `apps/web/components/ApiKeyDialog.tsx` | Create | The modal: input → `saveSettings` → resolve |
| `apps/web/components/AppShell.tsx` | Modify | Mount the dialog once, in both layout branches |

Note on testing: tasks 1–4 are verified by typecheck (`npm run lint` runs `tsc --noEmit` for the web workspace) because the web app has no unit-test runner. Task 5 is the real behavioral test: an end-to-end drive of the keyless flow.

---

### Task 1: Typed error in engine + route passthrough

**Files:**
- Modify: `apps/web/lib/engine.ts:66-73`
- Modify: `apps/web/app/api/tool/route.ts:13-15`

- [ ] **Step 1: Tag the engine error with a code**

In `apps/web/lib/engine.ts`, replace the stub inside `makeSampling`:

```ts
  if (!apiKey) {
    const stub = {
      createMessage: async () => {
        throw new Error('No Anthropic API key set. Add one in Settings to use AI features.');
      }
    };
    return new SamplingClient(stub as unknown as SdkServer);
  }
```

with:

```ts
  if (!apiKey) {
    const stub = {
      createMessage: async () => {
        const err = new Error('No Anthropic API key set. Add one to use AI features.');
        (err as Error & { code?: string }).code = 'NO_API_KEY';
        throw err;
      }
    };
    return new SamplingClient(stub as unknown as SdkServer);
  }
```

- [ ] **Step 2: Forward the code from the API route**

In `apps/web/app/api/tool/route.ts`, replace the catch block:

```ts
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
```

with:

```ts
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, code: (e as { code?: string }).code },
      { status: 400 }
    );
  }
```

(`code` is `undefined` for ordinary errors, and `JSON.stringify` drops undefined keys — non-coded errors are byte-identical to before.)

- [ ] **Step 3: Typecheck**

Run: `npm run lint -w @crosswalk/web`
Expected: exits 0, no output errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/engine.ts apps/web/app/api/tool/route.ts
git commit -m "feat(web): tag missing-API-key error with NO_API_KEY code"
```

---

### Task 2: Client bridge — `onApiKeyNeeded` + retry in `runTool`

**Files:**
- Modify: `apps/web/lib/api.ts:1-13`

- [ ] **Step 1: Rewrite `runTool` with the hook and single retry**

In `apps/web/lib/api.ts`, replace:

```ts
export async function runTool<T = unknown>(name: string, input?: unknown): Promise<T> {
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, input })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `tool ${name} failed`);
  return data.result as T;
}
```

with:

```ts
/** Registered by ApiKeyDialog (mounted in AppShell). Resolves true once a key is saved. */
let requestApiKey: (() => Promise<boolean>) | null = null;

export function onApiKeyNeeded(fn: (() => Promise<boolean>) | null) {
  requestApiKey = fn;
}

type ToolResponse = { ok: boolean; result?: unknown; error?: string; code?: string };

async function callTool(name: string, input?: unknown): Promise<ToolResponse> {
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, input })
  });
  return res.json();
}

export async function runTool<T = unknown>(name: string, input?: unknown): Promise<T> {
  let data = await callTool(name, input);
  // Missing key: ask for one in place, then retry the call exactly once.
  if (!data.ok && data.code === 'NO_API_KEY' && requestApiKey) {
    if (await requestApiKey()) data = await callTool(name, input);
  }
  if (!data.ok) throw new Error(data.error || `tool ${name} failed`);
  return data.result as T;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint -w @crosswalk/web`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(web): runTool pauses on NO_API_KEY and retries once after key entry"
```

---

### Task 3: ApiKeyDialog component

**Files:**
- Create: `apps/web/components/ApiKeyDialog.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
    return () => onApiKeyNeeded(null);
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
      <div className="cw-rise w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--shadow-lg)]">
        <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">AI BRAIN</div>
        <h2 className="font-display mt-2 text-[22px] font-semibold leading-tight">Add your Anthropic API key</h2>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          This action needs AI. Get a key at <span className="text-[var(--accent)]">console.anthropic.com</span> — it’s
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
```

(Style notes: `cw-rise`, `--shadow-lg`, `--bad-bg`, eyebrow/heading classes all match the onboarding wizard's visual language; `Button` and `Input` come from `components/ui.tsx`. `Button` accepts `type="submit"` per its props.)

- [ ] **Step 2: Typecheck**

Run: `npm run lint -w @crosswalk/web`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ApiKeyDialog.tsx
git commit -m "feat(web): ApiKeyDialog modal for inline key entry"
```

---

### Task 4: Mount the dialog in AppShell

**Files:**
- Modify: `apps/web/components/AppShell.tsx`

- [ ] **Step 1: Render the dialog in both branches**

Replace the full contents of `apps/web/components/AppShell.tsx` with:

```tsx
'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import ApiKeyDialog from '@/components/ApiKeyDialog';

/** Full-bleed routes (their own chrome) skip the sidebar shell. */
const FULL_BLEED = ['/onboarding'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (FULL_BLEED.some(p => path.startsWith(p))) {
    return (
      <div className="min-h-screen">
        {children}
        <ApiKeyDialog />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
      <ApiKeyDialog />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint -w @crosswalk/web`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/AppShell.tsx
git commit -m "feat(web): mount ApiKeyDialog globally in AppShell"
```

---

### Task 5: End-to-end verification (keyless flow)

**Files:** none (verification only)

The dev server must run **keyless**: point `CROSSWALK_HOME` at a fresh temp dir so any real `~/.crosswalk/config.json` key is ignored, and ensure `ANTHROPIC_API_KEY` is unset.

- [ ] **Step 1: Start a keyless dev server**

```bash
mkdir -p /tmp/cw-keyless-home
env -u ANTHROPIC_API_KEY CROSSWALK_HOME=/tmp/cw-keyless-home npm run gui
```

Wait for `✓ Ready` on http://localhost:3000 (stop any previously running instance first).

- [ ] **Step 2: Drive the dialog with Playwright**

Using the Playwright MCP browser (or manually):
1. Navigate to http://localhost:3000/jobs.
2. Trigger an AI action — e.g. add a job and click its **Draft** action (`draft_application`), or on an application page click **Explain fit**. Any `runTool` call that reaches `sampling.createMessage` works.
3. Expected: the **Add your Anthropic API key** modal appears instead of the pink error banner.

- [ ] **Step 3: Verify "Not now" fallback**

Click **Not now**.
Expected: modal closes, the page's normal pink error banner appears with the missing-key message.

- [ ] **Step 4: Verify save-and-retry**

Trigger the same action again; in the modal, paste a key (a real key if available — otherwise any `sk-ant-…` string) and click **Save & continue**.
Expected:
- Modal closes; the original action resumes automatically (no re-click).
- With a real key: the action completes with no error banner.
- With a fake key: the retried call fails once with Anthropic's auth error in the page banner (proves single-retry, no loop, no second modal).
- `cat /tmp/cw-keyless-home/config.json` shows the saved `apiKey` and `ls -l` shows mode `-rw-------`.

- [ ] **Step 5: Clean up and finish**

```bash
rm -rf /tmp/cw-keyless-home
```

Restart the dev server normally (`npm run gui`) if the user wants it running. Report results with screenshots.
