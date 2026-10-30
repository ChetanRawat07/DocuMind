import { MAX_UPLOAD_BYTES } from '@documind/shared';
import { describe, expect, it } from 'vitest';
import {
  detectFileType,
  MAX_FILENAME_LENGTH,
  sanitizeFilename,
  UploadRejectedError,
  validateUpload,
} from './upload-validation.js';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

function rejectionOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof UploadRejectedError) return error.reason;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('detectFileType', () => {
  it.each([
    ['PDF', PDF, 'application/pdf'],
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['a Windows executable', EXE, null],
    ['HTML', HTML, null],
    ['a PDF signature after leading junk', Buffer.concat([Buffer.from('junk'), PDF]), null],
    ['a truncated PNG signature', PNG.subarray(0, 4), null],
    ['nothing', Buffer.alloc(0), null],
  ])('detects %s as %s', (_name, content, expected) => {
    expect(detectFileType(content)).toBe(expected);
  });
});

describe('sanitizeFilename', () => {
  it.each([
    ['invoice.pdf', 'invoice.pdf'],
    ['../../etc/passwd.pdf', 'passwd.pdf'],
    ['C:\\Users\\ada\\scan.png', 'scan.png'],
    ['  quarterly   report .pdf ', 'quarterly report .pdf'],
    ['tab\there\u0000.pdf', 'tabhere.pdf'],
    // Right-to-left override: would display as "invoiceexe.pdf".
    ['invoice\u202Efdp.exe', 'invoicefdp.exe'],
    ['zero\u200Bwidth.pdf', 'zerowidth.pdf'],
    ['cafe\u0301.pdf', 'café.pdf'],
    ['रसीद.pdf', 'रसीद.pdf'],
  ])('turns %j into %j', (raw, expected) => {
    expect(sanitizeFilename(raw)).toBe(expected);
  });

  it.each(['', '   ', '/', 'folder/', '..', '\u202E'])('rejects %j', (raw) => {
    expect(sanitizeFilename(raw)).toBeNull();
  });

  it('shortens a long name to the limit, keeping the extension', () => {
    const result = sanitizeFilename(`${'a'.repeat(400)}.pdf`);

    expect(result).toBe(`${'a'.repeat(MAX_FILENAME_LENGTH - 4)}.pdf`);
  });

  it('counts characters, not bytes or UTF-16 units', () => {
    const result = sanitizeFilename(`${'📄'.repeat(300)}.pdf`) ?? '';

    expect(Array.from(result)).toHaveLength(MAX_FILENAME_LENGTH);
    expect(result.endsWith('📄.pdf')).toBe(true);
  });
});

describe('validateUpload', () => {
  it.each([
    ['report.pdf', PDF, 'application/pdf'],
    ['scan.PNG', PNG, 'image/png'],
    ['photo.jpeg', JPEG, 'image/jpeg'],
    ['photo.jpg', JPEG, 'image/jpeg'],
  ])('accepts %s', (originalName, content, mimeType) => {
    expect(validateUpload({ originalName, content })).toEqual({ filename: originalName, mimeType });
  });

  it.each([
    ['an empty file', 'a.pdf', Buffer.alloc(0), 'empty'],
    ['a file over the limit', 'a.pdf', Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'too_large'],
    ['a missing name', '', PDF, 'invalid_filename'],
    ['a disallowed extension', 'setup.exe', EXE, 'unsupported_type'],
    ['an SVG (can carry script)', 'logo.svg', HTML, 'unsupported_type'],
    ['no extension', 'invoice', PDF, 'unsupported_type'],
    ['an executable renamed to .pdf', 'invoice.pdf', EXE, 'content_mismatch'],
    ['HTML renamed to .png', 'image.png', HTML, 'content_mismatch'],
    ['a PNG named .pdf', 'invoice.pdf', PNG, 'content_mismatch'],
    ['a PDF named .jpg', 'photo.jpg', PDF, 'content_mismatch'],
  ])('rejects %s', (_case, originalName, content, reason) => {
    expect(rejectionOf(() => validateUpload({ originalName, content }))).toBe(reason);
  });

  it('accepts a file of exactly the maximum size', () => {
    const content = Buffer.alloc(MAX_UPLOAD_BYTES);
    PDF.copy(content);

    expect(validateUpload({ originalName: 'big.pdf', content }).mimeType).toBe('application/pdf');
  });

  it('judges the type from the extension of the sanitized name', () => {
    expect(() => validateUpload({ originalName: 'invoice.pdf\u202E', content: PDF })).not.toThrow();
    expect(
      rejectionOf(() => validateUpload({ originalName: 'x.pdf/evil.exe', content: PDF })),
    ).toBe('unsupported_type');
  });
});
