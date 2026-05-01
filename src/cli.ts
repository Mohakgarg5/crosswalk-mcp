#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

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

  if (cmd === undefined) {
    // No args — act as the MCP server (this is what Claude Desktop spawns).
    const { main: runServer } = await import('./server.ts');
    await runServer();
    return;
  }

  if (cmd === 'install') {
    const { configPath } = await installClaudeDesktop();
    console.log(`✓ Installed crosswalk-mcp into Claude Desktop at:\n  ${configPath}\n`);
    console.log(`Restart Claude Desktop to activate. State will live in ${process.env.CROSSWALK_HOME ?? '~/.crosswalk/'}.`);
    return;
  }

  if (cmd === '--version' || cmd === '-v') {
    const { SERVER_VERSION } = await import('./server.ts');
    console.log(SERVER_VERSION);
    return;
  }

  if (cmd === '--help' || cmd === '-h') {
    console.log(`Usage:
  crosswalk-mcp                 # run as MCP server (used by Claude Desktop)
  crosswalk-mcp install         # add to Claude Desktop config
  crosswalk-mcp run-scheduled   # run any workflows whose next_run_at has passed
  crosswalk-mcp --version       # print version
  crosswalk-mcp --help          # show this message`);
    return;
  }

  if (cmd === 'run-scheduled') {
    const { openDb } = await import('./store/db.ts');
    const { listDueWorkflows, recordWorkflowRun } = await import('./store/workflow.ts');
    const { runWorkflowKind } = await import('./services/workflowEngine.ts');
    const { CronExpressionParser } = await import('cron-parser');
    const db = openDb();
    const due = listDueWorkflows(db);
    if (due.length === 0) {
      console.log('No workflows due.');
      return;
    }
    for (const wf of due) {
      const result = await runWorkflowKind(db, wf.kind, wf.params);
      const interval = CronExpressionParser.parse(wf.cron, { currentDate: new Date() });
      const nextRunAt = interval.next().toDate().toISOString();
      recordWorkflowRun(db, wf.id, { status: result.status, error: result.error, nextRunAt });
      console.log(
        `[${result.status}] ${wf.id} (${wf.kind}) — next run ${nextRunAt}` +
        (result.error ? ` (error: ${result.error})` : '')
      );
    }
    return;
  }

  console.error(`Unknown command: ${cmd}\nRun \`crosswalk-mcp --help\` for usage.`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
