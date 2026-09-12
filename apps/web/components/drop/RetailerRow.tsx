import type { RetailerRef } from '@bitedrop/core';
import { Badge } from '@/components/ui/Badge';

export function RetailerRow({ retailers }: { retailers: RetailerRef[] }) {
  if (retailers.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold text-fg">Available at</h2>
      <div className="flex flex-wrap gap-2">
        {retailers.map((retailer) => (
          <Badge key={retailer.slug} label={retailer.name} tone="outline" />
        ))}
      </div>
    </section>
  );
}
