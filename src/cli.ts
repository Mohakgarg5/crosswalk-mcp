#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function installClaudeDesktop(opts: { configPath?: string } = {}): Promise<{ configPath: string }> {
  const { hostConfigPath } = await import('./cli/hosts.ts');
  const { installToHost } = await import('./cli/installToHost.ts');
  const configPath = opts.configPath ?? hostConfigPath('claude');

  const command = process.env.CROSSWALK_INSTALL_COMMAND ?? 'npx';
  const args = process.env.CROSSWALK_INSTALL_COMMAND
    ? []
    : ['-y', 'crosswalk-mcp@latest'];
  const env: Record<string, string> = process.env.CROSSWALK_HOME
    ? { CROSSWALK_HOME: process.env.CROSSWALK_HOME }
    : {};

  return installToHost({ configPath, command, args, env });
}

export async function uninstallClaudeDesktop(opts: { configPath?: string } = {}): Promise<{ configPath: string; removed: boolean }> {
  const { hostConfigPath } = await import('./cli/hosts.ts');
  const { uninstallFromHost } = await import('./cli/installToHost.ts');
  const configPath = opts.configPath ?? hostConfigPath('claude');
  return uninstallFromHost({ configPath });
}

export type RunInstallInput = {
  client: 'claude' | 'cursor' | 'windsurf' | 'all';
  configPaths?: Partial<Record<'claude' | 'cursor' | 'windsurf', string>>;
};

export type RunInstallResult = {
  installed: string[];
  skipped: string[];
  paths: Record<string, string>;
};

export async function runInstall(input: RunInstallInput): Promise<RunInstallResult> {
  const { listHostNames, hostConfigPath, isKnownHost } = await import('./cli/hosts.ts');
  const { installToHost } = await import('./cli/installToHost.ts');

  if (input.client !== 'all' && !isKnownHost(input.client)) {
    throw new Error(`unknown client: ${input.client}`);
  }

  const targets = input.client === 'all' ? listHostNames() : [input.client];

  const command = process.env.CROSSWALK_INSTALL_COMMAND ?? 'npx';
  const args = process.env.CROSSWALK_INSTALL_COMMAND
    ? []
    : ['-y', 'crosswalk-mcp@latest'];
  const env: Record<string, string> = process.env.CROSSWALK_HOME
    ? { CROSSWALK_HOME: process.env.CROSSWALK_HOME }
    : {};

  const installed: string[] = [];
  const skipped: string[] = [];
  const paths: Record<string, string> = {};

  for (const host of listHostNames()) {
    const cfgPath = input.configPaths?.[host] ?? hostConfigPath(host);
    paths[host] = cfgPath;
    if (!targets.includes(host)) {
      skipped.push(host);
      continue;
    }
    await installToHost({ configPath: cfgPath, command, args, env });
    installed.push(host);
  }

  return { installed, skipped, paths };
}

export type RunUninstallInput = {
  client: 'claude' | 'cursor' | 'windsurf' | 'all';
  configPaths?: Partial<Record<'claude' | 'cursor' | 'windsurf', string>>;
};

export type RunUninstallResult = {
  removed: string[];
  notFound: string[];
  skipped: string[];
  paths: Record<string, string>;
};

export async function runUninstall(input: RunUninstallInput): Promise<RunUninstallResult> {
  const { listHostNames, hostConfigPath, isKnownHost } = await import('./cli/hosts.ts');
  const { uninstallFromHost } = await import('./cli/installToHost.ts');

  if (input.client !== 'all' && !isKnownHost(input.client)) {
    throw new Error(`unknown client: ${input.client}`);
  }

  const targets = input.client === 'all' ? listHostNames() : [input.client];

  const removed: string[] = [];
  const notFound: string[] = [];
  const skipped: string[] = [];
  const paths: Record<string, string> = {};

  for (const host of listHostNames()) {
    const cfgPath = input.configPaths?.[host] ?? hostConfigPath(host);
    paths[host] = cfgPath;
    if (!targets.includes(host)) {
      skipped.push(host);
      continue;
    }
    const result = await uninstallFromHost({ configPath: cfgPath });
    if (result.removed) removed.push(host);
    else notFound.push(host);
  }

  return { removed, notFound, skipped, paths };
}

export type DoctorCheck = {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  allOk: boolean;
};

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. Database
  let db: ReturnType<typeof import('./store/db.ts').openDb> | null = null;
  try {
    const { openDb } = await import('./store/db.ts');
    db = openDb();
    checks.push({ name: 'database', status: 'ok', message: 'opened and migrated' });
  } catch (e) {
    checks.push({ name: 'database', status: 'fail', message: (e as Error).message });
  }

  // 2. Migrations
  if (db) {
    try {
      const ids = (db.prepare(`SELECT id FROM migrations ORDER BY id`).all() as Array<{ id: number }>).map(r => r.id);
      const expected = [1, 2, 3, 4];
      if (JSON.stringify(ids) === JSON.stringify(expected)) {
        checks.push({ name: 'migrations', status: 'ok', message: `applied: [${ids.join(', ')}]` });
      } else {
        checks.push({ name: 'migrations', status: 'fail', message: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(ids)}` });
      }
    } catch (e) {
      checks.push({ name: 'migrations', status: 'fail', message: (e as Error).message });
    }
  } else {
    checks.push({ name: 'migrations', status: 'fail', message: 'skipped (database unavailable)' });
  }

  // 3. Registry
  if (db) {
    try {
      const { listAllCompanies } = await import('./store/company.ts');
      const { seedRegistryIfEmpty } = await import('./registryBoot.ts');
      seedRegistryIfEmpty(db);
      const count = listAllCompanies(db).length;
      if (count >= 50) {
        checks.push({ name: 'registry', status: 'ok', message: `${count} companies loaded` });
      } else if (count > 0) {
        checks.push({ name: 'registry', status: 'warn', message: `${count} companies (expected ≥ 50)` });
      } else {
        checks.push({ name: 'registry', status: 'fail', message: 'no companies loaded' });
      }
    } catch (e) {
      checks.push({ name: 'registry', status: 'fail', message: (e as Error).message });
    }
  }

  // 4. Tools
  try {
    const { toolDefinitions } = await import('./tools/index.ts');
    if (toolDefinitions.length === 16) {
      checks.push({ name: 'tools', status: 'ok', message: `${toolDefinitions.length} tools registered` });
    } else {
      checks.push({ name: 'tools', status: 'warn', message: `${toolDefinitions.length} tools (expected 16)` });
    }
  } catch (e) {
    checks.push({ name: 'tools', status: 'fail', message: (e as Error).message });
  }

  // 5. Adapters
  try {
    await import('./ats/greenhouse.ts');
    await import('./ats/lever.ts');
    await import('./ats/ashby.ts');
    await import('./ats/workable.ts');
    await import('./ats/smartrecruiters.ts');
    await import('./ats/bamboohr.ts');
    await import('./ats/recruitee.ts');
    await import('./ats/personio.ts');
    const { listRegisteredAdapters } = await import('./ats/adapter.ts');
    const names = listRegisteredAdapters().sort();
    const expected = ['ashby', 'bamboohr', 'greenhouse', 'lever', 'personio', 'recruitee', 'smartrecruiters', 'workable'];
    const missing = expected.filter(n => !names.includes(n));
    if (missing.length === 0) {
      checks.push({ name: 'adapters', status: 'ok', message: `${names.length} adapters: ${names.join(', ')}` });
    } else {
      checks.push({ name: 'adapters', status: 'fail', message: `missing: ${missing.join(', ')}` });
    }
  } catch (e) {
    checks.push({ name: 'adapters', status: 'fail', message: (e as Error).message });
  }

  return { checks, allOk: checks.every(c => c.status !== 'fail') };
}

export type StatusReport = {
  version: string;
  stateDir: string;
  dbFile: string;
  dbExists: boolean;
  dbSizeBytes: number;
  profile: boolean;
  resumes: number;
  jobs: number;
  applicationsByStatus: Record<string, number>;
  workflows: number;
  installedHosts: Record<'claude' | 'cursor' | 'windsurf', boolean>;
  configPaths: Record<'claude' | 'cursor' | 'windsurf', string>;
};

export async function runStatus(opts: {
  configPaths?: Partial<Record<'claude' | 'cursor' | 'windsurf', string>>;
} = {}): Promise<StatusReport> {
  const { paths } = await import('./config.ts');
  const { openDb } = await import('./store/db.ts');
  const { SERVER_VERSION } = await import('./server.ts');
  const { listHostNames, hostConfigPath } = await import('./cli/hosts.ts');

  const stateDir = paths.stateDir();
  const dbFile = paths.dbFile();

  const db = openDb();
  const dbExists = existsSync(dbFile);
  const dbSizeBytes = dbExists ? statSync(dbFile).size : 0;

  const profileRow = db.prepare(`SELECT COUNT(*) AS n FROM profile`).get() as { n: number };
  const resumeRow = db.prepare(`SELECT COUNT(*) AS n FROM resume`).get() as { n: number };
  const jobRow = db.prepare(`SELECT COUNT(*) AS n FROM job`).get() as { n: number };
  const workflowRow = db.prepare(`SELECT COUNT(*) AS n FROM workflow`).get() as { n: number };

  const statusRows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM application GROUP BY status`
  ).all() as Array<{ status: string; n: number }>;
  const applicationsByStatus: Record<string, number> = {};
  for (const r of statusRows) applicationsByStatus[r.status] = r.n;

  const installedHosts: Record<'claude' | 'cursor' | 'windsurf', boolean> = {
    claude: false, cursor: false, windsurf: false
  };
  const configPaths: Record<'claude' | 'cursor' | 'windsurf', string> = {
    claude: '', cursor: '', windsurf: ''
  };
  for (const host of listHostNames()) {
    const cfgPath = opts.configPaths?.[host] ?? hostConfigPath(host);
    configPaths[host] = cfgPath;
    try {
      const json = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
      installedHosts[host] = Boolean(json.mcpServers && 'crosswalk-mcp' in json.mcpServers);
    } catch {
      installedHosts[host] = false;
    }
  }

  return {
    version: SERVER_VERSION,
    stateDir,
    dbFile,
    dbExists,
    dbSizeBytes,
    profile: profileRow.n > 0,
    resumes: resumeRow.n,
    jobs: jobRow.n,
    applicationsByStatus,
    workflows: workflowRow.n,
    installedHosts,
    configPaths
  };
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
    const clientIdx = process.argv.indexOf('--client');
    const clientArg = clientIdx >= 0 ? process.argv[clientIdx + 1] : 'all';
    const { isKnownHost } = await import('./cli/hosts.ts');
    if (clientArg !== 'all' && !isKnownHost(clientArg)) {
      console.error(`Unknown --client value: ${clientArg}. Use one of: claude, cursor, windsurf, all`);
      process.exit(1);
    }
    const result = await runInstall({ client: clientArg as 'claude' | 'cursor' | 'windsurf' | 'all' });
    if (result.installed.length === 0) {
      console.log('Nothing installed (no targets matched).');
    } else {
      console.log(`✓ Installed crosswalk-mcp into:`);
      for (const host of result.installed) {
        console.log(`  ${host}: ${result.paths[host]}`);
      }
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped: ${result.skipped.join(', ')}`);
    }
    console.log(`Restart the affected app(s) to activate. State at ${process.env.CROSSWALK_HOME ?? '~/.crosswalk/'}.`);
    return;
  }

  if (cmd === 'uninstall') {
    const purge = process.argv.includes('--purge');
    const clientIdx = process.argv.indexOf('--client');
    const clientArg = clientIdx >= 0 ? process.argv[clientIdx + 1] : 'all';
    const { isKnownHost } = await import('./cli/hosts.ts');
    if (clientArg !== 'all' && !isKnownHost(clientArg)) {
      console.error(`Unknown --client value: ${clientArg}. Use one of: claude, cursor, windsurf, all`);
      process.exit(1);
    }
    const result = await runUninstall({ client: clientArg as 'claude' | 'cursor' | 'windsurf' | 'all' });
    if (result.removed.length > 0) {
      console.log(`✓ Removed crosswalk-mcp from:`);
      for (const host of result.removed) {
        console.log(`  ${host}: ${result.paths[host]}`);
      }
    } else {
      console.log(`(Nothing to remove — no matching entries found.)`);
    }
    if (result.notFound.length > 0) {
      console.log(`Not present in: ${result.notFound.join(', ')}`);
    }
    if (purge) {
      const { paths } = await import('./config.ts');
      const fsSync = await import('node:fs');
      const stateDir = paths.stateDir();
      try {
        fsSync.rmSync(stateDir, { recursive: true, force: true });
        console.log(`✓ Purged state at ${stateDir}`);
      } catch (e) {
        console.error(`(Failed to purge ${stateDir}: ${(e as Error).message})`);
      }
    } else {
      console.log(`State at ${process.env.CROSSWALK_HOME ?? '~/.crosswalk/'} preserved. Pass --purge to delete.`);
    }
    return;
  }

  if (cmd === 'status') {
    const r = await runStatus();
    console.log(`Crosswalk v${r.version}`);
    console.log(`State: ${r.stateDir}`);
    console.log(`  db: ${r.dbExists ? `${r.dbFile} (${(r.dbSizeBytes / 1024).toFixed(1)} KB)` : '(not yet created)'}`);
    console.log(`  profile: ${r.profile ? 'set' : 'unset'}`);
    console.log(`  resumes: ${r.resumes}`);
    console.log(`  jobs (cached): ${r.jobs}`);
    console.log(`  applications: ${Object.entries(r.applicationsByStatus).map(([s, n]) => `${s}=${n}`).join(', ') || '(none)'}`);
    console.log(`  workflows: ${r.workflows}`);
    console.log(`Hosts:`);
    for (const host of ['claude', 'cursor', 'windsurf'] as const) {
      const mark = r.installedHosts[host] ? '✓' : '·';
      console.log(`  ${mark} ${host}: ${r.configPaths[host]}`);
    }
    return;
  }

  if (cmd === 'doctor') {
    const r = await runDoctor();
    for (const c of r.checks) {
      const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✗';
      console.log(`  ${icon} ${c.name}: ${c.message}`);
    }
    if (!r.allOk) {
      process.exit(1);
    }
    return;
  }

  if (cmd === '--version' || cmd === '-v') {
    const { SERVER_VERSION } = await import('./server.ts');
    console.log(SERVER_VERSION);
    return;
  }

  if (cmd === '--help' || cmd === '-h') {
    console.log(`Usage:
  crosswalk-mcp                            # run as MCP server
  crosswalk-mcp install                    # install into all detected hosts
  crosswalk-mcp install --client claude    # install into Claude Desktop only
  crosswalk-mcp install --client cursor    # install into Cursor only
  crosswalk-mcp install --client windsurf  # install into Windsurf only
  crosswalk-mcp uninstall                  # remove from all detected hosts
  crosswalk-mcp uninstall --purge          # also delete ~/.crosswalk/state.db
  crosswalk-mcp status                     # show installed state and counts
  crosswalk-mcp doctor                     # run sanity checks (added in M6-7)
  crosswalk-mcp run-scheduled              # run any due workflows now
  crosswalk-mcp --version                  # print version
  crosswalk-mcp --help                     # show this message`);
    return;
  }

  if (cmd === 'run-scheduled') {
    const { openDb } = await import('./store/db.ts');
    const { claimDueWorkflow, recordWorkflowRun } = await import('./store/workflow.ts');
    const { runWorkflowKind } = await import('./services/workflowEngine.ts');
    const { CronExpressionParser } = await import('cron-parser');
    const db = openDb();

    let ran = 0;
    while (true) {
      const wf = claimDueWorkflow(db);
      if (!wf) break;
      const result = await runWorkflowKind(db, wf.kind, wf.params);
      const interval = CronExpressionParser.parse(wf.cron, { currentDate: new Date() });
      const nextRunAt = interval.next().toDate().toISOString();
      recordWorkflowRun(db, wf.id, { status: result.status, error: result.error, nextRunAt });
      ran++;
      console.log(
        `[${result.status}] ${wf.id} (${wf.kind}) — next run ${nextRunAt}` +
        (result.error ? ` (error: ${result.error})` : '')
      );
    }
    if (ran === 0) console.log('No workflows due.');
    return;
  }

  console.error(`Unknown command: ${cmd}\nRun \`crosswalk-mcp --help\` for usage.`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
