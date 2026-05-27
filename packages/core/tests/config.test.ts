import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('config', () => {
  const original = process.env.CROSSWALK_HOME;
  beforeEach(() => { delete process.env.CROSSWALK_HOME; });
  afterEach(() => {
    if (original === undefined) delete process.env.CROSSWALK_HOME;
    else process.env.CROSSWALK_HOME = original;
  });

  it('defaults to ~/.crosswalk for stateDir', async () => {
    const { paths } = await import('../src/config.ts');
    expect(paths.stateDir()).toBe(path.join(os.homedir(), '.crosswalk'));
    expect(paths.dbFile()).toBe(path.join(os.homedir(), '.crosswalk', 'state.db'));
  });

  it('honors CROSSWALK_HOME override', async () => {
    process.env.CROSSWALK_HOME = '/tmp/cw';
    const { paths } = await import('../src/config.ts');
    expect(paths.stateDir()).toBe('/tmp/cw');
    expect(paths.dbFile()).toBe('/tmp/cw/state.db');
  });

  it('resolves registryDir to a real directory containing companies.json', async () => {
    delete process.env.CROSSWALK_REGISTRY_DIR;
    const { paths } = await import('../src/config.ts');
    const dir = paths.registryDir();
    expect(typeof dir).toBe('string');
    expect(fs.existsSync(path.join(dir, 'companies.json'))).toBe(true);
  });

  it('honors the CROSSWALK_REGISTRY_DIR override', async () => {
    process.env.CROSSWALK_REGISTRY_DIR = '/tmp/custom-registry';
    const { paths } = await import('../src/config.ts');
    expect(paths.registryDir()).toBe('/tmp/custom-registry');
    delete process.env.CROSSWALK_REGISTRY_DIR;
  });
});
