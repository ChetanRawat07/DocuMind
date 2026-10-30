import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { buttonClasses } from './ui/button-styles';

export function TextField({
  label,
  hint,
  ...inputProps
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className="block h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-xs placeholder:text-gray-400 focus:border-brand-600 focus:ring-3 focus:ring-brand-600/20 focus:outline-none"
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} className={buttonClasses('primary', 'md', 'h-10 w-full')}>
      {children}
    </button>
  );
}

/** Announced to screen readers when it appears. */
export function FormAlert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-green-200 bg-green-50 text-green-800';
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border p-3 text-sm ${styles}`}
    >
      {children}
    </p>
  );
}
