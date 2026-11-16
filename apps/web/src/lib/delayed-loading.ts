import { useLayoutEffect, useState } from 'react';

/** A skeleton stays invisible this long, so a fast response never flashes one. */
const SHOW_AFTER_MS = 150;
/** Once visible, a skeleton stays at least this long, so it does not flicker. */
const MIN_VISIBLE_MS = 300;

export interface DelayedLoading {
  readonly skeleton: boolean;
  readonly skeletonClass: string | undefined;
  readonly revealClass: string | undefined;
}

/**
 * How to show a load. While `skeleton` is true, render the skeleton in
 * place of the content (with `skeletonClass`): it keeps the content's space
 * from the start but stays invisible for the first 150ms, and once visible
 * it stays at least 300ms even if the data arrives sooner. `revealClass`
 * fades the content in after it replaced a skeleton the user saw; a
 * background refresh never shows a skeleton, so it never fades.
 */
export function useDelayedLoading(loading: boolean): DelayedLoading {
  const [visibleSince, setVisibleSince] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  // A layout effect, so the timers are cleared as the new state commits: a passive
  // effect's cleanup can run late, letting the skeleton appear after the data did.
  useLayoutEffect(() => {
    if (loading && visibleSince === null) {
      const timer = setTimeout(() => {
        setVisibleSince(performance.now());
      }, SHOW_AFTER_MS);
      return () => {
        clearTimeout(timer);
      };
    }
    if (!loading && visibleSince !== null) {
      const timer = setTimeout(
        () => {
          setVisibleSince(null);
          setRevealed(true);
        },
        Math.max(0, visibleSince + MIN_VISIBLE_MS - performance.now()),
      );
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [loading, visibleSince]);

  return {
    skeleton: loading || visibleSince !== null,
    skeletonClass: visibleSince === null ? 'invisible' : undefined,
    revealClass: revealed ? 'motion-safe:animate-reveal' : undefined,
  };
}
