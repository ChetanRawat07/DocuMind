import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { type ButtonSize, type ButtonVariant, buttonClasses } from './button-styles';

/** `loading` disables the button and shows a spinner beside its (unchanged) label. */
export function Button({
  variant,
  size,
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
      ) : null}
      {children}
    </button>
  );
}
