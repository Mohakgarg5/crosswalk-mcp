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
