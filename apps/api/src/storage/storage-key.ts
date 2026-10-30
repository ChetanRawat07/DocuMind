import type { UploadMimeType } from '@documind/shared';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID}$`);

/** Every key the application creates has exactly this shape. */
export const STORAGE_KEY_PATTERN = new RegExp(
  `^documents/${UUID}/\\d{4}/${UUID}/original\\.(pdf|png|jpg)$`,
);

const EXTENSION_FOR: Record<UploadMimeType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/**
 * `documents/{ownerId}/{year}/{documentId}/original.{ext}`. Built only from
 * generated ids and the type detected from the file's content, so no user
 * input reaches the path. The user id prefix groups a user's files for
 * cleanup; the year keeps listings manageable.
 */
export function documentStorageKey(input: {
  readonly ownerId: string;
  readonly documentId: string;
  readonly uploadedAt: Date;
  readonly mimeType: UploadMimeType;
}): string {
  for (const id of [input.ownerId, input.documentId]) {
    if (!UUID_PATTERN.test(id)) {
      throw new Error('Storage keys are built from lowercase UUIDs only');
    }
  }
  const year = input.uploadedAt.getUTCFullYear();
  return `documents/${input.ownerId}/${year}/${input.documentId}/original.${EXTENSION_FOR[input.mimeType]}`;
}

/** Defense in depth for adapters: refuse any key the application would not have generated. */
export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new Error('Refusing an unexpected storage key');
  }
}
