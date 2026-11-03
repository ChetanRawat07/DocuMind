import { z } from 'zod';

/** Largest PostgreSQL bigint, the type of audit log ids. */
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export const DEFAULT_AUDIT_LOG_PAGE_SIZE = 50;
export const MAX_AUDIT_LOG_PAGE_SIZE = 100;

/**
 * One audit entry as the API returns it. `actor` is `user` for the signed-in
 * user's own actions and `system` for processing. `metadata` holds codes,
 * counts and field names, never document content.
 */
export const auditLogEntrySchema = z.object({
  id: z.string().regex(/^\d+$/),
  occurredAt: z.iso.datetime(),
  actor: z.enum(['user', 'system']),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  requestId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditLogEntryDto = z.infer<typeof auditLogEntrySchema>;

/**
 * `GET /audit-logs`: newest first. `cursor` is the `nextCursor` of the
 * previous page, passed back unchanged.
 */
export const auditLogQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_AUDIT_LOG_PAGE_SIZE)
    .default(DEFAULT_AUDIT_LOG_PAGE_SIZE),
  cursor: z
    .string()
    .regex(/^\d{1,19}$/, { message: 'Invalid cursor', abort: true })
    // Ids are bigint: a larger value would fail in PostgreSQL as a 500, not a 400.
    .refine((cursor) => BigInt(cursor) <= MAX_BIGINT, 'Invalid cursor')
    .optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogListResponseSchema = z.object({
  items: z.array(auditLogEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

/** `GET /documents/:id/activity`: the document's most recent entries, newest first. */
export const documentActivityResponseSchema = z.object({ items: z.array(auditLogEntrySchema) });
export type DocumentActivityResponse = z.infer<typeof documentActivityResponseSchema>;
