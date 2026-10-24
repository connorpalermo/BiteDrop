import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFetchAllowed } from '../src/robots';

const USER_AGENT = 'BiteDropBot/0.1 (+https://bite-drop.vercel.app)';

afterEach(() => vi.unstubAllGlobals());

describe('isFetchAllowed', () => {
  it('allows when robots.txt 404s', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await isFetchAllowed('https://example.com/feed.xml', USER_AGENT, 1000)).toBe(true);
  });

  it('allows when robots.txt is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await isFetchAllowed('https://example.com/feed.xml', USER_AGENT, 1000)).toBe(true);
  });

  it('blocks a path disallowed for the matching BiteDropBot group', async () => {
    const body = 'User-agent: BiteDropBot\nDisallow: /feed.xml\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    expect(await isFetchAllowed('https://example.com/feed.xml', USER_AGENT, 1000)).toBe(false);
  });

  it("a more specific BiteDropBot group overrides a conflicting '*' group", async () => {
    const body = [
      'User-agent: *',
      'Disallow: /feed.xml',
      '',
      'User-agent: BiteDropBot',
      'Disallow:',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    expect(await isFetchAllowed('https://example.com/feed.xml', USER_AGENT, 1000)).toBe(true);
  });

  it('falls back to the "*" group when no bot-specific group exists', async () => {
    const body = 'User-agent: *\nDisallow: /private/\n';
    // mockImplementation (not mockResolvedValue) — each call needs its own
    // Response, since a body can only be read once and this test calls
    // isFetchAllowed twice.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response(body, { status: 200 }))),
    );
    expect(await isFetchAllowed('https://example.com/private/feed.xml', USER_AGENT, 1000)).toBe(
      false,
    );
    expect(await isFetchAllowed('https://example.com/public/feed.xml', USER_AGENT, 1000)).toBe(
      true,
    );
  });
});
