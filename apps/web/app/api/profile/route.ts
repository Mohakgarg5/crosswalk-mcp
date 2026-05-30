import { NextResponse } from 'next/server';
import { readProfile, saveProfile } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, profile: await readProfile() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const patch = (await req.json()) as Record<string, unknown>;
    if (!patch || typeof patch !== 'object') {
      return NextResponse.json({ ok: false, error: 'object body required' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, profile: await saveProfile(patch) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
