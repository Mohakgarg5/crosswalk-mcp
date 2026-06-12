import { NextResponse } from 'next/server';
import { listSearches, createSearch, deleteSearch, refreshSearches, setSearchAutoApply, updateSearchConfig } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, searches: await listSearches() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string; id?: string; name?: string;
      filters?: Record<string, unknown>; source?: 'web' | 'companies'; autoApply?: boolean;
      resumeId?: string; minFit?: number; weeklyCap?: number; autoSubmit?: boolean;
    };
    if (body.action === 'refresh') {
      return NextResponse.json({ ok: true, result: await refreshSearches() });
    }
    if (body.action === 'set-auto') {
      if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
      await setSearchAutoApply(body.id, Boolean(body.autoApply));
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'set-config') {
      if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
      await updateSearchConfig(body.id, {
        resumeId: body.resumeId ?? null,
        minFit: body.minFit ?? null,
        weeklyCap: body.weeklyCap ?? null,
        autoSubmit: body.autoSubmit ?? null,
        ...(body.autoApply === undefined ? {} : { autoApply: body.autoApply })
      });
      return NextResponse.json({ ok: true });
    }
    if (!body.name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
    const search = await createSearch(body.name, body.filters ?? {}, body.source, body.autoApply, {
      resumeId: body.resumeId, minFit: body.minFit, weeklyCap: body.weeklyCap, autoSubmit: body.autoSubmit
    });
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
