import { describe, expect, it } from 'vitest';
import { contentDisposition } from './content-disposition.js';

describe('contentDisposition', () => {
  it('names a plain ASCII file in both parameters', () => {
    expect(contentDisposition('attachment', 'invoice-1023.pdf')).toBe(
      `attachment; filename="invoice-1023.pdf"; filename*=UTF-8''invoice-1023.pdf`,
    );
  });

  it('keeps a Unicode name exact in filename* and gives an ASCII fallback', () => {
    expect(contentDisposition('inline', 'रसीद 2026.jpg')).toBe(
      `inline; filename="____ 2026.jpg"; filename*=UTF-8''%E0%A4%B0%E0%A4%B8%E0%A5%80%E0%A4%A6%202026.jpg`,
    );
  });

  it('cannot be broken out of with quotes, backslashes or semicolons', () => {
    const header = contentDisposition('attachment', `a"; filename="evil.html\\b;(1)*'.pdf`);

    expect(header).toBe(
      `attachment; filename="a_; filename=_evil.html_b;(1)*'.pdf"; filename*=UTF-8''a%22%3B%20filename%3D%22evil.html%5Cb%3B%281%29%2A%27.pdf`,
    );
    // The quoted fallback holds no quote, so the header has exactly the two quotes around it.
    expect(header.split('"')).toHaveLength(3);
  });

  it('never emits characters that are invalid in a header', () => {
    const header = contentDisposition('attachment', 'line\r\nSet-Cookie: x=1\u0000.pdf');

    expect(header).toMatch(/^[\x20-\x7e]+$/);
  });

  it('replaces % in the fallback so no client decodes it as an escape', () => {
    expect(contentDisposition('attachment', '100%25.pdf')).toContain('filename="100_25.pdf"');
  });
});
