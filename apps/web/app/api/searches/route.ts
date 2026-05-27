import { NextResponse } from 'next/server';
import { listSearches, createSearch, deleteSearch, refreshSearches } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, searches: await listSearches() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action?: string; name?: string; filters?: Record<string, unknown> };
    if (body.action === 'refresh') {
      return NextResponse.json({ ok: true, result: await refreshSearches() });
    }
    if (!body.name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
    const search = await createSearch(body.name, body.filters ?? {});
    return NextResponse.json({ ok: true, search });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
    await deleteSearch(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
