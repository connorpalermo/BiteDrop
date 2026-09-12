import type { FoodDropSummary } from '@bitedrop/core';
import { FoodDropCard } from '@/components/feed/FoodDropCard';

function RelatedGroup({ heading, items }: { heading: string; items: FoodDropSummary[] }) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-fg">{heading}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <FoodDropCard key={item.id} drop={item} />
        ))}
      </div>
    </section>
  );
}

interface RelatedDropsProps {
  brandName: string | null;
  categoryName: string;
  relatedBySameBrand: FoodDropSummary[];
  relatedBySameCategory: FoodDropSummary[];
}

export function RelatedDrops({
  brandName,
  categoryName,
  relatedBySameBrand,
  relatedBySameCategory,
}: RelatedDropsProps) {
  return (
    <>
      {brandName ? (
        <RelatedGroup heading={`More from ${brandName}`} items={relatedBySameBrand} />
      ) : null}
      <RelatedGroup heading={`More in ${categoryName}`} items={relatedBySameCategory} />
    </>
  );
}
