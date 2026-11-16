/**
 * Shared table look: 40px rows, no zebra. Headers stick under the 56px top bar; that needs every
 * ancestor to avoid overflow other than `clip`, so the wrapper scrolls
 * sideways only below `lg`, where the header does not need to stick.
 */
export const TABLE_WRAP = 'overflow-x-auto lg:overflow-x-visible';
export const TABLE = 'w-full text-left text-compact';
export const TH =
  'h-9 bg-surface-subtle px-4 text-xs font-medium whitespace-nowrap text-fg-muted shadow-[inset_0_-1px_0_var(--color-line)] lg:sticky lg:top-14 lg:z-10 sm:first:pl-6 sm:last:pr-6';
export const ROW =
  'group border-b border-line-subtle transition-colors duration-150 last:border-0 hover:bg-surface-subtle';
export const TD = 'h-10 px-4 py-1.5 sm:first:pl-6 sm:last:pr-6';

/** Row actions that appear on row hover or focus; see `.reveal-on-hover` in index.css. */
export const REVEAL_ON_HOVER = 'reveal-on-hover';
