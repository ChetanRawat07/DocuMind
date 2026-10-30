/**
 * Upload rules shared by the API (which enforces them) and the web app
 * (which pre-checks them for faster feedback). The API never trusts the
 * browser's checks or its declared MIME type: it inspects the file's bytes.
 */

/** 10 MiB. Bounds the memory one upload can use on a small API instance. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadFileType {
  /** The MIME type stored for the document, determined from the file's content. */
  readonly mimeType: string;
  /** Accepted filename extensions, lowercase with the dot. The first is canonical. */
  readonly extensions: readonly [string, ...string[]];
  readonly label: string;
}

export const UPLOAD_FILE_TYPES = [
  { mimeType: 'application/pdf', extensions: ['.pdf'], label: 'PDF' },
  { mimeType: 'image/png', extensions: ['.png'], label: 'PNG' },
  { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], label: 'JPEG' },
] as const satisfies readonly UploadFileType[];

export type UploadMimeType = (typeof UPLOAD_FILE_TYPES)[number]['mimeType'];

/** Lowercase extension including the dot ("report.PDF" → ".pdf"), or null if there is none. */
export function fileExtensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  return dot > 0 && dot < filename.length - 1 ? filename.slice(dot).toLowerCase() : null;
}

/** The allowed type for a filename's extension, or null if the extension is not allowed. */
export function uploadFileTypeForName(filename: string): UploadFileType | null {
  const extension = fileExtensionOf(filename);
  if (!extension) return null;
  return (
    UPLOAD_FILE_TYPES.find((type) => (type.extensions as readonly string[]).includes(extension)) ??
    null
  );
}

/** Multipart field name of the file in `POST /documents`. */
export const UPLOAD_FIELD_NAME = 'file';
