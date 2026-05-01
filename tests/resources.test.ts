import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { seedRegistryIfEmpty } from '../src/registryBoot.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { listResources, readResource } from '../src/resources/index.ts';

describe('resources', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); seedRegistryIfEmpty(db); });

  it('lists both resources', () => {
    const r = listResources();
    expect(r.map(x => x.uri).sort()).toEqual([
      'crosswalk://profile/me', 'crosswalk://registry/companies'
    ]);
  });

  it('reads the registry resource', async () => {
    const out = await readResource('crosswalk://registry/companies', { db });
    const parsed = JSON.parse(out.text) as Array<{ id: string }>;
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('reads the profile resource (null if unset)', async () => {
    const empty = await readResource('crosswalk://profile/me', { db });
    expect(JSON.parse(empty.text)).toBeNull();
    upsertProfile(db, { name: 'Mohak' });
    const set = await readResource('crosswalk://profile/me', { db });
    expect(JSON.parse(set.text)).toMatchObject({ name: 'Mohak' });
  });
});
