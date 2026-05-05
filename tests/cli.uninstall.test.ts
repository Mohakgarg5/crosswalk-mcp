import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { uninstallClaudeDesktop } from '../src/cli.ts';

describe('cli/uninstall', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-uninstall-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('removes the crosswalk-mcp entry from a populated config', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await fs.writeFile(cfg, JSON.stringify({
      mcpServers: {
        'crosswalk-mcp': { command: 'npx', args: ['-y', 'crosswalk-mcp@latest'] },
        'other': { command: 'x' }
      }
    }));
    const result = await uninstallClaudeDesktop({ configPath: cfg });
    expect(result.removed).toBe(true);
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp']).toBeUndefined();
    expect(json.mcpServers.other).toBeDefined();
  });

  it('returns removed=false when no entry exists', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await fs.writeFile(cfg, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    const result = await uninstallClaudeDesktop({ configPath: cfg });
    expect(result.removed).toBe(false);
  });

  it('returns removed=false when config does not exist', async () => {
    const cfg = path.join(tmp, 'nonexistent.json');
    const result = await uninstallClaudeDesktop({ configPath: cfg });
    expect(result.removed).toBe(false);
  });
});
