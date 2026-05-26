import { describe, it, expect } from 'vitest';
import { withinSinceDays } from '../src/ats/util.ts';

describe('ats/util', () => {
  it('includes everything when sinceDays is undefined', () => {
    expect(withinSinceDays('2020-01-01T00:00:00Z', undefined)).toBe(true);
    expect(withinSinceDays(undefined, undefined)).toBe(true);
  });

  it('includes jobs with no postedAt regardless of sinceDays', () => {
    expect(withinSinceDays(undefined, 7)).toBe(true);
  });

  it('excludes postings older than sinceDays cutoff', () => {
    const old = new Date(Date.now() - 30 * 86400_000).toISOString();
    expect(withinSinceDays(old, 7)).toBe(false);
  });

  it('includes postings within sinceDays cutoff', () => {
    const recent = new Date(Date.now() - 3 * 86400_000).toISOString();
    expect(withinSinceDays(recent, 7)).toBe(true);
  });
});
