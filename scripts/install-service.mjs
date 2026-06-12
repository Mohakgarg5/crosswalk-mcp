#!/usr/bin/env node
/**
 * Install (or remove) the Crosswalk watcher as a macOS LaunchAgent so it finds
 * and applies to new matching jobs every N minutes — on login, across reboots,
 * whether or not the app is open. The "always-on" runner.
 *
 * Usage:
 *   node scripts/install-service.mjs            # install + load
 *   node scripts/install-service.mjs uninstall  # unload + remove
 *
 * Env (mirrors `npm run watch`):
 *   CROSSWALK_WATCH_INTERVAL_MIN  minutes between passes (default 15)
 *   CROSSWALK_BROWSER_PROFILE     persistent Chrome profile (logged-in ATSes)
 *   CROSSWALK_BROWSER_HEADED=1    show the browser while applying
 *   CROSSWALK_HOME                data dir (default ~/.crosswalk)
 *
 * macOS only (launchd). On other platforms it prints the manual `npm run watch`
 * fallback and exits without error.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildLaunchAgentPlist, launchAgentPlistPath, LAUNCH_AGENT_LABEL } from 'crosswalk-mcp/runtime';

const mode = process.argv[2] === 'uninstall' ? 'uninstall' : 'install';
const osHome = os.homedir();
const plistPath = launchAgentPlistPath(osHome);

if (process.platform !== 'darwin') {
  console.log('Background service install is macOS-only. On this platform, run the watcher manually:\n  npm run watch');
  process.exit(0);
}

function tryLaunchctl(args) {
  try { execFileSync('launchctl', args, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

if (mode === 'uninstall') {
  tryLaunchctl(['unload', plistPath]); // ignore "not loaded"
  if (fs.existsSync(plistPath)) fs.rmSync(plistPath);
  console.log(`Removed the Crosswalk background service (${LAUNCH_AGENT_LABEL}).`);
  process.exit(0);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'watch.mjs');
const home = process.env.CROSSWALK_HOME ?? path.join(osHome, '.crosswalk');
const intervalMin = Number(process.env.CROSSWALK_WATCH_INTERVAL_MIN ?? 15);

const plist = buildLaunchAgentPlist({
  nodePath: process.execPath,
  scriptPath,
  workingDir: repoRoot,
  home,
  intervalMin,
  ...(process.env.CROSSWALK_BROWSER_HEADED === '1' ? { headed: true } : {}),
  ...(process.env.CROSSWALK_BROWSER_PROFILE ? { browserProfile: process.env.CROSSWALK_BROWSER_PROFILE } : {})
});

fs.mkdirSync(path.dirname(plistPath), { recursive: true });
fs.writeFileSync(plistPath, plist);

// Idempotent: unload any previous version before loading the new one.
tryLaunchctl(['unload', plistPath]);
const loaded = tryLaunchctl(['load', plistPath]);

console.log(`Installed the Crosswalk background service → ${plistPath}`);
console.log(loaded
  ? `It will run every ${intervalMin} min (and on login). Logs: ${path.join(home, 'watch.log')}`
  : `Wrote the plist but \`launchctl load\` failed — load it yourself with:\n  launchctl load ${plistPath}`);
console.log(`To stop it: npm run service:uninstall`);
