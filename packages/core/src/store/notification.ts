import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body?: string;
  refId?: string;
  read: boolean;
  createdAt: string;
};

type Row = { id: string; kind: string; title: string; body: string | null; ref_id: string | null; read: number; created_at: string };

function toNotification(r: Row): Notification {
  return {
    id: r.id, kind: r.kind, title: r.title,
    body: r.body ?? undefined, refId: r.ref_id ?? undefined,
    read: r.read === 1, createdAt: r.created_at
  };
}

export function createNotification(
  db: Db,
  input: { kind: string; title: string; body?: string; refId?: string }
): Notification {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO notification (id, kind, title, body, ref_id, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`)
    .run(id, input.kind, input.title, input.body ?? null, input.refId ?? null, createdAt);
  return { id, kind: input.kind, title: input.title, body: input.body, refId: input.refId, read: false, createdAt };
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
