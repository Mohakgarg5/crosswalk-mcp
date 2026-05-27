import { NextResponse } from 'next/server';
import { getApiKey, setApiKey, readConfig, writeConfig } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ hasKey: Boolean(getApiKey()), config: await readConfig() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      apiKey?: string;
      model?: string;
      weeklyCap?: number;
      submitPolicy?: 'review' | 'auto';
    };
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      setApiKey(body.apiKey.trim());
    }
    const patch: Record<string, unknown> = {};
    if (typeof body.model === 'string') patch.model = body.model;
    if (typeof body.weeklyCap === 'number') patch.weeklyCap = body.weeklyCap;
    if (body.submitPolicy === 'review' || body.submitPolicy === 'auto') patch.submitPolicy = body.submitPolicy;
    const config = Object.keys(patch).length ? await writeConfig(patch) : await readConfig();
    return NextResponse.json({ ok: true, settings: { hasKey: Boolean(getApiKey()), config } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
