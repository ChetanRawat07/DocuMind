import { dirname, join } from 'node:path';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import tesseractPackage from 'tesseract.js/package.json';
import { TextExtractionError } from './text-extraction-error.js';

/** English LSTM model, read from the npm package: tesseract.js would otherwise download it from a CDN. */
const LANGUAGE_DATA_PATH = join(
  dirname(require.resolve('@tesseract.js-data/eng/package.json')),
  '4.0.0_best_int',
);

export const OCR_ENGINE_NAME = `tesseract.js ${tesseractPackage.version} (eng 4.0.0_best_int)`;

export interface OcrResult {
  readonly text: string;
  /** Tesseract's mean word confidence, scaled to 0–1. */
  readonly confidence: number;
}

/**
 * Tesseract running as WebAssembly in a worker thread. The worker starts on
 * the first recognition and is released by `terminate()`, so a process that
 * is not extracting holds none of its memory. One engine serves one
 * document's pages in turn; it is not shared between concurrent callers.
 */
export class OcrEngine {
  private worker: Promise<Worker> | null = null;

  /** Recognizes text in a PNG or JPEG image. */
  async recognize(image: Buffer): Promise<OcrResult> {
    this.worker ??= createWorker('eng', OEM.LSTM_ONLY, {
      langPath: LANGUAGE_DATA_PATH,
      gzip: true,
      cacheMethod: 'none',
      // Without a handler, tesseract.js also re-throws every failed job where nothing can catch
      // it, which would crash the process. The rejected promise below already carries the error.
      errorHandler: () => undefined,
    });
    try {
      const { data } = await (await this.worker).recognize(image);
      return { text: data.text, confidence: data.confidence / 100 };
    } catch (error) {
      // tesseract.js sometimes rejects with a plain string.
      const reason = error instanceof Error ? error.message : String(error);
      throw new TextExtractionError('ocr_failed', `OCR failed: ${reason}`, { cause: error });
    }
  }

  async terminate(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    try {
      await (await worker).terminate();
    } catch {
      // A worker that failed to start has nothing to release.
    }
  }
}
