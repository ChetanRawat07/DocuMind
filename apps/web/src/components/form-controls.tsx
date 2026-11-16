import { CircleAlert, CircleCheck } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { cx } from '../lib/cx';
import { Button } from './ui/button';

/**
 * Shared look for text inputs, selects and textareas. The outline is always
 * there but transparent, so focus fades the ring in instead of snapping.
 */
export const INPUT_CLASS =
  'block w-full rounded-lg border border-line-strong bg-surface text-sm text-fg outline-2 -outline-offset-1 outline-transparent placeholder:text-fg-muted transition-[border-color,outline-color,background-color] duration-150 focus:border-accent focus:outline-accent disabled:opacity-50 aria-invalid:border-danger-fg aria-invalid:focus:outline-danger-fg';

export function TextField({
  label,
  hint,
  error,
  className,
  ...inputProps
}: {
  label: string;
  hint?: string;
  error?: string | null;
} & ComponentProps<'input'>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={cx('group space-y-2', className)}>
      <label
        htmlFor={id}
        className="block text-compact font-medium text-fg transition-colors duration-150 group-focus-within:text-accent-fg"
      >
        {label}
      </label>
      <input
        id={id}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={cx(INPUT_CLASS, 'h-9 px-3')}
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-center gap-1 text-xs text-danger-fg">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" loading={busy} className="w-full">
      {children}
    </Button>
  );
}

/** Announced to screen readers when it appears. */
export function FormAlert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex gap-2 rounded-lg border px-3 py-2 text-compact',
        tone === 'error'
          ? 'border-danger-line bg-danger-subtle text-danger-fg'
          : 'border-success-line bg-success-subtle text-success-fg',
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
