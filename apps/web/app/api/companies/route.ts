import { NextResponse } from 'next/server';
import { companyStats, importCompaniesBulk } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, ...(await companyStats()) });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { entries?: { name: string; ats: string; slug: string; h1bConfidence?: number }[] };
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      return NextResponse.json({ ok: false, error: 'entries array required' }, { status: 400 });
    }
    if (body.entries.length > 10000) {
      return NextResponse.json({ ok: false, error: 'max 10000 entries per import' }, { status: 400 });
    }
    const result = await importCompaniesBulk(body.entries);
    const stats = await companyStats();
    return NextResponse.json({ ok: true, ...result, total: stats.total });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
