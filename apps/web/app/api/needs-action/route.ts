import { NextResponse } from 'next/server';
import { listNeedsAction } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, items: await listNeedsAction() });
}
