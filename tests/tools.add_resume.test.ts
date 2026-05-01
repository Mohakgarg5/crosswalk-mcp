import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { listResumes } from '../src/store/resume.ts';
import { addResume } from '../src/tools/add_resume.ts';
import { listResumesTool } from '../src/tools/list_resumes.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/add_resume + list_resumes', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('extracts text from a path, structures it, and stores it', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        skills: ['python', 'sql'], experiences: [{ company: 'Acme', title: 'APM' }]
      })
    } as unknown as SamplingClient;

    const out = await addResume(
      { path: 'tests/fixtures/resume.txt', label: 'Generic PM' },
      { db, sampling }
    );
    expect(out.id).toBeTypeOf('string');
    expect(listResumes(db)).toHaveLength(1);

    const list = await listResumesTool({}, { db });
    expect(list.resumes[0].label).toBe('Generic PM');
  });
});
