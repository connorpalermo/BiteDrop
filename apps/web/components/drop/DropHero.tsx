import Image from 'next/image';
import { findStatusLabel, formatDropDate, formatPrice, type FoodDropDetail } from '@bitedrop/core';
import { Badge } from '@/components/ui/Badge';
import { statusTone } from './statusTone';

function availabilityLabel(drop: FoodDropDetail, now: Date): string | null {
  if (drop.availabilityStart) return `Available ${formatDropDate(drop.availabilityStart, now)}`;
  if (drop.releaseDate) return `Releases ${formatDropDate(drop.releaseDate, now)}`;
  return null;
}

// unoptimized (below): see the matching comment in FoodDropCard's CardImage.
function DropImage({ drop }: { drop: FoodDropDetail }) {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface-2 sm:aspect-[16/9]">
      {drop.imageUrl ? (
        <Image
          src={drop.imageUrl}
          alt={drop.name}
          fill
          sizes="(min-width: 1024px) 800px, 100vw"
          priority
          unoptimized
          className="object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-6xl"
          aria-hidden="true"
        >
          {drop.category.emoji}
        </div>
      )}
    </div>
  );
}

export function DropHero({ drop }: { drop: FoodDropDetail }) {
  const now = new Date();
  const date = availabilityLabel(drop, now);

  return (
    <div className="flex flex-col gap-4">
      <DropImage drop={drop} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge label={findStatusLabel(drop.status)} tone={statusTone(drop.status)} />
        {drop.isLimitedTime && drop.status !== 'limited_time' ? (
          <Badge label="Limited" tone="amber" />
        ) : null}
      </div>
      <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">
        <span aria-hidden="true">{drop.category.emoji}</span> {drop.name}
      </h1>
      {drop.brand ? <p className="text-base text-fg-muted">{drop.brand.name}</p> : null}
      <p className="max-w-prose text-base text-fg-muted">{drop.description}</p>
      <div className="flex flex-wrap items-center gap-3 text-sm text-fg-subtle">
        {drop.countries.map((c) => (
          <span key={c.code}>
            {c.emoji} {c.name}
          </span>
        ))}
        <span>{drop.category.name}</span>
        {date ? <span>{date}</span> : null}
        {drop.priceCents !== null && drop.priceCurrency ? (
          <span>{formatPrice(drop.priceCents, drop.priceCurrency)}</span>
        ) : null}
      </div>
    </div>
  );
}
