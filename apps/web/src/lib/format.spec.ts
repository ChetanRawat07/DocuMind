import { describe, expect, it } from 'vitest';
import {
  fileExtensionLabel,
  formatAmount,
  formatCalendarDate,
  formatDate,
  formatPercent,
  formatRelativeTime,
} from './format';
import { greetingFor } from './greeting';
import { initialsOf } from './initials';

const NOW = new Date('2026-10-29T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it.each([
    ['2026-10-29T11:59:30.000Z', 'just now'],
    ['2026-10-29T11:55:00.000Z', '5 minutes ago'],
    ['2026-10-29T09:00:00.000Z', '3 hours ago'],
    ['2026-10-28T12:00:00.000Z', 'yesterday'],
    ['2026-10-15T12:00:00.000Z', '2 weeks ago'],
    ['2025-10-29T12:00:00.000Z', 'last year'],
  ])('describes %s as "%s"', (iso, expected) => {
    expect(formatRelativeTime(iso, NOW, 'en')).toBe(expected);
  });
});

describe('formatDate', () => {
  it('formats a medium date', () => {
    expect(formatDate('2026-10-29T12:00:00.000Z', 'en-GB')).toBe('29 Oct 2026');
  });
});

describe('formatCalendarDate', () => {
  it('keeps the calendar day whatever the timezone', () => {
    // Read in UTC: a viewer west of Greenwich would otherwise see 19 Oct.
    expect(formatCalendarDate('2026-10-20', 'en-GB')).toBe('20 Oct 2026');
  });
});

describe('formatAmount', () => {
  it('shows the currency when it is known', () => {
    expect(formatAmount(58_200, 'INR', 'en-IN')).toBe('₹58,200.00');
    expect(formatAmount(1250.5, 'USD', 'en-US')).toBe('$1,250.50');
  });

  it('falls back to the number for a missing or unknown currency', () => {
    expect(formatAmount(100, null, 'en-US')).toBe('100.00');
    expect(formatAmount(100, 'ZZ', 'en-US')).toBe('100.00');
  });
});

describe('formatPercent', () => {
  it('rounds to whole percent', () => {
    expect(formatPercent(0.724, 'en')).toBe('72%');
    expect(formatPercent(0.95, 'en')).toBe('95%');
  });
});

describe('fileExtensionLabel', () => {
  it.each([
    ['invoice.pdf', 'PDF'],
    ['scan.final.jpeg', 'JPEG'],
    ['README', 'FILE'],
    ['archive.backup', 'FILE'],
    ['trailing.', 'FILE'],
  ])('labels %s as %s', (filename, expected) => {
    expect(fileExtensionLabel(filename)).toBe(expected);
  });
});

describe('greetingFor', () => {
  it.each([
    [0, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [17, 'Good afternoon'],
    [18, 'Good evening'],
    [23, 'Good evening'],
  ])('greets at %i:00 with "%s"', (hour, expected) => {
    expect(greetingFor(new Date(2026, 9, 29, hour))).toBe(expected);
  });
});

describe('initialsOf', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['ada', 'A'],
    ['Ada King Lovelace', 'AK'],
    ['ada@example.test', 'A'],
    ['  ', '?'],
  ])('turns "%s" into %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
