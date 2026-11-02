import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { AiProviderError } from './ai-error.js';
import { AiProvider, type AiRequest, type AiResponse } from './ai-provider.js';
import { postJson, statusError } from './http.js';

/**
 * Context window requested from Ollama. Its default depends on the version
 * and hardware and can be smaller than a multi-page document prompt, and
 * Ollama silently drops what does not fit, so the model would answer about
 * a truncated document. Prompts must stay below this (input plus output).
 */
export const OLLAMA_CONTEXT_TOKENS = 8192;

const chatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().int().optional(),
  eval_count: z.number().int().optional(),
});
const errorBodySchema = z.object({ error: z.string() });

/** A model served by Ollama's /api/chat endpoint (local development). */
export class OllamaProvider extends AiProvider {
  readonly name = 'ollama';

  constructor(private readonly options: { baseUrl: string; model: string; timeoutMs: number }) {
    super();
  }

  get model(): string {
    return this.options.model;
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const started = performance.now();
    const response = await postJson(this.name, `${this.options.baseUrl}/api/chat`, {
      body: {
        model: this.options.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        stream: false,
        // A JSON Schema here makes Ollama constrain decoding to matching JSON.
        ...(request.jsonSchema ? { format: request.jsonSchema } : {}),
        options: {
          temperature: request.temperature,
          num_predict: request.maxOutputTokens,
          num_ctx: OLLAMA_CONTEXT_TOKENS,
        },
      },
      timeoutMs: this.options.timeoutMs,
      signal: request.signal,
    });

    if (response.status < 200 || response.status >= 300) {
      const detail = errorBodySchema.safeParse(response.body).data?.error;
      throw statusError(this.name, response, detail);
    }
    const parsed = chatResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new AiProviderError('unavailable', this.name, 'Unexpected response shape');
    }
    if (parsed.data.done_reason === 'length') {
      throw new AiProviderError(
        'invalid_output',
        this.name,
        `The answer was cut off at ${request.maxOutputTokens} tokens`,
      );
    }
    return {
      text: parsed.data.message.content,
      provider: this.name,
      model: this.options.model,
      inputTokens: parsed.data.prompt_eval_count ?? null,
      outputTokens: parsed.data.eval_count ?? null,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
