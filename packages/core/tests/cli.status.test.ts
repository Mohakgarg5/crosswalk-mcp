import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runStatus } from '../src/cli.ts';

describe('cli/status', () => {
  let tmpHome: string;
  let tmpCfg: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.CROSSWALK_HOME;
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-status-'));
    tmpCfg = path.join(tmpHome, 'claude_desktop_config.json');
    process.env.CROSSWALK_HOME = tmpHome;
  });
  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.CROSSWALK_HOME;
    else process.env.CROSSWALK_HOME = originalEnv;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('reports counts when state.db is empty (newly created)', async () => {
    const out = await runStatus({
      configPaths: {
        claude: path.join(tmpHome, 'claude.json'),
        cursor: path.join(tmpHome, 'cursor.json'),
        windsurf: path.join(tmpHome, 'windsurf.json')
      }
    });
    expect(out.stateDir).toBe(tmpHome);
    expect(out.dbExists).toBe(true);
    expect(out.profile).toBe(false);
    expect(out.resumes).toBe(0);
    expect(out.applicationsByStatus).toEqual({});
    expect(out.workflows).toBe(0);
    expect(out.installedHosts).toEqual({ claude: false, cursor: false, windsurf: false });
  });

  it('reports installedHosts.claude=true when Claude config has the entry', async () => {
    await fs.writeFile(tmpCfg, JSON.stringify({
      mcpServers: { 'crosswalk-mcp': { command: 'npx', args: [] } }
    }));
    const out = await runStatus({ configPaths: { claude: tmpCfg } });
    expect(out.installedHosts.claude).toBe(true);
    expect(out.installedHosts.cursor).toBe(false);
    expect(out.installedHosts.windsurf).toBe(false);
  });

  it('counts applications grouped by status', async () => {
    const { openDb } = await import('../src/store/db.ts');
    const { upsertCompany } = await import('../src/store/company.ts');
    const { upsertJobs } = await import('../src/store/job.ts');
    const { addResume } = await import('../src/store/resume.ts');
    const { createApplication, updateApplicationStatus } = await import('../src/store/application.ts');
    const db = openDb();
    upsertCompany(db, { id: 'c', name: 'C', ats: 'greenhouse', atsOrgSlug: 'c' });
    upsertJobs(db, [{ id: 'j', companyId: 'c', title: 't', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r', label: 'L', rawText: 't', parsed: {} });
    createApplication(db, {
      id: 'a1', jobId: 'j', resumeId: 'r',
      tailoredResumeMd: '#', coverLetterMd: '.',
      answerPack: {}, deepLink: 'https://x'
    });
    createApplication(db, {
      id: 'a2', jobId: 'j', resumeId: 'r',
      tailoredResumeMd: '#', coverLetterMd: '.',
      answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'a2', 'submitted');

    const out = await runStatus({ configPaths: { claude: tmpCfg } });
    expect(out.applicationsByStatus).toEqual({ draft: 1, submitted: 1 });
    expect(out.resumes).toBe(1);
  });
});
