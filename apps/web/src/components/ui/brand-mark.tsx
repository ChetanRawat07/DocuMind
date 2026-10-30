import { cx } from '../../lib/cx';

/** The DocuMind logo tile with the product name. */
export function BrandMark({ className, hideName }: { className?: string; hideName?: boolean }) {
  return (
    <span className={cx('flex items-center gap-2.5 font-bold tracking-tight', className)}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-extrabold text-white"
      >
        D
      </span>
      <span className={hideName ? 'sr-only' : undefined}>DocuMind</span>
    </span>
  );
}
