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

  it('instructs the model to write in the first person — never about the candidate in third person', async () => {
    const completeFn = vi.fn().mockResolvedValue('Dear hiring manager,\n\nI built things.');
    const sampling = { complete: completeFn } as unknown as SamplingClient;
    await draftCoverLetter({
      job: { title: 'PM', companyName: 'Stripe', description: 'Lead' },
      profile: { name: 'Mohak Garg' },
      tailoredResumeMd: '# Mohak Garg',
      sampling
    });
    const call = completeFn.mock.calls[0][0] as { system: string };
    expect(call.system).toMatch(/first person/i);
    expect(call.system).toMatch(/\bAS the candidate\b|\bI\b/);
    expect(call.system).toMatch(/em dash/i);
  });

  it('rewrites em dashes the model leaks into plain punctuation', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('Dear hiring manager,\n\nI built a platform from scratch—conducting interviews — and shipped it.')
    } as unknown as SamplingClient;
    const letter = await draftCoverLetter({
      job: { title: 'PM', companyName: 'Stripe', description: 'Lead' },
      profile: { name: 'Mohak Garg' },
      tailoredResumeMd: '# Mohak Garg',
      sampling
    });
    expect(letter.coverLetterMd).not.toContain('—');
    expect(letter.coverLetterMd).toContain('from scratch, conducting interviews, and shipped it.');
  });
});
