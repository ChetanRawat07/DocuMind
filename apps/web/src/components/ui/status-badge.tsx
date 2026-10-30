import type { DocumentStatus } from '@documind/shared';
import { DOCUMENT_STATUS_DISPLAY, type StatusTone } from '../../lib/document-labels';
import { cx } from '../../lib/cx';

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  info: 'bg-brand-50 text-brand-700',
  warning: 'bg-amber-50 text-amber-800',
  success: 'bg-green-50 text-green-800',
  danger: 'bg-red-50 text-red-800',
};

/** Status pill. The label carries the meaning; color only reinforces it. */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={cx(
        'inline-flex w-max items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold',
        TONE_CLASS[tone],
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const { label, tone } = DOCUMENT_STATUS_DISPLAY[status];
  return <StatusBadge tone={tone} label={label} />;
}
