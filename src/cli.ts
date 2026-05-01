#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

function defaultClaudeConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? '', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

export async function installClaudeDesktop(opts: { configPath?: string } = {}): Promise<{ configPath: string }> {
  const configPath = opts.configPath ?? defaultClaudeConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  let json: { mcpServers?: Record<string, unknown> } = {};
  try {
    json = JSON.parse(await fs.readFile(configPath, 'utf8')) as typeof json;
  } catch {
    // File missing or unreadable — start fresh.
  }
  json.mcpServers ??= {};

  // Use the local binary if running from a clone; npx if installed globally.
  const command = process.env.CROSSWALK_INSTALL_COMMAND ?? 'npx';
  const args = process.env.CROSSWALK_INSTALL_COMMAND
    ? []
    : ['-y', 'crosswalk-mcp@latest'];

  json.mcpServers['crosswalk-mcp'] = {
    command,
    args,
    env: process.env.CROSSWALK_HOME ? { CROSSWALK_HOME: process.env.CROSSWALK_HOME } : {}
  };

  await fs.writeFile(configPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  return { configPath };
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'install') {
    const { configPath } = await installClaudeDesktop();
    console.log(`✓ Installed crosswalk-mcp into Claude Desktop at:\n  ${configPath}\n`);
    console.log(`Restart Claude Desktop to activate. State will live in ${process.env.CROSSWALK_HOME ?? '~/.crosswalk/'}.`);
    return;
  }
  console.log(`Usage:\n  crosswalk-mcp install   # add this MCP to Claude Desktop`);
  process.exit(cmd ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
