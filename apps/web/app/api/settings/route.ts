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
      applyMaxSteps?: number;
    };
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      const key = body.apiKey.trim();
      if (key.length < 8 || key.length > 200) {
        return NextResponse.json({ ok: false, error: 'API key looks invalid (wrong length)' }, { status: 400 });
      }
      setApiKey(key);
    }
    const patch: Record<string, unknown> = {};
    if (typeof body.model === 'string') patch.model = body.model;
    if (typeof body.weeklyCap === 'number') patch.weeklyCap = body.weeklyCap;
    if (body.submitPolicy === 'review' || body.submitPolicy === 'auto') patch.submitPolicy = body.submitPolicy;
    if (typeof body.applyMaxSteps === 'number') patch.applyMaxSteps = body.applyMaxSteps;
    const config = Object.keys(patch).length ? await writeConfig(patch) : await readConfig();
    return NextResponse.json({ ok: true, settings: { hasKey: Boolean(getApiKey()), config } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
