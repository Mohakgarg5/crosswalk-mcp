import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

export type EmailAccount = { provider: string; address: string; config: Record<string, unknown> };

export function getEmailAccount(db: Db): EmailAccount | null {
  const r = db.prepare(`SELECT provider, address, config_json FROM email_account WHERE id = 1`).get() as
    | { provider: string; address: string; config_json: string }
    | undefined;
  return r ? { provider: r.provider, address: r.address, config: JSON.parse(r.config_json) } : null;
}

export function setEmailAccount(db: Db, acct: EmailAccount): void {
  db.prepare(`
    INSERT INTO email_account (id, provider, address, config_json, updated_at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, address = excluded.address,
      config_json = excluded.config_json, updated_at = excluded.updated_at
  `).run(acct.provider, acct.address, JSON.stringify(acct.config), new Date().toISOString());
}

export type InboundEmail = {
  id: string;
  fromAddr: string;
  subject: string;
  body: string;
  receivedAt: string;
  applicationId?: string;
  matchedBy?: string;
  createdAt: string;
};

type Row = {
  id: string; from_addr: string; subject: string; body: string; received_at: string;
  application_id: string | null; matched_by: string | null; created_at: string;
};

function toEmail(r: Row): InboundEmail {
  return {
    id: r.id, fromAddr: r.from_addr, subject: r.subject, body: r.body, receivedAt: r.received_at,
    applicationId: r.application_id ?? undefined, matchedBy: r.matched_by ?? undefined, createdAt: r.created_at
  };
}

export function createInboundEmail(db: Db, input: {
  fromAddr: string; subject: string; body: string; receivedAt: string;
  applicationId?: string; matchedBy?: string;
}): InboundEmail {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO inbound_email (id, from_addr, subject, body, received_at, application_id, matched_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.fromAddr, input.subject, input.body, input.receivedAt, input.applicationId ?? null, input.matchedBy ?? null, createdAt);
  return { id, ...input, createdAt };
}

export function listInboundEmails(db: Db, limit = 100): InboundEmail[] {
  return (db.prepare(`SELECT * FROM inbound_email ORDER BY received_at DESC, rowid DESC LIMIT ?`).all(limit) as Row[]).map(toEmail);
}
