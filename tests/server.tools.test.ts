import { describe, it, expect } from 'vitest';

describe('server tools registration', () => {
  it('exports all 17 v1 tools', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    const names = toolDefinitions.map(t => t.name).sort();
    expect(names).toEqual([
      'add_note', 'add_resume', 'delete_workflow', 'draft_application',
      'explain_fit', 'fetch_jobs', 'list_pipeline', 'list_resumes',
      'list_workflows', 'preview_application', 'run_workflow',
      'schedule_workflow', 'score_fit', 'set_status',
      'setup_profile', 'submit_application', 'tailor_resume'
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
