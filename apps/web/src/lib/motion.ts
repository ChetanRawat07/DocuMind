/** False under prefers-reduced-motion, and where it cannot be checked (tests, old browsers). */
export function prefersMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}

/** Waits `ms` before resolving, or resolves at once when motion is reduced. */
export function afterMotion(ms: number): Promise<void> {
  return prefersMotion() ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** One subtle horizontal nudge on an invalid field: 2 cycles of 4px in 240ms. */
export function nudge(element: HTMLElement | null): void {
  if (!element || typeof element.animate !== 'function' || !prefersMotion()) return;
  element.animate(
    [0, -4, 4, -4, 4, 0].map((x) => ({ transform: `translateX(${String(x)}px)` })),
    { duration: 240, easing: 'ease-in-out' },
  );
}
