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

/** "29 Oct 2026, 10:00". */
export function formatDateTime(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Short badge text for a file icon: "PDF", "PNG"; "FILE" when there is no usable extension. */
export function fileExtensionLabel(filename: string): string {
  const match = /\.([a-z0-9]{1,4})$/i.exec(filename);
  return match?.[1] ? match[1].toUpperCase() : 'FILE';
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** "820 B", "1.4 MB", "10 MB". Binary multiples (1 KB = 1024 B), as file managers show them. */
export function formatBytes(bytes: number, locale?: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return `${number} ${BYTE_UNITS[unit] ?? 'B'}`;
}
