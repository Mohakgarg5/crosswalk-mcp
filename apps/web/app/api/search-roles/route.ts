import { NextResponse } from 'next/server';
import { searchRolesWeb } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { query?: string; category?: string; location?: string; pages?: number };
    const result = await searchRolesWeb(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
