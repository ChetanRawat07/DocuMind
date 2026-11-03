import { createCanvas, loadImage } from '@napi-rs/canvas';
import { type ImageDimensions, imageDimensions } from './image-dimensions.js';
import { normalizeExtractedText } from './normalize-text.js';
import type { OcrEngine } from './ocr-engine.js';
import { MAX_OCR_PIXELS, openPdf } from './pdf-document.js';
import { TextExtractionError } from './text-extraction-error.js';

/**
 * Images above this many pixels are downscaled before OCR: A4 at 200 DPI,
 * the resolution PDF pages are rendered at (pdf-document.ts). A 20 MP photo
 * then peaks about 250 MB lower, which keeps it within a 512 MB instance
 * (docs/operations/performance-review.md).
 */
export const OCR_IMAGE_PIXELS = 1654 * 2339;

/** Longest PDF processed. Bounds the time one document can take on a small instance. */
export const MAX_PDF_PAGES = 50;

/**
 * A page whose text layer has fewer visible characters than this is treated
 * as scanned and read with OCR. Low enough that a short text page (a cover,
 * a signature page) keeps its text layer; high enough that a scan carrying
 * only a stamped page number still gets OCR.
 */
export const MIN_TEXT_LAYER_CHARACTERS = 20;

/** Longest text kept for one page (the database enforces the same limit). */
export const MAX_PAGE_TEXT_LENGTH = 100_000;

export type TextMethod = 'text_layer' | 'ocr';

export interface ExtractedPage {
  readonly pageNumber: number;
  readonly method: TextMethod;
  /** Normalized text; may be empty for a blank page. */
  readonly text: string;
  /** 0–1 for OCR pages, null for text-layer pages. */
  readonly ocrConfidence: number | null;
}

/**
 * Extracts normalized text from a stored document, page by page. PDFs use
 * their text layer where it has real content and OCR elsewhere, so a PDF
 * mixing typed and scanned pages is handled page by page. Images are one
 * OCR page. Pages are processed one at a time to keep memory flat.
 */
export async function extractText(
  content: Buffer,
  mimeType: string,
  ocr: OcrEngine,
): Promise<ExtractedPage[]> {
  if (mimeType === 'application/pdf') return extractPdf(content, ocr);
  if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
    return [ocrPage(1, await recognizeImage(content, mimeType, ocr))];
  }
  throw new TextExtractionError('unsupported_type', `Cannot extract text from ${mimeType}`);
}

async function extractPdf(content: Buffer, ocr: OcrEngine): Promise<ExtractedPage[]> {
  const pdf = await openPdf(content);
  try {
    if (pdf.pageCount > MAX_PDF_PAGES) {
      throw new TextExtractionError(
        'too_many_pages',
        `The PDF has ${pdf.pageCount} pages; the limit is ${MAX_PDF_PAGES}`,
      );
    }
    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.pageCount; pageNumber += 1) {
      const text = normalizeExtractedText(await pdf.readTextLayer(pageNumber));
      if (visibleLength(text) >= MIN_TEXT_LAYER_CHARACTERS) {
        pages.push(checkedPage({ pageNumber, method: 'text_layer', text, ocrConfidence: null }));
      } else {
        pages.push(ocrPage(pageNumber, await ocr.recognize(await pdf.renderPage(pageNumber))));
      }
    }
    return pages;
  } finally {
    await pdf.close();
  }
}

/**
 * OCR of the given PDF pages as rendered, ignoring their text layer: what a
 * reader sees. A text layer can hold text that is never drawn visibly.
 */
export async function ocrPdfPages(
  content: Buffer,
  pageNumbers: readonly number[],
  ocr: OcrEngine,
): Promise<ExtractedPage[]> {
  const pdf = await openPdf(content);
  try {
    const pages: ExtractedPage[] = [];
    for (const pageNumber of pageNumbers) {
      pages.push(ocrPage(pageNumber, await ocr.recognize(await pdf.renderPage(pageNumber))));
    }
    return pages;
  } finally {
    await pdf.close();
  }
}

async function recognizeImage(content: Buffer, mimeType: string, ocr: OcrEngine) {
  const dimensions = imageDimensions(content, mimeType);
  if (!dimensions) {
    throw new TextExtractionError('unreadable_image', 'The image header is missing or corrupt');
  }
  if (dimensions.width * dimensions.height > MAX_OCR_PIXELS) {
    throw new TextExtractionError(
      'image_too_large',
      `The image is ${dimensions.width}×${dimensions.height} pixels; the limit is ${MAX_OCR_PIXELS} pixels`,
    );
  }
  return ocr.recognize(await fitForOcr(content, dimensions));
}

async function fitForOcr(content: Buffer, { width, height }: ImageDimensions): Promise<Buffer> {
  const scale = Math.sqrt(OCR_IMAGE_PIXELS / (width * height));
  if (scale >= 1) return content;
  let image;
  try {
    image = await loadImage(content);
  } catch (error) {
    throw new TextExtractionError('unreadable_image', 'The image could not be decoded', {
      cause: error,
    });
  }
  const canvas = createCanvas(Math.floor(width * scale), Math.floor(height * scale));
  const context = canvas.getContext('2d');
  // White background: transparency confuses OCR.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}

function ocrPage(pageNumber: number, result: { text: string; confidence: number }) {
  return checkedPage({
    pageNumber,
    method: 'ocr',
    text: normalizeExtractedText(result.text),
    ocrConfidence: result.confidence,
  });
}

function checkedPage(page: ExtractedPage): ExtractedPage {
  if (page.text.length > MAX_PAGE_TEXT_LENGTH) {
    throw new TextExtractionError(
      'page_text_too_long',
      `Page ${page.pageNumber} has more than ${MAX_PAGE_TEXT_LENGTH} characters of text`,
    );
  }
  return page;
}

function visibleLength(text: string): number {
  return text.replace(/\s/g, '').length;
}
