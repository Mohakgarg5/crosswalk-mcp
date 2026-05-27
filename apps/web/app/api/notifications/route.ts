import { NextResponse } from 'next/server';
import { listNotifs, markNotifsRead } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get('unread') === '1';
  return NextResponse.json({ ok: true, ...(await listNotifs(unreadOnly)) });
}

export async function POST() {
  const changed = await markNotifsRead();
  return NextResponse.json({ ok: true, changed });
}
