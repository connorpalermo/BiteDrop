import type {
  Facets,
  FeedQuery,
  FoodDropDetail,
  FoodDropRepository,
  FoodDropSummary,
  Page,
} from '@bitedrop/core';
import type { Database } from '../client';
import { getFoodDropDetail } from './dropDetail';
import { getFacets } from './facetQuery';
import { listFoodDrops } from './feedQuery';

export class PgFoodDropRepository implements FoodDropRepository {
  constructor(private readonly db: Database) {}

  list(q: FeedQuery): Promise<Page<FoodDropSummary>> {
    return listFoodDrops(this.db, q);
  }

  getBySlug(slug: string): Promise<FoodDropDetail | null> {
    return getFoodDropDetail(this.db, slug);
  }

  facets(): Promise<Facets> {
    return getFacets(this.db);
  }
}
