import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { createApplication } from '../src/store/application.ts';
import { applyApplication } from '../src/tools/apply_application.ts';
import type { Browser, FillField } from '../src/services/browser/types.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

function makeDefaultBrowser(overrides: Partial<Browser> = {}): Browser {
  return {
    preview: vi.fn().mockResolvedValue({
      screenshotPng: Buffer.from([]),
      resolvedUrl: 'https://x',
      title: 'Apply',
      formFields: []
    }),
    fillForm: vi.fn(async (_url: string, _fields: FillField[]) => ({
      resolvedUrl: 'u', title: 't',
      screenshotPng: Buffer.from([]),
      filled: [], skipped: []
    })),
    close: vi.fn(),
    ...overrides
  };
}

function makeNoopSampling(): SamplingClient {
  return { complete: vi.fn().mockResolvedValue('SKIP') } as unknown as SamplingClient;
}

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
    const browser = makeDefaultBrowser({
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
    });
    const sampling = makeNoopSampling();
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });

    expect(browser.fillForm).toHaveBeenCalledWith(
      'https://apply.example.com/job/12345',
      expect.any(Array),
      expect.any(Object)
    );
    const kinds = seenFields.map(f => f.kind).sort();
    expect(kinds).toEqual(
      ['cover_letter_file', 'cover_letter_text', 'email', 'first_name', 'last_name', 'linkedin', 'phone', 'resume_file']
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
    const browser = makeDefaultBrowser();
    const sampling = makeNoopSampling();
    await expect(
      applyApplication({ applicationId: 'nope' }, { db, browser, sampling })
    ).rejects.toThrow(/unknown application/i);
    expect(browser.fillForm).not.toHaveBeenCalled();
  });

  it('skips fields the profile does not provide', async () => {
    upsertProfile(db, { email: 'only@example.com' });
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => ({
        resolvedUrl: 'u', title: 't',
        screenshotPng: Buffer.from([]),
        filled: fields.map(f => f.kind),
        skipped: []
      }))
    });
    const sampling = makeNoopSampling();
    await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });
    const passed = (browser.fillForm as ReturnType<typeof vi.fn>).mock.calls[0][1] as FillField[];
    const kinds = passed.map(f => f.kind).sort();
    // Only email + resume_file (no name, phone, linkedin in this profile)
    expect(kinds).toEqual(['cover_letter_file', 'cover_letter_text', 'email', 'resume_file']);
  });

  it('pushes cover_letter_file + cover_letter_text fields when coverLetterMd is set', async () => {
    const passed: FillField[] = [];
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => {
        passed.push(...fields);
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: fields.map(f => f.kind),
          skipped: []
        };
      })
    });
    const sampling = makeNoopSampling();
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });

    const kinds = passed.map(f => f.kind).sort();
    expect(kinds).toContain('cover_letter_file');
    expect(kinds).toContain('cover_letter_text');
    expect(kinds).toContain('resume_file');

    const cf = passed.find(f => f.kind === 'cover_letter_file');
    expect(cf && cf.kind === 'cover_letter_file' && cf.path.endsWith('.docx') && cf.path.includes('cover-letter')).toBe(true);

    const ct = passed.find(f => f.kind === 'cover_letter_text');
    expect(ct && ct.kind === 'cover_letter_text' && ct.value.length > 0).toBe(true);

    expect(out.coverLetterDocxPath).toBeDefined();
    expect(out.coverLetterDocxPath?.endsWith('.docx')).toBe(true);
  });

  it('omits cover-letter fields when coverLetterMd is empty', async () => {
    db.prepare(`UPDATE application SET cover_letter_md = '' WHERE id = ?`).run('app1');
    const passed: FillField[] = [];
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => {
        passed.push(...fields);
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: [], skipped: []
        };
      })
    });
    const sampling = makeNoopSampling();
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });
    const kinds = passed.map(f => f.kind);
    expect(kinds).not.toContain('cover_letter_file');
    expect(kinds).not.toContain('cover_letter_text');
    expect(out.coverLetterDocxPath).toBeUndefined();
  });

  it('pushes text_by_name fields for each non-empty answerPack entry', async () => {
    db.prepare(`UPDATE application SET answer_pack_json = ? WHERE id = ?`).run(
      JSON.stringify({
        why_company: 'Mission alignment + product depth.',
        visa_status: 'US Citizen',
        empty_one: ''
      }),
      'app1'
    );
    const passed: FillField[] = [];
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => {
        passed.push(...fields);
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: fields.map(f => f.kind === 'text_by_name' ? `text_by_name:${f.name}` : f.kind),
          skipped: []
        };
      })
    });
    const sampling = makeNoopSampling();
    await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });

    const tbn = passed.filter(f => f.kind === 'text_by_name');
    const tbnNames = tbn.map(f => (f.kind === 'text_by_name' ? f.name : '')).sort();
    expect(tbnNames).toEqual(['visa_status', 'why_company']);

    const why = tbn.find(f => f.kind === 'text_by_name' && f.name === 'why_company');
    expect(why && why.kind === 'text_by_name' && why.value).toBe('Mission alignment + product depth.');
  });

  it('omits text_by_name fields when answerPack is empty', async () => {
    // beforeEach already sets answerPack: {} — verify nothing leaks through
    const passed: FillField[] = [];
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => {
        passed.push(...fields);
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: [], skipped: []
        };
      })
    });
    const sampling = makeNoopSampling();
    await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });

    expect(passed.filter(f => f.kind === 'text_by_name')).toEqual([]);
  });

  it('introspects the form and samples answers for unmatched textareas', async () => {
    const completeFn = vi.fn().mockImplementation(async (opts: { prompt: string }) => {
      if (opts.prompt.includes('Why are you interested')) {
        return 'Because I love your product depth.';
      }
      return 'SKIP';
    });
    const sampling = { complete: completeFn } as unknown as SamplingClient;

    const passed: FillField[] = [];
    const browser = makeDefaultBrowser({
      preview: vi.fn().mockResolvedValue({
        screenshotPng: Buffer.from([]),
        resolvedUrl: 'https://x',
        title: 'Apply',
        formFields: [
          { name: 'why_company', type: 'textarea', label: 'Why are you interested in this company?', required: true },
          { name: 'random_q', type: 'textarea', label: 'Your favorite color?', required: false },
          { name: 'cover_letter', type: 'textarea', label: 'Cover letter', required: false },
          { name: 'email', type: 'email', label: 'Email', required: true }
        ]
      }),
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => {
        passed.push(...fields);
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: fields.map(f => f.kind === 'text_by_name' ? `text_by_name:${f.name}` : f.kind),
          skipped: []
        };
      })
    });

    const out = await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });

    // why_company should be sampled and pushed as text_by_name
    const why = passed.find(f => f.kind === 'text_by_name' && f.name === 'why_company');
    expect(why && why.kind === 'text_by_name' && why.value).toBe('Because I love your product depth.');

    // random_q got SKIP — should NOT appear
    expect(passed.find(f => f.kind === 'text_by_name' && f.name === 'random_q')).toBeUndefined();

    // cover_letter is excluded by the cover-letter regex — should NOT appear in sampledFields
    expect(out.sampledFields).toContain('why_company');
    expect(out.sampledFields).not.toContain('cover_letter');
    expect(out.sampledFields).not.toContain('random_q');

    // Type=email shouldn't be considered a textarea
    expect(passed.find(f => f.kind === 'text_by_name' && f.name === 'email')).toBeUndefined();

    // Sampling was called for the two textareas that needed answers (why_company + random_q),
    // and skipped cover_letter (regex) + email (wrong type).
    expect(completeFn).toHaveBeenCalledTimes(2);
  });

  it('passes the company ats to browser.fillForm and reports detectedAts on the result', async () => {
    let seenOpts: { ats?: string } | undefined;
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, _fields: FillField[], opts?: { ats?: string }) => {
        seenOpts = opts;
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: [], skipped: []
        };
      })
    });
    const sampling = makeNoopSampling();
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });

    expect(seenOpts).toEqual({ ats: 'greenhouse' });
    expect(out.detectedAts).toBe('greenhouse');
  });

  it('reports detectedAts as null when the application job is missing from the DB', async () => {
    db.prepare(`DELETE FROM application WHERE id = ?`).run('app1');
    db.prepare(`DELETE FROM job WHERE id = ?`).run('g:stripe:1');
    // Re-create the application without a valid job in the DB — use a non-existent jobId
    // by re-inserting with a bogus jobId is impossible due to FK, so instead
    // we test by noting getJob returns null → detectedAts is null.
    // We re-insert with PRAGMA foreign_keys = OFF briefly.
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    db.prepare(`INSERT INTO application (id, job_id, resume_id, tailored_resume_md, cover_letter_md, answer_pack_json, deep_link, created_at)
      VALUES ('app1', 'nonexistent-job', 'r1', '# Resume', '.', '{}', 'https://apply.example.com/job/12345', datetime('now'))`).run();
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    const browser = makeDefaultBrowser();
    const sampling = makeNoopSampling();
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });
    expect(out.detectedAts).toBeNull();
  });

  it('passes clickSubmit:true to fillForm when input.submit is true and reports submitted=true', async () => {
    let seenOpts: { ats?: string; clickSubmit?: boolean } | undefined;
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, _fields: FillField[], opts?: { ats?: string; clickSubmit?: boolean }) => {
        seenOpts = opts;
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: [], skipped: [],
          submitClicked: true,
          postSubmitUrl: 'https://x/thank-you',
          postSubmitTitle: 'Thank You'
        };
      })
    });
    const sampling = makeNoopSampling();
    const out = await applyApplication({ applicationId: 'app1', submit: true }, { db, browser, sampling });

    expect(seenOpts?.clickSubmit).toBe(true);
    expect(out.submitted).toBe(true);
    expect(out.postSubmitUrl).toBe('https://x/thank-you');
  });

  it('does not pass clickSubmit when submit is omitted; submitted=false', async () => {
    let seenOpts: { ats?: string; clickSubmit?: boolean } | undefined;
    const browser = makeDefaultBrowser({
      fillForm: vi.fn(async (_url: string, _fields: FillField[], opts?: { ats?: string; clickSubmit?: boolean }) => {
        seenOpts = opts;
        return {
          resolvedUrl: 'u', title: 't',
          screenshotPng: Buffer.from([]),
          filled: [], skipped: []
        };
      })
    });
    const sampling = makeNoopSampling();
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser, sampling });

    expect(seenOpts?.clickSubmit).toBeUndefined();
    expect(out.submitted).toBe(false);
  });
});
