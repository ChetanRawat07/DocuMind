import { dirname, join } from 'node:path';
import { type Canvas, createCanvas } from '@napi-rs/canvas';
import {
  getDocument,
  InvalidPDFException,
  PasswordException,
  type PDFDocumentProxy,
  version as pdfjsVersion,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { TextExtractionError } from './text-extraction-error.js';

export { pdfjsVersion };

/** Largest image, in pixels, that is decoded or rendered for OCR (5000 × 5000). */
export const MAX_OCR_PIXELS = 25_000_000;

/**
 * Pages are rendered for OCR at 200 DPI (PDF user space is 72 units per
 * inch). Tesseract's guidance is 300 DPI, but on our samples 200 DPI read
 * just as accurately with about 15% less peak memory and a third less time;
 * text smaller than about 8 pt may need more.
 */
const OCR_RENDER_SCALE = 200 / 72;

// pdf.js data files, read from the installed package so nothing is fetched over the network.
const PDFJS_ROOT = dirname(require.resolve('pdfjs-dist/package.json'));
const asset = (folder: string) => `${join(PDFJS_ROOT, folder)}/`;

/** An opened PDF. Call `close()` when done to release pdf.js's memory. */
export interface PdfDocument {
  readonly pageCount: number;
  /** The page's text layer, one line per text run that ends a line. */
  readTextLayer(pageNumber: number): Promise<string>;
  /** The page as a PNG at about 200 DPI, capped at MAX_OCR_PIXELS. */
  renderPage(pageNumber: number): Promise<Buffer>;
  close(): Promise<void>;
}

/** Opens PDF bytes. Throws TextExtractionError for a corrupt or password-protected file. */
export async function openPdf(bytes: Buffer): Promise<PdfDocument> {
  const task = getDocument({
    // pdf.js may transfer the buffer it is given, so it gets a copy.
    data: new Uint8Array(bytes),
    standardFontDataUrl: asset('standard_fonts'),
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
    // Embedded images beyond this are skipped instead of decoded (decompression bombs).
    maxImageSize: MAX_OCR_PIXELS,
    enableXfa: false,
    verbosity: 0,
  });

  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy();
    if (error instanceof PasswordException) {
      throw new TextExtractionError('encrypted_pdf', 'The PDF is password-protected', {
        cause: error,
      });
    }
    if (error instanceof InvalidPDFException) {
      throw new TextExtractionError('unreadable_pdf', 'The PDF is corrupt or not a PDF', {
        cause: error,
      });
    }
    throw error;
  }

  // One canvas for the whole document, resized per page. Its pixels live in native memory that
  // is freed only when V8 collects the canvas, which it rarely does: a canvas per page grew the
  // process by about 30 MB a page.
  let canvas: Canvas | null = null;

  return {
    pageCount: pdf.numPages,

    async readTextLayer(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        return content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
          .join('');
      } finally {
        page.cleanup();
      }
    },

    async renderPage(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      try {
        const unscaled = page.getViewport({ scale: 1 });
        const fit = Math.sqrt(MAX_OCR_PIXELS / (unscaled.width * unscaled.height));
        const viewport = page.getViewport({ scale: Math.min(OCR_RENDER_SCALE, fit) });
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);
        canvas ??= createCanvas(width, height);
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        // White background: scanned text is dark-on-light, and transparency confuses OCR.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        // @napi-rs/canvas is the canvas pdf.js itself uses in Node; its types differ from the DOM's.
        await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
          .promise;
        return canvas.toBuffer('image/png');
      } finally {
        page.cleanup();
      }
    },

    async close() {
      canvas = null;
      await task.destroy();
    },
  };
}
