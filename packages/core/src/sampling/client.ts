type SdkServer = {
  createMessage(req: {
    messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
    maxTokens: number;
    systemPrompt?: string;
    temperature?: number;
  }): Promise<{ content: { type: 'text'; text: string } }>;
};

export type CompleteOpts = {
  prompt: string;
  system?: string;
  maxTokens: number;
  temperature?: number;
};

export class SamplingClient {
  constructor(private readonly server: SdkServer) {}

  async complete(opts: CompleteOpts): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.server.createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: opts.prompt } }],
          systemPrompt: opts.system,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature ?? 0.2
        });
        return res.content.text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('sampling failed');
  }

  async completeJson<T>(opts: CompleteOpts): Promise<T> {
    const text = await this.complete({
      ...opts,
      system: (opts.system ?? '') +
        '\n\nRespond ONLY with valid JSON. No prose, no code fences.'
    });
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  }
}
