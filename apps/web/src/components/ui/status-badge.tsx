import type { DocumentStatus } from '@documind/shared';
import { DOCUMENT_STATUS_DISPLAY, type StatusTone } from '../../lib/document-labels';
import { cx } from '../../lib/cx';

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'border-line bg-surface-muted text-fg-secondary',
  info: 'border-info-line bg-info-subtle text-info-fg',
  warning: 'border-warning-line bg-warning-subtle text-warning-fg',
  success: 'border-success-line bg-success-subtle text-success-fg',
  danger: 'border-danger-line bg-danger-subtle text-danger-fg',
};

/**
 * Status badge. The label carries the meaning; the dot and colour only
 * reinforce it. `pulse` softly animates the dot (the dashboard's Processing).
 */
export function StatusBadge({
  tone,
  label,
  pulse = false,
}: {
  tone: StatusTone;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-5 w-max items-center gap-1.5 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone],
      )}
    >
      <span
        aria-hidden="true"
        className={cx('size-1.5 rounded-full bg-current', pulse && 'motion-safe:animate-dot-pulse')}
      />
      {label}
    </span>
  );
}

export function DocumentStatusBadge({
  status,
  animate = false,
}: {
  status: DocumentStatus;
  animate?: boolean;
}) {
  const { label, tone } = DOCUMENT_STATUS_DISPLAY[status];
  return <StatusBadge tone={tone} label={label} pulse={animate && status === 'processing'} />;
}
