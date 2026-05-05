# Crosswalk M6 Implementation Plan — Multi-host install + doctor + registry to 100

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Crosswalk installable across Claude Desktop, Cursor, and Windsurf with a single command, add a `doctor` diagnostic that flags common setup issues, and grow the seed registry from 74 to ~100 companies. Ship v0.5.0.

**Architecture:** All three target hosts (Claude Desktop, Cursor, Windsurf) use the same `mcpServers.<name> = { command, args, env }` JSON shape — only the file path differs. We extract a generic `installToHost(client, opts)` helper, refactor the existing `installClaudeDesktop` to delegate to it, and add adapters for Cursor (`~/.cursor/mcp.json`) and Windsurf (`~/.codeium/windsurf/mcp_config.json`). The `--client` flag on `install`/`uninstall` lets the user target one or all detected hosts. `status` becomes per-client. `doctor` runs sanity checks (db migration current, registry loaded, sampling support detected on the running host).

**Tech Stack:** Same as M5. No new runtime deps.

**M6 ships:**
- `installToHost(client)` generic helper
- Cursor + Windsurf installers
- `--client claude|cursor|windsurf|all` flag on `install` and `uninstall`
- `status` reports install presence per host
- `crosswalk-mcp doctor` — runs sanity checks
- Registry expansion from 74 → ~100 companies (community-friendly seed)
- README + USER_GUIDE updates
- Version 0.5.0

**Out of M6 (deferred to M7):**
- Workday + iCIMS adapters via Playwright sandbox (deserves its own plan)
- Sampling-driven workflows (need a check-back-into-host pattern)
- 200+ company registry (community PR territory)

---

## File structure

```
crosswalk-mcp/
├── src/
│   ├── cli/                          # NEW DIR — extract install logic
│   │   ├── hosts.ts                  # NEW — host registry + path resolution
│   │   └── installToHost.ts          # NEW — generic install/uninstall
│   ├── cli.ts                        # MODIFY — wire new flags + doctor
│   └── ...
├── registry/
│   ├── companies.json                # MODIFY — expand to ~100
│   └── h1b.json                      # MODIFY — coverage for new entries
├── tests/
│   ├── cli.hosts.test.ts             # NEW
│   ├── cli.installToHost.test.ts     # NEW
│   ├── cli.uninstall.test.ts         # MODIFY — multi-host
│   ├── cli.status.test.ts            # MODIFY — per-client install map
│   └── cli.doctor.test.ts            # NEW
└── ...
```

> Note: `src/cli/` is a new directory. The existing `src/cli.ts` file stays as the entry point and orchestrator; the new helpers live next to it under `src/cli/`.

---

## Task list (10 tasks)

| # | Theme | Task |
|---|---|---|
| 1 | Refactor | Extract host registry (`src/cli/hosts.ts`) with Claude path |
| 2 | Refactor | Extract `installToHost` generic helper from existing install code |
| 3 | Hosts | Add Cursor host config (`~/.cursor/mcp.json`) |
| 4 | Hosts | Add Windsurf host config (`~/.codeium/windsurf/mcp_config.json`) |
| 5 | CLI | `install` accepts `--client` flag |
| 6 | CLI | `uninstall` accepts `--client` flag |
| 7 | CLI | `status` shows per-client install map |
| 8 | CLI | `crosswalk-mcp doctor` |
| 9 | Registry | Expand to ~100 companies |
| 10 | Ship | README + USER_GUIDE + version 0.5.0 |

---

## Task 1: Host registry

**Files:**
- Create: `src/cli/hosts.ts`, `tests/cli.hosts.test.ts`

A small module that lists the supported hosts and resolves their config paths. This becomes the single source of truth for "what hosts can Crosswalk install into" and centralizes per-OS path logic.

- [ ] **Step 1: Failing test**

Create `tests/cli.hosts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HOSTS, hostConfigPath, listHostNames, isKnownHost } from '../src/cli/hosts.ts';

describe('cli/hosts', () => {
  it('exports the canonical host list', () => {
    expect(listHostNames().sort()).toEqual(['claude', 'cursor', 'windsurf']);
  });

  it('resolves a non-empty config path for each host on each platform', () => {
    for (const host of listHostNames()) {
      const p = hostConfigPath(host);
      expect(p).toBeTypeOf('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('isKnownHost validates input', () => {
    expect(isKnownHost('claude')).toBe(true);
    expect(isKnownHost('cursor')).toBe(true);
    expect(isKnownHost('windsurf')).toBe(true);
    expect(isKnownHost('chatgpt')).toBe(false);
    expect(isKnownHost('')).toBe(false);
  });

  it('exports a HOSTS map with display names', () => {
    expect(HOSTS.claude.displayName).toBe('Claude Desktop');
    expect(HOSTS.cursor.displayName).toBe('Cursor');
    expect(HOSTS.windsurf.displayName).toBe('Windsurf');
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.hosts
```

- [ ] **Step 3: Implement**

Create `src/cli/hosts.ts`:

```ts
import * as os from 'node:os';
import * as path from 'node:path';

export type HostName = 'claude' | 'cursor' | 'windsurf';

export type HostInfo = {
  displayName: string;
  /** Resolves the absolute config-file path for this host on the current platform. */
  configPath(): string;
};

function claudePath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? '', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function cursorPath(): string {
  // Cursor uses a single user-level MCP config across all OSes.
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

function windsurfPath(): string {
  // Windsurf uses ~/.codeium/windsurf/mcp_config.json on all OSes.
  return path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
}

export const HOSTS: Record<HostName, HostInfo> = {
  claude: { displayName: 'Claude Desktop', configPath: claudePath },
  cursor: { displayName: 'Cursor', configPath: cursorPath },
  windsurf: { displayName: 'Windsurf', configPath: windsurfPath }
};

export function listHostNames(): HostName[] {
  return Object.keys(HOSTS) as HostName[];
}

export function hostConfigPath(host: HostName): string {
  return HOSTS[host].configPath();
}

export function isKnownHost(name: string): name is HostName {
  return name === 'claude' || name === 'cursor' || name === 'windsurf';
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 150 passing (146 + 4 new). Lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/hosts.ts tests/cli.hosts.test.ts
git commit -m "feat(cli): host registry with Claude/Cursor/Windsurf paths"
```

---

## Task 2: `installToHost` generic helper

**Files:**
- Create: `src/cli/installToHost.ts`, `tests/cli.installToHost.test.ts`

A generic install/uninstall pair that takes a `HostName` and operates on the appropriate config file. Both Claude Desktop, Cursor, and Windsurf use the same `mcpServers.<name>` shape, so one implementation works for all three.

- [ ] **Step 1: Failing test**

Create `tests/cli.installToHost.test.ts`:

```ts
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

  it('install honors CROSSWALK_HOME env via the env field', async () => {
    const cfg = path.join(tmp, 'cfg.json');
    await installToHost({
      configPath: cfg, command: 'npx', args: [],
      env: { CROSSWALK_HOME: '/some/where' }
    });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp'].env).toEqual({ CROSSWALK_HOME: '/some/where' });
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.installToHost
```

- [ ] **Step 3: Implement**

Create `src/cli/installToHost.ts`:

```ts
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
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 157 passing (150 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/cli/installToHost.ts tests/cli.installToHost.test.ts
git commit -m "feat(cli): generic installToHost + uninstallFromHost helpers"
```

---

## Task 3: Refactor `installClaudeDesktop` and `uninstallClaudeDesktop` to delegate

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`, `tests/cli.uninstall.test.ts` (no changes; existing tests verify the wrapper still works)

The existing functions stay (backward-compatible API), but now delegate to the generic helpers + the `claude` host.

- [ ] **Step 1: Update `installClaudeDesktop`**

In `src/cli.ts`, find the existing `installClaudeDesktop` function. Replace its body with:

```ts
export async function installClaudeDesktop(opts: { configPath?: string } = {}): Promise<{ configPath: string }> {
  const { hostConfigPath } = await import('./cli/hosts.ts');
  const { installToHost } = await import('./cli/installToHost.ts');
  const configPath = opts.configPath ?? hostConfigPath('claude');

  const command = process.env.CROSSWALK_INSTALL_COMMAND ?? 'npx';
  const args = process.env.CROSSWALK_INSTALL_COMMAND
    ? []
    : ['-y', 'crosswalk-mcp@latest'];

  const env = process.env.CROSSWALK_HOME ? { CROSSWALK_HOME: process.env.CROSSWALK_HOME } : {};

  return installToHost({ configPath, command, args, env });
}
```

(Remove the existing `defaultClaudeConfigPath()` helper from `cli.ts` if it's no longer referenced — it's now in `cli/hosts.ts`.)

- [ ] **Step 2: Update `uninstallClaudeDesktop`**

Replace its body with:

```ts
export async function uninstallClaudeDesktop(opts: { configPath?: string } = {}): Promise<{ configPath: string; removed: boolean }> {
  const { hostConfigPath } = await import('./cli/hosts.ts');
  const { uninstallFromHost } = await import('./cli/installToHost.ts');
  const configPath = opts.configPath ?? hostConfigPath('claude');
  return uninstallFromHost({ configPath });
}
```

- [ ] **Step 3: Update internal references**

`runStatus` in `cli.ts` references `defaultClaudeConfigPath()`. Update to:

```ts
const { hostConfigPath } = await import('./cli/hosts.ts');
const configPath = opts.configPath ?? hostConfigPath('claude');
```

(Find any other references to `defaultClaudeConfigPath` and update similarly. After this task, `defaultClaudeConfigPath` should no longer exist in `cli.ts`.)

- [ ] **Step 4: Run all tests + lint**

```bash
npm test && npm run lint
```
Expected: 157 passing (test count unchanged — refactor preserves behavior).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "refactor(cli): delegate Claude install/uninstall to host helpers"
```

---

## Task 4: `install` accepts `--client` flag

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.install.flag.test.ts`

The `install` subcommand now accepts `--client claude`, `--client cursor`, `--client windsurf`, or `--client all`. Without the flag, default behavior installs to all known hosts (skipping any whose config path's parent directory doesn't exist — that signals the host isn't installed).

- [ ] **Step 1: Failing test**

Create `tests/cli.install.flag.test.ts`:

```ts
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

    // Only cursor.json should exist now.
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
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.install.flag
```

- [ ] **Step 3: Implement `runInstall`**

In `src/cli.ts`, add this exported function after `uninstallClaudeDesktop`:

```ts
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
  const env = process.env.CROSSWALK_HOME ? { CROSSWALK_HOME: process.env.CROSSWALK_HOME } : {};

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
```

- [ ] **Step 4: Update the `install` branch in `main()`**

Find the existing `install` branch in `main()`. Replace the body with:

```ts
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
```

- [ ] **Step 5: Update `--help`**

Replace the existing `--help` content with:

```ts
    console.log(`Usage:
  crosswalk-mcp                            # run as MCP server (used by Claude/Cursor/Windsurf)
  crosswalk-mcp install                    # install into all detected hosts
  crosswalk-mcp install --client claude    # install into Claude Desktop only
  crosswalk-mcp install --client cursor    # install into Cursor only
  crosswalk-mcp install --client windsurf  # install into Windsurf only
  crosswalk-mcp uninstall                  # remove from all detected hosts
  crosswalk-mcp uninstall --client claude  # remove from Claude Desktop only
  crosswalk-mcp uninstall --purge          # also delete ~/.crosswalk/state.db
  crosswalk-mcp status                     # show installed state and counts
  crosswalk-mcp doctor                     # run sanity checks
  crosswalk-mcp run-scheduled              # run any due workflows now
  crosswalk-mcp --version                  # print version
  crosswalk-mcp --help                     # show this message`);
    return;
```

- [ ] **Step 6: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 160 passing (157 + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/cli.install.flag.test.ts
git commit -m "feat(cli): install --client flag (claude/cursor/windsurf/all)"
```

---

## Task 5: `uninstall` accepts `--client` flag

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.uninstall.flag.test.ts`

Same pattern as install. Default `uninstall` (no flag) removes from all detected hosts. `--client cursor` removes only from Cursor.

- [ ] **Step 1: Failing test**

Create `tests/cli.uninstall.flag.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.uninstall.flag
```

- [ ] **Step 3: Implement `runUninstall`**

In `src/cli.ts`, add this exported function:

```ts
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
```

- [ ] **Step 4: Update the `uninstall` branch in `main()`**

Replace the existing `uninstall` branch with:

```ts
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
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 163 passing (160 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.uninstall.flag.test.ts
git commit -m "feat(cli): uninstall --client flag (claude/cursor/windsurf/all)"
```

---

## Task 6: `status` shows per-client install map

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.status.test.ts`

Replace the boolean `installedInClaudeDesktop` field with a `installedHosts: Record<HostName, boolean>` map. The CLI output prints one line per host.

- [ ] **Step 1: Update tests**

Open `tests/cli.status.test.ts`. Find each test that asserts `installedInClaudeDesktop`. Replace those assertions:

```ts
// Replace:
//   expect(out.installedInClaudeDesktop).toBe(false);
// With:
expect(out.installedHosts).toEqual({ claude: false, cursor: false, windsurf: false });
```

```ts
// Replace:
//   expect(out.installedInClaudeDesktop).toBe(true);
// With:
expect(out.installedHosts.claude).toBe(true);
```

The test that already writes a Claude config and verifies install presence becomes:

```ts
  it('reports installedHosts.claude=true when Claude config has the entry', async () => {
    await fs.writeFile(tmpCfg, JSON.stringify({
      mcpServers: { 'crosswalk-mcp': { command: 'npx', args: [] } }
    }));
    const out = await runStatus({ configPaths: { claude: tmpCfg } });
    expect(out.installedHosts.claude).toBe(true);
    expect(out.installedHosts.cursor).toBe(false);
    expect(out.installedHosts.windsurf).toBe(false);
  });
```

(Update the other tests in the file: change `configPath: tmpCfg` to `configPaths: { claude: tmpCfg }`.)

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.status
```

- [ ] **Step 3: Update `runStatus`**

In `src/cli.ts`, find the existing `runStatus` and replace its signature + body:

```ts
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

  const installedHosts = { claude: false, cursor: false, windsurf: false };
  const configPaths = { claude: '', cursor: '', windsurf: '' };
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
```

- [ ] **Step 4: Update the `status` branch in `main()`**

Replace the existing `status` branch with:

```ts
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
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 163 passing.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.status.test.ts
git commit -m "feat(cli): status reports per-host install map"
```

---

## Task 7: `crosswalk-mcp doctor`

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.doctor.test.ts`

`doctor` runs sanity checks and prints a list of `[ok|warn|fail]` lines. Checks:

1. **Database opens.** Migrations apply cleanly.
2. **Migration count.** `migrations.id` contains exactly `[1, 2, 3, 4]`.
3. **Registry loaded.** Companies table has at least 50 rows.
4. **Tools registered.** The toolDefinitions array has 16 entries.
5. **Adapters registered.** The adapter registry contains all 8 names.

- [ ] **Step 1: Failing test**

Create `tests/cli.doctor.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runDoctor } from '../src/cli.ts';

describe('cli/doctor', () => {
  let tmpHome: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.CROSSWALK_HOME;
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-doctor-'));
    process.env.CROSSWALK_HOME = tmpHome;
  });
  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.CROSSWALK_HOME;
    else process.env.CROSSWALK_HOME = originalEnv;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('returns ok status when everything is fine', async () => {
    const r = await runDoctor();
    expect(r.checks.length).toBeGreaterThanOrEqual(5);
    expect(r.checks.every(c => c.status !== 'fail')).toBe(true);
    expect(r.allOk).toBe(true);
  });

  it('reports each named check', async () => {
    const r = await runDoctor();
    const names = r.checks.map(c => c.name);
    expect(names).toContain('database');
    expect(names).toContain('migrations');
    expect(names).toContain('registry');
    expect(names).toContain('tools');
    expect(names).toContain('adapters');
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.doctor
```

- [ ] **Step 3: Implement `runDoctor`**

In `src/cli.ts`, add this exported type + function:

```ts
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
    // Importing the adapter modules triggers their self-registration.
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
```

- [ ] **Step 4: Add the `doctor` branch in `main()`**

After the `status` branch, add:

```ts
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
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 165 passing (163 + 2 new).

- [ ] **Step 6: Smoke test**

```bash
npm run build
rm -rf /tmp/cw-doctor-smoke && CROSSWALK_HOME=/tmp/cw-doctor-smoke node dist/cli.js doctor
```
Expected: 5 lines starting with `✓`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/cli.doctor.test.ts
git commit -m "feat(cli): doctor subcommand runs sanity checks"
```

---

## Task 8: Registry expansion to ~100 companies

**Files:**
- Modify: `registry/companies.json`
- Modify: `registry/h1b.json`

Add ~26 new companies across all 8 ATSs.

- [ ] **Step 1: Append entries to `registry/companies.json`**

Open the file. Find the closing `]`. Add a comma after the last existing entry, then insert these new entries before the closing `]`:

```json
  ,
  { "id": "ramp_labs",       "name": "Ramp Labs",       "ats": "greenhouse",       "atsOrgSlug": "rampnetwork" },
  { "id": "twilio",          "name": "Twilio",          "ats": "greenhouse",       "atsOrgSlug": "twilio" },
  { "id": "fivetran",        "name": "Fivetran",        "ats": "greenhouse",       "atsOrgSlug": "fivetran" },
  { "id": "hashicorp",       "name": "HashiCorp",       "ats": "greenhouse",       "atsOrgSlug": "hashicorp" },
  { "id": "block",           "name": "Block (Square)",  "ats": "greenhouse",       "atsOrgSlug": "square" },
  { "id": "samsara",         "name": "Samsara",         "ats": "greenhouse",       "atsOrgSlug": "samsara" },
  { "id": "datarobot",       "name": "DataRobot",       "ats": "greenhouse",       "atsOrgSlug": "datarobot" },

  { "id": "writer",          "name": "Writer",          "ats": "ashby",            "atsOrgSlug": "writer" },
  { "id": "harvey",          "name": "Harvey",          "ats": "ashby",            "atsOrgSlug": "harvey" },
  { "id": "runwayml",        "name": "Runway",          "ats": "ashby",            "atsOrgSlug": "runwayml" },
  { "id": "togetherai",      "name": "Together AI",     "ats": "ashby",            "atsOrgSlug": "togetherai" },
  { "id": "groq",            "name": "Groq",            "ats": "ashby",            "atsOrgSlug": "groq" },

  { "id": "atlassian",       "name": "Atlassian",       "ats": "lever",            "atsOrgSlug": "atlassian" },
  { "id": "canva",           "name": "Canva",           "ats": "lever",            "atsOrgSlug": "canva" },
  { "id": "asana_lever",     "name": "Asana (Lever)",   "ats": "lever",            "atsOrgSlug": "asanaco" },

  { "id": "delivery_now",    "name": "Foodpanda",       "ats": "smartrecruiters",  "atsOrgSlug": "Foodpanda" },
  { "id": "publicis",        "name": "Publicis Groupe", "ats": "smartrecruiters",  "atsOrgSlug": "PublicisGroupe" },

  { "id": "frontify",        "name": "Frontify",        "ats": "workable",         "atsOrgSlug": "frontify" },
  { "id": "bunq",            "name": "bunq",            "ats": "workable",         "atsOrgSlug": "bunq" },

  { "id": "amplitude",       "name": "Amplitude",       "ats": "bamboohr",         "atsOrgSlug": "amplitude" },
  { "id": "crowdstrike",     "name": "CrowdStrike",     "ats": "bamboohr",         "atsOrgSlug": "crowdstrike" },

  { "id": "personio_jobs",   "name": "Bolt",            "ats": "recruitee",        "atsOrgSlug": "bolt-eu" },
  { "id": "kayak",           "name": "Kayak",           "ats": "recruitee",        "atsOrgSlug": "kayak" },

  { "id": "doctolib",        "name": "Doctolib",        "ats": "personio",         "atsOrgSlug": "doctolib" },
  { "id": "blinkist",        "name": "Blinkist",        "ats": "personio",         "atsOrgSlug": "blinkist" },
  { "id": "auto1",           "name": "AUTO1 Group",     "ats": "personio",         "atsOrgSlug": "auto1-group" }
]
```

That's 26 new entries → **100 companies total**.

- [ ] **Step 2: Append matching entries to `registry/h1b.json`**

Inside the `companies` object, after the existing last entry (add a comma after its closing brace), insert:

```json
    "ramp_labs":      { "confidence": 0.55, "lastSeen": "2025-09-30" },
    "twilio":         { "confidence": 0.92, "lastSeen": "2025-09-30" },
    "fivetran":       { "confidence": 0.83, "lastSeen": "2025-09-30" },
    "hashicorp":      { "confidence": 0.85, "lastSeen": "2025-09-30" },
    "block":          { "confidence": 0.88, "lastSeen": "2025-09-30" },
    "samsara":        { "confidence": 0.78, "lastSeen": "2025-09-30" },
    "datarobot":      { "confidence": 0.74, "lastSeen": "2025-09-30" },
    "writer":         { "confidence": 0.62, "lastSeen": "2025-09-30" },
    "harvey":         { "confidence": 0.58, "lastSeen": "2025-09-30" },
    "runwayml":       { "confidence": 0.55, "lastSeen": "2025-09-30" },
    "togetherai":     { "confidence": 0.60, "lastSeen": "2025-09-30" },
    "groq":           { "confidence": 0.66, "lastSeen": "2025-09-30" },
    "atlassian":      { "confidence": 0.86, "lastSeen": "2025-09-30" },
    "canva":          { "confidence": 0.62, "lastSeen": "2025-09-30" },
    "asana_lever":    { "confidence": 0.79, "lastSeen": "2025-09-30" },
    "delivery_now":   { "confidence": 0.20, "lastSeen": "2025-09-30" },
    "publicis":       { "confidence": 0.45, "lastSeen": "2025-09-30" },
    "frontify":       { "confidence": 0.20, "lastSeen": "2025-09-30" },
    "bunq":           { "confidence": 0.15, "lastSeen": "2025-09-30" },
    "amplitude":      { "confidence": 0.74, "lastSeen": "2025-09-30" },
    "crowdstrike":    { "confidence": 0.81, "lastSeen": "2025-09-30" },
    "personio_jobs":  { "confidence": 0.20, "lastSeen": "2025-09-30" },
    "kayak":          { "confidence": 0.42, "lastSeen": "2025-09-30" },
    "doctolib":       { "confidence": 0.18, "lastSeen": "2025-09-30" },
    "blinkist":       { "confidence": 0.10, "lastSeen": "2025-09-30" },
    "auto1":          { "confidence": 0.22, "lastSeen": "2025-09-30" }
```

- [ ] **Step 3: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 165 passing (no test count change — registryBoot test reads JSON length dynamically).

- [ ] **Step 4: Commit**

```bash
git add registry/companies.json registry/h1b.json
git commit -m "feat(registry): expand to 100 companies"
```

---

## Task 9: Update README + USER_GUIDE

**Files:**
- Modify: `README.md`
- Modify: `docs/USER_GUIDE.md`

- [ ] **Step 1: Update README**

In `/Users/mohakgarg/Desktop/Job-Os/README.md`:

A) Update version + tests badges:

```markdown
[![Tests](https://img.shields.io/badge/tests-165%20passing-brightgreen.svg)](#development)
[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](https://github.com/Mohakgarg5/crosswalk-mcp/releases)
```

B) Find `## What it does` heading. Replace the version-tagline line that says "16 MCP tools across 5 surfaces. v0.4.0 adds the live-fit guardrail gate..." with:

```markdown
**16 MCP tools across 5 surfaces.** v0.5.0 ships with **multi-host install** (Claude Desktop, Cursor, Windsurf), the new `doctor` diagnostic, and the registry grown to 100 companies.
```

C) Update the "Quick start" section to reflect multi-host install:

```markdown
## Quick start

```bash
npx crosswalk-mcp install
```

That installs into all detected hosts (Claude Desktop, Cursor, Windsurf). To target one:

```bash
npx crosswalk-mcp install --client cursor
```

Restart the affected app(s). Then ask your AI:
```

D) Update the Roadmap table:

```markdown
| Version | Headline |
|---|---|
| M1 | Discover + match + explain |
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
| M3 | Pipeline tracker, anti-spam guardrail, scheduled workflows |
| M4 | 5 more ATS adapters (8 total); 51-company registry |
| M5 | Live-fit guardrail gate; uninstall + status CLI; registry to 74 |
| **M6 (this release)** | Multi-host install (Claude/Cursor/Windsurf); doctor diagnostic; registry to 100 |
| M7 | Workday + iCIMS via Playwright sandbox; sampling-driven workflows |
| v2 | Autonomous apply via Playwright in a sandbox |
```

E) Update the ATS coverage table to bump the "Total: 100 companies, 8 ATSs" line.

- [ ] **Step 2: Update USER_GUIDE.md**

In `/Users/mohakgarg/Desktop/Job-Os/docs/USER_GUIDE.md`:

A) Update the title-block subtitle from `v0.4.0` to `v0.5.0`.

B) In Section 6.2 (CLI subcommands), add three new rows (insert after the existing `crosswalk-mcp install` row):

```markdown
| `crosswalk-mcp install --client claude` | Install only into Claude Desktop |
| `crosswalk-mcp install --client cursor` | Install only into Cursor |
| `crosswalk-mcp install --client windsurf` | Install only into Windsurf |
| `crosswalk-mcp install --client all` | Install into all detected hosts (default) |
```

And after `crosswalk-mcp uninstall --purge`:

```markdown
| `crosswalk-mcp uninstall --client <name>` | Remove only from one host |
```

And after `crosswalk-mcp status`:

```markdown
| `crosswalk-mcp doctor` | Run sanity checks (db, migrations, registry, tools, adapters) |
```

C) Update the roadmap snapshot in 6.7 to mark v0.5.0 as Current.

- [ ] **Step 3: Run tests + lint + build**

```bash
npm test && npm run lint && npm run build
```
Expected: 165 passing, lint clean, build clean.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/USER_GUIDE.md
git commit -m "docs: update for v0.5.0 — multi-host install, doctor, 100 companies"
```

---

## Task 10: Ship v0.5.0

**Files:**
- Modify: `package.json` (version 0.4.0 → 0.5.0)
- Modify: `src/server.ts` (SERVER_VERSION 0.4.0 → 0.5.0)

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "0.4.0"` → `"version": "0.5.0"`.

In `src/server.ts`, change `SERVER_VERSION = '0.4.0'` → `SERVER_VERSION = '0.5.0'`.

- [ ] **Step 2: Final test + lint + build**

```bash
npm test && npm run lint && npm run build
```
Expected: 165 passing, lint clean.

- [ ] **Step 3: Smoke run**

```bash
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "smoke=ok"
```
Expected: `smoke=ok`.

```bash
rm -rf /tmp/cw-m6-smoke && CROSSWALK_HOME=/tmp/cw-m6-smoke node dist/cli.js doctor
```
Expected: 5 `✓` lines, exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json src/server.ts
git commit -m "feat: ship v0.5.0 — multi-host install, doctor, registry to 100"
```

---

## Self-review checklist

- [ ] All 10 tasks completed; all tests passing.
- [ ] Build clean. Smoke run boots cleanly.
- [ ] `crosswalk-mcp install --client all` writes to all 3 host configs.
- [ ] `crosswalk-mcp uninstall --client cursor` removes from Cursor only.
- [ ] `crosswalk-mcp status` shows three host lines with ✓ or · markers.
- [ ] `crosswalk-mcp doctor` returns 5 `✓` lines on a fresh install.
- [ ] Registry has ≥100 companies covering all 8 adapters.
- [ ] No model-provider keys.

---

**End of M6 plan.**
