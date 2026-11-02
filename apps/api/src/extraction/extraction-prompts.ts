import { DOCUMENT_TYPES, type DocumentType } from '@documind/shared';
import { z } from 'zod';
import { type PromptTemplate, UNTRUSTED_TEXT_RULE, untrustedText } from '../ai/prompt-template.js';
import {
  EXTRACTION_SCHEMAS,
  type ModelExtraction,
  modelOutputSchema,
} from './extraction-schemas.js';

/** Classification only needs the start of a document: titles and headers are there. */
export const CLASSIFICATION_TEXT_LIMIT = 4_000;
/**
 * Keeps the extraction prompt and answer inside Ollama's 8,192-token context
 * (OLLAMA_CONTEXT_TOKENS). Number-dense text measured about 1.6 characters
 * per token with qwen2.5, so 8,000 characters is about 5,000 tokens, plus
 * the instructions and the 2,000-token answer. Longer text is cut and flagged.
 */
export const EXTRACTION_TEXT_LIMIT = 8_000;

export const UNSUPPORTED_TYPE = 'other';

export interface Classification {
  readonly documentType: DocumentType | typeof UNSUPPORTED_TYPE;
  readonly evidence: string | null;
}

export const classifyDocumentPrompt: PromptTemplate<{ text: string }, Classification> = {
  id: 'document.classify',
  version: 1,
  system: [
    'You classify business documents.',
    'Answer "invoice" for a bill requesting payment for goods or services delivered.',
    'Answer "purchase_order" for a buyer\'s order to a supplier, issued before delivery.',
    'Answer "contract" for an agreement between parties setting out terms and obligations.',
    'Answer "other" for anything else, including quotes, receipts and letters.',
    'Set "evidence" to the shortest exact passage copied from the document that shows its type,',
    'for example its title. Use null if there is none.',
    UNTRUSTED_TEXT_RULE,
  ].join('\n'),
  render: ({ text }) =>
    `Classify this document.\n${untrustedText('document', text.slice(0, CLASSIFICATION_TEXT_LIMIT))}`,
  output: z.object({
    documentType: z.enum([...DOCUMENT_TYPES, UNSUPPORTED_TYPE]),
    evidence: z.string().max(300).nullable(),
  }),
  maxOutputTokens: 100,
  temperature: 0,
};

const EXTRACTION_SYSTEM = [
  'You extract fields from business documents into JSON.',
  'For every field return "value" and "evidence".',
  '- value: as written in the document, normalized: dates as YYYY-MM-DD; amounts as plain numbers',
  '  without currency symbols or thousands separators; currency as a 3-letter ISO 4217 code.',
  '- evidence: the single line of the document that shows the value, copied character for',
  '  character, for example "Invoice No: INV-1023". Never combine lines.',
  'If a field is not in the document, set both to null. Never guess, and never compute a value',
  'that is not written in the document.',
  'For lists, include every item in document order, at most 40, with null for missing parts.',
  UNTRUSTED_TEXT_RULE,
].join('\n');

function extractionPrompt(type: DocumentType): PromptTemplate<{ text: string }, ModelExtraction> {
  const schema = EXTRACTION_SCHEMAS[type];
  const fieldList = Object.entries(schema.fields)
    .map(([name, spec]) => `- ${name}: ${spec.description}`)
    .join('\n');
  return {
    id: `document.extract.${type}`,
    version: 1,
    system: EXTRACTION_SYSTEM,
    render: ({ text }) =>
      [
        `Extract these fields from the ${type.replace('_', ' ')} below.`,
        fieldList,
        `- ${schema.list.name}: ${schema.list.description}`,
        untrustedText('document', text.slice(0, EXTRACTION_TEXT_LIMIT)),
      ].join('\n'),
    output: modelOutputSchema(schema),
    // About 40 list items and every field with its evidence.
    maxOutputTokens: 2_000,
    temperature: 0,
  };
}

export const EXTRACTION_PROMPTS = Object.fromEntries(
  DOCUMENT_TYPES.map((type) => [type, extractionPrompt(type)]),
) as Record<DocumentType, PromptTemplate<{ text: string }, ModelExtraction>>;
