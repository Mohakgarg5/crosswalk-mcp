import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { addResume } from '../src/store/resume.ts';
import { resolveResume } from '../src/services/resolveResume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/resolveResume', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    addResume(db, { id: 'r2', label: 'Payments PM', rawText: 'PM', parsed: {} });
  });

  it('uses explicit resumeId when supplied', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    const out = await resolveResume({
      db, sampling, jobTitle: 'PM', jobDescription: 'Lead', resumeId: 'r2'
    });
    expect(out.resumeId).toBe('r2');
    expect(out.pickedReason).toBe('caller-supplied');
    expect(sampling.completeJson).not.toHaveBeenCalled();
  });

  it('throws when explicit resumeId is unknown', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(
      resolveResume({ db, sampling, jobTitle: 'PM', jobDescription: 'Lead', resumeId: 'nope' })
    ).rejects.toThrow(/unknown resume/);
  });

  it('throws when no resumes exist', async () => {
    const empty = openDb(':memory:');
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(
      resolveResume({ db: empty, sampling, jobTitle: 'PM', jobDescription: 'Lead' })
    ).rejects.toThrow(/no resumes/);
  });

  it('delegates to picker when no resumeId given', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({ resume_id: 'r2', reason: 'better fit' })
    } as unknown as SamplingClient;
    const out = await resolveResume({
      db, sampling, jobTitle: 'PM', jobDescription: 'Lead'
    });
    expect(out.resumeId).toBe('r2');
    expect(out.pickedReason).toContain('better');
  });
});
