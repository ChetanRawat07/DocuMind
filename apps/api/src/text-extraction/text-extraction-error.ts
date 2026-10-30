export type TextExtractionFailure =
  | 'unreadable_pdf'
  | 'encrypted_pdf'
  | 'too_many_pages'
  | 'unreadable_image'
  | 'image_too_large'
  | 'unsupported_type'
  | 'page_text_too_long'
  | 'ocr_failed';

/** Failures that will happen again on retry: the file itself is the problem. */
const PERMANENT: ReadonlySet<TextExtractionFailure> = new Set([
  'unreadable_pdf',
  'encrypted_pdf',
  'too_many_pages',
  'unreadable_image',
  'image_too_large',
  'unsupported_type',
  'page_text_too_long',
]);

/**
 * A document whose text could not be extracted. `permanent` tells the job
 * runner (Phase 9) whether a retry can help: a corrupt or encrypted file
 * fails the same way every time, while an OCR engine failure may not.
 * Messages describe the file, never its content.
 */
export class TextExtractionError extends Error {
  readonly permanent: boolean;

  constructor(
    readonly failure: TextExtractionFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TextExtractionError';
    this.permanent = PERMANENT.has(failure);
  }
}
