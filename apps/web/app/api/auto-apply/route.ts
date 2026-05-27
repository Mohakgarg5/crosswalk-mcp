import { NextResponse } from 'next/server';
import { autoApplyJobs } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Auto-apply drafts (AI) + fills/submits each job; allow time for a batch.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { jobIds?: string[]; submit?: boolean };
    if (!Array.isArray(body.jobIds) || body.jobIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'jobIds required' }, { status: 400 });
    }
    // One HTTP request must finish within maxDuration; each job is an AI call +
    // a live browser fill. Cap the batch so the request can't hang or burn the
    // budget — high volume runs through the watcher daemon, not one click.
    if (body.jobIds.length > 50) {
      return NextResponse.json({ ok: false, error: 'max 50 jobs per request — use a watch + the watcher daemon for higher volume' }, { status: 400 });
    }
    const summary = await autoApplyJobs(body.jobIds, body.submit);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
