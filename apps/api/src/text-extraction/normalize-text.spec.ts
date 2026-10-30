import { describe, expect, it } from 'vitest';
import { normalizeExtractedText } from './normalize-text.js';

describe('normalizeExtractedText', () => {
  it('splits ligatures and unifies compatibility characters', () => {
    expect(normalizeExtractedText('ﬁnal ﬂow ＩＮＶＯＩＣＥ')).toBe('final flow INVOICE');
  });

  it('unifies line breaks and collapses horizontal whitespace', () => {
    expect(normalizeExtractedText('Total:\t  1,250.00 EUR\r\nDue\rNow')).toBe(
      'Total: 1,250.00 EUR\nDue\nNow',
    );
  });

  it('removes control and invisible format characters', () => {
    expect(normalizeExtractedText('in­voice​ #‮10\u000723')).toBe('invoice #1023');
  });

  it('trims lines and keeps at most one blank line between blocks', () => {
    expect(normalizeExtractedText('  \n  Header  \n\n\n\n  Body \n\n')).toBe('Header\n\nBody');
  });

  it('returns an empty string for whitespace only', () => {
    expect(normalizeExtractedText(' \n\t ​ ')).toBe('');
  });
});
