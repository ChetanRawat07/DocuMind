import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_VIEW,
  documentContentPath,
  documentDetailPath,
  documentListPath,
  documentViewFromParams,
  documentViewToParams,
  hasDocumentFilters,
  isDefaultDocumentView,
} from './document-view';

const params = (query: string) => new URLSearchParams(query);

describe('documentViewFromParams', () => {
  it('reads search, filters and sort', () => {
    expect(
      documentViewFromParams(
        params('q=%20acme%20&status=failed&type=unclassified&format=image&sort=name_asc'),
      ),
    ).toEqual({
      q: 'acme',
      status: 'failed',
      type: 'unclassified',
      format: 'image',
      sort: 'name_asc',
    });
  });

  it('defaults to the newest-first, unfiltered view', () => {
    expect(documentViewFromParams(params(''))).toEqual(DEFAULT_DOCUMENT_VIEW);
  });

  it('drops values the API would reject, keeping the valid ones', () => {
    expect(
      documentViewFromParams(params(`status=done&type=invoice&sort=random&q=${'a'.repeat(101)}`)),
    ).toEqual({ type: 'invoice', sort: 'newest' });
  });
});

describe('documentViewToParams', () => {
  it('leaves out defaults and empty values', () => {
    expect(documentViewToParams({ sort: 'newest', q: undefined }).toString()).toBe('');
    expect(documentViewToParams({ sort: 'largest', status: 'completed' }).toString()).toBe(
      'status=completed&sort=largest',
    );
  });

  it('round-trips through the URL', () => {
    const view = { q: 'März & co', format: 'pdf', sort: 'oldest' } as const;

    expect(documentViewFromParams(documentViewToParams(view))).toEqual(view);
  });
});

describe('view predicates', () => {
  it('counts search and filters as filtering, but not the order', () => {
    expect(hasDocumentFilters({ sort: 'name_desc' })).toBe(false);
    expect(hasDocumentFilters({ sort: 'newest', q: 'x' })).toBe(true);
    expect(isDefaultDocumentView({ sort: 'newest' })).toBe(true);
    expect(isDefaultDocumentView({ sort: 'oldest' })).toBe(false);
  });
});

describe('paths', () => {
  it('builds list paths with the page size and an encoded cursor', () => {
    expect(documentListPath({ sort: 'newest', q: 'a&b' }, 20, 'c/1+=')).toBe(
      '/documents?q=a%26b&limit=20&cursor=c%2F1%2B%3D',
    );
  });

  it('encodes ids in detail and content paths', () => {
    expect(documentDetailPath('../x')).toBe('/documents/..%2Fx');
    expect(documentContentPath('id', 'inline')).toBe('/documents/id/content?disposition=inline');
  });
});
