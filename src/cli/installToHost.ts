import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type InstallToHostInput = {
  configPath: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type InstallToHostResult = { configPath: string };

export async function installToHost(input: InstallToHostInput): Promise<InstallToHostResult> {
  await fs.mkdir(path.dirname(input.configPath), { recursive: true });

  let json: { mcpServers?: Record<string, unknown> } = {};
  try {
    json = JSON.parse(await fs.readFile(input.configPath, 'utf8')) as typeof json;
  } catch {
    // Missing or unparseable — start fresh.
  }
  json.mcpServers ??= {};

  json.mcpServers['crosswalk-mcp'] = {
    command: input.command,
    args: input.args,
    env: input.env ?? {}
  };

  await fs.writeFile(input.configPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  return { configPath: input.configPath };
}

export async function uninstallFromHost(opts: { configPath: string }): Promise<{ configPath: string; removed: boolean }> {
  let json: { mcpServers?: Record<string, unknown> };
  try {
    json = JSON.parse(await fs.readFile(opts.configPath, 'utf8')) as typeof json;
  } catch {
    return { configPath: opts.configPath, removed: false };
  }

  if (!json.mcpServers || !('crosswalk-mcp' in json.mcpServers)) {
    return { configPath: opts.configPath, removed: false };
  }

  delete json.mcpServers['crosswalk-mcp'];
  await fs.writeFile(opts.configPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  return { configPath: opts.configPath, removed: true };
}
