import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';

describe('store/db', () => {
  it('opens an in-memory db and applies all migrations', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain('profile');
    expect(names).toContain('resume');
    expect(names).toContain('company');
    expect(names).toContain('job');
    expect(names).toContain('application');
    expect(names).toContain('application_event');
    expect(names).toContain('workflow');
    expect(names).toContain('migrations');
  });

  it('is idempotent across repeat openings', () => {
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
  });

  it('applied three migrations', () => {
    const db = openDb(':memory:');
    const ids = (db.prepare(`SELECT id FROM migrations ORDER BY id`).all() as Array<{ id: number }>).map(r => r.id);
    expect(ids).toEqual([1, 2, 3]);
  });
});
