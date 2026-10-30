export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Reads an image's width and height from its header, without decoding it,
 * so an oversized image (a decompression bomb: a small file that expands to
 * gigabytes of pixels) is refused before any memory is spent on it.
 * Returns null when the header is missing or malformed.
 */
export function imageDimensions(image: Buffer, mimeType: string): ImageDimensions | null {
  if (mimeType === 'image/png') return pngDimensions(image);
  if (mimeType === 'image/jpeg') return jpegDimensions(image);
  return null;
}

/** PNG: the IHDR chunk always comes first, right after the 8-byte signature. */
function pngDimensions(image: Buffer): ImageDimensions | null {
  if (image.length < 24 || image.toString('latin1', 12, 16) !== 'IHDR') return null;
  return positive(image.readUInt32BE(16), image.readUInt32BE(20));
}

/** JPEG: walk the marker segments to the first start-of-frame (SOFn) marker. */
function jpegDimensions(image: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 4 <= image.length) {
    if (image[offset] !== 0xff) return null;
    const marker = image[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    // Standalone markers (TEM, RSTn, SOI, EOI) carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > image.length) return null;
      return positive(image.readUInt16BE(offset + 7), image.readUInt16BE(offset + 5));
    }
    offset += 2 + image.readUInt16BE(offset + 2);
  }
  return null;
}

function positive(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null;
}
