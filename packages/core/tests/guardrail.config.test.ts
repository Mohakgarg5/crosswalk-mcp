import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { setConfig } from '../src/store/appConfig.ts';
import { checkGuardrail } from '../src/services/guardrail.ts';

describe('guardrail weekly cap is configurable', () => {
  it('blocks immediately when weeklyCap is 0', () => {
    const db = openDb(':memory:');
    setConfig(db, { weeklyCap: 0 });
    const res = checkGuardrail(db, { jobId: 'j1', resumeId: 'r1' });
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.reason).toMatch(/0\/0/);
  });

  it('defaults to cap 10 (no config, no applications => allowed)', () => {
    const db = openDb(':memory:');
    const res = checkGuardrail(db, { jobId: 'j1', resumeId: 'r1' });
    expect(res.allowed).toBe(true);
  });
});
