import type { DiscoveredItem, SourceAdapter } from '@bitedrop/core';
import { XMLParser } from 'fast-xml-parser';
import { fetchWithRetry } from '../httpClient';
import { stripHtml, truncate } from '../stripHtml';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export class UnrecognizedFeedFormatError extends Error {
  constructor(url: string) {
    super(`${url}: unrecognized feed format (neither <rss> nor <feed> root)`);
    this.name = 'UnrecognizedFeedFormatError';
  }
}

interface AtomLink {
  '@_rel'?: string;
  '@_href'?: string;
}

interface MediaContent {
  '@_url'?: string;
  '@_type'?: string;
}

interface MediaThumbnail {
  '@_url'?: string;
}

interface RssItem {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  author?: unknown;
  'dc:creator'?: unknown;
  pubDate?: unknown;
  description?: unknown;
  'content:encoded'?: unknown;
  enclosure?: { '@_url'?: string; '@_type'?: string };
  'media:content'?: MediaContent | MediaContent[];
  'media:thumbnail'?: MediaThumbnail | MediaThumbnail[];
}

interface AtomEntry {
  title?: unknown;
  link?: AtomLink | AtomLink[];
  id?: unknown;
  author?: { name?: unknown } | string;
  published?: unknown;
  updated?: unknown;
  summary?: unknown;
  content?: unknown;
  'media:thumbnail'?: MediaThumbnail | MediaThumbnail[];
}

interface RssDoc {
  rss: { channel: { item?: RssItem | RssItem[] } };
}

interface AtomDoc {
  feed: { entry?: AtomEntry | AtomEntry[] };
}

function isRssDoc(doc: unknown): doc is RssDoc {
  return typeof doc === 'object' && doc !== null && 'rss' in doc;
}

function isAtomDoc(doc: unknown): doc is AtomDoc {
  return typeof doc === 'object' && doc !== null && 'feed' in doc;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object' && '#text' in node) {
    const text = (node as Record<string, unknown>)['#text'];
    return typeof text === 'string' ? text : null;
  }
  return null;
}

/** Decodes HTML entities (WordPress feeds routinely emit titles/authors as
 * e.g. "Dunkin&#8217;" or "Domino&#39;s" — numeric entities, not actual HTML
 * tags) without the 500/40k truncation excerpt/bodyText get. */
function cleanText(raw: string | null): string | null {
  return raw ? stripHtml(raw) : null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Atom entries can carry several `<link>` elements — rel="replies" (a
 * comments feed), rel="edit", rel="self", and rel="alternate" — and Atom's
 * default rel (when omitted) is "alternate" per RFC 4287 §4.2.7.2. Taking
 * `links[0]` would silently capture a comments-feed URL instead of the
 * article on a real Brand Eating entry (verified 2026-10-24).
 */
function pickAtomLink(linkField: AtomLink | AtomLink[] | undefined): string | null {
  const links = toArray(linkField);
  const alternate = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
  return alternate?.['@_href'] ?? links[0]?.['@_href'] ?? null;
}

/**
 * Feeds advertise an item's image through any of three different, non-
 * universal mechanisms: the RSS 2.0 standard `<enclosure>` (The Takeout),
 * the Yahoo Media RSS `<media:content>` (PR Newswire — confirmed live
 * 2026-10-24; it has no `<enclosure>` at all), or `<media:thumbnail>`
 * (Brand Eating's Atom entries, and a fallback The Takeout also includes).
 * Checked in that order; the first valid image wins.
 */
function pickImageUrl(fields: {
  enclosure?: { '@_url'?: string; '@_type'?: string };
  mediaContent?: MediaContent | MediaContent[];
  mediaThumbnail?: MediaThumbnail | MediaThumbnail[];
}): string | null {
  const enclosure = fields.enclosure;
  if (enclosure?.['@_type']?.startsWith('image/') && enclosure['@_url']) return enclosure['@_url'];

  const content = toArray(fields.mediaContent).find(
    (c) => !c['@_type'] || c['@_type'].startsWith('image/'),
  );
  if (content?.['@_url']) return content['@_url'];

  return toArray(fields.mediaThumbnail)[0]?.['@_url'] ?? null;
}

function mapRssItem(item: RssItem): DiscoveredItem {
  const rawExcerpt = textOf(item.description);
  const rawBody = textOf(item['content:encoded']) ?? rawExcerpt;

  return {
    url: textOf(item.link) ?? textOf(item.guid) ?? '',
    title: cleanText(textOf(item.title)),
    author: cleanText(textOf(item.author) ?? textOf(item['dc:creator'])),
    publishedAt: parseDate(textOf(item.pubDate)),
    excerpt: rawExcerpt ? truncate(stripHtml(rawExcerpt), 500) : null,
    bodyText: rawBody ? truncate(stripHtml(rawBody), 40_000) : null,
    imageUrl: pickImageUrl({
      enclosure: item.enclosure,
      mediaContent: item['media:content'],
      mediaThumbnail: item['media:thumbnail'],
    }),
    rawPayload: item,
  };
}

function mapAtomEntry(entry: AtomEntry): DiscoveredItem {
  const rawExcerpt = textOf(entry.summary);
  const rawBody = textOf(entry.content) ?? rawExcerpt;
  const authorName = typeof entry.author === 'object' ? entry.author?.name : entry.author;

  return {
    url: pickAtomLink(entry.link) ?? textOf(entry.id) ?? '',
    title: cleanText(textOf(entry.title)),
    author: cleanText(textOf(authorName)),
    publishedAt: parseDate(textOf(entry.published) ?? textOf(entry.updated)),
    excerpt: rawExcerpt ? truncate(stripHtml(rawExcerpt), 500) : null,
    bodyText: rawBody ? truncate(stripHtml(rawBody), 40_000) : null,
    imageUrl: pickImageUrl({ mediaThumbnail: entry['media:thumbnail'] }),
    rawPayload: entry,
  };
}

function parseFeed(body: string, feedUrl: string): DiscoveredItem[] {
  const doc: unknown = parser.parse(body);

  if (isRssDoc(doc)) return toArray(doc.rss.channel.item).map(mapRssItem);
  if (isAtomDoc(doc)) return toArray(doc.feed.entry).map(mapAtomEntry);
  throw new UnrecognizedFeedFormatError(feedUrl);
}

export const rssAdapter: SourceAdapter = {
  type: 'rss',

  async fetch(source, ctx) {
    const headers: Record<string, string> = { 'User-Agent': ctx.userAgent };
    if (source.httpEtag) headers['If-None-Match'] = source.httpEtag;
    if (source.httpLastModified) headers['If-Modified-Since'] = source.httpLastModified;

    const response = await fetchWithRetry(source.url, { headers, timeoutMs: ctx.timeoutMs });

    if (response.status === 304) {
      return {
        items: [],
        etag: source.httpEtag,
        lastModified: source.httpLastModified,
        notModified: true,
      };
    }
    if (!response.ok) throw new Error(`${source.url} responded ${response.status}`);

    const items = parseFeed(await response.text(), source.url).filter(
      (item) => item.url.length > 0,
    );

    return {
      items,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      notModified: false,
    };
  },
};
