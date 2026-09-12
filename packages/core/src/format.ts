const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
];

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/**
 * Relative time, truncated (not rounded) to the boundary — 119 minutes reads
 * "1 hour ago", not "2 hours ago". Future timestamps clamp to "just now".
 */
export function formatRelativeTime(iso: string, now: Date): string {
  const elapsedMs = now.getTime() - new Date(iso).getTime();
  if (elapsedMs < 60_000) return 'just now';

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return plural(minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');

  const days = Math.floor(hours / 24);
  if (days < 7) return plural(days, 'day');

  const weeks = Math.floor(days / 7);
  if (days < 35) return plural(weeks, 'week');

  return formatAbsoluteDate(iso, now);
}

function formatAbsoluteDate(iso: string, now: Date): string {
  const date = new Date(iso);
  const month = MONTH_ABBR[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const suffix = year === now.getUTCFullYear() ? '' : `, ${year}`;
  return `${month} ${day}${suffix}`;
}

export function formatPrice(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${amount}`;
}

/** '2026-09-15' -> 'Sept 15' (or 'Sept 15, 2027' if not the current year). */
export function formatDropDate(iso: string, now: Date): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const month = MONTH_ABBR[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const suffix = year === now.getUTCFullYear() ? '' : `, ${year}`;
  return `${month} ${day}${suffix}`;
}

export function formatSourceCount(n: number): string {
  return `${n} source${n === 1 ? '' : 's'}`;
}
