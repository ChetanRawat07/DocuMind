import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';
import { UPLOAD_ACCEPT, UPLOAD_TYPES_LABEL, uploadProblemOf } from './upload-checks';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [820, '820 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1.44 * 1024 * 1024, '1.4 MB'],
    [10 * 1024 * 1024, '10 MB'],
    [3 * 1024 ** 3, '3 GB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes, 'en')).toBe(expected);
  });
});

describe('upload checks', () => {
  it('describes the allowed types for the picker and for people', () => {
    expect(UPLOAD_ACCEPT).toBe('.pdf,.png,.jpg,.jpeg');
    expect(UPLOAD_TYPES_LABEL).toBe('PDF, PNG, or JPEG');
  });

  it.each([
    [{ name: 'a.pdf', size: 1 }, null],
    [{ name: 'A.JPEG', size: 10 * 1024 * 1024 }, null],
    [{ name: 'a.docx', size: 1 }, 'Unsupported file type. Upload a PDF, PNG, or JPEG file.'],
    [{ name: 'a.pdf', size: 0 }, 'The file is empty.'],
    [{ name: 'a.pdf', size: 12 * 1024 * 1024 }, 'The file is 12 MB, larger than the 10 MB limit.'],
    [{ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 }, 'The file is larger than the 10 MB limit.'],
  ])('checks %j', (file, expected) => {
    expect(uploadProblemOf(file)).toBe(expected);
  });
});
