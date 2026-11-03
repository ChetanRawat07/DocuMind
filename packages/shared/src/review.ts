import { z } from 'zod';
import { DOCUMENT_TYPES } from './documents.js';

/**
 * Below this confidence a field needs a human check, and an extraction with
 * any field below it (or any issue) waits for review instead of completing.
 * Scores are rule-based review signals, not probabilities (ADR-017).
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.9;

/** Findings stored with an extraction: business rules and evidence checks. */
export const VALIDATION_ISSUE_CODES = [
  'missing_required_field',
  'evidence_not_found',
  'value_not_in_evidence',
  'evidence_not_visible',
  'date_order',
  'totals_mismatch',
  'line_items_total_mismatch',
  'line_item_arithmetic',
  'non_positive_amount',
  'too_few_parties',
  'text_truncated',
] as const;
export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];

/** How a field is written. `list` is line items or contract parties, which are confirmed, not edited. */
export const EXTRACTED_FIELD_KINDS = ['text', 'date', 'amount', 'currency', 'list'] as const;
export type ExtractedFieldKind = (typeof EXTRACTED_FIELD_KINDS)[number];

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  amount: z.number().nullable(),
});
const partySchema = z.object({ name: z.string(), role: z.string().nullable() });
const fieldValueSchema = z
  .union([z.string(), z.number(), z.array(lineItemSchema), z.array(partySchema)])
  .nullable();

/**
 * One field for review. `value` is the current value: the reviewer's when
 * they corrected it, otherwise the model's (`extractedValue`). `confidence`
 * and `evidence` always describe the model's value.
 */
export const extractedFieldSchema = z.object({
  name: z.string(),
  kind: z.enum(EXTRACTED_FIELD_KINDS),
  required: z.boolean(),
  value: fieldValueSchema,
  extractedValue: fieldValueSchema,
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().nullable(),
  /** Codes of the issues that name this field. */
  issues: z.array(z.enum(VALIDATION_ISSUE_CODES)),
  /** Below the threshold, missing although required, or named in an issue. */
  needsReview: z.boolean(),
  /** Confirmed or corrected by the reviewer. */
  reviewed: z.boolean(),
  corrected: z.boolean(),
});
export type ExtractedFieldDto = z.infer<typeof extractedFieldSchema>;

export const REVIEW_DECISIONS = ['approved', 'rejected'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** `GET /documents/:id/extraction`: the latest extraction with its review state. */
export const documentExtractionSchema = z.object({
  id: z.uuid(),
  documentType: z.enum(DOCUMENT_TYPES),
  overallConfidence: z.number().min(0).max(1),
  classificationConfidence: z.number().min(0).max(1),
  issues: z.array(z.object({ code: z.enum(VALIDATION_ISSUE_CODES), fields: z.array(z.string()) })),
  /** In schema order. */
  fields: z.array(extractedFieldSchema),
  aiProvider: z.string(),
  aiModel: z.string(),
  createdAt: z.iso.datetime(),
  review: z.object({
    decision: z.enum(REVIEW_DECISIONS).nullable(),
    /** `system` when the extraction was confident enough to complete without review. */
    decidedBy: z.enum(['user', 'system']).nullable(),
    decidedAt: z.iso.datetime().nullable(),
    rejectReason: z.string().nullable(),
  }),
});
export type DocumentExtractionDto = z.infer<typeof documentExtractionSchema>;

/**
 * Every review request names the extraction the reviewer is looking at, so
 * an action never lands on a newer extraction they have not seen (409).
 */
const reviewTarget = { extractionId: z.uuid() };

/**
 * `PUT /documents/:id/extraction/fields/:field`. `confirm` accepts the
 * current value as it is; `correct` replaces it (null clears it). Only
 * single-value fields can be corrected; the API checks the value against the
 * field's kind.
 */
export const reviewFieldRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...reviewTarget, action: z.literal('confirm') }),
  z.object({
    ...reviewTarget,
    action: z.literal('correct'),
    value: z.union([z.string().trim().max(300), z.number()]).nullable(),
  }),
]);
export type ReviewFieldRequest = z.infer<typeof reviewFieldRequestSchema>;

/** `POST /documents/:id/extraction/approve`. */
export const approveExtractionRequestSchema = z.object(reviewTarget);
export type ApproveExtractionRequest = z.infer<typeof approveExtractionRequestSchema>;

export const MAX_REJECT_REASON_LENGTH = 500;

/** `POST /documents/:id/extraction/reject`. A blank reason is no reason. */
export const rejectExtractionRequestSchema = z.object({
  ...reviewTarget,
  reason: z
    .string()
    .trim()
    .max(MAX_REJECT_REASON_LENGTH)
    .optional()
    .transform((reason) => (reason ? reason : undefined)),
});
export type RejectExtractionRequest = z.input<typeof rejectExtractionRequestSchema>;
