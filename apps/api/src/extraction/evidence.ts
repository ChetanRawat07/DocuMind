import type { ExtractedPage } from '../text-extraction/text-extractor.js';
import type { FieldKind } from './extraction-schemas.js';

/** Case and whitespace differences between the quote and the text do not count. */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The page containing the quote, or null if the quote is not in the document.
 * Each line of a multi-line quote may sit anywhere on the page: models often
 * prefix a quote with a heading ("INVOICE\nTotal: 868.70") from further up.
 */
export function locateEvidence(
  pages: readonly ExtractedPage[],
  quote: string,
): ExtractedPage | null {
  const lines = quote
    .split('\n')
    .map(normalizeForMatch)
    .filter((line) => line !== '');
  if (lines.length === 0) return null;
  return (
    pages.find((page) => {
      const text = normalizeForMatch(page.text);
      return lines.every((line) => text.includes(line));
    }) ?? null
  );
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const CURRENCY_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  '€': ['EUR'],
  '£': ['GBP'],
  '₹': ['INR'],
  '¥': ['JPY', 'CNY'],
  $: ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'],
};

/**
 * Whether the quote plausibly shows the value. The model normalizes values
 * (dates to ISO, amounts to plain numbers), so the check works on the
 * parts a reader would recognize rather than on the exact string.
 */
export function valueMatchesEvidence(
  kind: FieldKind,
  value: string | number,
  quote: string,
): boolean {
  switch (kind) {
    case 'text':
      return normalizeForMatch(quote).includes(normalizeForMatch(String(value)));
    case 'amount': {
      // Each number in the quote is read both ways: "1,250.50" and "1.250,50" are both 1250.5.
      const target = Math.abs(Number(value));
      return (quote.match(/\d(?:[\d.,]*\d)?/g) ?? []).some((token) =>
        [Number(token.replace(/,/g, '')), Number(token.replace(/\./g, '').replace(',', '.'))].some(
          (candidate) => Math.abs(candidate - target) < 0.005,
        ),
      );
    }
    case 'currency': {
      const code = String(value);
      return (
        quote.toUpperCase().includes(code) ||
        Object.entries(CURRENCY_SYMBOLS).some(
          ([symbol, codes]) => codes.includes(code) && quote.includes(symbol),
        )
      );
    }
    case 'date': {
      // Year, month and day must all appear: "2026-03-05", "05/03/2026", "March 5, 2026".
      const [year, month, day] = String(value).split('-').map(Number) as [number, number, number];
      const numbers = (quote.match(/\d+/g) ?? []).map(Number);
      const monthName = new RegExp(`\\b${MONTHS[month - 1] ?? ''}`, 'i');
      return (
        (numbers.includes(year) || numbers.includes(year % 100)) &&
        numbers.includes(day) &&
        (numbers.includes(month) || monthName.test(quote))
      );
    }
  }
}
