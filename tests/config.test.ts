import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

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
});
