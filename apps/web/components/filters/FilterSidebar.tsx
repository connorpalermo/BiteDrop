'use client';

import type { CategorySlug, CountryCode, DropStatus, FacetCount } from '@bitedrop/core';
import { useFeedFilters } from '@/lib/useFeedFilters';
import { BrandFilter } from './BrandFilter';
import { ChipFilterGroup, type ChipFilterOption } from './ChipFilterGroup';
import { SearchInput } from './SearchInput';
import { SortSelect } from './SortSelect';

interface FilterSidebarProps {
  categoryOptions: ChipFilterOption<CategorySlug>[];
  countryOptions: ChipFilterOption<CountryCode>[];
  statusOptions: ChipFilterOption<DropStatus>[];
  brandOptions: FacetCount<string>[];
}

export function FilterSidebar({
  categoryOptions,
  countryOptions,
  statusOptions,
  brandOptions,
}: FilterSidebarProps) {
  const { query, toggleCategory, toggleCountry, toggleStatus, toggleBrand, setSearch, setSort } =
    useFeedFilters();

  return (
    <aside className="hidden lg:block lg:w-72 lg:flex-none">
      <div className="flex flex-col gap-5 lg:sticky lg:top-4 lg:max-h-sticky-panel lg:overflow-y-auto lg:p-2 lg:-m-2">
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
    </aside>
  );
}
