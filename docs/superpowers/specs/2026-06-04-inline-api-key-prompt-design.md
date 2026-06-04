# Inline API-key prompt at point of use

**Date:** 2026-06-04
**Status:** Approved

## Problem

When an AI feature runs without an Anthropic API key, the engine throws
`No Anthropic API key set. Add one in Settings to use AI features.` Each page
surfaces it as a generic error banner, forcing a detour to Settings. The user
should be asked for the key *in the flow itself*: the action pauses, prompts
for the key, then continues.

## Design

### 1. Server: typed error — `apps/web/lib/engine.ts`

The keyless sampling stub in `makeSampling` throws an error carrying a stable
machine-readable code:

```ts
const err = new Error('No Anthropic API key set.');
(err as Error & { code: string }).code = 'NO_API_KEY';
throw err;
```

### 2. API route — `apps/web/app/api/tool/route.ts`

The catch block forwards the code when present:

```ts
return NextResponse.json(
  { ok: false, error: (e as Error).message, code: (e as { code?: string }).code },
  { status: 400 }
);
```

Errors without a code are unchanged.

### 3. Client bridge — `apps/web/lib/api.ts`

- Module-level handler slot plus registration function:

  ```ts
  let requestApiKey: (() => Promise<boolean>) | null = null;
  export function onApiKeyNeeded(fn: (() => Promise<boolean>) | null) { requestApiKey = fn; }
  ```

- `runTool` flow: on `data.code === 'NO_API_KEY'` and a registered handler,
  `await requestApiKey()`.
  - Resolves `true` (key saved) → retry the identical fetch **once**; return
    its result or throw its error (no second prompt, no retry loop).
  - Resolves `false` (dismissed) or no handler registered → throw the original
    error, so the existing per-page banner remains the fallback.

### 4. Dialog — `apps/web/components/ApiKeyDialog.tsx`, mounted in `AppShell`

- Mounted once at the root of `AppShell` (both the full-bleed and chrome
  branches render it, so it also covers `/onboarding`). Registers itself via
  `onApiKeyNeeded` on mount, deregisters (passes `null`) on unmount.
- Modal matching app styling: headline "Add your Anthropic API key", password
  input (`sk-ant-…` placeholder), the same trust note as onboarding ("stored
  only in `~/.crosswalk` and never leaves your machine", key from
  console.anthropic.com), buttons **Save & continue** and **Not now**.
- Save → `saveSettings({ apiKey })`; on success resolve `true` and close. Save
  failure shows the error inside the dialog and keeps it open.
- Not now / Escape → resolve `false` and close.
- Concurrency: if a request arrives while the dialog is already pending, both
  callers share the same promise — the dialog opens once and all waiting
  `runTool` calls resume on its resolution.

## Error handling

- **Invalid key saved:** the retried call fails with Anthropic's auth error,
  which surfaces through the normal page banner. Exactly one retry per
  original call prevents loops.
- **Dismissal:** original error propagates; pages behave exactly as today.

## Out of scope

No changes to the onboarding wizard (its skippable key step stays), the
Settings page, or any page component.

## Testing

Manual, with the dev server running keyless:

1. Trigger an AI action (e.g. `explain_fit` on an application, or
   `draft_application` from Jobs) → dialog appears.
2. Paste a valid key, **Save & continue** → action completes without an error
   banner; key persisted to `~/.crosswalk/config.json`.
3. Trigger again keyless, click **Not now** → existing pink banner appears.
4. Paste an invalid key → retry fails, auth error shows in the page banner.
