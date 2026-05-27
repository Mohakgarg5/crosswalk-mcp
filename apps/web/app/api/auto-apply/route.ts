import { NextResponse } from 'next/server';
import { autoApplyJobs } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Auto-apply drafts (AI) + fills/submits each job; allow time for a batch.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { jobIds?: string[]; submit?: boolean };
    if (!body.jobIds?.length) {
      return NextResponse.json({ ok: false, error: 'jobIds required' }, { status: 400 });
    }
    const summary = await autoApplyJobs(body.jobIds, body.submit);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
