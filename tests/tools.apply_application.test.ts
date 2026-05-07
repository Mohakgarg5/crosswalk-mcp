import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { createApplication } from '../src/store/application.ts';
import { applyApplication } from '../src/tools/apply_application.ts';
import type { Browser, FillField } from '../src/services/browser/types.ts';

describe('tools/apply_application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    upsertProfile(db, {
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Smith',
      phone: '+1-555-0100',
      linkedin: 'https://linkedin.com/in/jane'
    });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# Jane Smith\n\nResume content',
      coverLetterMd: '.', answerPack: {},
      deepLink: 'https://apply.example.com/job/12345'
    });
  });

  it('fills known fields from profile + tailored resume and returns base64 screenshot', async () => {
    const seenFields: FillField[] = [];
    const browser: Browser = {
      preview: vi.fn(),
      close: vi.fn(),
      fillForm: vi.fn(async (url: string, fields: FillField[]) => {
        seenFields.push(...fields);
        return {
          resolvedUrl: url,
          title: 'Apply: PM',
          screenshotPng: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          filled: ['email', 'first_name', 'last_name', 'phone', 'linkedin', 'resume_file'],
          skipped: []
        };
      })
    };
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser });

    expect(browser.fillForm).toHaveBeenCalledWith(
      'https://apply.example.com/job/12345',
      expect.any(Array)
    );
    const kinds = seenFields.map(f => f.kind).sort();
    expect(kinds).toEqual(
      ['email', 'first_name', 'last_name', 'linkedin', 'phone', 'resume_file']
    );
    const resumeField = seenFields.find(f => f.kind === 'resume_file');
    expect(resumeField).toBeDefined();
    if (resumeField && resumeField.kind === 'resume_file') {
      expect(resumeField.path.endsWith('.docx')).toBe(true);
    }

    expect(out.applicationId).toBe('app1');
    expect(out.title).toBe('Apply: PM');
    expect(out.filled).toContain('email');
    expect(out.filled).toContain('resume_file');
    expect(out.submitted).toBe(false);
    expect(out.screenshotPngBase64).toBeTypeOf('string');
    expect(Buffer.from(out.screenshotPngBase64, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
  });

  it('throws on unknown application', async () => {
    const browser: Browser = { preview: vi.fn(), close: vi.fn(), fillForm: vi.fn() };
    await expect(
      applyApplication({ applicationId: 'nope' }, { db, browser })
    ).rejects.toThrow(/unknown application/i);
    expect(browser.fillForm).not.toHaveBeenCalled();
  });

  it('skips fields the profile does not provide', async () => {
    upsertProfile(db, { email: 'only@example.com' });
    const browser: Browser = {
      preview: vi.fn(),
      close: vi.fn(),
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => ({
        resolvedUrl: 'u', title: 't',
        screenshotPng: Buffer.from([]),
        filled: fields.map(f => f.kind),
        skipped: []
      }))
    };
    await applyApplication({ applicationId: 'app1' }, { db, browser });
    const passed = (browser.fillForm as ReturnType<typeof vi.fn>).mock.calls[0][1] as FillField[];
    const kinds = passed.map(f => f.kind).sort();
    // Only email + resume_file (no name, phone, linkedin in this profile)
    expect(kinds).toEqual(['email', 'resume_file']);
  });
});
