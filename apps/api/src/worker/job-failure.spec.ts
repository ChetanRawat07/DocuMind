import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../ai/ai-error.js';
import { DocumentAnalysisError } from '../extraction/document-analysis.service.js';
import { ObjectNotFoundError } from '../storage/object-storage.js';
import { TextExtractionError } from '../text-extraction/text-extraction-error.js';
import { classifyFailure, retryDelayMs } from './job-failure.js';

describe('classifyFailure', () => {
  it.each([
    [new TextExtractionError('encrypted_pdf', 'The PDF is encrypted'), 'encrypted_pdf', false],
    [new TextExtractionError('ocr_failed', 'OCR failed'), 'ocr_failed', true],
    [new DocumentAnalysisError('no_text'), 'no_text', false],
    [new AiProviderError('unavailable', 'ollama', 'down'), 'ai_unavailable', true],
    [new AiProviderError('invalid_request', 'ollama', 'too long'), 'ai_invalid_request', false],
    [new ObjectNotFoundError('documents/a/b'), 'file_missing', false],
  ])('classifies %s', (error, code, retryable) => {
    expect(classifyFailure(error)).toMatchObject({ code, retryable });
  });

  it('keeps the provider wait hint', () => {
    const error = new AiProviderError('rate_limited', 'cloudflare', 'slow down', {
      retryAfterMs: 90_000,
    });

    expect(classifyFailure(error).retryAfterMs).toBe(90_000);
  });

  it('retries unknown errors with a fixed message, never their own text', () => {
    const failure = classifyFailure(new Error('connection to 10.0.0.5 lost; key=secret'));

    expect(failure).toEqual({
      code: 'internal_error',
      message: 'Unexpected error, see the worker log',
      retryable: true,
    });
  });

  it('does not reveal the storage key of a missing file', () => {
    expect(classifyFailure(new ObjectNotFoundError('documents/owner/doc')).message).not.toContain(
      'documents/',
    );
  });
});

describe('retryDelayMs', () => {
  const lowest = () => 0;
  const highest = () => 1;

  it('doubles per attempt, with half of the delay random', () => {
    expect([1, 2, 3].map((attempt) => retryDelayMs(attempt, 0, lowest))).toEqual([
      15_000, 30_000, 60_000,
    ]);
    expect([1, 2, 3].map((attempt) => retryDelayMs(attempt, 0, highest))).toEqual([
      30_000, 60_000, 120_000,
    ]);
  });

  it('caps the delay at 15 minutes', () => {
    expect(retryDelayMs(20, 0, highest)).toBe(15 * 60_000);
  });

  it('waits at least as long as the provider asked, up to the cap', () => {
    expect(retryDelayMs(1, 120_000, lowest)).toBe(120_000);
    expect(retryDelayMs(1, 24 * 60 * 60_000, lowest)).toBe(15 * 60_000);
  });
});
