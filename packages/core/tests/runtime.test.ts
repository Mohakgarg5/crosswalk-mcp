import { describe, it, expect } from 'vitest';
import * as runtime from '../src/runtime.ts';
import { listRegisteredAdapters } from '../src/ats/adapter.ts';

describe('runtime library entry', () => {
  it('exposes the engine surface the web app needs', () => {
    expect(typeof runtime.openDb).toBe('function');
    expect(typeof runtime.SamplingClient).toBe('function');
    expect(typeof runtime.ApiSamplingBackend).toBe('function');
    expect(typeof runtime.LazyPlaywrightBrowser).toBe('function');
    expect(typeof runtime.seedRegistryIfEmpty).toBe('function');
    expect(typeof runtime.getConfig).toBe('function');
    expect(typeof runtime.setConfig).toBe('function');
    expect(typeof runtime.getProfile).toBe('function');
    expect(runtime.paths).toBeDefined();
    expect(Array.isArray(runtime.toolDefinitions)).toBe(true);
    expect(runtime.toolDefinitions.length).toBe(18);
  });

  it('self-registers all 10 ATS adapters on import', () => {
    expect(listRegisteredAdapters().length).toBe(10);
  });
});
