import type { FoodDropSummary } from '@bitedrop/core';
import { FoodDropCard } from './FoodDropCard';

interface FeedGridProps {
  items: FoodDropSummary[];
}

// Matches the widest breakpoint's column count (xl:grid-cols-4) — these are the
// only cards guaranteed above the fold, so only they skip lazy-loading.
const PRIORITY_COUNT = 4;

export function FeedGrid({ items }: FeedGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((drop, index) => (
        <FoodDropCard key={drop.id} drop={drop} priority={index < PRIORITY_COUNT} />
      ))}
    </div>
  );
}
