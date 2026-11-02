import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../database/generated/database.js';
import type { DocumentExtraction } from '../extraction/document-extractions.repository.js';
import type { ExtractionReview } from './extraction-reviews.repository.js';
import {
  canSkipReview,
  describeFields,
  parseCorrection,
  toExtractionDto,
} from './review-fields.js';

const stored = (value: JsonValue, confidence: number | null, evidence: string | null = null) => ({
  value,
  confidence,
  evidence,
});

const EXTRACTION: DocumentExtraction = {
  id: '00000000-0000-4000-8000-000000000001',
  documentId: '00000000-0000-4000-8000-000000000002',
  jobId: '00000000-0000-4000-8000-000000000003',
  documentType: 'purchase_order',
  schemaVersion: 1,
  fields: {
    poNumber: stored('PO-1', 0.95, 'PO-1'),
    buyerName: stored('Globex', 0.3, 'Bill to: Globex'),
    supplierName: stored(null, null),
    orderDate: stored('2026-10-01', 0.95, 'Order date: 2026-10-01'),
    deliveryDate: stored(null, null),
    currency: stored('USD', 0.95, 'USD'),
    totalAmount: stored(100, 0.5, 'Total: 100.00'),
    lineItems: stored([{ description: 'Widget', quantity: 1, unitPrice: 90, amount: 90 }], 0.5),
  },
  overallConfidence: 0,
  classificationConfidence: 0.95,
  validationIssues: [
    { code: 'evidence_not_found', fields: ['buyerName'] },
    { code: 'missing_required_field', fields: ['supplierName'] },
    { code: 'line_items_total_mismatch', fields: ['lineItems', 'totalAmount'] },
  ],
  aiProvider: 'test',
  aiModel: 'test-model',
  classificationPrompt: 'document.classify@1',
  extractionPrompt: 'document.extract.purchase_order@1',
  createdAt: new Date('2026-11-02T10:00:00.000Z'),
};

const review = (fields: ExtractionReview['fields']): ExtractionReview => ({
  extractionId: EXTRACTION.id,
  fields,
  decision: null,
  decidedBy: null,
  decidedAt: null,
  rejectReason: null,
});

const byName = (fields: ReturnType<typeof describeFields>) =>
  Object.fromEntries(fields.map((field) => [field.name, field]));

describe('canSkipReview', () => {
  it.each([
    [0.95, [], true],
    [0.9, [], true],
    [0.89, [], false],
    [0.95, [{ code: 'text_truncated' }], false],
  ])('overall %s with issues %j: %s', (overallConfidence, issues, expected) => {
    expect(canSkipReview({ overallConfidence, issues })).toBe(expected);
  });
});

describe('describeFields', () => {
  it('lists every field of the type in schema order, the list last', () => {
    expect(describeFields(EXTRACTION, null).map((field) => field.name)).toEqual([
      'poNumber',
      'buyerName',
      'supplierName',
      'orderDate',
      'deliveryDate',
      'currency',
      'totalAmount',
      'lineItems',
    ]);
  });

  it('flags low scores, missing required fields and fields named in an issue', () => {
    const fields = byName(describeFields(EXTRACTION, null));

    expect(fields.poNumber).toMatchObject({ needsReview: false, issues: [] });
    expect(fields.buyerName).toMatchObject({ needsReview: true, issues: ['evidence_not_found'] });
    expect(fields.supplierName).toMatchObject({
      needsReview: true,
      required: true,
      issues: ['missing_required_field'],
    });
    expect(fields.totalAmount).toMatchObject({
      needsReview: true,
      issues: ['line_items_total_mismatch'],
    });
    expect(fields.lineItems).toMatchObject({ kind: 'list', needsReview: true });
    // Optional and absent: nothing to check.
    expect(fields.deliveryDate).toMatchObject({ needsReview: false, confidence: null });
  });

  it('does not flag a field scored exactly at the threshold', () => {
    const extraction = {
      ...EXTRACTION,
      fields: { ...EXTRACTION.fields, currency: stored('USD', 0.9, 'USD') },
    };

    expect(byName(describeFields(extraction, null)).currency?.needsReview).toBe(false);
  });

  it('flags a field scored below the threshold even without an issue', () => {
    const extraction = {
      ...EXTRACTION,
      fields: { ...EXTRACTION.fields, currency: stored('USD', 0.89, 'USD') },
    };

    expect(byName(describeFields(extraction, null)).currency?.needsReview).toBe(true);
  });

  it('shows the reviewed value and tells a confirmation from a correction', () => {
    const fields = byName(
      describeFields(
        EXTRACTION,
        review({ buyerName: { value: 'Globex' }, totalAmount: { value: 90 } }),
      ),
    );

    expect(fields.buyerName).toMatchObject({ reviewed: true, corrected: false, value: 'Globex' });
    expect(fields.totalAmount).toMatchObject({
      reviewed: true,
      corrected: true,
      value: 90,
      extractedValue: 100,
      // The score describes the model's value, not the reviewer's.
      confidence: 0.5,
    });
    expect(fields.poNumber).toMatchObject({ reviewed: false, corrected: false });
  });
});

describe('toExtractionDto', () => {
  it('reports an automatic approval as decided by the system', () => {
    const dto = toExtractionDto(EXTRACTION, {
      ...review({}),
      decision: 'approved',
      decidedAt: new Date('2026-11-02T11:00:00.000Z'),
    });

    expect(dto.review).toEqual({
      decision: 'approved',
      decidedBy: 'system',
      decidedAt: '2026-11-02T11:00:00.000Z',
      rejectReason: null,
    });
  });

  it('has no decision before review', () => {
    expect(toExtractionDto(EXTRACTION, null).review).toMatchObject({
      decision: null,
      decidedBy: null,
    });
  });
});

describe('parseCorrection', () => {
  it.each([
    ['text', 'Acme GmbH', 'Acme GmbH'],
    ['text', '', null],
    ['date', '2026-10-01', '2026-10-01'],
    ['amount', 58_200.5, 58_200.5],
    ['currency', 'EUR', 'EUR'],
    ['amount', null, null],
  ] as const)('accepts a %s value %j', (kind, value, expected) => {
    expect(parseCorrection(kind, value)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['date', '01/10/2026'],
    ['date', '2026-02-30'],
    ['amount', '100'],
    ['amount', 1e13],
    ['currency', 'eur'],
    ['currency', 'EURO'],
    ['text', 42],
    ['text', 'x'.repeat(301)],
  ] as const)('rejects a %s value %j', (kind, value) => {
    expect(parseCorrection(kind, value)).toMatchObject({ ok: false });
  });
});
