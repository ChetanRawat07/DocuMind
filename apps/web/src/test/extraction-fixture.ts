import type { DocumentExtractionDto, ExtractedFieldDto } from '@documind/shared';

/** An unflagged, absent field; overrides describe the rest. */
const field = (overrides: Partial<ExtractedFieldDto> & Pick<ExtractedFieldDto, 'name'>) => ({
  kind: 'text' as const,
  required: false,
  value: null,
  extractedValue: null,
  confidence: null,
  evidence: null,
  issues: [],
  needsReview: false,
  reviewed: false,
  corrected: false,
  ...overrides,
});

/** An invoice in review with two flagged fields: Vendor (quote not found) and Total (72%). */
export function testExtraction(
  overrides: Partial<DocumentExtractionDto> = {},
): DocumentExtractionDto {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    documentType: 'invoice',
    overallConfidence: 0.3,
    classificationConfidence: 0.95,
    issues: [{ code: 'evidence_not_found', fields: ['vendorName'] }],
    fields: [
      field({
        name: 'invoiceNumber',
        value: 'INV-1023',
        extractedValue: 'INV-1023',
        confidence: 0.95,
      }),
      field({
        name: 'vendorName',
        value: 'ABC Pvt Ltd',
        extractedValue: 'ABC Pvt Ltd',
        confidence: 0.3,
        evidence: 'Sold by ABC',
        issues: ['evidence_not_found'],
        needsReview: true,
      }),
      field({
        name: 'issueDate',
        kind: 'date',
        value: '2026-10-20',
        extractedValue: '2026-10-20',
        confidence: 0.95,
      }),
      field({
        name: 'currency',
        kind: 'currency',
        value: 'INR',
        extractedValue: 'INR',
        confidence: 0.95,
      }),
      field({
        name: 'totalAmount',
        kind: 'amount',
        value: 58_200,
        extractedValue: 58_200,
        confidence: 0.72,
        evidence: 'Total: ₹58,200',
        needsReview: true,
      }),
      field({ name: 'dueDate', kind: 'date' }),
      field({ name: 'lineItems', kind: 'list' }),
    ],
    aiProvider: 'ollama',
    aiModel: 'qwen2.5:3b',
    createdAt: '2026-10-29T10:01:00.000Z',
    review: { decision: null, decidedBy: null, decidedAt: null, rejectReason: null },
    ...overrides,
  };
}
