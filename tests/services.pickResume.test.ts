import { describe, it, expect, vi } from 'vitest';
import { pickBestResume } from '../src/services/pickResume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/pickResume', () => {
  it('returns the only resume when there is one', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    const out = await pickBestResume(
      { jobTitle: 'PM', jobDescription: 'Lead payments' },
      [{ id: 'r1', label: 'Generic PM', parsed: {} }],
      sampling
    );
    expect(out).toEqual({ resumeId: 'r1', reason: 'only stored resume' });
    expect(sampling.completeJson).not.toHaveBeenCalled();
  });

  it('asks sampling when there are multiple', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        resume_id: 'r2',
        reason: 'r2 leads with payments and Stripe APIs'
      })
    } as unknown as SamplingClient;

    const out = await pickBestResume(
      { jobTitle: 'PM, Payments', jobDescription: 'Lead payments product' },
      [
        { id: 'r1', label: 'Generic PM', parsed: { skills: ['analytics'] } },
        { id: 'r2', label: 'Payments PM', parsed: { skills: ['stripe', 'payments'] } }
      ],
      sampling
    );
    expect(out.resumeId).toBe('r2');
    expect(out.reason).toContain('payments');
  });
});
