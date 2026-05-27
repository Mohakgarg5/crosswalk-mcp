// Client-side helpers that call the in-process engine via API routes.

export async function runTool<T = unknown>(name: string, input?: unknown): Promise<T> {
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, input })
  });
  const data = await res.json();
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
