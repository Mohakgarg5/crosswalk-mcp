import { NextResponse } from 'next/server';
import { listEmails, ingestEmail } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, emails: await listEmails() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { from?: string; subject?: string; body?: string };
    if (!body.from || !body.subject) {
      return NextResponse.json({ ok: false, error: 'from and subject required' }, { status: 400 });
    }
    const result = await ingestEmail({ from: body.from, subject: body.subject, body: body.body ?? '' });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
