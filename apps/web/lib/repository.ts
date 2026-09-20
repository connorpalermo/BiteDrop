import type { FoodDropRepository } from '@bitedrop/core';
import { getDb, PgFoodDropRepository } from '@bitedrop/db';

export const repository: FoodDropRepository = new PgFoodDropRepository(getDb());
