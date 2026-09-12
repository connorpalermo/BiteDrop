import {
  PAGE_SIZE,
  findCategory,
  findCountry,
  parseFeedQuery,
  type FeedQuery,
  type RawSearchParams,
} from '@bitedrop/core';
import { ActivePills } from '@/components/filters/ActivePills';
import type { ChipFilterOption } from '@/components/filters/ChipFilterGroup';
import { FilterSheet } from '@/components/filters/FilterSheet';
import { FilterSidebar } from '@/components/filters/FilterSidebar';
import { InfiniteScroller } from '@/components/feed/InfiniteScroller';
import { repository } from '@/lib/repository';

interface HomePageProps {
  searchParams: Promise<RawSearchParams>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const rawParams = await searchParams;
  const query: FeedQuery = parseFeedQuery(rawParams, PAGE_SIZE);

  const [page, facets] = await Promise.all([repository.list(query), repository.facets()]);

  const categoryOptions: ChipFilterOption<(typeof facets.categories)[number]['value']>[] =
    facets.categories.map((c) => ({ ...c, emoji: findCategory(c.value).emoji }));
  const countryOptions: ChipFilterOption<(typeof facets.countries)[number]['value']>[] =
    facets.countries.map((c) => ({ ...c, emoji: findCountry(c.value).emoji }));
  const statusOptions = facets.statuses;

  return (
    <main id="main-content" className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <FilterSidebar
          categoryOptions={categoryOptions}
          countryOptions={countryOptions}
          statusOptions={statusOptions}
          brandOptions={facets.brands}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <FilterSheet
            categoryOptions={categoryOptions}
            countryOptions={countryOptions}
            statusOptions={statusOptions}
            brandOptions={facets.brands}
          />
          <ActivePills brandOptions={facets.brands} />
          <InfiniteScroller
            key={JSON.stringify(query)}
            initialItems={page.items}
            initialCursor={page.nextCursor}
            query={query}
          />
        </div>
      </div>
    </main>
  );
}
