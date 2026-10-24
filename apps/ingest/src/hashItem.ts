import { createHash } from 'node:crypto';
import { canonicalizeUrl, normalizeText, type DiscoveredItem } from '@bitedrop/core';
import type { InsertableRawItem } from '@bitedrop/db';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Canonicalises the URL and computes url_hash/content_hash. Lives here, not
 * in packages/core (must stay I/O-free) or packages/sources (shouldn't need
 * to know this project's hashing scheme to add a tenth adapter later).
 */
export function hashItem(discovered: DiscoveredItem): InsertableRawItem {
  const url = canonicalizeUrl(discovered.url);
  return {
    url,
    urlHash: sha256(url),
    contentHash: discovered.bodyText ? sha256(normalizeText(discovered.bodyText)) : null,
    title: discovered.title,
    author: discovered.author,
    publishedAt: discovered.publishedAt ? new Date(discovered.publishedAt) : null,
    excerpt: discovered.excerpt,
    bodyText: discovered.bodyText,
    imageUrl: discovered.imageUrl,
    rawPayload: discovered.rawPayload,
  };
}
