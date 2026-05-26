import { describe, it, expect } from 'vitest';
import { getAdapter, registerAdapter } from '../src/ats/adapter.ts';
import type { ATSAdapter, NormalizedJob } from '../src/ats/types.ts';

describe('ats/adapter', () => {
  it('throws for unknown adapter', () => {
    expect(() => getAdapter('unknown')).toThrow(/unknown ats/i);
  });

  it('registers and retrieves a fake adapter', () => {
    const fake: ATSAdapter = {
      name: 'fake',
      async listJobs(): Promise<NormalizedJob[]> { return []; }
    };
    registerAdapter(fake);
    expect(getAdapter('fake')).toBe(fake);
  });
});
