const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** "5 minutes ago", "yesterday", "just now". `now` is passed in so callers and tests control the clock. */
export function formatRelativeTime(iso: string, now: Date, locale?: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return formatter.format(Math.trunc(seconds / unitSeconds), unit);
    }
  }
  return 'just now';
}

/** "29 Oct 2026". */
export function formatDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

/** Short badge text for a file icon: "PDF", "PNG"; "FILE" when there is no usable extension. */
export function fileExtensionLabel(filename: string): string {
  const match = /\.([a-z0-9]{1,4})$/i.exec(filename);
  return match?.[1] ? match[1].toUpperCase() : 'FILE';
}
