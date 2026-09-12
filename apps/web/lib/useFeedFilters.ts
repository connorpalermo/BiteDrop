import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  PAGE_SIZE,
  feedQueryToSearchParams,
  parseFeedQuery,
  type CategorySlug,
  type CountryCode,
  type DropStatus,
  type FeedQuery,
  type SortKey,
} from '@bitedrop/core';

export interface FeedFilters {
  query: FeedQuery;
  toggleCategory: (slug: CategorySlug) => void;
  toggleCountry: (code: CountryCode) => void;
  toggleStatus: (status: DropStatus) => void;
  toggleBrand: (slug: string) => void;
  setSearch: (value: string) => void;
  setSort: (sort: SortKey) => void;
  clearAll: () => void;
}

function toggleInList<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return next.length > 0 ? next : undefined;
}

export function useFeedFilters(): FeedFilters {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = parseFeedQuery(Object.fromEntries(searchParams.entries()), PAGE_SIZE);

  function applyQuery(next: FeedQuery) {
    const qs = feedQueryToSearchParams(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return {
    query,
    toggleCategory: (slug) =>
      applyQuery({ ...query, categories: toggleInList(query.categories, slug) }),
    toggleCountry: (code) =>
      applyQuery({ ...query, countries: toggleInList(query.countries, code) }),
    toggleStatus: (status) =>
      applyQuery({ ...query, statuses: toggleInList(query.statuses, status) }),
    toggleBrand: (slug) =>
      applyQuery({ ...query, brandSlugs: toggleInList(query.brandSlugs, slug) }),
    setSearch: (value) => applyQuery({ ...query, search: value || undefined }),
    setSort: (sort) => applyQuery({ ...query, sort }),
    clearAll: () => router.replace(pathname, { scroll: false }),
  };
}
