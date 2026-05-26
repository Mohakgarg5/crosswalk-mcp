/**
 * An SdkServer-shaped LLM backend backed by the Anthropic API.
 * Wrapped by the existing SamplingClient so every service works unchanged
 * whether the model comes from an MCP host (sampling) or a direct API key.
 */

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

type CreateBody = {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export interface AnthropicLike {
  messages: {
    create(body: CreateBody): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export type ApiSamplingBackendOpts = {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  /** Inject a client in tests. */
  client?: AnthropicLike;
  /** Mark the system prompt as an ephemeral cache breakpoint (default true). */
  cacheSystemPrompt?: boolean;
};

export class ApiSamplingBackend {
  private readonly model: string;
  private readonly baseURL?: string;
  private readonly apiKey?: string;
  private readonly cacheSystemPrompt: boolean;
  private readonly injected?: AnthropicLike;
  private clientPromise: Promise<AnthropicLike> | null = null;

  constructor(opts: ApiSamplingBackendOpts = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseURL = opts.baseURL;
    this.cacheSystemPrompt = opts.cacheSystemPrompt ?? true;
    this.injected = opts.client;
    if (!this.injected) {
      this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!this.apiKey) {
        throw new Error('ApiSamplingBackend: no API key (set ANTHROPIC_API_KEY or pass { apiKey }).');
      }
    }
  }

  private async getClient(): Promise<AnthropicLike> {
    if (this.injected) return this.injected;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = (await import('@anthropic-ai/sdk')) as unknown as { default: new (o: unknown) => AnthropicLike };
        const Anthropic = mod.default;
        return new Anthropic({ apiKey: this.apiKey, baseURL: this.baseURL });
      })();
    }
    return this.clientPromise;
  }

  async createMessage(req: {
    messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
    maxTokens: number;
    systemPrompt?: string;
    temperature?: number;
  }): Promise<{ content: { type: 'text'; text: string } }> {
    const client = await this.getClient();
    const system = req.systemPrompt
      ? (this.cacheSystemPrompt
          ? [{ type: 'text' as const, text: req.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
          : req.systemPrompt)
      : undefined;
    const res = await client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system,
      messages: req.messages.map(m => ({ role: m.role, content: m.content.text }))
    });
    const text = res.content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('');
    return { content: { type: 'text', text } };
  }
}
