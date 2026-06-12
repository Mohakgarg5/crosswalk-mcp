# Needs-You Queue (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Unify every application that can't finish autonomously (captcha, account wall, unconfirmed submit, verification timeout, expired listing, no-form, browser-unavailable) into one queryable "Needs You" queue with a reason + direct link — instead of today's scattered `manual_apply_needed` / `submit_unconfirmed` / `verification_pending` notifications and the silent `listing_expired` event.

**Architecture:** Add two nullable columns (`reason`, `link`) to the existing `notification` table and a `needs_action` kind. A typed `enqueueNeedsAction()` helper writes them; `listNeedsActions()` queries them. The scattered notification calls in `apply_application.ts` are replaced by `enqueueNeedsAction` with a structured reason; `autoApplyEngine` routes its `drafted` outcomes (browser threw) into the queue too. A web "Needs You" card on the Alerts page renders reason badges + "Open & finish" links.

**Tech Stack:** TypeScript (strict), better-sqlite3, Vitest, Next.js App Router.

---

## Type contract

```typescript
export type NeedsActionReason =
  | 'account_wall'        // nothing filled — Workday-style sign-in wall
  | 'no_form'             // aggregator listing with no resolvable apply form
  | 'submit_unconfirmed'  // submit clicked, no confirmation evidence
  | 'verification_timeout'// emailed code/link not read in time
  | 'listing_expired'     // listing gone/removed
  | 'browser_unavailable';// browser step threw (not installed, crash, login wall)

// enqueueNeedsAction(db, { applicationId, reason, title, body?, link })
//   → creates a notification with kind 'needs_action', reason, link, refId=applicationId
// listNeedsActions(db, { limit? }) → Notification[] where kind='needs_action'
// Notification type gains: reason?: string; link?: string;
```

---

## Task 1: Migration + notification store extension

**Files:**
- Modify: `packages/core/src/store/migrations.ts` (append migration #11)
- Modify: `packages/core/src/store/notification.ts`
- Test: `packages/core/tests/needsAction.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `packages/core/tests/needsAction.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { enqueueNeedsAction, listNeedsActions, listNotifications } from '../src/store/notification.ts';

describe('needs-action queue', () => {
  it('enqueues a needs_action notification with reason + link and lists it', () => {
    const db = openDb(':memory:');
    enqueueNeedsAction(db, {
      applicationId: 'app-1', reason: 'account_wall',
      title: 'Form needs you', body: 'Workday wall', link: 'https://x/apply'
    });
    const queue = listNeedsActions(db);
    expect(queue.length).toBe(1);
    expect(queue[0].kind).toBe('needs_action');
    expect(queue[0].reason).toBe('account_wall');
    expect(queue[0].link).toBe('https://x/apply');
    expect(queue[0].refId).toBe('app-1');
  });

  it('listNeedsActions returns only needs_action items', () => {
    const db = openDb(':memory:');
    const { createNotification } = require('../src/store/notification.ts');
    createNotification(db, { kind: 'new_match', title: 'a PM job' });
    enqueueNeedsAction(db, { applicationId: 'app-2', reason: 'submit_unconfirmed', title: 'Not confirmed', link: 'https://y' });
    expect(listNeedsActions(db).length).toBe(1);
    expect(listNotifications(db).length).toBe(2); // both still in the general feed
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`enqueueNeedsAction`/`listNeedsActions` undefined).

Run: `npm test -w crosswalk-mcp -- needsAction`

- [ ] **Step 3: Add migration #11** in `migrations.ts` after the id:10 entry:

```typescript
  ,
  {
    id: 11,
    name: 'notification_needs_action',
    sql: `
      ALTER TABLE notification ADD COLUMN reason TEXT;
      ALTER TABLE notification ADD COLUMN link TEXT;
    `
  }
```

- [ ] **Step 4: Extend `notification.ts`**

Add to the `Notification` type (after `refId?: string;`):

```typescript
  reason?: string;
  link?: string;
```

Update `Row` type to add `reason: string | null; link: string | null;` and `toNotification` to map `reason: r.reason ?? undefined, link: r.link ?? undefined`.

Replace `createNotification`'s INSERT to include the new columns:

```typescript
export function createNotification(
  db: Db,
  input: { kind: string; title: string; body?: string; refId?: string; reason?: string; link?: string }
): Notification {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO notification (id, kind, title, body, ref_id, reason, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
    .run(id, input.kind, input.title, input.body ?? null, input.refId ?? null, input.reason ?? null, input.link ?? null, createdAt);
  return { id, kind: input.kind, title: input.title, body: input.body, refId: input.refId, reason: input.reason, link: input.link, read: false, createdAt };
}
```

Update the `SELECT *` in `listNotifications` is fine (returns new columns). Append:

```typescript
export type NeedsActionReason =
  | 'account_wall' | 'no_form' | 'submit_unconfirmed'
  | 'verification_timeout' | 'listing_expired' | 'browser_unavailable';

export function enqueueNeedsAction(
  db: Db,
  input: { applicationId: string; reason: NeedsActionReason; title: string; body?: string; link: string }
): Notification {
  return createNotification(db, {
    kind: 'needs_action', title: input.title, body: input.body,
    refId: input.applicationId, reason: input.reason, link: input.link
  });
}

export function listNeedsActions(db: Db, opts: { limit?: number } = {}): Notification[] {
  const limit = opts.limit ?? 100;
  return (db.prepare(`SELECT * FROM notification WHERE kind = 'needs_action' ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(limit) as Row[]).map(toNotification);
}
```

- [ ] **Step 5: Run — expect PASS.** Also update `store.test.ts` migration-id assertion to `[1..11]`.

Run: `npm test -w crosswalk-mcp -- needsAction store.test`

- [ ] **Step 6: Commit** `feat(store): needs_action notification queue (reason + link)`

---

## Task 2: Route apply_application blocked paths through the queue

**Files:**
- Modify: `packages/core/src/tools/apply_application.ts`
- Test: `packages/core/tests/tools.apply_application.test.ts`

- [ ] **Step 1: Write/extend a failing test** — assert that after a fill that yields `filled.length === 0`, a `needs_action` row with `reason='account_wall'` exists. Read the existing test file's fakeBrowser/seed helpers and mirror them; add:

```typescript
  it('enqueues a needs_action (account_wall) when nothing fills', async () => {
    // fakeBrowser whose fillForm returns filled: []
    // ...seed an application, run applyApplication({ applicationId, submit: false })
    const { listNeedsActions } = await import('../src/store/notification.ts');
    const q = listNeedsActions(db);
    expect(q.some(n => n.reason === 'account_wall')).toBe(true);
  });
```

(Match the file's existing setup exactly — it already constructs a browser + application; clone the closest existing test and force `filled: []`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Replace the scattered notifications** in `apply_application.ts`. Import `enqueueNeedsAction` (alongside `createNotification`). Then:

  - `listing_expired` throw path: before throwing, add
    `enqueueNeedsAction(ctx.db, { applicationId: app.id, reason: 'listing_expired', title: 'Listing expired', body: 'This listing is no longer accepting applications.', link: app.deepLink });`
  - `apply_url_unresolved` (`manual_apply_needed`) → replace with
    `enqueueNeedsAction(ctx.db, { applicationId: app.id, reason: 'no_form', title: 'Apply on the company site', body: "Couldn't find the application form behind this listing.", link: app.deepLink });`
  - `nothing_filled` (`manual_apply_needed`) → replace with
    `enqueueNeedsAction(ctx.db, { applicationId: app.id, reason: 'account_wall', title: 'Form needs you — likely a sign-in wall', body: 'No fields could be filled (often a Workday-style account wall). Finish it by hand.', link: result.resolvedUrl || applyUrl });`
  - `submit_unconfirmed` → replace the `createNotification({ kind: 'submit_unconfirmed', ... })` with
    `enqueueNeedsAction(ctx.db, { applicationId: app.id, reason: 'submit_unconfirmed', title: 'Submission not confirmed', body: 'A submit button was clicked but nothing confirmed it went through.', link: applyUrl });`
  - `verification_pending` → replace its `createNotification` with
    `enqueueNeedsAction(ctx.db, { applicationId: app.id, reason: 'verification_timeout', title: 'Email verification needed', body: 'The form asked for an emailed code/link we could not read in time. The form is filled — finish it by hand.', link: result.resolvedUrl || applyUrl });`

  Leave the `addEventForApplication(...)` event-log calls untouched (they are the audit trail; only the notification layer changes).

- [ ] **Step 4: Run — expect PASS.** Then run the whole apply_application test file to confirm no regression: `npm test -w crosswalk-mcp -- apply_application`

- [ ] **Step 5: Commit** `feat(apply): route blocked outcomes into the needs_action queue`

---

## Task 3: autoApplyEngine routes drafted (browser-threw) into the queue

**Files:**
- Modify: `packages/core/src/services/autoApplyEngine.ts`
- Test: `packages/core/tests/autoApply.test.ts`

- [ ] **Step 1: Extend the failing test** — using the file's existing `brokenBrowser()` helper (fillForm throws):

```typescript
  it('enqueues a needs_action (browser_unavailable) when the browser step throws', async () => {
    const db = openDb(':memory:');
    seed(db);
    const { listNeedsActions } = await import('../src/store/notification.ts');
    await autoApply({ jobIds: ['g-1'], submit: true }, { db, sampling: fakeSampling(), browser: brokenBrowser() });
    const q = listNeedsActions(db);
    expect(q.some(n => n.reason === 'browser_unavailable')).toBe(true);
  });
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in the `catch (e)` block of the `applyApplication` call in `autoApplyEngine.ts` (the one that pushes `status: 'drafted'`), before/after pushing the result, enqueue:

```typescript
    } catch (e) {
      const job = getJob(deps.db, jobId);
      enqueueNeedsAction(deps.db, {
        applicationId,
        reason: 'browser_unavailable',
        title: 'Application needs you',
        body: `Drafted, but auto-fill couldn't finish: ${(e as Error).message}`,
        link: job?.url ?? ''
      });
      results.push({ jobId, applicationId, status: 'drafted', message: `drafted; auto-fill unavailable: ${(e as Error).message}` });
      continue;
    }
```

Add imports: `import { enqueueNeedsAction } from '../store/notification.ts';` and `import { getJob } from '../store/job.ts';` (only if not already imported). Guard: only enqueue when `applicationId` is defined (it is, since buildApplication succeeded before this catch).

- [ ] **Step 4: Run — expect PASS** (whole file): `npm test -w crosswalk-mcp -- autoApply`

- [ ] **Step 5: Commit** `feat(autoApply): drafted-on-browser-error enqueues needs_action`

---

## Task 4: Runtime exports + web wiring

**Files:**
- Modify: `packages/core/src/runtime.ts`
- Modify: `apps/web/lib/engine.ts`
- Create: `apps/web/app/api/needs-action/route.ts`
- Test: `packages/core/tests/smoke.test.ts`

- [ ] **Step 1: Failing smoke test** — append:

```typescript
  it('runtime exports enqueueNeedsAction + listNeedsActions', async () => {
    const rt = await import('../src/runtime.ts');
    expect(typeof rt.enqueueNeedsAction).toBe('function');
    expect(typeof rt.listNeedsActions).toBe('function');
  });
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Export from runtime** — extend the notification export line in `runtime.ts`:

```typescript
export { listNotifications, unreadCount, markAllRead, enqueueNeedsAction, listNeedsActions, createNotification } from './store/notification.ts';
export type { Notification, NeedsActionReason } from './store/notification.ts';
```

- [ ] **Step 4: Engine wrapper** in `apps/web/lib/engine.ts` (near `listNotifs`):

```typescript
export async function listNeedsAction() {
  const { listNeedsActions } = await rt();
  return listNeedsActions(await db());
}
```

- [ ] **Step 5: API route** — create `apps/web/app/api/needs-action/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { listNeedsAction } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, items: await listNeedsAction() });
}
```

- [ ] **Step 6: Run smoke test — expect PASS.** Build core so the web barrel resolves: `npm run build:core`. Then `npm run lint -w @crosswalk/web`.

- [ ] **Step 7: Commit** `feat(web): needs-action API + runtime exports`

---

## Task 5: "Needs You" card on the Alerts page

**Files:**
- Modify: `apps/web/app/alerts/page.tsx`

- [ ] **Step 1: Add state + load** — extend the `Notification` type with `reason?: string; link?: string;`. Add:

```typescript
  const [needs, setNeeds] = useState<Notification[]>([]);
```

In `load()`, after fetching notifications, also:

```typescript
      const nr = await fetch('/api/needs-action').then(x => x.json());
      if (nr.ok) setNeeds(nr.items ?? []);
```

- [ ] **Step 2: Render the card ABOVE the Notifications card** — a visually distinct "Needs You" list with reason badges + an "Open & finish" link:

```tsx
      {needs.length > 0 && (
        <Card title={`Needs you (${needs.length})`} subtitle="Applications that couldn't finish on their own — one quick step from you.">
          <ul className="divide-y divide-[var(--border)]">
            {needs.map(n => (
              <li key={n.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm">{n.title}</div>
                  {n.body && <div className="text-xs text-[var(--muted)]">{n.body}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <Pill tone="muted">{(n.reason ?? 'action').replace(/_/g, ' ')}</Pill>
                  {n.link && <a href={n.link} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)]">Open &amp; finish →</a>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
```

- [ ] **Step 3: Lint** `npm run lint -w @crosswalk/web` → PASS.

- [ ] **Step 4: Commit** `feat(web): Needs-You card on the Alerts page`

---

## Task 6: Full verification

- [ ] `npm test` → all green (existing + new needsAction/apply/autoApply/smoke tests).
- [ ] `npm run lint` → clean (core + web).
- [ ] `npm run build:core` → builds.
- [ ] Commit any fixups.

---

## Self-review

- **Spec coverage:** needs_action kind + reason + link (Task 1), apply routing for all blocked reasons incl. the previously-silent listing_expired (Task 2), autoApply drafted→queue (Task 3), runtime+API (Task 4), web panel (Task 5). Matches spec §3.1 "needs_action notification kind" + "Needs-You panel".
- **Type consistency:** `NeedsActionReason` union identical across store/runtime; `enqueueNeedsAction(db, {applicationId, reason, title, body?, link})` identical in Tasks 1/2/3; `listNeedsActions` identical in Tasks 1/4.
- **No silent drops:** every throw/blocked branch in apply_application now both logs an event AND enqueues a needs_action.
