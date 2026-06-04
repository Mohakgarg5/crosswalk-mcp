import { NextResponse } from 'next/server';
import { runTool } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { name, input } = (await req.json()) as { name?: string; input?: unknown };
    if (!name) return NextResponse.json({ ok: false, error: 'missing tool name' }, { status: 400 });
    const result = await runTool(name, input);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, code: (e as { code?: string }).code },
      { status: 400 }
    );
  }
}
