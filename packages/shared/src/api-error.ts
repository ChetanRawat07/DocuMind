import { z } from 'zod';

/** Every non-2xx API response uses this envelope so clients have one error shape to handle. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
