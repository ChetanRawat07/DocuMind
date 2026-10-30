import { describe, expect, it } from 'vitest';
import { fileExtensionOf, uploadFileTypeForName } from './uploads.js';

describe('fileExtensionOf', () => {
  it.each([
    ['invoice.pdf', '.pdf'],
    ['Scan.JPEG', '.jpeg'],
    ['archive.tar.pdf', '.pdf'],
    ['.pdf', null],
    ['README', null],
    ['trailing.', null],
  ])('%s → %s', (name, expected) => {
    expect(fileExtensionOf(name)).toBe(expected);
  });
});

describe('uploadFileTypeForName', () => {
  it.each([
    ['a.pdf', 'application/pdf'],
    ['a.PNG', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
  ])('allows %s as %s', (name, mimeType) => {
    expect(uploadFileTypeForName(name)?.mimeType).toBe(mimeType);
  });

  it.each(['a.exe', 'a.pdf.exe', 'a.svg', 'a.html', 'a.tiff', 'pdf', 'a'])('rejects %s', (name) => {
    expect(uploadFileTypeForName(name)).toBeNull();
  });
});
