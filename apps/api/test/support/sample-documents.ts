import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

/**
 * Synthetic documents for extraction tests, generated in code so the
 * repository holds no binary fixtures and every sample states what it
 * contains. Text is drawn with Liberation Sans from pdfjs-dist, so tests do
 * not depend on the fonts installed on the machine.
 */

GlobalFonts.registerFromPath(
  join(
    dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts/LiberationSans-Regular.ttf',
  ),
  'Sample Sans',
);

/** An image of dark text on white, at roughly 300 DPI proportions. */
export function textImage(
  lines: readonly string[],
  format: 'png' | 'jpeg' = 'png',
  size = { width: 1700, height: 400 + lines.length * 90 },
): Buffer {
  const canvas = createCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.fillStyle = '#111111';
  context.font = '56px "Sample Sans"';
  lines.forEach((line, index) => {
    context.fillText(line, 120, 200 + index * 90);
  });
  return format === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg', 92);
}

/** A page of a sample PDF: typed text lines, or a scanned JPEG filling the page. */
export type SamplePage =
  | { readonly lines: readonly string[] }
  | { readonly scan: Buffer; readonly width: number; readonly height: number };

/** A US Letter PDF, one page per entry. Encrypted (with an unknown password) on request. */
export function samplePdf(
  pages: readonly SamplePage[],
  options: { encrypted?: boolean } = {},
): Buffer {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
    return objects.length;
  };

  const catalog = add(''); // filled in once the page tree exists
  const pagesId = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = pages.map((page) => {
    let resources = `<< /Font << /F1 ${font} 0 R >> >>`;
    let stream: string;
    if ('lines' in page) {
      const shown = page.lines.map((line) => `(${escapePdfString(line)}) Tj T*`).join(' ');
      stream = `BT /F1 20 Tf 26 TL 72 720 Td ${shown} ET`;
    } else {
      const image = add(
        Buffer.concat([
          Buffer.from(
            `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
              `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.scan.length} >>\nstream\n`,
            'latin1',
          ),
          page.scan,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
      resources = `<< /XObject << /Im1 ${image} 0 R >> >>`;
      stream = 'q 612 0 0 792 0 0 cm /Im1 Do Q';
    }
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${contents} 0 R >>`,
    );
  });
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`,
    'latin1',
  );

  // Standard security handler with random O/U entries: no password, empty or otherwise, opens it.
  const hex = (bytes: number) => randomBytes(bytes).toString('hex');
  const encrypt = options.encrypted
    ? add(`<< /Filter /Standard /V 1 /R 2 /O <${hex(32)}> /U <${hex(32)}> /P -4 >>`)
    : null;

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let length = chunks[0]?.length ?? 0;
  const offsets = objects.map((body, index) => {
    const offset = length;
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    chunks.push(chunk);
    length += chunk.length;
    return offset;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const trailerExtras = encrypt ? ` /Encrypt ${encrypt} 0 R /ID [<${hex(16)}> <${hex(16)}>]` : '';
  chunks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${trailerExtras} >>\nstartxref\n${length}\n%%EOF\n`,
      'latin1',
    ),
  );
  return Buffer.concat(chunks);
}

function escapePdfString(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}
