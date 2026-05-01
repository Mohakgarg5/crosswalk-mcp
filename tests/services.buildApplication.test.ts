import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { getApplication } from '../src/store/application.ts';
import { buildApplication } from '../src/services/buildApplication.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/buildApplication', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://apply', descriptionMd: 'Lead Payments.', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM at Acme', parsed: { skills: ['payments'] } });
  });

  it('builds and persists an application using the only stored resume', async () => {
    const calls: string[] = [];
    const sampling = {
      complete: vi.fn().mockImplementation(async ({ system }: { system: string }) => {
        if (system.includes('tailor an existing resume')) { calls.push('tailor'); return '# Mohak\n\n- PM @ Acme'; }
        if (system.includes('cover letter'))             { calls.push('letter'); return 'Dear hiring manager,\n\nI am excited...'; }
        throw new Error('unexpected system prompt');
      }),
      completeJson: vi.fn()  // not called when there's only 1 resume
    } as unknown as SamplingClient;

    const out = await buildApplication({ jobId: 'g:stripe:1' }, { db, sampling });
    expect(out.applicationId).toBeTypeOf('string');
    expect(out.tailoredResumeMd).toContain('Mohak');
    expect(out.coverLetterMd).toContain('hiring manager');
    expect(out.deepLink).toBe('https://apply');
    expect(calls).toEqual(['tailor', 'letter']);

    const stored = getApplication(db, out.applicationId);
    expect(stored?.coverLetterMd).toBe(out.coverLetterMd);
    expect(stored?.status).toBe('draft');
  });

  it('throws on unknown job', async () => {
    const sampling = { complete: vi.fn(), completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(buildApplication({ jobId: 'nope' }, { db, sampling })).rejects.toThrow(/unknown job/);
  });

  it('throws when no resumes exist', async () => {
    const empty = openDb(':memory:');
    upsertCompany(empty, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(empty, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    const sampling = { complete: vi.fn(), completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(buildApplication({ jobId: 'g:stripe:1' }, { db: empty, sampling }))
      .rejects.toThrow(/no resumes/);
  });

  it('refuses when guardrail blocks (duplicate)', async () => {
    const { createApplication } = await import('../src/store/application.ts');
    createApplication(db, {
      id: 'pre', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });

    const sampling = {
      complete: vi.fn(),
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    await expect(
      buildApplication({ jobId: 'g:stripe:1' }, { db, sampling })
    ).rejects.toThrow(/already.*application/i);
    expect(sampling.complete).not.toHaveBeenCalled();
  });

  it('proceeds when allowDuplicate=true', async () => {
    const { createApplication } = await import('../src/store/application.ts');
    createApplication(db, {
      id: 'pre', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });

    const sampling = {
      complete: vi.fn()
        .mockResolvedValueOnce('# Mohak\n\n- PM')
        .mockResolvedValueOnce('Dear hiring manager...'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    const out = await buildApplication(
      { jobId: 'g:stripe:1', allowDuplicate: true },
      { db, sampling }
    );
    expect(out.applicationId).toBeTypeOf('string');
  });
});
