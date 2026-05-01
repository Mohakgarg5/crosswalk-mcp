import { describe, it, expect, vi } from 'vitest';
import { tailorResume } from '../src/services/tailorResume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/tailorResume', () => {
  it('produces tailored markdown via sampling', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak Garg\n\n## Experience\n\n- PM @ Acme (payments)')
    } as unknown as SamplingClient;
    const out = await tailorResume({
      job: { title: 'PM, Payments', description: 'Lead payments' },
      profile: { name: 'Mohak Garg' },
      resume: { label: 'Generic PM', rawText: 'PM @ Acme', parsed: { skills: ['payments'] } },
      sampling
    });
    expect(out.tailoredMd).toContain('Mohak Garg');
    expect(out.tailoredMd).toContain('payments');
    expect(sampling.complete).toHaveBeenCalledOnce();
  });
});
