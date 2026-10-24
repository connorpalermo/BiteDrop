import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IngestSource } from '@bitedrop/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rssAdapter } from '../../src/adapters/rss';

const FIXTURES_DIR = path.join(import.meta.dirname, '..', 'fixtures');

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

function sourceFixture(overrides: Partial<IngestSource> = {}): IngestSource {
  return {
    id: 'src-1',
    slug: 'brandeating-rss',
    name: 'Brand Eating',
    type: 'rss',
    url: 'https://www.brandeating.com/feeds/posts/default?alt=rss',
    config: {},
    httpEtag: null,
    httpLastModified: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

const CTX = { timeoutMs: 10_000, userAgent: 'BiteDropBot/0.1 (+https://bite-drop.vercel.app)' };

describe('rssAdapter — Atom (Brand Eating fixture)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(fixture('brandeating.atom.xml'), {
        status: 200,
        headers: { etag: '"abc123"', 'last-modified': 'Fri, 23 Oct 2026 10:00:00 GMT' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('parses every entry', async () => {
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    expect(result.items).toHaveLength(2);
    expect(result.notModified).toBe(false);
  });

  it('picks the rel="alternate" link, never the comments/edit/self link', async () => {
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    const first = result.items[0]!;
    expect(first.url).toBe('https://www.brandeating.com/2026/10/new-spicy-chick-fil-a-sauce.html');
    expect(first.url).not.toContain('/comments/');
    expect(first.url).not.toContain('blogger.com');
  });

  it('extracts a plain-text title and strips HTML from the body', async () => {
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    const first = result.items[0]!;
    expect(first.title).toBe('Chick-fil-A Unveils New Spicy Chick-fil-A Sauce');
    expect(first.bodyText).not.toContain('<');
    expect(first.bodyText).toContain('Spicy Chick-fil-A Sauce');
  });

  it('carries the etag/last-modified from the response for the next run', async () => {
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    expect(result.etag).toBe('"abc123"');
    expect(result.lastModified).toBe('Fri, 23 Oct 2026 10:00:00 GMT');
  });

  it('sends If-None-Match/If-Modified-Since when the source already has them', async () => {
    await rssAdapter.fetch(
      sourceFixture({ httpEtag: '"prev"', httpLastModified: 'Thu, 22 Oct 2026 00:00:00 GMT' }),
      CTX,
    );
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['If-None-Match']).toBe('"prev"');
    expect(headers['If-Modified-Since']).toBe('Thu, 22 Oct 2026 00:00:00 GMT');
  });
});

describe('rssAdapter — a single, rel-less <link> defaults to alternate', () => {
  it('uses the one link present when Atom omits rel (RFC 4287 default)', async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Only Link</title><link href="https://example.com/only"/>
      <id>tag:example.com,1</id><summary>hi</summary></entry>
    </feed>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(atom, { status: 200 })));
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    expect(result.items[0]!.url).toBe('https://example.com/only');
    vi.unstubAllGlobals();
  });
});

describe('rssAdapter — RSS 2.0 (PR Newswire fixture)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(fixture('prnewswire.rss.xml'), { status: 200 })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('parses every item, including CDATA-wrapped descriptions', async () => {
    const result = await rssAdapter.fetch(sourceFixture({ name: 'PR Newswire', type: 'rss' }), CTX);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]!.bodyText).toContain('Rosen Law Firm');
    expect(result.items[0]!.bodyText).not.toContain('<p>');
  });

  it('takes the plain <link> text node as the url', async () => {
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    expect(result.items[0]!.url).toBe(
      'https://www.prnewswire.com/news-releases/bbnx-deadline-bbnx-investors-have-opportunity-to-lead-beta-bionics-inc-securities-fraud-lawsuit-302918530.html',
    );
  });
});

describe('rssAdapter — 304 Not Modified', () => {
  it('short-circuits without parsing a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));
    const result = await rssAdapter.fetch(
      sourceFixture({ httpEtag: '"same"', httpLastModified: 'Thu, 22 Oct 2026 00:00:00 GMT' }),
      CTX,
    );
    expect(result).toEqual({
      items: [],
      etag: '"same"',
      lastModified: 'Thu, 22 Oct 2026 00:00:00 GMT',
      notModified: true,
    });
    vi.unstubAllGlobals();
  });
});

describe('rssAdapter — body length cap', () => {
  it('truncates bodyText at 40,000 chars (invariant 5)', async () => {
    const longContent = 'x'.repeat(50_000);
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Long</title><link rel="alternate" href="https://example.com/long"/>
      <id>tag:example.com,2</id><content type="html">${longContent}</content></entry>
    </feed>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(atom, { status: 200 })));
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    expect(result.items[0]!.bodyText).toHaveLength(40_000);
    vi.unstubAllGlobals();
  });
});

describe('rssAdapter — HTML entities in title/author', () => {
  it('decodes numeric entities in RSS titles and authors — WordPress feeds routinely emit these', async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title>Dunkin&#8217;s New Menu Is Here</title>
        <link>https://example.com/entity-title</link>
        <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Domino&#39;s Team</dc:creator>
      </item>
    </channel></rss>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(rss, { status: 200 })));
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    expect(result.items[0]!.title).toBe('Dunkin’s New Menu Is Here');
    expect(result.items[0]!.author).toBe("Domino's Team");
    vi.unstubAllGlobals();
  });

  it('decodes numeric entities in Atom titles', async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>McDonald&#8217;s Is Back</title>
      <link rel="alternate" href="https://example.com/atom-entity-title"/>
      <id>tag:example.com,3</id></entry>
    </feed>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(atom, { status: 200 })));
    const result = await rssAdapter.fetch(sourceFixture(), CTX);
    expect(result.items[0]!.title).toBe('McDonald’s Is Back');
    vi.unstubAllGlobals();
  });
});
