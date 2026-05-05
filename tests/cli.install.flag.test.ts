import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runInstall } from '../src/cli.ts';

describe('cli/install --client flag', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-installflag-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('installs only to the specified client', async () => {
    const claudeCfg = path.join(tmp, 'claude.json');
    const cursorCfg = path.join(tmp, 'cursor.json');
    const windsurfCfg = path.join(tmp, 'windsurf.json');
    const result = await runInstall({
      client: 'cursor',
      configPaths: { claude: claudeCfg, cursor: cursorCfg, windsurf: windsurfCfg }
    });
    expect(result.installed).toEqual(['cursor']);
    expect(result.skipped).toEqual(['claude', 'windsurf']);

    const cursorJson = JSON.parse(await fs.readFile(cursorCfg, 'utf8'));
    expect(cursorJson.mcpServers['crosswalk-mcp']).toBeDefined();

    await expect(fs.access(claudeCfg)).rejects.toThrow();
    await expect(fs.access(windsurfCfg)).rejects.toThrow();
  });

  it('installs to all clients when client=all', async () => {
    const claudeCfg = path.join(tmp, 'claude.json');
    const cursorCfg = path.join(tmp, 'cursor.json');
    const windsurfCfg = path.join(tmp, 'windsurf.json');
    const result = await runInstall({
      client: 'all',
      configPaths: { claude: claudeCfg, cursor: cursorCfg, windsurf: windsurfCfg }
    });
    expect(result.installed.sort()).toEqual(['claude', 'cursor', 'windsurf']);
    expect(result.skipped).toEqual([]);

    for (const cfg of [claudeCfg, cursorCfg, windsurfCfg]) {
      const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
      expect(json.mcpServers['crosswalk-mcp']).toBeDefined();
    }
  });

  it('rejects unknown client', async () => {
    await expect(
      runInstall({ client: 'chatgpt' as never })
    ).rejects.toThrow(/unknown client/i);
  });
});
