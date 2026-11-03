import type { DocumentType } from '@documind/shared';
import type { ExtractedPage } from '../text-extraction/text-extractor.js';
import type { AssessedField } from './assess-extraction.js';
import { locateEvidence } from './evidence.js';
import { EXTRACTION_SCHEMAS, type LineItem, type Party } from './extraction-schemas.js';

/**
 * Most text-layer pages rendered to confirm evidence. Each costs an OCR run;
 * evidence spread over more pages sends the document to review instead.
 */
export const MAX_RENDERED_EVIDENCE_PAGES = 3;

type Fields = Readonly<Record<string, AssessedField>>;

/** The text each value was grounded on, chosen as in assessExtraction. */
function quotes(documentType: DocumentType, fields: Fields): { field: string; quote: string }[] {
  const schema = EXTRACTION_SCHEMAS[documentType];
  const result: { field: string; quote: string }[] = [];
  for (const [name, spec] of Object.entries(schema.fields)) {
    const field = fields[name];
    if (!field || field.value === null) continue;
    const text = spec.kind === 'text' && typeof field.value === 'string' ? field.value : null;
    const quote = field.evidence ?? text;
    if (quote !== null) result.push({ field: name, quote });
  }
  const list = fields[schema.list.name]?.value;
  if (Array.isArray(list)) {
    for (const item of list as readonly (LineItem | Party)[]) {
      result.push({
        field: schema.list.name,
        quote: 'name' in item ? item.name : item.description,
      });
    }
  }
  return result;
}

/**
 * Pages whose text layer holds evidence, in order. A text layer can carry
 * text that is never drawn visibly (invisible, white-on-white, off-page), so
 * these pages must be rendered and read before the values are trusted.
 */
export function textLayerEvidencePages(
  documentType: DocumentType,
  fields: Fields,
  pages: readonly ExtractedPage[],
): number[] {
  const numbers = new Set<number>();
  for (const { quote } of quotes(documentType, fields)) {
    const page = locateEvidence(pages, quote);
    if (page?.method === 'text_layer') numbers.add(page.pageNumber);
  }
  return [...numbers].sort((a, b) => a - b);
}

/** Fields with evidence that is not on any of `visiblePages`, which hold only text read from rendered pages. */
export function fieldsWithoutVisibleEvidence(
  documentType: DocumentType,
  fields: Fields,
  visiblePages: readonly ExtractedPage[],
): string[] {
  const missing = new Set<string>();
  for (const { field, quote } of quotes(documentType, fields)) {
    if (!locateEvidence(visiblePages, quote)) missing.add(field);
  }
  return [...missing];
}
