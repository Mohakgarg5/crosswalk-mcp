// Server-only bridge to the Crosswalk engine. Imported only from route handlers.
//
// The engine is loaded via a dynamic import that webpack is told to ignore, so
// it runs as a real Node ESM module from node_modules/crosswalk-mcp rather than
// being bundled. That keeps import.meta.url (registry resolution) correct and
// lets native deps (better-sqlite3) and the Anthropic SDK load normally.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ToolCtx, Db, AppConfig } from 'crosswalk-mcp/runtime';

type Runtime = typeof import('crosswalk-mcp/runtime');

let _rt: Runtime | null = null;
async function rt(): Promise<Runtime> {
  if (!_rt) {
    _rt = (await import(/* webpackIgnore: true */ 'crosswalk-mcp/runtime')) as Runtime;
  }
  return _rt;
}

let _db: Db | null = null;
async function db(): Promise<Db> {
  if (!_db) {
    const { openDb, seedRegistryIfEmpty } = await rt();
    _db = openDb();
    seedRegistryIfEmpty(_db);
  }
  return _db;
}

function home(): string {
  return process.env.CROSSWALK_HOME ?? path.join(os.homedir(), '.crosswalk');
}
function configPath(): string {
  return path.join(home(), 'config.json');
}

export function getApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as { apiKey?: unknown };
    return typeof c.apiKey === 'string' && c.apiKey ? c.apiKey : undefined;
  } catch {
    return undefined;
  }
}

export function setApiKey(key: string): void {
  fs.mkdirSync(home(), { recursive: true });
  let cur: Record<string, unknown> = {};
  try {
    cur = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    /* no existing config */
  }
  fs.writeFileSync(configPath(), JSON.stringify({ ...cur, apiKey: key }, null, 2), { mode: 0o600 });
}

// AI features need a key; non-AI tools (fetch_jobs, list_pipeline, ...) don't.
// Use a stub that only errors when the model is actually invoked.
async function makeSampling(d: Db) {
  const { SamplingClient, ApiSamplingBackend, getConfig } = await rt();
  type SdkServer = ConstructorParameters<typeof SamplingClient>[0];
  const apiKey = getApiKey();
  if (!apiKey) {
    const stub = {
      createMessage: async () => {
        throw new Error('No Anthropic API key set. Add one in Settings to use AI features.');
      }
    };
    return new SamplingClient(stub as unknown as SdkServer);
  }
  return new SamplingClient(new ApiSamplingBackend({ apiKey, model: getConfig(d).model }));
}

export async function buildCtx(): Promise<ToolCtx> {
  const { LazyPlaywrightBrowser } = await rt();
  const d = await db();
  return { db: d, sampling: await makeSampling(d), browser: new LazyPlaywrightBrowser() };
}

export async function runTool(name: string, input: unknown): Promise<unknown> {
  const { toolDefinitions } = await rt();
  const def = toolDefinitions.find(t => t.name === name);
  if (!def) throw new Error(`unknown tool: ${name}`);
  return def.run(input ?? {}, await buildCtx());
}

export async function readConfig(): Promise<AppConfig> {
  const { getConfig } = await rt();
  return getConfig(await db());
}

export async function writeConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const { setConfig } = await rt();
  return setConfig(await db(), patch);
}

export async function readProfile(): Promise<Record<string, unknown> | null> {
  const { getProfile } = await rt();
  return getProfile(await db());
}

export async function readApplication(id: string) {
  const { getApplication, listEventsForApplication } = await rt();
  const d = await db();
  const application = getApplication(d, id);
  if (!application) return null;
  return { application, events: listEventsForApplication(d, id) };
}

// --- Discovery alerts ---------------------------------------------------------

export async function listSearches() {
  const { listSavedSearches } = await rt();
  return listSavedSearches(await db());
}
export async function createSearch(name: string, filters: Record<string, unknown>) {
  const { createSavedSearch } = await rt();
  return createSavedSearch(await db(), { name, filters });
}
export async function deleteSearch(id: string) {
  const { deleteSavedSearch } = await rt();
  deleteSavedSearch(await db(), id);
}
export async function refreshSearches() {
  const { refreshAllSavedSearches } = await rt();
  return refreshAllSavedSearches(await db());
}
export async function listNotifs(unreadOnly = false) {
  const { listNotifications, unreadCount } = await rt();
  const d = await db();
  return { items: listNotifications(d, { unreadOnly }), unread: unreadCount(d) };
}
export async function markNotifsRead() {
  const { markAllRead } = await rt();
  return markAllRead(await db());
}

// --- Recruiter email ----------------------------------------------------------

export async function listEmails() {
  const { listInboundEmails } = await rt();
  return listInboundEmails(await db());
}
export async function ingestEmail(email: { from: string; subject: string; body: string; receivedAt?: string }) {
  const { routeEmail } = await rt();
  return routeEmail(await db(), email);
}

// --- Autonomous apply ---------------------------------------------------------

export async function autoApplyJobs(jobIds: string[], submit?: boolean) {
  const { autoApply, getConfig } = await rt();
  const ctx = await buildCtx();
  const doSubmit = submit ?? (getConfig(ctx.db).submitPolicy === 'auto');
  return autoApply({ jobIds, submit: doSubmit }, ctx);
}
