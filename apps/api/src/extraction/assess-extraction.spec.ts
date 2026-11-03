import { describe, expect, it } from 'vitest';
import type { ExtractedPage } from '../text-extraction/text-extractor.js';
import { type AssessmentInput, assessExtraction } from './assess-extraction.js';
import type { LineItem, ModelExtraction } from './extraction-schemas.js';

const INVOICE_TEXT = [
  'INVOICE',
  'Invoice No: INV-1023',
  'From: Acme GmbH   To: Globex Ltd',
  'Invoice date: 5 March 2026   Due: 4 April 2026',
  'Consulting  10 x 100.00  1,000.00',
  'Travel  1 x 200.00  200.00',
  'Subtotal: 1,200.00 EUR',
  'VAT: 228.00 EUR',
  'Total: 1,428.00 EUR',
].join('\n');

const textPage = (text: string): ExtractedPage => ({
  pageNumber: 1,
  method: 'text_layer',
  text,
  ocrConfidence: null,
});

const LINES: LineItem[] = [
  { description: 'Consulting', quantity: 10, unitPrice: 100, amount: 1000 },
  { description: 'Travel', quantity: 1, unitPrice: 200, amount: 200 },
];

function invoice(overrides: Partial<Record<string, [string | number | null, string | null]>> = {}) {
  const fields: Record<string, [string | number | null, string | null]> = {
    invoiceNumber: ['INV-1023', 'Invoice No: INV-1023'],
    vendorName: ['Acme GmbH', 'From: Acme GmbH'],
    customerName: ['Globex Ltd', 'To: Globex Ltd'],
    issueDate: ['2026-03-05', 'Invoice date: 5 March 2026'],
    dueDate: ['2026-04-04', 'Due: 4 April 2026'],
    currency: ['EUR', 'Total: 1,428.00 EUR'],
    subtotal: [1200, 'Subtotal: 1,200.00 EUR'],
    taxAmount: [228, 'VAT: 228.00 EUR'],
    totalAmount: [1428, 'Total: 1,428.00 EUR'],
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(fields).map(([name, [value, evidence]]) => [name, { value, evidence }]),
  );
}

function assess(
  extraction: ModelExtraction,
  overrides: Partial<AssessmentInput> = {},
): ReturnType<typeof assessExtraction> {
  return assessExtraction({
    documentType: 'invoice',
    extraction,
    pages: [textPage(INVOICE_TEXT)],
    classificationConfidence: 0.95,
    textTruncated: false,
    ...overrides,
  });
}

const codes = (result: ReturnType<typeof assessExtraction>) => result.issues.map((i) => i.code);

describe('assessExtraction', () => {
  it('scores a consistent, fully quoted invoice as grounded, with no issues', () => {
    const result = assess({ fields: invoice(), lineItems: LINES });

    expect(result.issues).toEqual([]);
    expect(result.overallConfidence).toBe(0.95);
    expect(result.fields.totalAmount).toEqual({
      value: 1428,
      confidence: 0.95,
      evidence: 'Total: 1,428.00 EUR',
    });
    expect(result.fields.lineItems).toEqual({ value: LINES, confidence: 0.95, evidence: null });
  });

  it('scales confidence by the OCR confidence of the page the quote is on', () => {
    const pages: ExtractedPage[] = [
      { ...textPage(INVOICE_TEXT), method: 'ocr', ocrConfidence: 0.8 },
    ];

    const result = assess({ fields: invoice(), lineItems: LINES }, { pages });

    expect(result.fields.invoiceNumber?.confidence).toBe(0.76);
    expect(result.overallConfidence).toBe(0.76);
  });

  it('marks a value whose quote is not in the document as ungrounded', () => {
    const result = assess({
      fields: invoice({ invoiceNumber: ['INV-9999', 'Invoice No: INV-9999'] }),
      lineItems: LINES,
    });

    expect(result.fields.invoiceNumber?.confidence).toBe(0.3);
    expect(result.issues).toContainEqual({
      code: 'evidence_not_found',
      fields: ['invoiceNumber'],
    });
    expect(result.overallConfidence).toBe(0.3);
  });

  it('flags and scores low a value its quote does not show, such as a computed tax', () => {
    const result = assess({
      fields: invoice({ customerName: ['Initech', 'To: Globex Ltd'] }),
      lineItems: LINES,
    });

    expect(result.fields.customerName?.confidence).toBe(0.4);
    expect(result.issues).toContainEqual({
      code: 'value_not_in_evidence',
      fields: ['customerName'],
    });
    expect(result.overallConfidence).toBe(0.4);
  });

  it('uses a text value as its own evidence when the model gives no quote', () => {
    const result = assess({
      fields: invoice({ vendorName: ['Acme GmbH', null] }),
      lineItems: LINES,
    });

    expect(result.fields.vendorName).toEqual({
      value: 'Acme GmbH',
      confidence: 0.95,
      evidence: null,
    });
  });

  it('flags missing required fields and scores them as 0; absent optional fields stay unscored', () => {
    const result = assess({
      fields: invoice({ invoiceNumber: [null, null], customerName: ['  ', ''] }),
      lineItems: LINES,
    });

    expect(result.issues).toContainEqual({
      code: 'missing_required_field',
      fields: ['invoiceNumber'],
    });
    expect(result.fields.customerName).toEqual({ value: null, confidence: null, evidence: null });
    expect(result.overallConfidence).toBe(0);
  });

  it.each([
    [
      'totals_mismatch',
      { fields: invoice({ taxAmount: [200, 'VAT: 228.00 EUR'] }), lineItems: LINES },
      ['subtotal', 'taxAmount', 'totalAmount'],
    ],
    [
      'date_order',
      { fields: invoice({ dueDate: ['2026-03-01', 'Due: 4 April 2026'] }), lineItems: LINES },
      ['issueDate', 'dueDate'],
    ],
    [
      'line_items_total_mismatch',
      { fields: invoice(), lineItems: [LINES[0] as LineItem] },
      ['lineItems', 'subtotal'],
    ],
    [
      'line_item_arithmetic',
      {
        fields: invoice(),
        lineItems: [{ ...(LINES[0] as LineItem), quantity: 9 }, LINES[1] as LineItem],
      },
      ['lineItems'],
    ],
    [
      'non_positive_amount',
      { fields: invoice({ totalAmount: [0, 'Total: 1,428.00 EUR'] }), lineItems: [] },
      ['totalAmount'],
    ],
  ] as const)('flags %s and caps the fields involved', (code, extraction, fields) => {
    const result = assess(extraction);

    expect(result.issues).toContainEqual({ code, fields });
    for (const field of fields) {
      expect(result.fields[field]?.confidence).toBeLessThanOrEqual(0.5);
    }
    expect(result.overallConfidence).toBeLessThanOrEqual(0.5);
  });

  it('accepts a due date on the issue date', () => {
    const fields = invoice({ dueDate: ['2026-03-05', 'Invoice date: 5 March 2026'] });

    expect(codes(assess({ fields, lineItems: LINES }))).not.toContain('date_order');
  });

  it('tolerates rounding by a few cents but flags a real difference in the totals', () => {
    const rounded = invoice({ totalAmount: [1428.04, 'Total: 1,428.00 EUR'] });
    const wrong = invoice({ totalAmount: [1428.1, 'Total: 1,428.00 EUR'] });

    expect(codes(assess({ fields: rounded, lineItems: LINES }))).not.toContain('totals_mismatch');
    expect(codes(assess({ fields: wrong, lineItems: LINES }))).toContain('totals_mismatch');
  });

  it('checks line items against the total minus tax when there is no subtotal', () => {
    const fields = invoice({ subtotal: [null, null] });

    expect(codes(assess({ fields, lineItems: LINES }))).toEqual([]);
    expect(codes(assess({ fields, lineItems: [LINES[0] as LineItem] }))).toContain(
      'line_items_total_mismatch',
    );
  });

  it('caps the overall confidence of truncated text and of an uncertain classification', () => {
    const truncated = assess({ fields: invoice(), lineItems: LINES }, { textTruncated: true });
    expect(truncated.issues).toContainEqual({ code: 'text_truncated', fields: [] });
    expect(truncated.overallConfidence).toBe(0.5);

    const uncertain = assess(
      { fields: invoice(), lineItems: LINES },
      { classificationConfidence: 0.5 },
    );
    expect(uncertain.overallConfidence).toBe(0.5);
  });

  it('requires at least two parties in a contract and checks their names against the text', () => {
    const text =
      'SERVICES AGREEMENT\nbetween Acme GmbH (Client) and Globex Ltd (Provider)\nEffective 1 May 2026';
    const fields = {
      title: { value: 'Services Agreement', evidence: 'SERVICES AGREEMENT' },
      effectiveDate: { value: '2026-05-01', evidence: 'Effective 1 May 2026' },
      endDate: { value: null, evidence: null },
      governingLaw: { value: null, evidence: null },
      contractValue: { value: null, evidence: null },
      currency: { value: null, evidence: null },
    };
    const contract = (parties: { name: string; role: string | null }[]) =>
      assess({ fields, parties }, { documentType: 'contract', pages: [textPage(text)] });

    const both = contract([
      { name: 'Acme GmbH', role: 'Client' },
      { name: 'Globex Ltd', role: 'Provider' },
    ]);
    expect(both.issues).toEqual([]);
    expect(both.overallConfidence).toBe(0.95);

    const one = contract([{ name: 'Acme GmbH', role: 'Client' }]);
    expect(one.issues).toContainEqual({ code: 'too_few_parties', fields: ['parties'] });

    const invented = contract([
      { name: 'Acme GmbH', role: 'Client' },
      { name: 'Initech LLC', role: 'Provider' },
    ]);
    expect(invented.fields.parties?.confidence).toBe(0.63);
    expect(invented.issues).toContainEqual({ code: 'evidence_not_found', fields: ['parties'] });

    expect(contract([]).issues).toContainEqual({
      code: 'missing_required_field',
      fields: ['parties'],
    });
  });
});
