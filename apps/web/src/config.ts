import { z } from 'zod';

/**
 * Browser configuration, baked in at build time from VITE_* variables.
 * Everything here ships to every visitor: it must never contain secrets.
 * The publishable key is designed to be public; tables are protected by RLS
 * and the API verifies every token.
 */
const webEnvSchema = z.object({
  VITE_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export interface WebConfig {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
}

export function loadWebConfig(env: Record<string, unknown>): WebConfig {
  const result = webEnvSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Missing or invalid web configuration: ${names.join(', ')}. See .env.example.`);
  }
  return {
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}
