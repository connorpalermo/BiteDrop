export type IngestSourceType = 'rss' | 'json_api' | 'html_listing' | 'reddit' | 'youtube';

export interface IngestSource {
  id: string;
  slug: string;
  name: string;
  type: IngestSourceType;
  url: string;
  config: Record<string, unknown>;
  httpEtag: string | null;
  httpLastModified: string | null;
  consecutiveFailures: number;
}

/** One pre-normalisation discovery, before url_hash/content_hash are computed. */
export interface DiscoveredItem {
  url: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null; // ISO 8601, or null if the feed omits it
  excerpt: string | null;
  bodyText: string | null; // capped at 40k chars by the adapter — invariant 5
  imageUrl: string | null;
  rawPayload: unknown; // the original feed entry, JSON-safe, for reprocessing
}

export interface FetchContext {
  timeoutMs: number;
  userAgent: string;
}

export interface FetchResult {
  items: DiscoveredItem[];
  etag: string | null;
  lastModified: string | null;
  notModified: boolean; // true on a 304 — items is [] and the caller skips the rest
}

export interface SourceAdapter {
  readonly type: IngestSourceType;
  fetch(source: IngestSource, ctx: FetchContext): Promise<FetchResult>;
}
