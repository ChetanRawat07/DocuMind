import { z } from 'zod';
import { AiProviderError } from './ai-error.js';
import type { AiProvider, AiResponse } from './ai-provider.js';
import type { PromptTemplate } from './prompt-template.js';

export interface StructuredResult<TOutput> {
  readonly data: TOutput;
  readonly response: AiResponse;
  /** `id@version` of the template that produced the answer. */
  readonly prompt: string;
}

/**
 * Runs a template and returns its validated answer. The JSON Schema derived
 * from the template's Zod schema goes to the provider's constrained-output
 * mode, but the answer is still parsed and validated here: no provider
 * guarantees conformance. Anything that does not validate becomes an
 * `invalid_output` AiProviderError, so unvalidated model output never
 * reaches the caller.
 */
export async function generateStructured<TInput, TOutput>(
  provider: AiProvider,
  template: PromptTemplate<TInput, TOutput>,
  input: TInput,
  options: { signal?: AbortSignal } = {},
): Promise<StructuredResult<TOutput>> {
  const response = await provider.generate({
    system: template.system,
    user: template.render(input),
    jsonSchema: z.toJSONSchema(template.output, { target: 'draft-7' }),
    maxOutputTokens: template.maxOutputTokens,
    temperature: template.temperature,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  let json: unknown;
  try {
    json = JSON.parse(response.text);
  } catch (error) {
    throw new AiProviderError('invalid_output', provider.name, 'The answer is not valid JSON', {
      cause: error,
    });
  }
  const result = template.output.safeParse(json);
  if (!result.success) {
    // Paths only: the issue messages could quote document content echoed by the model.
    const paths = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)')),
    ];
    throw new AiProviderError(
      'invalid_output',
      provider.name,
      `The answer does not match the schema at: ${paths.join(', ')}`,
    );
  }
  return { data: result.data, response, prompt: `${template.id}@${template.version}` };
}
