import { z } from 'zod';
import type { PromptTemplate } from '../prompt-template.js';

/**
 * A tiny round trip proving the configured provider answers with valid,
 * schema-conforming JSON. The model must echo a random nonce, so a pass
 * cannot come from a cached or canned answer. Contains no document data.
 */
export const connectivityCheckPrompt: PromptTemplate<
  { nonce: string },
  { status: 'ok'; echo: string }
> = {
  id: 'connectivity-check',
  version: 1,
  system: 'You are a health check for an API integration. Answer with JSON only.',
  render: ({ nonce }) => `Return status "ok" and echo exactly this code: ${nonce}`,
  output: z.object({ status: z.literal('ok'), echo: z.string().max(64) }),
  maxOutputTokens: 64,
  temperature: 0,
};
