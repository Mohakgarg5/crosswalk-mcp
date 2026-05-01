import { describe, it, expect, vi } from 'vitest';
import { draftCoverLetter } from '../src/services/coverLetter.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/coverLetter', () => {
  it('drafts a cover letter via sampling', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('Dear hiring manager,\n\nI am excited about the PM role at Stripe...')
    } as unknown as SamplingClient;

    const letter = await draftCoverLetter({
      job: { title: 'PM, Payments', companyName: 'Stripe', description: 'Lead Payments product' },
      profile: { name: 'Mohak Garg' },
      tailoredResumeMd: '# Mohak Garg\n\n- 2 yrs PM at Acme',
      sampling
    });
    expect(letter.coverLetterMd).toContain('Stripe');
    expect(letter.coverLetterMd.toLowerCase()).toContain('dear');
  });
});
