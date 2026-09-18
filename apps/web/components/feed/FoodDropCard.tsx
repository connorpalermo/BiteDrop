import Image from 'next/image';
import Link from 'next/link';
import {
  findStatusLabel,
  formatDropDate,
  formatRelativeTime,
  formatSourceCount,
} from '@bitedrop/core';
import type { FoodDropSummary } from '@bitedrop/core';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { FOCUS_RING } from '@/components/ui/focusRing';
import { statusTone } from '@/components/drop/statusTone';

interface FoodDropCardProps {
  drop: FoodDropSummary;
  /** True for above-the-fold cards (first grid row) so their image isn't lazy-loaded. */
  priority?: boolean;
}

function dateLabel(drop: FoodDropSummary, now: Date): string | null {
  if (drop.availabilityStart) return `Available ${formatDropDate(drop.availabilityStart, now)}`;
  if (drop.releaseDate) return `Releases ${formatDropDate(drop.releaseDate, now)}`;
  return null;
}

function retailerLabel(retailers: FoodDropSummary['retailers']): string | null {
  if (retailers.length === 0) return null;
  const shown = retailers.slice(0, 3).map((r) => r.name);
  const extra = retailers.length - shown.length;
  return extra > 0 ? `${shown.join(' · ')} +${extra}` : shown.join(' · ');
}

// unoptimized (below): Phase 1's images are hotlinked, pre-sized Unsplash URLs
// (?w=800&q=80) — Next's own resize proxy would just re-transform an
// already-appropriately-sized remote image, adding a redundant hop. Revisit
// once Phase 9 mirrors images into R2, where local optimization is worthwhile
// again since we own the source files.
function CardImage({ drop, priority }: { drop: FoodDropSummary; priority?: boolean }) {
  return (
    <div className="relative aspect-[4/3] bg-surface-2">
      {drop.imageUrl ? (
        <Image
          src={drop.imageUrl}
          alt={drop.name}
          fill
          sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
          priority={priority}
          unoptimized
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center text-3xl"
          aria-hidden="true"
        >
          {drop.category.emoji}
        </div>
      )}
      <div className="absolute left-2 top-2 flex gap-1.5">
        <Badge label={findStatusLabel(drop.status)} tone={statusTone(drop.status)} />
        {drop.isLimitedTime && drop.status !== 'limited_time' ? (
          <Badge label="Limited" tone="amber" />
        ) : null}
      </div>
    </div>
  );
}

function CardMetaRow({ drop, date }: { drop: FoodDropSummary; date: string | null }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
      {drop.countries.map((country) => (
        <span key={country.code} aria-hidden="true">
          {country.emoji}
        </span>
      ))}
      <span>{drop.category.name}</span>
      {date ? <span>· {date}</span> : null}
    </div>
  );
}

export function FoodDropCard({ drop, priority }: FoodDropCardProps) {
  const now = new Date();
  const retailerText = retailerLabel(drop.retailers);

  return (
    <Link href={`/drops/${drop.slug}`} className={`block h-full rounded-lg ${FOCUS_RING}`}>
      <Card interactive className="flex h-full flex-col">
        <CardImage drop={drop} priority={priority} />
        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <h3 className="line-clamp-2 font-display text-lg font-bold text-fg">
            <span aria-hidden="true">{drop.category.emoji}</span> {drop.name}
          </h3>
          {drop.brand ? <p className="text-sm text-fg-muted">{drop.brand.name}</p> : null}
          <p className="line-clamp-2 text-sm text-fg-muted">{drop.shortDescription}</p>
          <CardMetaRow drop={drop} date={dateLabel(drop, now)} />
          {retailerText ? <p className="text-xs text-fg-subtle">{retailerText}</p> : null}
          <div className="mt-auto flex items-center gap-1.5 text-xs text-fg-subtle">
            <span>{formatSourceCount(drop.sourceCount)}</span>
            <span>·</span>
            <span>Discovered {formatRelativeTime(drop.firstSeenAt, now)}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
