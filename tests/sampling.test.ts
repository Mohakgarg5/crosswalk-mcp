import { describe, it, expect, vi } from 'vitest';
import { SamplingClient } from '../src/sampling/client.ts';

describe('sampling/client', () => {
  it('returns text from a successful sampling call', async () => {
    const fakeServer = {
      createMessage: vi.fn().mockResolvedValue({
        content: { type: 'text', text: 'hello world' }
      })
    } as unknown as ConstructorParameters<typeof SamplingClient>[0];
    const c = new SamplingClient(fakeServer);
    const out = await c.complete({ prompt: 'say hi', maxTokens: 32 });
    expect(out).toBe('hello world');
  });

  it('parses JSON when asJson is set', async () => {
    const fakeServer = {
      createMessage: vi.fn().mockResolvedValue({
        content: { type: 'text', text: '```json\n{"score": 0.8}\n```' }
      })
    } as unknown as ConstructorParameters<typeof SamplingClient>[0];
    const c = new SamplingClient(fakeServer);
    const out = await c.completeJson<{ score: number }>({ prompt: 'score', maxTokens: 64 });
    expect(out.score).toBe(0.8);
  });

  it('retries once on transient failure', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ content: { type: 'text', text: 'ok' } });
    const fakeServer = { createMessage: create } as unknown as ConstructorParameters<typeof SamplingClient>[0];
    const c = new SamplingClient(fakeServer);
    expect(await c.complete({ prompt: 'x', maxTokens: 8 })).toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
