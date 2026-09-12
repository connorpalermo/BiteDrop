'use client';

import { useState } from 'react';
import type { CategorySlug, CountryCode, DropStatus, FacetCount } from '@bitedrop/core';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useFeedFilters } from '@/lib/useFeedFilters';
import { BrandFilter } from './BrandFilter';
import { ChipFilterGroup, type ChipFilterOption } from './ChipFilterGroup';
import { SearchInput } from './SearchInput';
import { SortSelect } from './SortSelect';

interface FilterSheetProps {
  categoryOptions: ChipFilterOption<CategorySlug>[];
  countryOptions: ChipFilterOption<CountryCode>[];
  statusOptions: ChipFilterOption<DropStatus>[];
  brandOptions: FacetCount<string>[];
}

export function FilterSheet({
  categoryOptions,
  countryOptions,
  statusOptions,
  brandOptions,
}: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const { query, toggleCategory, toggleCountry, toggleStatus, toggleBrand, setSearch, setSort } =
    useFeedFilters();

  return (
    <div className="lg:hidden">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Filters
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Filters">
        <div className="flex flex-col gap-5">
          <SearchInput value={query.search ?? ''} onChange={setSearch} />
          <SortSelect value={query.sort} onChange={setSort} />
          <ChipFilterGroup
            legend="Category"
            options={categoryOptions}
            selected={query.categories ?? []}
            onToggle={toggleCategory}
          />
          <ChipFilterGroup
            legend="Country"
            options={countryOptions}
            selected={query.countries ?? []}
            onToggle={toggleCountry}
          />
          <ChipFilterGroup
            legend="Status"
            options={statusOptions}
            selected={query.statuses ?? []}
            onToggle={toggleStatus}
          />
          <BrandFilter
            options={brandOptions}
            selected={query.brandSlugs ?? []}
            onToggle={toggleBrand}
          />
        </div>
      </Sheet>
    </div>
  );
}
