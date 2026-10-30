import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_PAGE_SIZE,
  documentContentQuerySchema,
  documentListQuerySchema,
  MAX_DOCUMENT_SEARCH_LENGTH,
} from './documents.js';

describe('documentListQuerySchema', () => {
  it('defaults to the first page, newest first, unfiltered', () => {
    expect(documentListQuerySchema.parse({})).toEqual({
      limit: DEFAULT_DOCUMENT_PAGE_SIZE,
      sort: 'newest',
    });
  });

  it('trims the search and treats a blank one as no search', () => {
    expect(documentListQuerySchema.parse({ q: '  acme  ' }).q).toBe('acme');
    expect(documentListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it('normalizes the search to NFC, the form stored filenames use', () => {
    const decomposed = 'Café';

    expect(documentListQuerySchema.parse({ q: decomposed }).q).toBe('Café');
  });

  it('accepts the unclassified type and the known formats', () => {
    expect(documentListQuerySchema.parse({ type: 'unclassified', format: 'image' })).toMatchObject({
      type: 'unclassified',
      format: 'image',
    });
  });

  it.each([
    { sort: 'random' },
    { status: 'done' },
    { type: 'receipt' },
    { format: 'docx' },
    { q: 'a'.repeat(MAX_DOCUMENT_SEARCH_LENGTH + 1) },
    { cursor: '' },
  ])('rejects %j', (query) => {
    expect(documentListQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('documentContentQuerySchema', () => {
  it('downloads as an attachment unless inline is asked for', () => {
    expect(documentContentQuerySchema.parse({}).disposition).toBe('attachment');
    expect(documentContentQuerySchema.parse({ disposition: 'inline' }).disposition).toBe('inline');
    expect(documentContentQuerySchema.safeParse({ disposition: 'evil' }).success).toBe(false);
  });
});
