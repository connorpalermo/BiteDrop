import type {
  CategorySlug,
  CountryCode,
  DropStatus,
  Facets,
  FoodDropDetail,
  FoodDropSummary,
  Page,
  SortKey,
} from './types';

export interface FeedQuery {
  cursor?: string;
  limit: number;
  categories?: CategorySlug[];
  countries?: CountryCode[];
  statuses?: DropStatus[];
  brandSlugs?: string[];
  search?: string;
  sort: SortKey;
}

export interface FoodDropRepository {
  list(q: FeedQuery): Promise<Page<FoodDropSummary>>;
  getBySlug(slug: string): Promise<FoodDropDetail | null>;
  facets(): Promise<Facets>;
}

export const PAGE_SIZE = 12;

export class InvalidCursorError extends Error {
  constructor(cursor: string) {
    super(`Invalid pagination cursor: ${cursor}`);
    this.name = 'InvalidCursorError';
  }
}

interface CursorPayload {
  v: string | number;
  id: string;
}

/** Cross-runtime base64url (works in both Node and edge/browser contexts). */
function toBase64Url(input: string): string {
  const base64 =
    typeof Buffer !== 'undefined' ? Buffer.from(input, 'utf-8').toString('base64') : btoa(input);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return typeof Buffer !== 'undefined'
    ? Buffer.from(padded, 'base64').toString('utf-8')
    : atob(padded);
}

export function encodeCursor(payload: CursorPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw new InvalidCursorError(cursor);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('v' in parsed) ||
    !('id' in parsed) ||
    (typeof (parsed as { v: unknown }).v !== 'string' &&
      typeof (parsed as { v: unknown }).v !== 'number') ||
    typeof (parsed as { id: unknown }).id !== 'string'
  ) {
    throw new InvalidCursorError(cursor);
  }
  return parsed as CursorPayload;
}
