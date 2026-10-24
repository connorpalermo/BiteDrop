import {
  Candy,
  Cookie,
  CupSoda,
  Gift,
  Hamburger,
  IceCreamCone,
  Popcorn,
  ShoppingCart,
  Sparkles,
  Store,
  UtensilsCrossed,
} from 'lucide-react';
import type { CategorySlug } from '@bitedrop/core';

const CATEGORY_ICONS = {
  fast_food: Hamburger,
  restaurants: UtensilsCrossed,
  candy: Candy,
  snacks: Cookie,
  chips: Popcorn,
  drinks: CupSoda,
  desserts: IceCreamCone,
  grocery: ShoppingCart,
  convenience: Store,
  seasonal: Gift,
  other: Sparkles,
} as const satisfies Record<CategorySlug, unknown>;

interface CategoryIconProps {
  slug: CategorySlug;
  className?: string;
}

/** Replaces the category emoji glyph with a consistent, themeable icon —
 * same spot, no reliance on how the OS happens to render an emoji font. */
export function CategoryIcon({ slug, className }: CategoryIconProps) {
  const Icon = CATEGORY_ICONS[slug];
  return <Icon className={className} aria-hidden="true" />;
}
