import type { Db } from '../store/db.ts';
import { createInboundEmail, type InboundEmail } from '../store/email.ts';
import { addEventForApplication } from '../store/application.ts';
import { createNotification } from '../store/notification.ts';

export type IncomingEmail = { from: string; subject: string; body: string; receivedAt?: string };

export type RouteResult = {
  email: InboundEmail;
  applicationId?: string;
  matchedBy?: 'company' | 'jobTitle';
};

/**
 * Route an incoming recruiter email to the application it most likely belongs
 * to, by looking for a known company name (then job title) in the email. On a
 * match, link the email, append an `email` event to the application, and raise
 * a notification. Unmatched emails are stored and flagged for manual routing.
 */
export function routeEmail(db: Db, email: IncomingEmail): RouteResult {
  const candidates = db.prepare(`
    SELECT a.id AS applicationId, j.title AS jobTitle, c.name AS company
    FROM application a
    LEFT JOIN job j ON j.id = a.job_id
    LEFT JOIN company c ON c.id = j.company_id
    ORDER BY a.created_at DESC, a.rowid DESC
  `).all() as Array<{ applicationId: string; jobTitle: string | null; company: string | null }>;

  const hay = `${email.subject}\n${email.body}\n${email.from}`.toLowerCase();

  let matched: { applicationId: string; company: string | null } | undefined;
  let matchedBy: 'company' | 'jobTitle' | undefined;
  for (const c of candidates) {
    if (c.company && hay.includes(c.company.toLowerCase())) { matched = c; matchedBy = 'company'; break; }
  }
  if (!matched) {
    for (const c of candidates) {
      if (c.jobTitle && hay.includes(c.jobTitle.toLowerCase())) { matched = c; matchedBy = 'jobTitle'; break; }
    }
  }

  const stored = createInboundEmail(db, {
    fromAddr: email.from,
    subject: email.subject,
    body: email.body,
    receivedAt: email.receivedAt ?? new Date().toISOString(),
    applicationId: matched?.applicationId,
    matchedBy
  });

  if (matched) {
    addEventForApplication(db, matched.applicationId, 'email', { from: email.from, subject: email.subject });
    createNotification(db, {
      kind: 'recruiter_email',
      title: `Email: ${email.subject}`,
      body: `routed to ${matched.company ?? 'application'} (by ${matchedBy})`,
      refId: matched.applicationId
    });
  } else {
    createNotification(db, { kind: 'email_unrouted', title: `Unrouted email: ${email.subject}`, body: email.from });
  }

  return { email: stored, applicationId: matched?.applicationId, matchedBy };
}
