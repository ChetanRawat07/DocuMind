import type { ExtractedFieldDto, ReviewFieldRequest } from '@documind/shared';
import { Check, Pencil } from 'lucide-react';
import { type SubmitEvent, useState } from 'react';
import { cx } from '../../lib/cx';
import { fieldLabel, formatFieldValue, ISSUE_LABEL } from '../../lib/extraction-labels';
import { formatAmount, formatPercent } from '../../lib/format';
import { TextField } from '../form-controls';
import { Button } from '../ui/button';

/** What the reviewer asks for, without the extraction id the panel adds. */
export type FieldAction =
  | Omit<Extract<ReviewFieldRequest, { action: 'confirm' }>, 'extractionId'>
  | Omit<Extract<ReviewFieldRequest, { action: 'correct' }>, 'extractionId'>;

/** Saves a field action; resolves to an error message to show, or null when saved. */
export type ReviewFieldHandler = (field: string, action: FieldAction) => Promise<string | null>;

const INPUT_TYPE: Record<Exclude<ExtractedFieldDto['kind'], 'list'>, string> = {
  text: 'text',
  date: 'date',
  amount: 'number',
  currency: 'text',
};

type ListItems = Extract<ExtractedFieldDto['value'], unknown[]>;

function ListValue({ value, currency }: { value: ListItems; currency: string | null }) {
  const money = (amount: number | null) => (amount === null ? '?' : formatAmount(amount, currency));
  return (
    <ul className="mt-1 space-y-1 text-sm text-gray-900">
      {value.map((item, index) =>
        'name' in item ? (
          <li key={index}>
            {item.name}
            {item.role ? <span className="text-gray-500"> ({item.role})</span> : null}
          </li>
        ) : (
          <li key={index} className="flex justify-between gap-3">
            <span className="min-w-0 break-words">{item.description}</span>
            <span className="shrink-0 text-gray-600 tabular-nums">
              {item.quantity ?? '?'} × {money(item.unitPrice)} = {money(item.amount)}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

/** The reviewer's input as the API expects it: numbers for amounts, upper-case currency codes. */
function toValue(
  kind: ExtractedFieldDto['kind'],
  input: string,
): { value: string | number | null } | { error: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { value: null };
  if (kind === 'amount') {
    const number = Number(trimmed);
    return Number.isFinite(number) ? { value: number } : { error: 'Enter a number' };
  }
  return { value: kind === 'currency' ? trimmed.toUpperCase() : trimmed };
}

/**
 * One extracted field. Flagged fields show why, and the passage the model
 * quoted, so the reviewer can check it against the preview. While the
 * document is in review, each can be confirmed as it is or corrected; lists
 * can only be confirmed.
 */
export function FieldRow({
  field,
  currency,
  editable,
  onReview,
}: {
  field: ExtractedFieldDto;
  currency: string | null;
  editable: boolean;
  onReview: ReviewFieldHandler;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = fieldLabel(field.name);
  const pending = field.needsReview && !field.reviewed;
  const shown = formatFieldValue(field, field.value, currency);

  async function save(action: FieldAction) {
    setBusy(true);
    setError(null);
    const message = await onReview(field.name, action);
    setBusy(false);
    setError(message);
    if (message === null) setEditing(false);
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = toValue(field.kind, input);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    void save({ action: 'correct', value: parsed.value });
  }

  return (
    <li className={cx('px-5 py-3', pending && 'bg-amber-50/70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          {Array.isArray(field.value) && field.value.length > 0 ? (
            <ListValue value={field.value} currency={currency} />
          ) : (
            <p className="text-sm font-medium break-words text-gray-900">
              {shown ?? <span className="font-normal text-gray-400">Not found</span>}
            </p>
          )}
          {field.corrected ? (
            <p className="mt-0.5 text-xs text-gray-500">
              Extracted: {formatFieldValue(field, field.extractedValue, currency) ?? 'nothing'}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {field.confidence !== null ? (
            <span
              className={cx(
                'rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                field.needsReview ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700',
              )}
              title="Score from checks against the document. A review signal, not a guarantee."
            >
              <span className="sr-only">Confidence </span>
              {formatPercent(field.confidence)}
            </span>
          ) : null}
          {pending ? <span className="text-xs font-semibold text-amber-800">Check</span> : null}
          {field.reviewed ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-800">
              <Check aria-hidden="true" className="size-3.5" />
              {field.corrected ? 'Corrected' : 'Confirmed'}
            </span>
          ) : null}
        </div>
      </div>

      {field.needsReview ? (
        <div className="mt-1.5 space-y-1 text-xs">
          {field.issues.map((code) => (
            <p key={code} className="text-amber-900">
              {ISSUE_LABEL[code]}
            </p>
          ))}
          {field.evidence ? (
            <p className="text-gray-600">
              Quoted: <q className="italic">{field.evidence}</q>
            </p>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <form className="mt-2 space-y-2" onSubmit={submit} noValidate>
          <TextField
            label={`New value for ${label}`}
            type={field.kind === 'list' ? 'text' : INPUT_TYPE[field.kind]}
            step={field.kind === 'amount' ? 'any' : undefined}
            maxLength={field.kind === 'currency' ? 3 : 300}
            hint={
              field.kind === 'currency' ? 'Three-letter code, such as USD' : 'Leave empty to clear'
            }
            value={input}
            autoFocus
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : editable ? (
        <div className="mt-2 flex gap-2">
          {!field.reviewed ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              aria-label={`Confirm ${label}`}
              onClick={() => void save({ action: 'confirm' })}
            >
              <Check aria-hidden="true" className="size-3.5" />
              Confirm
            </Button>
          ) : null}
          {field.kind !== 'list' ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Edit ${label}`}
              onClick={() => {
                const current = field.value;
                setInput(current === null || Array.isArray(current) ? '' : String(current));
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              Edit
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </li>
  );
}
