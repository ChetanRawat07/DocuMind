import type { ExtractedFieldDto, ValidationIssueCode } from '@documind/shared';
import { formatAmount, formatCalendarDate } from './format';

/** Field names as reviewers read them. A field missing here shows its API name. */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  invoiceNumber: 'Invoice number',
  vendorName: 'Vendor',
  customerName: 'Customer',
  issueDate: 'Invoice date',
  dueDate: 'Due date',
  currency: 'Currency',
  subtotal: 'Subtotal',
  taxAmount: 'Tax',
  totalAmount: 'Total',
  lineItems: 'Line items',
  poNumber: 'PO number',
  buyerName: 'Buyer',
  supplierName: 'Supplier',
  orderDate: 'Order date',
  deliveryDate: 'Delivery date',
  title: 'Title',
  effectiveDate: 'Effective date',
  endDate: 'End date',
  governingLaw: 'Governing law',
  contractValue: 'Contract value',
  parties: 'Parties',
};

export function fieldLabel(name: string): string {
  return FIELD_LABEL[name] ?? name;
}

/** Why a field was flagged, in the reviewer's terms. `Record` makes a new code a compile error here. */
export const ISSUE_LABEL: Record<ValidationIssueCode, string> = {
  missing_required_field: 'Required, but not found',
  evidence_not_found: 'The quoted text is not in the document',
  value_not_in_evidence: 'The quoted text does not show this value',
  date_order: 'The dates are in the wrong order',
  totals_mismatch: 'Subtotal and tax do not add up to the total',
  line_items_total_mismatch: 'The line items do not add up',
  line_item_arithmetic: 'Quantity × price differs from a line amount',
  non_positive_amount: 'The amount is zero or negative',
  too_few_parties: 'Fewer than two parties were found',
  text_truncated: 'Only the start of this long document was read',
};

/**
 * A scalar value for display: dates as calendar dates, amounts with the
 * document's currency. Lists are shown by the review panel itself.
 */
export function formatFieldValue(
  field: Pick<ExtractedFieldDto, 'kind'>,
  value: ExtractedFieldDto['value'],
  currency: string | null,
): string | null {
  if (value === null || Array.isArray(value)) return null;
  if (field.kind === 'date' && typeof value === 'string') return formatCalendarDate(value);
  if (field.kind === 'amount' && typeof value === 'number') return formatAmount(value, currency);
  return String(value);
}
