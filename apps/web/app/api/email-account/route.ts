import { NextResponse } from 'next/server';
import { readEmailAccount, saveEmailAccount, testEmailConnection } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const acct = await readEmailAccount();
  // Never return the password to the browser.
  const safe = acct
    ? { provider: acct.provider, address: acct.address, hasPassword: Boolean((acct.config as { appPassword?: string }).appPassword) }
    : null;
  return NextResponse.json({ ok: true, account: safe });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { provider?: string; address?: string; appPassword?: string; host?: string; port?: number; secure?: boolean; test?: boolean };
    if (!body.provider || !body.address) {
      return NextResponse.json({ ok: false, error: 'provider and address are required' }, { status: 400 });
    }
    // Merge over the existing stored config. The GET handler masks the password
    // (the browser never holds it), so a Save/Test that omits appPassword must
    // PRESERVE the saved one rather than wipe it. A re-typed password overrides.
    const existing = await readEmailAccount();
    const acct = {
      provider: body.provider,
      address: body.address,
      config: {
        ...(existing?.config ?? {}),
        ...(body.appPassword ? { appPassword: body.appPassword } : {}),
        ...(body.host ? { host: body.host } : {}),
        ...(body.port ? { port: body.port } : {}),
        ...(typeof body.secure === 'boolean' ? { secure: body.secure } : {})
      }
    };
    if (body.test) {
      const result = await testEmailConnection(acct);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    await saveEmailAccount(acct);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
