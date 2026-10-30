import { MAX_UPLOAD_BYTES, UPLOAD_FILE_TYPES, uploadFileTypeForName } from '@documind/shared';
import { formatBytes } from './format';

/** For the file picker's `accept` attribute: ".pdf,.png,.jpg,.jpeg". */
export const UPLOAD_ACCEPT = UPLOAD_FILE_TYPES.flatMap((type) => type.extensions).join(',');

/** "PDF, PNG or JPEG". */
export const UPLOAD_TYPES_LABEL = new Intl.ListFormat('en', { type: 'disjunction' }).format(
  UPLOAD_FILE_TYPES.map((type) => type.label),
);

export const UPLOAD_LIMIT_LABEL = formatBytes(MAX_UPLOAD_BYTES);

/**
 * Fast feedback before uploading. The API repeats every check and also
 * inspects the file's content, so these are for convenience, not security.
 * Returns a message, or null if the file may be uploaded.
 */
export function uploadProblemOf(file: Pick<File, 'name' | 'size'>): string | null {
  if (!uploadFileTypeForName(file.name)) {
    return `Unsupported file type. Upload a ${UPLOAD_TYPES_LABEL} file.`;
  }
  if (file.size === 0) {
    return 'The file is empty.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    // Rounded sizes can match the limit ("10 MB"), so state the size only when it differs.
    const size = formatBytes(file.size);
    return size === UPLOAD_LIMIT_LABEL
      ? `The file is larger than the ${UPLOAD_LIMIT_LABEL} limit.`
      : `The file is ${size}, larger than the ${UPLOAD_LIMIT_LABEL} limit.`;
  }
  return null;
}
