import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runDoctor } from '../src/cli.ts';

describe('cli/doctor', () => {
  let tmpHome: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.CROSSWALK_HOME;
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-doctor-'));
    process.env.CROSSWALK_HOME = tmpHome;
  });
  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.CROSSWALK_HOME;
    else process.env.CROSSWALK_HOME = originalEnv;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('returns ok status when everything is fine', async () => {
    const r = await runDoctor();
    expect(r.checks.length).toBeGreaterThanOrEqual(5);
    expect(r.checks.every(c => c.status !== 'fail')).toBe(true);
    expect(r.allOk).toBe(true);
  });

  it('reports each named check', async () => {
    const r = await runDoctor();
    const names = r.checks.map(c => c.name);
    expect(names).toContain('database');
    expect(names).toContain('migrations');
    expect(names).toContain('registry');
    expect(names).toContain('tools');
    expect(names).toContain('adapters');
    expect(names).toContain('browser');
  });

  it('tools check passes with 18 tools registered', async () => {
    const r = await runDoctor();
    const tools = r.checks.find(c => c.name === 'tools');
    expect(tools?.status).toBe('ok');
    expect(tools?.message).toMatch(/18 tools/);
  });
});
