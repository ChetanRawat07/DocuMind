import { isDeepStrictEqual } from 'node:util';
import {
  type DocumentExtractionDto,
  type ExtractedFieldDto,
  type ExtractedFieldKind,
  REVIEW_CONFIDENCE_THRESHOLD,
} from '@documind/shared';
import type { ValidationIssue } from '../extraction/assess-extraction.js';
import type { DocumentExtraction } from '../extraction/document-extractions.repository.js';
import { EXTRACTION_SCHEMAS, FIELD_VALUE_SCHEMAS } from '../extraction/extraction-schemas.js';
import type { ExtractionReview } from './extraction-reviews.repository.js';

/** The stored shape of one field (docs/processing/document-extraction.md). */
interface StoredField {
  readonly value: ExtractedFieldDto['value'];
  readonly confidence: number | null;
  readonly evidence: string | null;
}

const ABSENT: StoredField = { value: null, confidence: null, evidence: null };

/**
 * True when an extraction may complete without a human: every value scored
 * at or above the review threshold and no check found anything.
 */
export function canSkipReview(assessment: {
  readonly overallConfidence: number;
  readonly issues: readonly unknown[];
}): boolean {
  return (
    assessment.overallConfidence >= REVIEW_CONFIDENCE_THRESHOLD && assessment.issues.length === 0
  );
}

/**
 * The extraction's fields in schema order, each with its current value and
 * whether it needs a human check: a score below the threshold, or named in
 * an issue (which includes a missing required field).
 */
export function describeFields(
  extraction: DocumentExtraction,
  review: ExtractionReview | null,
): ExtractedFieldDto[] {
  const schema = EXTRACTION_SCHEMAS[extraction.documentType];
  const issues = extraction.validationIssues as unknown as readonly ValidationIssue[];
  const specs: [string, ExtractedFieldKind, boolean][] = [
    ...Object.entries(schema.fields).map(([name, spec]): [string, ExtractedFieldKind, boolean] => [
      name,
      spec.kind,
      spec.required,
    ]),
    [schema.list.name, 'list', schema.list.required],
  ];
  return specs.map(([name, kind, required]) => {
    const stored = (extraction.fields[name] as StoredField | undefined) ?? ABSENT;
    const reviewed = review?.fields[name];
    const fieldIssues = issues.filter((issue) => issue.fields.includes(name)).map((i) => i.code);
    return {
      name,
      kind,
      required,
      value: reviewed ? (reviewed.value as ExtractedFieldDto['value']) : stored.value,
      extractedValue: stored.value,
      confidence: stored.confidence,
      evidence: stored.evidence,
      issues: fieldIssues,
      needsReview:
        fieldIssues.length > 0 ||
        (stored.confidence !== null && stored.confidence < REVIEW_CONFIDENCE_THRESHOLD),
      reviewed: reviewed !== undefined,
      corrected: reviewed !== undefined && !isDeepStrictEqual(reviewed.value, stored.value),
    };
  });
}

export function toExtractionDto(
  extraction: DocumentExtraction,
  review: ExtractionReview | null,
): DocumentExtractionDto {
  return {
    id: extraction.id,
    documentType: extraction.documentType,
    overallConfidence: extraction.overallConfidence,
    classificationConfidence: extraction.classificationConfidence,
    issues: (extraction.validationIssues as unknown as readonly ValidationIssue[]).map((issue) => ({
      code: issue.code,
      fields: [...issue.fields],
    })),
    fields: describeFields(extraction, review),
    aiProvider: extraction.aiProvider,
    aiModel: extraction.aiModel,
    createdAt: extraction.createdAt.toISOString(),
    review: {
      decision: review?.decision ?? null,
      decidedBy: review?.decision ? (review.decidedBy ? 'user' : 'system') : null,
      decidedAt: review?.decidedAt?.toISOString() ?? null,
      rejectReason: review?.rejectReason ?? null,
    },
  };
}

/**
 * Checks a reviewer's value against the field's kind, with the same rules
 * as the model's answer. An empty string clears the field.
 */
export function parseCorrection(
  kind: Exclude<ExtractedFieldKind, 'list'>,
  value: string | number | null,
): { ok: true; value: string | number | null } | { ok: false; message: string } {
  const result = FIELD_VALUE_SCHEMAS[kind].nullable().safeParse(value === '' ? null : value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, message: result.error.issues[0]?.message ?? 'Invalid value' };
}
