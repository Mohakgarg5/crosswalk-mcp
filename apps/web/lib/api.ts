// Client-side helpers that call the in-process engine via API routes.

/** Registered by ApiKeyDialog (mounted in AppShell). Resolves true once a key is saved. */
let requestApiKey: (() => Promise<boolean>) | null = null;

/**
 * Register the handler runTool awaits when a tool fails with NO_API_KEY.
 * The handler must coalesce concurrent callers — return the same pending
 * promise while a prompt is open — or each waiting call opens its own prompt.
 * Pass null to deregister (dialog unmount).
 */
export function onApiKeyNeeded(fn: (() => Promise<boolean>) | null) {
  requestApiKey = fn;
}

type ToolResponse = { ok: boolean; result?: unknown; error?: string; code?: string };

async function callTool(name: string, input?: unknown): Promise<ToolResponse> {
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, input })
  });
  return res.json();
}

export async function runTool<T = unknown>(name: string, input?: unknown): Promise<T> {
  let data = await callTool(name, input);
  // Missing key: ask for one in place, then retry the call exactly once.
  if (!data.ok && data.code === 'NO_API_KEY' && requestApiKey) {
    if (await requestApiKey()) data = await callTool(name, input);
  }
  if (!data.ok) throw new Error(data.error || `tool ${name} failed`);
  return data.result as T;
}

export type Settings = {
  hasKey: boolean;
  config: { model: string; weeklyCap: number; submitPolicy: 'review' | 'auto'; applyMaxSteps: number };
};

export async function getSettings(): Promise<Settings> {
  const res = await fetch('/api/settings');
  return res.json();
}

export async function saveSettings(patch: {
  apiKey?: string;
  model?: string;
  weeklyCap?: number;
  submitPolicy?: 'review' | 'auto';
  applyMaxSteps?: number;
}): Promise<Settings> {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'failed to save settings');
  return data.settings as Settings;
}
