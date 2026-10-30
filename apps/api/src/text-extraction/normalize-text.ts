/**
 * Normalizes extracted text so the same document always yields the same
 * string, whichever way it was read:
 *
 * - NFKC: splits ligatures ("ﬁ" → "fi") and unifies look-alike characters
 *   that PDFs often contain; it also flattens "²" to "2".
 * - Line breaks become `\n`; runs of other whitespace become one space.
 * - Control and invisible format characters (soft hyphens, zero-width
 *   spaces, bidi overrides) are removed.
 * - Lines are trimmed and blank runs collapse to one empty line.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) => (character === '\n' ? character : ''))
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
