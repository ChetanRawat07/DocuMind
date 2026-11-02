export interface AiRequest {
  /** Instructions: what the model is and must do. Never contains untrusted text. */
  readonly system: string;
  /** The task, including any untrusted document text (see prompt-template.ts). */
  readonly user: string;
  /** When set, the provider is asked to answer with JSON matching this JSON Schema. */
  readonly jsonSchema?: Record<string, unknown>;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  /** Cancels the request (for example, on shutdown). */
  readonly signal?: AbortSignal;
}

export interface AiResponse {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  /** Token counts when the provider reports them. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly durationMs: number;
}

/**
 * A large language model behind a provider's API (ADR-006). Business logic
 * depends on this class only; configuration picks the implementation
 * (OllamaProvider locally, CloudflareProvider in the demo). Implementations
 * throw AiProviderError for every failure, apply their own timeout, and do
 * not retry: retries belong to the job runner.
 */
export abstract class AiProvider {
  abstract readonly name: string;
  abstract readonly model: string;

  abstract generate(request: AiRequest): Promise<AiResponse>;
}
