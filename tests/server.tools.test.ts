import { describe, it, expect } from 'vitest';

describe('server tools registration', () => {
  it('exports all 8 v1 tools', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    const names = toolDefinitions.map(t => t.name).sort();
    expect(names).toEqual([
      'add_resume', 'draft_application', 'explain_fit', 'fetch_jobs',
      'list_resumes', 'score_fit', 'setup_profile', 'tailor_resume'
    ]);
  });

  it('every tool has a JSON-schema input', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    for (const t of toolDefinitions) {
      expect(t.inputSchema).toBeTypeOf('object');
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});
