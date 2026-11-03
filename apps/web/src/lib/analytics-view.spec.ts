import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsPath, viewerTimeZone } from './analytics-view';

afterEach(() => {
  vi.restoreAllMocks();
});

function reportTimeZone(timeZone: string | undefined) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

describe('analytics view', () => {
  it("sends the viewer's timezone, encoded", () => {
    expect(analyticsPath(30, 'America/Argentina/Buenos_Aires')).toBe(
      '/analytics?days=30&tz=America%2FArgentina%2FBuenos_Aires',
    );
  });

  it('uses the browser timezone, or UTC when it reports none', () => {
    reportTimeZone('Asia/Kolkata');
    expect(viewerTimeZone()).toBe('Asia/Kolkata');
    reportTimeZone(undefined);
    expect(viewerTimeZone()).toBe('UTC');
  });
});
