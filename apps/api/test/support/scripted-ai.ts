import { AiProvider, type AiRequest, type AiResponse } from '../../src/ai/ai-provider.js';

/** A purchase order's text and a model answer that extracts it correctly. */
export const PO_TEXT = [
  'PURCHASE ORDER',
  'PO Number: PO-7781',
  'Buyer: Globex Ltd',
  'Supplier: Acme GmbH',
  'Order date: 2026-10-01',
  'Widget A  4 x 25.00  100.00',
  'Total: 100.00 USD',
].join('\n');

export const field = (value: string | number | null, evidence: string | null) => ({
  value,
  evidence,
});
export const PO_ANSWER = {
  fields: {
    poNumber: field('PO-7781', 'PO Number: PO-7781'),
    buyerName: field('Globex Ltd', 'Buyer: Globex Ltd'),
    supplierName: field('Acme GmbH', 'Supplier: Acme GmbH'),
    orderDate: field('2026-10-01', 'Order date: 2026-10-01'),
    deliveryDate: field(null, null),
    currency: field('USD', 'Total: 100.00 USD'),
    totalAmount: field(100, 'Total: 100.00 USD'),
  },
  lineItems: [{ description: 'Widget A', quantity: 4, unitPrice: 25, amount: 100 }],
};

/**
 * Answers each call with the next scripted answer and records the requests.
 * An Error answer is thrown instead, to script provider failures.
 */
export class ScriptedProvider extends AiProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-model';
  readonly requests: AiRequest[] = [];
  private readonly answers: unknown[];

  constructor(...answers: unknown[]) {
    super();
    this.answers = answers;
  }

  generate(request: AiRequest): Promise<AiResponse> {
    this.requests.push(request);
    if (this.answers.length === 0) throw new Error('Unexpected AI call');
    const answer = this.answers.shift();
    if (answer instanceof Error) return Promise.reject(answer);
    const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
    return Promise.resolve({
      text,
      provider: this.name,
      model: this.model,
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
    });
  }
}

export const classifiedAs = (documentType: string, evidence: string | null) => ({
  documentType,
  evidence,
});
