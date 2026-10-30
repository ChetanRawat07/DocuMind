import { describe, expect, it } from 'vitest';
import { decodeDocumentCursor, encodeDocumentCursor } from './document-cursor.js';

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9fa0b1c2d3';
const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url');

describe('document cursor', () => {
  it.each([
    ['newest', new Date('2026-10-29T10:00:00.123Z')],
    ['name_asc', 'Rechnung «März» 💶.pdf'],
    ['largest', 10 * 1024 * 1024],
  ] as const)('round-trips a %s cursor', (sort, value) => {
    const encoded = encodeDocumentCursor(sort, { value, id: ID });

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeDocumentCursor(sort, encoded)).toEqual({ value, id: ID });
  });

  it('refuses a cursor made for another sort order', () => {
    const encoded = encodeDocumentCursor('newest', { value: new Date(), id: ID });

    expect(decodeDocumentCursor('oldest', encoded)).toBeNull();
    expect(decodeDocumentCursor('name_asc', encoded)).toBeNull();
  });

  it.each([
    ['not base64 JSON', 'newest', '!!!'],
    ['a value of the wrong type', 'largest', encode({ sort: 'largest', value: 'big', id: ID })],
    ['a non-positive size', 'smallest', encode({ sort: 'smallest', value: 0, id: ID })],
    ['an empty name', 'name_asc', encode({ sort: 'name_asc', value: '', id: ID })],
    ['a bad date', 'newest', encode({ sort: 'newest', value: 'yesterday', id: ID })],
    [
      'a bad id',
      'newest',
      encode({ sort: 'newest', value: '2026-10-29T10:00:00.000Z', id: '1 OR 1=1' }),
    ],
    ['an unknown sort', 'newest', encode({ sort: 'random', value: 1, id: ID })],
  ] as const)('returns null for %s', (_case, sort, encoded) => {
    expect(decodeDocumentCursor(sort, encoded)).toBeNull();
  });
});
