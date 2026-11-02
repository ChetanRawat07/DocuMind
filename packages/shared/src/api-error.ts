import { z } from 'zod';

/**
 * Every non-2xx API response uses this envelope so clients have one error
 * shape to handle. `requestId` (also in the `X-Request-Id` header) lets a
 * user's report be matched to the server's logs.
 */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
