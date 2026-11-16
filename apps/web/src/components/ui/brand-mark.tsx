import { cx } from '../../lib/cx';

/** The DocuMind logo tile with the product name, in the surrounding text colour. */
export function BrandMark({ className, hideName }: { className?: string; hideName?: boolean }) {
  return (
    <span
      className={cx(
        'flex items-center gap-2.5 font-display text-base font-extrabold tracking-[-0.03em]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-extrabold text-on-accent"
      >
        D
      </span>
      <span className={hideName ? 'sr-only' : undefined}>DocuMind</span>
    </span>
  );
}
