import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body?: string;
  refId?: string;
  reason?: string;
  link?: string;
  read: boolean;
  createdAt: string;
};

type Row = {
  id: string; kind: string; title: string; body: string | null; ref_id: string | null;
  reason: string | null; link: string | null; read: number; created_at: string;
};

function toNotification(r: Row): Notification {
  return {
    id: r.id, kind: r.kind, title: r.title,
    body: r.body ?? undefined, refId: r.ref_id ?? undefined,
    reason: r.reason ?? undefined, link: r.link ?? undefined,
    read: r.read === 1, createdAt: r.created_at
  };
}

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

export function listNotifications(db: Db, opts: { unreadOnly?: boolean; limit?: number } = {}): Notification[] {
  const where = opts.unreadOnly ? 'WHERE read = 0' : '';
  const limit = opts.limit ?? 100;
  return (db.prepare(`SELECT * FROM notification ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(limit) as Row[]).map(toNotification);
}

export function unreadCount(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM notification WHERE read = 0`).get() as { n: number }).n;
}

export function markAllRead(db: Db): number {
  const info = db.prepare(`UPDATE notification SET read = 1 WHERE read = 0`).run();
  return info.changes;
}

export type NeedsActionReason =
  | 'account_wall'         // nothing filled — Workday-style sign-in wall
  | 'no_form'              // aggregator listing with no resolvable apply form
  | 'submit_unconfirmed'   // submit clicked, no confirmation evidence
  | 'verification_timeout' // emailed code/link not read in time
  | 'listing_expired'      // listing gone/removed
  | 'browser_unavailable'  // browser step threw (not installed, crash, login wall)
  | 'required_field_missing';// ATS rejected submit — a required field needs an answer

/**
 * Add an application to the "Needs You" queue: it couldn't finish autonomously
 * and one human step (sign in, solve a check, confirm) will complete it. This
 * is the single honest surface for blocked work — never a fake "submitted".
 */
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
