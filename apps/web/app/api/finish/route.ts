import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Walk up from a starting dir until scripts/finish.mjs is found (the repo
 *  root), so this works whether Next runs with cwd at the root or apps/web. */
function findScript(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'scripts', 'finish.mjs');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const { applicationId } = (await req.json()) as { applicationId?: string };
    if (!applicationId) {
      return NextResponse.json({ ok: false, error: 'applicationId required' }, { status: 400 });
    }
    const scriptPath = findScript(process.cwd());
    if (!scriptPath) {
      return NextResponse.json({ ok: false, error: 'finish script not found — run `npm run finish -- <id>` from the project folder instead.' }, { status: 500 });
    }
    const home = process.env.CROSSWALK_HOME ?? path.join(os.homedir(), '.crosswalk');
    // Detached + unref'd: the headed browser must outlive this request so the
    // user can review and submit at their own pace.
    const child = spawn(process.execPath, [scriptPath, applicationId], {
      cwd: path.dirname(path.dirname(scriptPath)),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CROSSWALK_BROWSER_HEADED: '1',
        CROSSWALK_BROWSER_PROFILE: process.env.CROSSWALK_BROWSER_PROFILE ?? path.join(home, 'chrome')
      }
    });
    child.unref();
    return NextResponse.json({ ok: true, message: 'Opening the filled application in a browser window — review it and click Submit there.' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
