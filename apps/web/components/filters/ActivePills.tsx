'use client';

import { findCategory, findCountry, findStatusLabel, type FacetCount } from '@bitedrop/core';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useFeedFilters } from '@/lib/useFeedFilters';

interface Pill {
  key: string;
  label: string;
  onRemove: () => void;
}

function buildPills(
  filters: ReturnType<typeof useFeedFilters>,
  brandOptions: FacetCount<string>[],
): Pill[] {
  const { query, toggleCategory, toggleCountry, toggleStatus, toggleBrand, setSearch } = filters;
  const brandNames = new Map(brandOptions.map((b) => [b.value, b.label]));
  const pills: Pill[] = [];

  for (const slug of query.categories ?? []) {
    pills.push({
      key: `cat-${slug}`,
      label: findCategory(slug).name,
      onRemove: () => toggleCategory(slug),
    });
  }
  for (const code of query.countries ?? []) {
    pills.push({
      key: `country-${code}`,
      label: findCountry(code).name,
      onRemove: () => toggleCountry(code),
    });
  }
  for (const status of query.statuses ?? []) {
    pills.push({
      key: `status-${status}`,
      label: findStatusLabel(status),
      onRemove: () => toggleStatus(status),
    });
  }
  for (const slug of query.brandSlugs ?? []) {
    pills.push({
      key: `brand-${slug}`,
      label: brandNames.get(slug) ?? slug,
      onRemove: () => toggleBrand(slug),
    });
  }
  if (query.search) {
    pills.push({ key: 'search', label: `"${query.search}"`, onRemove: () => setSearch('') });
  }
  return pills;
}

export function ActivePills({ brandOptions }: { brandOptions: FacetCount<string>[] }) {
  const filters = useFeedFilters();
  const pills = buildPills(filters, brandOptions);

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pills.map((pill) => (
        <Chip key={pill.key} label={pill.label} selected onToggle={pill.onRemove} />
      ))}
      <Button variant="ghost" size="sm" onClick={filters.clearAll}>
        Clear all
      </Button>
    </div>
  );
}
