'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedQuery, FoodDropSummary } from '@bitedrop/core';
import { loadMoreDrops } from '@/app/actions/feed';
import { Button } from '@/components/ui/Button';
import { scrollToTopRespectingMotion } from '@/lib/scrollToTop';
import { EmptyState } from './EmptyState';
import { FeedGrid } from './FeedGrid';
import { FeedGridSkeleton } from './FeedGridSkeleton';

interface InfiniteScrollerProps {
  initialItems: FoodDropSummary[];
  initialCursor: string | null;
  query: FeedQuery;
}

function dedupeAppend(prev: FoodDropSummary[], next: FoodDropSummary[]): FoodDropSummary[] {
  const seen = new Set(prev.map((item) => item.id));
  return [...prev, ...next.filter((item) => !seen.has(item.id))];
}

/** Loads the next page when the sentinel scrolls into view. */
function useAutoLoad(
  sentinelRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  loadMore: () => void,
) {
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sentinelRef, enabled, loadMore]);
}

export function InfiniteScroller({ initialItems, initialCursor, query }: InfiniteScrollerProps) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // This component remounts on every filter/search/sort change (page.tsx keys
  // it by the query), so a mount-only effect fires exactly when the result set
  // changes — not on later "Load more" appends within the same query, which
  // only update state, not this effect. Resets scroll so a short result set
  // (e.g. 4 items) is never left showing an empty page below a stale scroll
  // position from a much longer previous list.
  useEffect(() => {
    scrollToTopRespectingMotion();
  }, []);

  const loadMore = useCallback(() => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(false);
    loadMoreDrops({ ...query, cursor })
      .then((page) => {
        setItems((prev) => dedupeAppend(prev, page.items));
        setCursor(page.nextCursor);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [cursor, loading, query]);

  useAutoLoad(sentinelRef, Boolean(cursor) && !loading, loadMore);

  if (items.length === 0) {
    return <EmptyState message="Try a different search or clear your filters." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <FeedGrid items={items} />
      {loading ? <FeedGridSkeleton count={4} /> : null}
      {error ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-fg-muted">Could not load more drops.</p>
          <Button onClick={loadMore}>Try again</Button>
        </div>
      ) : null}
      {!error && cursor ? (
        <div className="flex justify-center">
          <Button onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
      {!cursor ? (
        <p className="text-center text-sm text-fg-subtle">You&rsquo;ve reached the end.</p>
      ) : null}
      <div ref={sentinelRef} aria-hidden="true" className="h-1" />
    </div>
  );
}
