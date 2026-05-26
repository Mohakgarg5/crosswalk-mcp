import { describe, it, expect } from 'vitest';
import { ApiSamplingBackend } from '../src/sampling/apiBackend.ts';
import { SamplingClient } from '../src/sampling/client.ts';

function fakeClient(reply: string, sink?: unknown[]) {
  return {
    messages: {
      create: async (body: unknown) => {
        sink?.push(body);
        return { content: [{ type: 'text', text: reply }] };
      }
    }
  };
}

describe('ApiSamplingBackend', () => {
  it('maps the sampling request to the Anthropic Messages API and extracts text', async () => {
    const calls: any[] = [];
    const backend = new ApiSamplingBackend({ client: fakeClient('HELLO', calls), model: 'claude-sonnet-4-6' });
    const out = await backend.createMessage({
      messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
      systemPrompt: 'sys',
      maxTokens: 100,
      temperature: 0.2
    });
    expect(out).toEqual({ content: { type: 'text', text: 'HELLO' } });
    expect(calls[0].model).toBe('claude-sonnet-4-6');
    expect(calls[0].max_tokens).toBe(100);
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(calls[0].system[0]).toMatchObject({ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } });
  });

  it('satisfies the SamplingClient contract (complete + completeJson)', async () => {
    const sc = new SamplingClient(new ApiSamplingBackend({ client: fakeClient('{"a":1}') }));
    expect(await sc.complete({ prompt: 'x', maxTokens: 50 })).toBe('{"a":1}');
    expect(await sc.completeJson<{ a: number }>({ prompt: 'x', maxTokens: 50 })).toEqual({ a: 1 });
  });

  it('throws fast when no api key and no injected client', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new ApiSamplingBackend({})).toThrow(/api key/i);
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });
});
