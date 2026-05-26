import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { getProfile } from '../src/store/profile.ts';
import { setupProfile } from '../src/tools/setup_profile.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/setup_profile', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('stores a structured profile from a free-form description', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        name: 'Mohak Garg',
        headline: 'Product Manager',
        years_experience: 2,
        skills: ['Python', 'SQL'],
        wants: { roles: ['PM'], locations: ['NYC', 'remote'] }
      })
    } as unknown as SamplingClient;

    const result = await setupProfile(
      { description: 'I am Mohak, a PM with 2 yrs at Acme. Want NYC/remote.' },
      { db, sampling }
    );
    expect(result.profile.name).toBe('Mohak Garg');
    expect(getProfile(db)?.name).toBe('Mohak Garg');
  });
});
