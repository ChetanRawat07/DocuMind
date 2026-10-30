import { describe, expect, it } from 'vitest';
import { assertStorageKey, documentStorageKey } from './storage-key.js';

const OWNER = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
const DOCUMENT = '0a1b2c3d-4e5f-4a6b-8c7d-8e9fa0b1c2d3';

describe('documentStorageKey', () => {
  it.each([
    ['application/pdf', 'pdf'],
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
  ] as const)('builds the key for %s', (mimeType, extension) => {
    expect(
      documentStorageKey({
        ownerId: OWNER,
        documentId: DOCUMENT,
        uploadedAt: new Date('2026-12-31T23:59:59.000Z'),
        mimeType,
      }),
    ).toBe(`documents/${OWNER}/2026/${DOCUMENT}/original.${extension}`);
  });

  it.each(['../../etc', 'not-a-uuid', OWNER.toUpperCase(), `${OWNER}/x`])(
    'refuses a non-UUID id %j',
    (id) => {
      expect(() =>
        documentStorageKey({
          ownerId: id,
          documentId: DOCUMENT,
          uploadedAt: new Date(),
          mimeType: 'application/pdf',
        }),
      ).toThrow('Storage keys are built from lowercase UUIDs only');
    },
  );
});

describe('assertStorageKey', () => {
  it('accepts a generated key', () => {
    expect(() => {
      assertStorageKey(`documents/${OWNER}/2026/${DOCUMENT}/original.pdf`);
    }).not.toThrow();
  });

  it.each([
    `documents/${OWNER}/2026/${DOCUMENT}/../../secrets.pdf`,
    `/documents/${OWNER}/2026/${DOCUMENT}/original.pdf`,
    `documents/${OWNER}/2026/${DOCUMENT}/original.exe`,
    `documents/${OWNER}/2026/${DOCUMENT}/invoice.pdf`,
    'original.pdf',
    '',
  ])('refuses %j', (key) => {
    expect(() => {
      assertStorageKey(key);
    }).toThrow('Refusing an unexpected storage key');
  });
});
