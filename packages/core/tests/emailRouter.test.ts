import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication, listEventsForApplication } from '../src/store/application.ts';
import { listInboundEmails } from '../src/store/email.ts';
import { listNotifications } from '../src/store/notification.ts';
import { routeEmail } from '../src/services/emailRouter.ts';

function seedApplication(db: ReturnType<typeof openDb>) {
  upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
  upsertJobs(db, [{ id: 'g-1', companyId: 'stripe', title: 'PM, Payments', url: 'https://x', raw: {} }]);
  addResume(db, { id: 'r-1', label: 'PM', rawText: 'resume', parsed: {} });
  return createApplication(db, {
    id: 'a-1', jobId: 'g-1', resumeId: 'r-1',
    tailoredResumeMd: '# me', coverLetterMd: 'hi', answerPack: {}, deepLink: 'https://x'
  });
}

describe('email router', () => {
  it('routes an email to an application by company name and logs an event', () => {
    const db = openDb(':memory:');
    seedApplication(db);
    const res = routeEmail(db, {
      from: 'recruiter@stripe.com',
      subject: 'Your application to Stripe',
      body: 'Thanks for applying — we would love to chat.'
    });
    expect(res.applicationId).toBe('a-1');
    expect(res.matchedBy).toBe('company');
    expect(listEventsForApplication(db, 'a-1').some(e => e.kind === 'email')).toBe(true);
    expect(listNotifications(db)[0].kind).toBe('recruiter_email');
    expect(listInboundEmails(db)[0].applicationId).toBe('a-1');
  });

  it('falls back to job-title matching', () => {
    const db = openDb(':memory:');
    seedApplication(db);
    const res = routeEmail(db, { from: 'x@unknown.io', subject: 'Re: PM, Payments role', body: 'next steps' });
    expect(res.applicationId).toBe('a-1');
    expect(res.matchedBy).toBe('jobTitle');
  });

  it('stores unmatched emails and flags them', () => {
    const db = openDb(':memory:');
    seedApplication(db);
    const res = routeEmail(db, { from: 'spam@nowhere.io', subject: 'Newsletter', body: 'buy now' });
    expect(res.applicationId).toBeUndefined();
    expect(listInboundEmails(db)[0].applicationId).toBeUndefined();
    expect(listNotifications(db)[0].kind).toBe('email_unrouted');
  });
});
