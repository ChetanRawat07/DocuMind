import { z } from 'zod';

/** Response of `GET /me`: the signed-in user as DocuMind knows them. */
export const currentUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;
