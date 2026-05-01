import type { ATSAdapter } from './types.ts';

const registry = new Map<string, ATSAdapter>();

export function registerAdapter(a: ATSAdapter): void {
  registry.set(a.name, a);
}

export function getAdapter(name: string): ATSAdapter {
  const a = registry.get(name);
  if (!a) throw new Error(`unknown ats: ${name}`);
  return a;
}

export function listRegisteredAdapters(): string[] {
  return [...registry.keys()];
}
