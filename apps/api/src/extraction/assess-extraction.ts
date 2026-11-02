import type { DocumentType } from '@documind/shared';
import type { ExtractedPage } from '../text-extraction/text-extractor.js';
import { locateEvidence, valueMatchesEvidence } from './evidence.js';
import {
  EXTRACTION_SCHEMAS,
  type LineItem,
  type ModelExtraction,
  type Party,
} from './extraction-schemas.js';

/**
 * Confidence comes from checks we can explain, never from the model's own
 * opinion of itself. Below 1 even when every check passes: a passage can be
 * quoted correctly and still be the wrong one.
 */
export const CONFIDENCE = {
  /** The quote is in the document and shows the value. */
  grounded: 0.95,
  /**
   * The quote is in the document but does not show the value: in live tests,
   * typically a value the model computed (a tax as total minus subtotal).
   */
  quoteWithoutValue: 0.4,
  /** The quote is not in the document: the value may be invented. */
  ungrounded: 0.3,
  /** Cap for fields involved in a failed business rule. */
  ruleViolation: 0.5,
  /** Cap on the overall confidence when the text was cut to fit the model. */
  truncated: 0.5,
  classificationGrounded: 0.95,
  classificationUngrounded: 0.5,
} as const;

/** Rounding differences up to a few cents are not an inconsistency. */
const AMOUNT_TOLERANCE = 0.05;

export const VALIDATION_ISSUE_CODES = [
  'missing_required_field',
  'evidence_not_found',
  'value_not_in_evidence',
  'date_order',
  'totals_mismatch',
  'line_items_total_mismatch',
  'line_item_arithmetic',
  'non_positive_amount',
  'too_few_parties',
  'text_truncated',
] as const;
export type ValidationIssueCode = (typeof VALIDATION_ISSUE_CODES)[number];

/** Codes and field names only, never values: issues are logged and audited. */
export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly fields: readonly string[];
}

export interface AssessedField {
  readonly value: string | number | readonly LineItem[] | readonly Party[] | null;
  /** 0–1, rounded to two decimals; null when the field is absent. */
  readonly confidence: number | null;
  readonly evidence: string | null;
}

export interface Assessment {
  readonly fields: Readonly<Record<string, AssessedField>>;
  readonly issues: readonly ValidationIssue[];
  readonly overallConfidence: number;
}

export interface AssessmentInput {
  readonly documentType: DocumentType;
  readonly extraction: ModelExtraction;
  readonly pages: readonly ExtractedPage[];
  readonly classificationConfidence: number;
  readonly textTruncated: boolean;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const blankToNull = <T>(value: T): T | null =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/**
 * Turns a schema-valid model answer into stored fields: runs the business
 * rules, checks each value against the passage the model quoted, and scores
 * fields and the whole result. The strategy is documented in
 * docs/processing/document-extraction.md.
 */
export function assessExtraction(input: AssessmentInput): Assessment {
  const schema = EXTRACTION_SCHEMAS[input.documentType];
  const values: Record<string, string | number | null> = {};
  for (const name of Object.keys(schema.fields)) {
    values[name] = blankToNull(input.extraction.fields[name]?.value ?? null);
  }
  const list = (input.extraction[schema.list.name] ?? []) as readonly (LineItem | Party)[];

  const issues: ValidationIssue[] = businessRuleIssues(input.documentType, values, list);
  const capped = new Set(issues.flatMap((issue) => issue.fields));
  const cap = (name: string, confidence: number): number =>
    round(capped.has(name) ? Math.min(confidence, CONFIDENCE.ruleViolation) : confidence);

  const fields: Record<string, AssessedField> = {};
  const ungrounded: string[] = [];
  const unshown: string[] = [];
  for (const [name, spec] of Object.entries(schema.fields)) {
    const value = values[name] ?? null;
    if (value === null) {
      fields[name] = { value: null, confidence: null, evidence: null };
      continue;
    }
    const evidence = blankToNull(input.extraction.fields[name]?.evidence ?? null);
    // A name or number copied verbatim is its own evidence when the model gives none.
    const quote = evidence ?? (spec.kind === 'text' ? String(value) : null);
    const page = quote === null ? null : locateEvidence(input.pages, quote);
    let confidence: number = CONFIDENCE.ungrounded;
    if (page && quote !== null) {
      const shown = valueMatchesEvidence(spec.kind, value, quote);
      if (!shown) unshown.push(name);
      confidence =
        (shown ? CONFIDENCE.grounded : CONFIDENCE.quoteWithoutValue) * (page.ocrConfidence ?? 1);
    } else {
      ungrounded.push(name);
    }
    fields[name] = { value, confidence: cap(name, confidence), evidence };
  }

  if (list.length === 0) {
    fields[schema.list.name] = { value: null, confidence: null, evidence: null };
  } else {
    // Each item counts as grounded when its description or party name is in the text.
    const scores = list.map((item) => {
      const page = locateEvidence(input.pages, 'name' in item ? item.name : item.description);
      return page ? CONFIDENCE.grounded * (page.ocrConfidence ?? 1) : CONFIDENCE.ungrounded;
    });
    if (scores.includes(CONFIDENCE.ungrounded)) ungrounded.push(schema.list.name);
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    fields[schema.list.name] = {
      value: list as readonly LineItem[] | readonly Party[],
      confidence: cap(schema.list.name, mean),
      evidence: null,
    };
  }

  const required = [
    ...Object.entries(schema.fields)
      .filter(([, spec]) => spec.required)
      .map(([name]) => name),
    ...(schema.list.required ? [schema.list.name] : []),
  ];
  const missing = required.filter((name) => fields[name]?.confidence === null);
  if (missing.length > 0) issues.push({ code: 'missing_required_field', fields: missing });
  if (ungrounded.length > 0) issues.push({ code: 'evidence_not_found', fields: ungrounded });
  if (unshown.length > 0) issues.push({ code: 'value_not_in_evidence', fields: unshown });
  if (input.textTruncated) issues.push({ code: 'text_truncated', fields: [] });

  // A result is only as reliable as its weakest value; a missing required field counts as 0.
  let overall = Math.min(
    input.classificationConfidence,
    ...required.map((name) => fields[name]?.confidence ?? 0),
    ...Object.values(fields).map((field) => field.confidence ?? 1),
  );
  if (input.textTruncated) overall = Math.min(overall, CONFIDENCE.truncated);
  return { fields, issues, overallConfidence: round(overall) };
}

function businessRuleIssues(
  type: DocumentType,
  values: Readonly<Record<string, string | number | null>>,
  list: readonly (LineItem | Party)[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const amount = (name: string): number | null => {
    const value = values[name];
    return typeof value === 'number' ? value : null;
  };
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= AMOUNT_TOLERANCE;

  const dateOrder = (start: string, end: string): void => {
    const [from, to] = [values[start], values[end]];
    // ISO dates compare correctly as strings.
    if (typeof from === 'string' && typeof to === 'string' && to < from) {
      issues.push({ code: 'date_order', fields: [start, end] });
    }
  };
  const positive = (name: string): void => {
    const value = amount(name);
    if (value !== null && value <= 0) issues.push({ code: 'non_positive_amount', fields: [name] });
  };
  const lineItems = (target: number | null, targetField: string): void => {
    const items = list as readonly LineItem[];
    if (
      items.some(
        (item) =>
          item.quantity !== null &&
          item.unitPrice !== null &&
          item.amount !== null &&
          !close(item.quantity * item.unitPrice, item.amount),
      )
    ) {
      issues.push({ code: 'line_item_arithmetic', fields: ['lineItems'] });
    }
    const amounts = items.map((item) => item.amount);
    if (target !== null && amounts.length > 0 && !amounts.includes(null)) {
      const sum = amounts.reduce<number>((total, value) => total + (value ?? 0), 0);
      if (!close(sum, target)) {
        issues.push({ code: 'line_items_total_mismatch', fields: ['lineItems', targetField] });
      }
    }
  };

  switch (type) {
    case 'invoice': {
      dateOrder('issueDate', 'dueDate');
      const [subtotal, tax, total] = [
        amount('subtotal'),
        amount('taxAmount'),
        amount('totalAmount'),
      ];
      if (subtotal !== null && tax !== null && total !== null && !close(subtotal + tax, total)) {
        issues.push({ code: 'totals_mismatch', fields: ['subtotal', 'taxAmount', 'totalAmount'] });
      }
      // Line items add up to the subtotal; without one, to the total minus any tax.
      if (subtotal !== null) lineItems(subtotal, 'subtotal');
      else lineItems(total === null ? null : total - (tax ?? 0), 'totalAmount');
      positive('totalAmount');
      break;
    }
    case 'purchase_order':
      dateOrder('orderDate', 'deliveryDate');
      lineItems(amount('totalAmount'), 'totalAmount');
      positive('totalAmount');
      break;
    case 'contract':
      dateOrder('effectiveDate', 'endDate');
      if (list.length === 1) issues.push({ code: 'too_few_parties', fields: ['parties'] });
      positive('contractValue');
      break;
  }
  return issues;
}
