import {
  MAX_UPLOAD_BYTES,
  UPLOAD_FILE_TYPES,
  type UploadMimeType,
  uploadFileTypeForName,
} from '@documind/shared';

/** Longest stored filename; matches the documents.original_filename CHECK constraint. */
export const MAX_FILENAME_LENGTH = 255;

export type UploadRejection =
  'empty' | 'too_large' | 'invalid_filename' | 'unsupported_type' | 'content_mismatch';

export class UploadRejectedError extends Error {
  constructor(
    readonly reason: UploadRejection,
    message: string,
  ) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

/**
 * File signatures ("magic bytes") at offset 0. The PDF specification lets
 * readers tolerate leading junk before `%PDF-`; rejecting it is stricter and
 * avoids polyglot files that are valid as two formats at once.
 */
const SIGNATURES: readonly { mimeType: UploadMimeType; bytes: readonly number[] }[] = [
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

/** The allowed type the content actually is, judged by its leading bytes; null if none matches. */
export function detectFileType(content: Uint8Array): UploadMimeType | null {
  const match = SIGNATURES.find(({ bytes }) =>
    bytes.every((byte, index) => content[index] === byte),
  );
  return match?.mimeType ?? null;
}

/**
 * Makes a client-supplied filename safe to store and display. It is never
 * used to build a storage path. Keeps only the last path segment, normalizes
 * Unicode, removes control and invisible formatting characters (such as the
 * right-to-left override used to disguise "invoice‮fdp.exe" as
 * "invoiceexe.pdf"), collapses whitespace and shortens the name, keeping the
 * extension. Returns null when nothing usable remains.
 */
export function sanitizeFilename(raw: string): string | null {
  const lastSegment = raw.split(/[/\\]/).at(-1) ?? '';
  const cleaned = lastSegment
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return null;

  const characters = Array.from(cleaned);
  if (characters.length <= MAX_FILENAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 ? Array.from(cleaned.slice(dot)) : [];
  if (extension.length >= MAX_FILENAME_LENGTH) return null;
  const stem = Array.from(dot > 0 ? cleaned.slice(0, dot) : cleaned);
  return [...stem.slice(0, MAX_FILENAME_LENGTH - extension.length), ...extension].join('').trim();
}

export interface ValidatedUpload {
  readonly filename: string;
  /** Detected from the content, never the browser's claim. */
  readonly mimeType: UploadMimeType;
}

const ALLOWED_LABELS = UPLOAD_FILE_TYPES.map((type) => type.label).join(', ');

/**
 * Checks an uploaded file: size, filename, allowed extension, and that the
 * bytes really are that type. The client's declared MIME type is not an
 * input: a renamed executable fails the signature check.
 */
export function validateUpload(file: {
  readonly originalName: string;
  readonly content: Buffer;
}): ValidatedUpload {
  if (file.content.length === 0) {
    throw new UploadRejectedError('empty', 'The file is empty.');
  }
  if (file.content.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejectedError('too_large', 'The file is larger than the 10 MB limit.');
  }

  const filename = sanitizeFilename(file.originalName);
  if (!filename) {
    throw new UploadRejectedError('invalid_filename', 'The file name is missing or invalid.');
  }

  const expected = uploadFileTypeForName(filename);
  if (!expected) {
    throw new UploadRejectedError(
      'unsupported_type',
      `Unsupported file type. Allowed types: ${ALLOWED_LABELS}.`,
    );
  }

  const detected = detectFileType(file.content);
  if (!detected || detected !== expected.mimeType) {
    throw new UploadRejectedError(
      'content_mismatch',
      `The file's content is not a valid ${expected.label} file.`,
    );
  }
  return { filename, mimeType: detected };
}
