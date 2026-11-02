import type { DocumentType } from '@documind/shared';
import { z } from 'zod';

/** How a scalar value is written, which decides how it is checked against its evidence. */
export type FieldKind = 'text' | 'date' | 'amount' | 'currency';

export interface FieldSpec {
  readonly kind: FieldKind;
  readonly required: boolean;
  /** Shown to the model; plain wording, no examples from real documents. */
  readonly description: string;
}

export type ListName = 'lineItems' | 'parties';

export interface ExtractionSchema {
  /** Stored with every extraction; bump it when fields change meaning. */
  readonly version: number;
  readonly fields: Readonly<Record<string, FieldSpec>>;
  readonly list: {
    readonly name: ListName;
    readonly required: boolean;
    readonly description: string;
  };
}

const LINE_ITEMS = 'Each billed or ordered line: description, quantity, unit price, line amount.';

export const EXTRACTION_SCHEMAS: Readonly<Record<DocumentType, ExtractionSchema>> = {
  invoice: {
    version: 1,
    fields: {
      invoiceNumber: { kind: 'text', required: true, description: 'Invoice number or id' },
      vendorName: { kind: 'text', required: true, description: 'Company that issued the invoice' },
      customerName: { kind: 'text', required: false, description: 'Company or person billed' },
      issueDate: { kind: 'date', required: true, description: 'Invoice date' },
      dueDate: { kind: 'date', required: false, description: 'Payment due date' },
      currency: { kind: 'currency', required: true, description: 'Currency of the amounts' },
      subtotal: { kind: 'amount', required: false, description: 'Total before tax' },
      taxAmount: {
        kind: 'amount',
        required: false,
        description: 'Total tax (VAT, GST, sales tax)',
      },
      totalAmount: { kind: 'amount', required: true, description: 'Total amount due, with tax' },
    },
    list: { name: 'lineItems', required: false, description: LINE_ITEMS },
  },
  purchase_order: {
    version: 1,
    fields: {
      poNumber: { kind: 'text', required: true, description: 'Purchase order number' },
      buyerName: { kind: 'text', required: true, description: 'Company placing the order' },
      supplierName: { kind: 'text', required: true, description: 'Company receiving the order' },
      orderDate: { kind: 'date', required: true, description: 'Order date' },
      deliveryDate: { kind: 'date', required: false, description: 'Requested delivery date' },
      currency: { kind: 'currency', required: false, description: 'Currency of the amounts' },
      totalAmount: { kind: 'amount', required: true, description: 'Order total' },
    },
    list: { name: 'lineItems', required: false, description: LINE_ITEMS },
  },
  contract: {
    version: 1,
    fields: {
      title: {
        kind: 'text',
        required: true,
        description:
          'Contract title, usually the heading at the top (for example "Lease Agreement")',
      },
      effectiveDate: {
        kind: 'date',
        required: true,
        description: 'Date the contract takes effect',
      },
      endDate: { kind: 'date', required: false, description: 'Date the contract ends or expires' },
      governingLaw: { kind: 'text', required: false, description: 'Governing law or jurisdiction' },
      contractValue: { kind: 'amount', required: false, description: 'Total contract value' },
      currency: { kind: 'currency', required: false, description: 'Currency of the value' },
    },
    list: {
      name: 'parties',
      required: true,
      description: 'Each party to the contract: legal name and role (for example "Client")',
    },
  },
};

/** Generous bound that still rejects nonsense such as 1e300. */
const MAX_AMOUNT = 1e12;
const text = z.string().max(300);
const amount = z.number().min(-MAX_AMOUNT).max(MAX_AMOUNT);
const VALUE_SCHEMAS: Record<FieldKind, z.ZodType<string | number>> = {
  text,
  date: z.iso.date(),
  amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
};

export interface LineItem {
  readonly description: string;
  readonly quantity: number | null;
  readonly unitPrice: number | null;
  readonly amount: number | null;
}

export interface Party {
  readonly name: string;
  readonly role: string | null;
}

/** Bounds the answer to what fits the output-token budget. */
export const MAX_LIST_ITEMS = 40;

const LIST_SCHEMAS = {
  lineItems: z
    .array(
      z.object({
        description: text,
        quantity: amount.nullable(),
        unitPrice: amount.nullable(),
        amount: amount.nullable(),
      }),
    )
    .max(MAX_LIST_ITEMS),
  parties: z.array(z.object({ name: text, role: z.string().max(100).nullable() })).max(10),
} satisfies Record<ListName, z.ZodType>;

export interface ModelField {
  readonly value: string | number | null;
  /** The passage the model says shows the value; checked against the text, never trusted. */
  readonly evidence: string | null;
}

/** The model's answer for one document, after Zod validation. */
export interface ModelExtraction {
  readonly fields: Readonly<Record<string, ModelField>>;
  readonly lineItems?: readonly LineItem[];
  readonly parties?: readonly Party[];
}

/** The answer schema for one document type, sent as JSON Schema and checked with Zod. */
export function modelOutputSchema(schema: ExtractionSchema): z.ZodType<ModelExtraction> {
  const fields = Object.fromEntries(
    Object.entries(schema.fields).map(([name, spec]) => [
      name,
      z.object({ value: VALUE_SCHEMAS[spec.kind].nullable(), evidence: text.nullable() }),
    ]),
  );
  return schema.list.name === 'lineItems'
    ? z.object({ fields: z.object(fields), lineItems: LIST_SCHEMAS.lineItems })
    : z.object({ fields: z.object(fields), parties: LIST_SCHEMAS.parties });
}
