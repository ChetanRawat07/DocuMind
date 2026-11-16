import { cx } from '../../lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary:
    'border border-line-strong bg-surface text-fg hover:border-fg-muted hover:bg-surface-subtle',
  ghost: 'text-fg-secondary hover:bg-surface-muted hover:text-fg',
  danger: 'bg-danger-solid text-on-accent hover:bg-danger-solid-hover',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-compact',
  md: 'h-9 gap-2 px-4 text-sm',
};

/** The focus ring every interactive element shares. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Classes for anything that should look like a button, including router links. */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors duration-150',
    FOCUS_RING,
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

/** Container and buttons of an aria-pressed toggle group (range pickers, status filters). */
export const SEGMENTED_GROUP =
  'inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-subtle p-0.5';

export function segmentClasses(pressed: boolean): string {
  return cx(
    'h-7 rounded-md px-2 text-compact font-medium transition-colors duration-150',
    FOCUS_RING,
    pressed
      ? 'bg-surface text-fg shadow-[0_0_0_1px_var(--color-line)]'
      : 'text-fg-muted hover:text-fg',
  );
}
