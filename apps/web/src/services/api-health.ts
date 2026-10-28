import { type HealthResponse, healthResponseSchema } from '@documind/shared';

export const HEALTH_ENDPOINT = '/api/v1/health';

/**
 * Fetches API liveness and validates the response against the shared contract,
 * so a drifting backend fails loudly here instead of rendering bad data.
 */
export async function fetchApiHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(HEALTH_ENDPOINT, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }
  return healthResponseSchema.parse(await response.json());
}
