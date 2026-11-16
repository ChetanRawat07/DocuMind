import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedLoading } from './delayed-loading';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderLoading() {
  return renderHook(({ loading }: { loading: boolean }) => useDelayedLoading(loading), {
    initialProps: { loading: true },
  });
}

describe('useDelayedLoading', () => {
  it('keeps the skeleton invisible for a fast load, then shows the content without a fade', () => {
    const { result, rerender } = renderLoading();
    expect(result.current).toMatchObject({ skeleton: true, skeletonClass: 'invisible' });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ loading: false });

    expect(result.current).toMatchObject({ skeleton: false, revealClass: undefined });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.skeleton).toBe(false);
  });

  it('shows the skeleton after 150ms and keeps it at least 300ms, then fades the content in', () => {
    const { result, rerender } = renderLoading();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toMatchObject({ skeleton: true, skeletonClass: undefined });

    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender({ loading: false });
    // The data is here, but the skeleton has only been seen for 50ms.
    expect(result.current.skeleton).toBe(true);

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current.skeleton).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toMatchObject({
      skeleton: false,
      revealClass: 'motion-safe:animate-reveal',
    });
  });

  it('hides a skeleton that has been visible long enough as soon as the data arrives', () => {
    const { result, rerender } = renderLoading();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    rerender({ loading: false });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.skeleton).toBe(false);
  });
});
