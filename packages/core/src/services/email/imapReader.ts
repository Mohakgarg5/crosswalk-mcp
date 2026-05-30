import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { EmailAccount } from '../../store/email.ts';
import type { ParsedEmail } from './verification.ts';

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

/** Injectable mailbox reader — fetch messages received at/after `sinceISO`. */
export type ImapFetcher = (cfg: ImapConfig, sinceISO: string) => Promise<ParsedEmail[]>;

const PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail: { host: 'imap.gmail.com', port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
  icloud: { host: 'imap.mail.me.com', port: 993, secure: true }
};

/** Derive connection settings from a stored account, or null if unusable. */
export function imapConfigFromAccount(acct: EmailAccount): ImapConfig | null {
  const cfg = acct.config as { appPassword?: string; host?: string; port?: number; secure?: boolean };
  const pass = cfg.appPassword;
  if (!pass) return null;

  const preset = PRESETS[acct.provider];
  if (preset) {
    return { ...preset, user: acct.address, pass };
  }
  // custom / unknown provider: require an explicit host.
  if (!cfg.host) return null;
  return {
    host: cfg.host,
    port: cfg.port ?? 993,
    secure: cfg.secure ?? true,
    user: acct.address,
    pass
  };
}

/**
 * Live fetcher: open a read-only IMAP session, pull messages received since the
 * given time, parse them, and return the lightweight shape extraction needs.
 * Best-effort — connection errors propagate so the caller treats them as
 * "unresolved" and pauses the application.
 */
export const liveImapFetcher: ImapFetcher = async (cfg, sinceISO) => {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false
  });

  const out: ParsedEmail[] = [];
  await client.connect();
  try {
    // readOnly opens INBOX via EXAMINE, not SELECT — protocol-level guarantee
    // we never mutate the user's mailbox (the PEEK fetch below already avoids
    // setting \Seen; this is defense-in-depth matching the read-only intent).
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const since = new Date(sinceISO);
      for await (const msg of client.fetch({ since }, { source: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        out.push({
          from: parsed.from?.text ?? '',
          subject: parsed.subject ?? '',
          text: parsed.text ?? '',
          html: typeof parsed.html === 'string' ? parsed.html : undefined,
          date: (parsed.date ?? new Date()).toISOString()
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out;
};
