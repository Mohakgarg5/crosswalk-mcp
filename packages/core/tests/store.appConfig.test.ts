import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { getConfig, setConfig, DEFAULT_APP_CONFIG } from '../src/store/appConfig.ts';

describe('app_config store', () => {
  it('returns defaults when unset', () => {
    const db = openDb(':memory:');
    expect(getConfig(db)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('merges partial updates and persists across reads', () => {
    const db = openDb(':memory:');
    setConfig(db, { weeklyCap: 50 });
    expect(getConfig(db).weeklyCap).toBe(50);
    expect(getConfig(db).submitPolicy).toBe('review'); // untouched default
    setConfig(db, { submitPolicy: 'auto' });
    expect(getConfig(db)).toMatchObject({ weeklyCap: 50, submitPolicy: 'auto' });
  });
});

describe('appConfig verificationTimeoutMs', () => {
  it('defaults to 90 seconds', () => {
    expect(DEFAULT_APP_CONFIG.verificationTimeoutMs).toBe(90_000);
  });

  it('persists an override', () => {
    const db = openDb(':memory:');
    setConfig(db, { verificationTimeoutMs: 120_000 });
    expect(getConfig(db).verificationTimeoutMs).toBe(120_000);
  });
});
