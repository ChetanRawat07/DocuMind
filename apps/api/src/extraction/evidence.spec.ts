import { describe, expect, it } from 'vitest';
import type { ExtractedPage } from '../text-extraction/text-extractor.js';
import { locateEvidence, valueMatchesEvidence } from './evidence.js';

const pages: ExtractedPage[] = [
  {
    pageNumber: 1,
    method: 'text_layer',
    text: 'INVOICE\nInvoice No:   INV-1023',
    ocrConfidence: null,
  },
  { pageNumber: 2, method: 'ocr', text: 'Total due: 1,250.50 EUR', ocrConfidence: 0.8 },
];

describe('locateEvidence', () => {
  it('finds the page holding the quote, ignoring case and whitespace', () => {
    expect(locateEvidence(pages, 'invoice no: INV-1023')?.pageNumber).toBe(1);
    expect(locateEvidence(pages, 'total due:\n1,250.50')?.pageNumber).toBe(2);
  });

  it('accepts a multi-line quote whose lines are all on one page, in any position', () => {
    const page = [
      { ...pages[0], text: 'INVOICE\nVendor: Acme\nInvoice No: INV-1023' } as ExtractedPage,
    ];

    expect(locateEvidence(page, 'INVOICE\nInvoice No: INV-1023')?.pageNumber).toBe(1);
    expect(locateEvidence(pages, 'INVOICE\nTotal due: 1,250.50 EUR')).toBeNull();
  });

  it('returns null for a quote that is not in the document, or an empty one', () => {
    expect(locateEvidence(pages, 'Total due: 9,999.00 EUR')).toBeNull();
    expect(locateEvidence(pages, '  \n ')).toBeNull();
  });
});

describe('valueMatchesEvidence', () => {
  it.each([
    ['text', 'ACME GmbH', 'Vendor: Acme  GmbH, Berlin', true],
    ['text', 'ACME GmbH', 'Vendor: Globex Ltd', false],
    ['amount', 1250.5, 'Total: 1,250.50', true],
    ['amount', 1250.5, 'Gesamt: 1.250,50 €', true],
    ['amount', 1250.5, 'Total: 125.05', false],
    ['amount', 1250.5, 'Total: 1,250.00', false],
    ['amount', 582000, 'Total: ₹5,82,000', true],
    ['amount', -40, 'Credit: (40.00)', true],
    ['currency', 'EUR', 'Total: 1,250.50 eur', true],
    ['currency', 'EUR', 'Total: €1,250.50', true],
    ['currency', 'USD', 'Total: $1,250.50', true],
    ['currency', 'GBP', 'Total: $1,250.50', false],
    ['date', '2026-03-05', 'Date: 2026-03-05', true],
    ['date', '2026-03-05', 'Date: 05/03/2026', true],
    ['date', '2026-03-05', 'Date: March 5, 2026', true],
    ['date', '2026-03-05', 'Date: 5 Mar 26', true],
    ['date', '2026-03-05', 'Date: March 6, 2026', false],
    ['date', '2026-03-05', 'Date: April 5, 2026', false],
    ['date', '2026-03-05', 'Date: March 5, 2025', false],
  ] as const)('%s %s in "%s" → %s', (kind, value, quote, expected) => {
    expect(valueMatchesEvidence(kind, value, quote)).toBe(expected);
  });
});
