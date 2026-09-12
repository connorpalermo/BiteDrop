'use server';

import type { FeedQuery, FoodDropSummary, Page } from '@bitedrop/core';
import { repository } from '@/lib/repository';

export async function loadMoreDrops(query: FeedQuery): Promise<Page<FoodDropSummary>> {
  return repository.list(query);
}
