import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runUninstall } from '../src/cli.ts';

describe('cli/uninstall --client flag', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-uninstallflag-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('removes from a single specified client', async () => {
    const claudeCfg = path.join(tmp, 'claude.json');
    const cursorCfg = path.join(tmp, 'cursor.json');
    await fs.writeFile(claudeCfg, JSON.stringify({
      mcpServers: { 'crosswalk-mcp': { command: 'npx', args: [] } }
    }));
    await fs.writeFile(cursorCfg, JSON.stringify({
      mcpServers: { 'crosswalk-mcp': { command: 'npx', args: [] } }
    }));

    const result = await runUninstall({
      client: 'cursor',
      configPaths: { claude: claudeCfg, cursor: cursorCfg, windsurf: '/tmp/never' }
    });
    expect(result.removed).toEqual(['cursor']);
    expect(result.skipped).toEqual(['claude', 'windsurf']);

    const cursorJson = JSON.parse(await fs.readFile(cursorCfg, 'utf8'));
    expect(cursorJson.mcpServers['crosswalk-mcp']).toBeUndefined();

    const claudeJson = JSON.parse(await fs.readFile(claudeCfg, 'utf8'));
    expect(claudeJson.mcpServers['crosswalk-mcp']).toBeDefined();
  });

  it('removes from all clients when client=all and entries exist', async () => {
    const claudeCfg = path.join(tmp, 'claude.json');
    const cursorCfg = path.join(tmp, 'cursor.json');
    const windsurfCfg = path.join(tmp, 'windsurf.json');
    for (const cfg of [claudeCfg, cursorCfg, windsurfCfg]) {
      await fs.writeFile(cfg, JSON.stringify({
        mcpServers: { 'crosswalk-mcp': { command: 'npx', args: [] } }
      }));
    }
    const result = await runUninstall({
      client: 'all',
      configPaths: { claude: claudeCfg, cursor: cursorCfg, windsurf: windsurfCfg }
    });
    expect(result.removed.sort()).toEqual(['claude', 'cursor', 'windsurf']);
  });

  it('returns notFound for clients with no entry', async () => {
    const cursorCfg = path.join(tmp, 'cursor.json');
    await fs.writeFile(cursorCfg, JSON.stringify({ mcpServers: {} }));
    const result = await runUninstall({
      client: 'all',
      configPaths: { claude: '/tmp/never1', cursor: cursorCfg, windsurf: '/tmp/never2' }
    });
    expect(result.removed).toEqual([]);
    expect(result.notFound.sort()).toEqual(['claude', 'cursor', 'windsurf']);
  });
});
