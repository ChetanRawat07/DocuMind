import { cx } from '../../lib/cx';
import { initialsOf } from '../../lib/initials';

/** Decorative: the accessible name comes from the surrounding control or text. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-full border border-line bg-surface-muted text-xs font-semibold text-fg-secondary',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
