import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { installToHost, uninstallFromHost } from '../src/cli/installToHost.ts';

describe('cli/installToHost', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-installhost-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates a fresh config when none exists', async () => {
    const cfg = path.join(tmp, 'cfg.json');
    await installToHost({ configPath: cfg, command: 'npx', args: ['-y', 'crosswalk-mcp@latest'] });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp'].command).toBe('npx');
    expect(json.mcpServers['crosswalk-mcp'].args).toEqual(['-y', 'crosswalk-mcp@latest']);
  });

  it('merges into an existing config without disturbing other entries', async () => {
    const cfg = path.join(tmp, 'cfg.json');
    await fs.writeFile(cfg, JSON.stringify({
      mcpServers: { other: { command: 'x', args: [] } }
    }));
    await installToHost({ configPath: cfg, command: 'npx', args: [] });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers.other).toBeDefined();
    expect(json.mcpServers['crosswalk-mcp']).toBeDefined();
  });

  it('overwrites an existing crosswalk-mcp entry', async () => {
    const cfg = path.join(tmp, 'cfg.json');
    await fs.writeFile(cfg, JSON.stringify({
      mcpServers: { 'crosswalk-mcp': { command: 'old', args: ['stale'] } }
    }));
    await installToHost({ configPath: cfg, command: 'new', args: ['fresh'] });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp'].command).toBe('new');
    expect(json.mcpServers['crosswalk-mcp'].args).toEqual(['fresh']);
  });

  it('uninstall removes the entry when present', async () => {
    const cfg = path.join(tmp, 'cfg.json');
    await fs.writeFile(cfg, JSON.stringify({
      mcpServers: {
        'crosswalk-mcp': { command: 'x', args: [] },
        'other': { command: 'y', args: [] }
      }
    }));
    const result = await uninstallFromHost({ configPath: cfg });
    expect(result.removed).toBe(true);
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp']).toBeUndefined();
    expect(json.mcpServers.other).toBeDefined();
  });

  it('uninstall returns removed=false when entry absent', async () => {
    const cfg = path.join(tmp, 'cfg.json');
    await fs.writeFile(cfg, JSON.stringify({ mcpServers: { other: { command: 'y' } } }));
    const result = await uninstallFromHost({ configPath: cfg });
    expect(result.removed).toBe(false);
  });

  it('uninstall returns removed=false when config does not exist', async () => {
    const cfg = path.join(tmp, 'nonexistent.json');
    const result = await uninstallFromHost({ configPath: cfg });
    expect(result.removed).toBe(false);
  });

  it('install honors env field', async () => {
    const cfg = path.join(tmp, 'cfg.json');
    await installToHost({
      configPath: cfg, command: 'npx', args: [],
      env: { CROSSWALK_HOME: '/some/where' }
    });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp'].env).toEqual({ CROSSWALK_HOME: '/some/where' });
  });
});
