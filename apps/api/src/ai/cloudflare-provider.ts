import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { AiProviderError } from './ai-error.js';
import { AiProvider, type AiRequest, type AiResponse } from './ai-provider.js';
import { postJson, statusError } from './http.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

const runResponseSchema = z.object({
  success: z.literal(true),
  result: z.object({
    // A string normally; JSON mode may return the parsed object instead.
    response: z.union([z.string(), z.record(z.string(), z.unknown())]),
    usage: z
      .object({ prompt_tokens: z.number().int(), completion_tokens: z.number().int() })
      .optional(),
  }),
});
const errorBodySchema = z.object({
  errors: z.array(z.object({ message: z.string() })).min(1),
});

/** Cloudflare's error text when the model could not satisfy the requested JSON Schema. */
const JSON_MODE_FAILURE = /json mode couldn'?t be met/i;

/** A model on Cloudflare Workers AI, through its REST API (the hosted demo). */
export class CloudflareProvider extends AiProvider {
  readonly name = 'cloudflare';

  constructor(
    private readonly options: {
      accountId: string;
      apiToken: string;
      model: string;
      timeoutMs: number;
    },
  ) {
    super();
  }

  get model(): string {
    return this.options.model;
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const started = performance.now();
    const { accountId, apiToken, model, timeoutMs } = this.options;
    // The model id ("@cf/vendor/name") is part of the path as-is; configuration validates it.
    const response = await postJson(
      this.name,
      `${API_BASE}/accounts/${accountId}/ai/run/${model}`,
      {
        headers: { Authorization: `Bearer ${apiToken}` },
        body: {
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          ...(request.jsonSchema
            ? { response_format: { type: 'json_schema', json_schema: request.jsonSchema } }
            : {}),
        },
        timeoutMs,
        signal: request.signal,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      const detail = errorBodySchema
        .safeParse(response.body)
        .data?.errors.map((error) => error.message)
        .join('; ');
      if (detail && JSON_MODE_FAILURE.test(detail)) {
        throw new AiProviderError(
          'invalid_output',
          this.name,
          'The model could not produce JSON matching the schema',
        );
      }
      throw statusError(this.name, response, detail);
    }
    const parsed = runResponseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new AiProviderError('unavailable', this.name, 'Unexpected response shape');
    }
    const { response: answer, usage } = parsed.data.result;
    return {
      text: typeof answer === 'string' ? answer : JSON.stringify(answer),
      provider: this.name,
      model,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
