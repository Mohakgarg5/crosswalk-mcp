import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { draftApplication } from '../src/tools/draft_application.ts';
import { getApplication } from '../src/store/application.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/draft_application', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://apply', descriptionMd: 'Lead Payments', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('drafts and persists an application', async () => {
    const sampling = {
      complete: vi.fn()
        .mockResolvedValueOnce('# Mohak\n\n- PM')   // tailor
        .mockResolvedValueOnce('Dear hiring manager,\n\nLetter body.'),  // letter
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    const out = await draftApplication({ jobId: 'g:stripe:1' }, { db, sampling });
    expect(out.applicationId).toBeTypeOf('string');
    expect(out.tailoredResumeMd).toContain('Mohak');
    expect(out.coverLetterMd).toContain('hiring manager');
    expect(out.deepLink).toBe('https://apply');
    expect(getApplication(db, out.applicationId)).not.toBeNull();
  });
});
