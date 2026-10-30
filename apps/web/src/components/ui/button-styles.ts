import { cx } from '../../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700',
  secondary: 'border border-gray-300 bg-white text-gray-800 shadow-xs hover:bg-gray-50',
  ghost: 'text-gray-700 hover:bg-gray-100',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
};

/** Classes for anything that should look like a button, including router links. */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
    'disabled:cursor-not-allowed disabled:opacity-60',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
