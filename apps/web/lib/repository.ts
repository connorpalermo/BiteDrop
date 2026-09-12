import type { FoodDropRepository } from '@bitedrop/core';
import { MockFoodDropRepository } from '@bitedrop/core/mock';

export const repository: FoodDropRepository = new MockFoodDropRepository();
