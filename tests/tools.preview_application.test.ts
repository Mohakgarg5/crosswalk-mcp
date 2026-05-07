import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication } from '../src/store/application.ts';
import { previewApplication } from '../src/tools/preview_application.ts';
import type { Browser } from '../src/services/browser/types.ts';

describe('tools/preview_application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '#', coverLetterMd: '.',
      answerPack: {}, deepLink: 'https://apply.example.com/job/12345'
    });
  });

  it('previews the deep link via the injected browser', async () => {
    const browser: Browser = {
      preview: vi.fn().mockResolvedValue({
        screenshotPng: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        resolvedUrl: 'https://apply.example.com/job/12345',
        title: 'Apply: PM',
        formFields: [
          { name: 'email', type: 'email', required: true },
          { name: 'resume', type: 'file', required: true }
        ]
      }),
      fillForm: vi.fn(),
      close: vi.fn()
    };
    const out = await previewApplication({ applicationId: 'app1' }, { db, browser });
    expect(browser.preview).toHaveBeenCalledWith('https://apply.example.com/job/12345');
    expect(out.title).toBe('Apply: PM');
    expect(out.screenshotPngBase64).toBeTypeOf('string');
    expect(Buffer.from(out.screenshotPngBase64, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
    expect(out.formFields).toHaveLength(2);
  });

  it('throws on unknown application', async () => {
    const browser: Browser = { preview: vi.fn(), fillForm: vi.fn(), close: vi.fn() };
    await expect(
      previewApplication({ applicationId: 'nope' }, { db, browser })
    ).rejects.toThrow(/unknown application/i);
    expect(browser.preview).not.toHaveBeenCalled();
  });
});
