import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { getProfile, upsertProfile } from '../src/store/profile.ts';

describe('store/profile', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns null when no profile is stored', () => {
    expect(getProfile(db)).toBeNull();
  });

  it('upserts and reads back', () => {
    upsertProfile(db, { name: 'Mohak Garg', headline: 'PM' });
    expect(getProfile(db)).toMatchObject({ name: 'Mohak Garg', headline: 'PM' });
  });

  it('overwrites on second upsert', () => {
    upsertProfile(db, { name: 'A' });
    upsertProfile(db, { name: 'B' });
    expect(getProfile(db)).toEqual({ name: 'B' });
  });
});
