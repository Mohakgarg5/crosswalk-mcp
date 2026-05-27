#!/usr/bin/env node
/**
 * Crosswalk always-on watcher (closed-app daemon).
 *
 * Runs the watch loop independently of the GUI: every N minutes it re-checks
 * each saved "watch" for new role matches and auto-applies them (per each
 * watch's auto-apply flag + your submit policy + weekly cap).
 *
 * Usage:
 *   node scripts/watch.mjs                 # loop forever (Ctrl-C to stop)
 *   CROSSWALK_WATCH_ONCE=1 node scripts/watch.mjs   # one pass, then exit (for cron)
 *
 * Env:
 *   ANTHROPIC_API_KEY                AI key (or set it once in the GUI → config.json)
 *   CROSSWALK_WATCH_INTERVAL_MIN     minutes between passes (default 15)
 *   CROSSWALK_BROWSER_PROFILE        persistent Chrome profile (for logged-in ATSes)
 *   CROSSWALK_BROWSER_HEADED=1       show the browser while it applies
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openDb, seedRegistryIfEmpty, SamplingClient, ApiSamplingBackend,
  LazyPlaywrightBrowser, runWatch, getConfig
} from 'crosswalk-mcp/runtime';

const HOME = process.env.CROSSWALK_HOME ?? path.join(os.homedir(), '.crosswalk');
const INTERVAL_MIN = Number(process.env.CROSSWALK_WATCH_INTERVAL_MIN ?? 15);
const ONCE = process.env.CROSSWALK_WATCH_ONCE === '1';

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8')).apiKey || undefined;
  } catch {
    return undefined;
  }
}

function buildCtx() {
  const db = openDb();
  seedRegistryIfEmpty(db);
  const key = apiKey();
  const sampling = key
    ? new SamplingClient(new ApiSamplingBackend({ apiKey: key, model: getConfig(db).model }))
    : new SamplingClient({ createMessage: async () => { throw new Error('No Anthropic API key — set one in the GUI or ANTHROPIC_API_KEY.'); } });
  return { db, sampling, browser: new LazyPlaywrightBrowser() };
}

async function tick() {
  const ctx = buildCtx();
  try {
    const r = await runWatch(ctx);
    console.log(`[${new Date().toISOString()}] watch → ${r.totalNew} new match(es), ${r.totalSubmitted} submitted across ${r.searches.length} watch(es)`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] watch error: ${e.message}`);
  } finally {
    try { await ctx.browser.close(); } catch { /* ignore */ }
  }
}

console.log(`Crosswalk watcher starting (interval ${INTERVAL_MIN} min${ONCE ? ', run-once' : ''}). Data: ${HOME}`);
await tick();
if (!ONCE) {
  setInterval(tick, INTERVAL_MIN * 60 * 1000);
}
