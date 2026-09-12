import { describe, expect, it } from 'vitest';
import { formatDropDate, formatPrice, formatRelativeTime, formatSourceCount } from '../src/format';

const NOW = new Date('2026-09-11T12:00:00.000Z');

function secondsAgo(s: number): string {
  return new Date(NOW.getTime() - s * 1000).toISOString();
}
function minutesAgo(m: number): string {
  return secondsAgo(m * 60);
}
function hoursAgo(h: number): string {
  return minutesAgo(h * 60);
}
function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

describe('formatRelativeTime', () => {
  it('reads "just now" under 60 seconds', () => {
    expect(formatRelativeTime(secondsAgo(59), NOW)).toBe('just now');
  });

  it('crosses into minutes at exactly 60 seconds', () => {
    expect(formatRelativeTime(secondsAgo(60), NOW)).toBe('1 minute ago');
  });

  it('stays in minutes at 59 minutes', () => {
    expect(formatRelativeTime(minutesAgo(59), NOW)).toBe('59 minutes ago');
  });

  it('crosses into hours at exactly 60 minutes', () => {
    expect(formatRelativeTime(minutesAgo(60), NOW)).toBe('1 hour ago');
  });

  it('truncates rather than rounds: 119 minutes reads 1 hour ago', () => {
    expect(formatRelativeTime(minutesAgo(119), NOW)).toBe('1 hour ago');
  });

  it('stays in hours at 23 hours', () => {
    expect(formatRelativeTime(hoursAgo(23), NOW)).toBe('23 hours ago');
  });

  it('crosses into days at exactly 24 hours', () => {
    expect(formatRelativeTime(hoursAgo(24), NOW)).toBe('1 day ago');
  });

  it('stays in days at 6 days', () => {
    expect(formatRelativeTime(daysAgo(6), NOW)).toBe('6 days ago');
  });

  it('crosses into weeks at exactly 7 days', () => {
    expect(formatRelativeTime(daysAgo(7), NOW)).toBe('1 week ago');
  });

  it('stays in weeks at 34 days', () => {
    expect(formatRelativeTime(daysAgo(34), NOW)).toBe('4 weeks ago');
  });

  it('crosses into an absolute date at exactly 35 days', () => {
    expect(formatRelativeTime(daysAgo(35), NOW)).toBe('Aug 7');
  });

  it('uses singular for N=1 across every unit', () => {
    expect(formatRelativeTime(minutesAgo(1), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(hoursAgo(1), NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(daysAgo(1), NOW)).toBe('1 day ago');
    expect(formatRelativeTime(daysAgo(7), NOW)).toBe('1 week ago');
  });

  it('clamps a future timestamp to "just now"', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(formatRelativeTime(future, NOW)).toBe('just now');
  });

  it('includes the year for an absolute date far in the past', () => {
    expect(formatRelativeTime('2025-01-15T00:00:00.000Z', NOW)).toBe('Jan 15, 2025');
  });
});

describe('formatPrice', () => {
  it('formats cents as a dollar amount', () => {
    expect(formatPrice(499, 'USD')).toBe('$4.99');
  });

  it('formats a whole-dollar amount with trailing zeros', () => {
    expect(formatPrice(500, 'USD')).toBe('$5.00');
  });

  it('falls back to a currency code prefix for non-USD', () => {
    expect(formatPrice(499, 'EUR')).toBe('EUR 4.99');
  });
});

describe('formatDropDate', () => {
  it('formats without a year when the date is in the current year', () => {
    expect(formatDropDate('2026-09-15', NOW)).toBe('Sept 15');
  });

  it('formats with a year when the date is not the current year', () => {
    expect(formatDropDate('2027-01-05', NOW)).toBe('Jan 5, 2027');
  });

  it('abbreviates September as "Sept", not "Sep"', () => {
    expect(formatDropDate('2026-09-01', NOW)).toContain('Sept');
  });
});

describe('formatSourceCount', () => {
  it('uses singular for exactly one source', () => {
    expect(formatSourceCount(1)).toBe('1 source');
  });

  it('uses plural for zero or many', () => {
    expect(formatSourceCount(0)).toBe('0 sources');
    expect(formatSourceCount(3)).toBe('3 sources');
  });
});
