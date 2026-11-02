import { AiProviderError } from '../ai/ai-error.js';
import { DocumentAnalysisError } from '../extraction/document-analysis.service.js';
import type { JobError } from '../jobs/processing-jobs.repository.js';
import { ObjectNotFoundError } from '../storage/object-storage.js';
import { TextExtractionError } from '../text-extraction/text-extraction-error.js';

const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface JobFailure extends JobError {
  /** Whether another attempt can succeed. Permanent failures go straight to the dead letter. */
  readonly retryable: boolean;
  /** The provider's own wait hint (HTTP Retry-After), when it gave one. */
  readonly retryAfterMs?: number;
}

/** The classifier is a recognized document, just not one DocuMind extracts. */
export const UNSUPPORTED_DOCUMENT: JobFailure = {
  code: 'unsupported_document_type',
  message: 'Not an invoice, purchase order or contract',
  retryable: false,
};

/**
 * Sorts an error into retryable or permanent, with a stable code for the API.
 * Each error class already knows which of its failures repeat on retry (a
 * corrupt file, a rejected request); unknown errors are usually a passing
 * database or storage outage, so they are retried, with a fixed message:
 * their details go to the worker log only.
 */
export function classifyFailure(error: unknown): JobFailure {
  if (error instanceof TextExtractionError || error instanceof DocumentAnalysisError) {
    return { code: error.failure, message: error.message, retryable: !error.permanent };
  }
  if (error instanceof AiProviderError) {
    return {
      code: `ai_${error.kind}`,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    };
  }
  if (error instanceof ObjectNotFoundError) {
    return { code: 'file_missing', message: 'The stored file was not found', retryable: false };
  }
  return {
    code: 'internal_error',
    message: 'Unexpected error, see the worker log',
    retryable: true,
  };
}

/**
 * Exponential backoff with jitter after the given attempt: about 30 s, 1 min,
 * 2 min… capped at 15 min, and never sooner than the provider asked. Half the
 * delay is random ("equal jitter") so jobs that failed together, for example
 * during an AI outage, do not all retry at the same moment.
 */
export function retryDelayMs(attempt: number, retryAfterMs = 0, random = Math.random): number {
  const exponential = Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  const jittered = exponential / 2 + random() * (exponential / 2);
  return Math.round(Math.max(jittered, Math.min(retryAfterMs, MAX_RETRY_DELAY_MS)));
}
