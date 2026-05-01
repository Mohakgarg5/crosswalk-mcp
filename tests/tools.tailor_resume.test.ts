import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { tailorResumeTool } from '../src/tools/tailor_resume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/tailor_resume', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM',
      url: 'https://x', descriptionMd: 'Lead Payments', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('returns markdown only by default', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak\n\n- PM @ Acme'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;
    const out = await tailorResumeTool({ jobId: 'g:stripe:1' }, { db, sampling });
    expect(out.tailoredMd).toContain('Mohak');
    expect(out.docxBase64).toBeUndefined();
    expect(out.html).toBeUndefined();
  });

  it('returns html when requested', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;
    const out = await tailorResumeTool({ jobId: 'g:stripe:1', format: 'html' }, { db, sampling });
    expect(out.html).toContain('<!doctype html>');
    expect(out.html).toContain('Mohak');
  });

  it('returns docxBase64 when requested', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;
    const out = await tailorResumeTool({ jobId: 'g:stripe:1', format: 'docx' }, { db, sampling });
    expect(out.docxBase64).toBeTypeOf('string');
    const buf = Buffer.from(out.docxBase64!, 'base64');
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
