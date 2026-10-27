import { z } from 'zod';

/**
 * Liveness response. Intentionally minimal: an unauthenticated endpoint must not
 * disclose versions, hostnames or dependency details.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
