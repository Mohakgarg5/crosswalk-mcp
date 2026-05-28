import { NextResponse } from 'next/server';
import { listAnswerBank, addAnswerEntry, deleteAnswerEntry, loadAnswerDefaults } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, answers: await listAnswerBank() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action?: string; label?: string; answer?: string };
    if (body.action === 'load-defaults') {
      const added = await loadAnswerDefaults();
      return NextResponse.json({ ok: true, added, answers: await listAnswerBank() });
    }
    if (!body.label?.trim() || !body.answer?.trim()) {
      return NextResponse.json({ ok: false, error: 'label and answer required' }, { status: 400 });
    }
    if (body.label.length > 200 || body.answer.length > 2000) {
      return NextResponse.json({ ok: false, error: 'label/answer too long' }, { status: 400 });
    }
    await addAnswerEntry(body.label.trim(), body.answer.trim());
    return NextResponse.json({ ok: true, answers: await listAnswerBank() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  await deleteAnswerEntry(id);
  return NextResponse.json({ ok: true });
}
