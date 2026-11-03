import { afterAll, describe, expect, it } from 'vitest';
import { samplePdf, textImage } from '../../test/support/sample-documents.js';
import { imageDimensions } from './image-dimensions.js';
import { OcrEngine } from './ocr-engine.js';
import { MAX_OCR_PIXELS } from './pdf-document.js';
import { TextExtractionError } from './text-extraction-error.js';
import { extractText, MAX_PDF_PAGES, OCR_IMAGE_PIXELS } from './text-extractor.js';

// Real pdf.js and Tesseract on synthetic documents: slower than a unit test, but OCR cannot be faked meaningfully.
const OCR_TIMEOUT = 60_000;

const INVOICE_LINES = ['INVOICE 1023', 'ACME Corporation', 'Total due 1250.00 EUR'];
const ocr = new OcrEngine();

afterAll(async () => {
  await ocr.terminate();
});

async function expectFailure(promise: Promise<unknown>, failure: string, permanent = true) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(TextExtractionError);
  expect(error).toMatchObject({ failure, permanent });
}

describe('extractText', () => {
  it('reads a typed PDF from its text layer, page by page, without OCR', async () => {
    const pdf = samplePdf([
      { lines: ['INVOICE 1023', 'Bill to: ACME Corporation, 1 Main Street'] },
      { lines: ['Terms: payment due within thirty days of the invoice date.'] },
    ]);

    expect(await extractText(pdf, 'application/pdf', ocr)).toEqual([
      {
        pageNumber: 1,
        method: 'text_layer',
        text: 'INVOICE 1023\nBill to: ACME Corporation, 1 Main Street',
        ocrConfidence: null,
      },
      {
        pageNumber: 2,
        method: 'text_layer',
        text: 'Terms: payment due within thirty days of the invoice date.',
        ocrConfidence: null,
      },
    ]);
  });

  it(
    'reads a scanned PDF with OCR',
    async () => {
      const scan = textImage(INVOICE_LINES, 'jpeg', { width: 1275, height: 1650 });
      const pdf = samplePdf([{ scan, width: 1275, height: 1650 }]);

      const [page] = await extractText(pdf, 'application/pdf', ocr);

      expect(page).toMatchObject({ pageNumber: 1, method: 'ocr' });
      expect(page?.text).toContain('INVOICE 1023');
      expect(page?.text).toContain('Total due 1250.00 EUR');
      expect(page?.ocrConfidence).toBeGreaterThan(0.8);
    },
    OCR_TIMEOUT,
  );

  it(
    'chooses per page in a PDF that mixes typed and scanned pages',
    async () => {
      const scan = textImage(['SIGNED COPY', 'Page two'], 'jpeg', { width: 1275, height: 1650 });
      const pdf = samplePdf([
        { lines: ['Purchase order 77, typed page with enough text.'] },
        { scan, width: 1275, height: 1650 },
        // Too little text to count as a text layer, so this page goes to OCR too.
        { lines: ['3'] },
      ]);

      const pages = await extractText(pdf, 'application/pdf', ocr);

      expect(pages.map((page) => page.method)).toEqual(['text_layer', 'ocr', 'ocr']);
      expect(pages[1]?.text).toContain('SIGNED COPY');
    },
    OCR_TIMEOUT,
  );

  it.each(['png', 'jpeg'] as const)(
    'reads a %s image with OCR as one page',
    async (format) => {
      const pages = await extractText(textImage(INVOICE_LINES, format), `image/${format}`, ocr);

      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({ pageNumber: 1, method: 'ocr' });
      expect(pages[0]?.text).toContain('ACME Corporation');
    },
    OCR_TIMEOUT,
  );

  describe('failures', () => {
    it('reports a corrupt PDF as permanent', async () => {
      await expectFailure(
        extractText(Buffer.from('%PDF-1.7\nnot really a pdf'), 'application/pdf', ocr),
        'unreadable_pdf',
      );
    });

    it('reports a password-protected PDF as permanent', async () => {
      const pdf = samplePdf([{ lines: ['secret'] }], { encrypted: true });

      await expectFailure(extractText(pdf, 'application/pdf', ocr), 'encrypted_pdf');
    });

    it('refuses a PDF over the page limit before reading any page', async () => {
      const pdf = samplePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => ({ lines: ['x'] })));

      await expectFailure(extractText(pdf, 'application/pdf', ocr), 'too_many_pages');
    });

    it('refuses an image whose header claims too many pixels, without decoding it', async () => {
      const png = textImage(['tiny']);
      png.writeUInt32BE(30_000, 16); // width
      png.writeUInt32BE(30_000, 20); // height

      await expectFailure(extractText(png, 'image/png', ocr), 'image_too_large');
    });

    it('draws the pixel limit exactly at MAX_OCR_PIXELS', async () => {
      const png = (width: number, height: number) => {
        const image = textImage(['tiny']);
        image.writeUInt32BE(width, 16);
        image.writeUInt32BE(height, 20);
        return image;
      };

      await expectFailure(
        extractText(png(1, MAX_OCR_PIXELS + 1), 'image/png', ocr),
        'image_too_large',
      );
      // At the limit the size check passes; the fake pixel data then fails to decode.
      await expectFailure(
        extractText(png(1, MAX_OCR_PIXELS), 'image/png', ocr),
        'unreadable_image',
      );
    });

    it('downscales an image over OCR_IMAGE_PIXELS before OCR, keeping its aspect ratio', async () => {
      const received: Buffer[] = [];
      const stub = {
        recognize: (image: Buffer) => {
          received.push(image);
          return Promise.resolve({ text: 'tiny', confidence: 0.9 });
        },
      } as unknown as OcrEngine;
      const small = textImage(['tiny']);

      await extractText(
        textImage(['tiny'], 'png', { width: 4000, height: 5000 }),
        'image/png',
        stub,
      );
      await extractText(small, 'image/png', stub);

      const scaled = imageDimensions(received[0] as Buffer, 'image/png');
      expect((scaled?.width ?? 0) * (scaled?.height ?? 0)).toBeLessThanOrEqual(OCR_IMAGE_PIXELS);
      expect((scaled?.width ?? 0) / (scaled?.height ?? 1)).toBeCloseTo(4000 / 5000, 2);
      expect(received[1]).toBe(small);
    });

    it('refuses an oversized image whose data cannot be decoded', async () => {
      const png = textImage(['tiny']);
      png.writeUInt32BE(4000, 16);
      png.writeUInt32BE(5000, 20);

      await expectFailure(extractText(png, 'image/png', ocr), 'unreadable_image');
    });

    it('refuses an image with a corrupt header', async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);

      await expectFailure(extractText(jpeg, 'image/jpeg', ocr), 'unreadable_image');
    });

    it('reports an OCR engine failure as retryable', async () => {
      // A valid header with no image data behind it: Tesseract itself fails to decode it.
      const truncated = textImage(['x']).subarray(0, 64);

      await expectFailure(extractText(truncated, 'image/png', ocr), 'ocr_failed', false);
    });

    it('refuses a type it cannot read', async () => {
      await expectFailure(extractText(Buffer.from('x'), 'text/plain', ocr), 'unsupported_type');
    });
  });
});

describe('imageDimensions', () => {
  it('reads PNG and JPEG sizes from the header', () => {
    expect(
      imageDimensions(textImage(['a'], 'png', { width: 321, height: 123 }), 'image/png'),
    ).toEqual({ width: 321, height: 123 });
    expect(
      imageDimensions(textImage(['a'], 'jpeg', { width: 321, height: 123 }), 'image/jpeg'),
    ).toEqual({ width: 321, height: 123 });
  });

  it('returns null for truncated or foreign data', () => {
    expect(imageDimensions(Buffer.from([0x89, 0x50]), 'image/png')).toBeNull();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg')).toBeNull();
    expect(imageDimensions(Buffer.from('GIF89a'), 'image/gif')).toBeNull();
  });

  // Hand-built JPEG headers: SOF2 with height 123 and width 321.
  const SOF2 = [0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x7b, 0x01, 0x41];
  const jpeg = (...bytes: number[]) => Buffer.from([0xff, 0xd8, ...bytes]);

  it('walks fill bytes, standalone markers and skipped segments to the frame header', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    // DHT (C4) sits in the SOF range but is a table, not a frame.
    const dht = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00];
    const restart = [0xff, 0xd0];
    expect(imageDimensions(jpeg(0xff, ...app0, ...dht, ...restart, ...SOF2), 'image/jpeg')).toEqual(
      { width: 321, height: 123 },
    );
  });

  it.each([
    ['a byte that is not a marker', jpeg(0x00, 0xff, ...SOF2)],
    ['a truncated frame header', jpeg(...SOF2.slice(0, 6))],
    ['a segment length past the end', jpeg(0xff, 0xe0, 0xff, 0xff)],
    ['a zero width', jpeg(...SOF2.slice(0, 7), 0x00, 0x00)],
    ['a PNG without IHDR first', Buffer.alloc(24)],
  ])('returns null for %s', (_case, image) => {
    const type = image[0] === 0xff ? 'image/jpeg' : 'image/png';
    expect(imageDimensions(image, type)).toBeNull();
  });
});
