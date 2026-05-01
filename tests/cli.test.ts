import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { installClaudeDesktop } from '../src/cli.ts';

describe('cli/install', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-cli-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates a fresh config when none exists', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await installClaudeDesktop({ configPath: cfg });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp']).toBeDefined();
    expect(json.mcpServers['crosswalk-mcp'].command).toBeTypeOf('string');
  });

  it('merges into an existing config', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await fs.writeFile(cfg, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    await installClaudeDesktop({ configPath: cfg });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers.other).toBeDefined();
    expect(json.mcpServers['crosswalk-mcp']).toBeDefined();
  });
});
