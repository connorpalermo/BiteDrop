export interface FilterableItem {
  title: string | null;
  excerpt: string | null;
  bodyText: string | null;
  publishedAt: string | null; // ISO
  discoveredAt: string; // ISO
}

export interface FilterVerdict {
  passed: boolean;
  reason: string | null; // null iff passed; stored verbatim in raw_item.filter_reason
}

const TOO_OLD_DAYS = 30;

const FOOD_SIGNAL_PATTERN =
  /food|snack|drink|beverage|menu|flavor|flavour|restaurant|burger|pizza|taco|sandwich|chicken|dessert|candy|chocolate|chip|soda|coffee|donut|doughnut|cereal|sauce|cookie|ice cream|cream|edition|launch(es|ing)?|debut(s)?|unveil(s)?|introduc(e|es|ing)/i;

const LEGAL_OR_LAWSUIT_PATTERN =
  /class action|securities fraud|shareholder|investors (have|face)|law firm|lawsuit|\bllp\b|deadline:/i;
const SPONSORED_FILLER_PATTERN = /^in hellonation,|sponsored content|advertisement:/i;
const RECIPE_OR_LISTICLE_PATTERN = /\brecipe\b|how to make|\btop \d+\b|ranked:|\d+ (best|worst)/i;
const REVIEW_OR_OPINION_PATTERN = /\breview\b|we tried|taste test|our verdict|hands-on/i;

function isTooOld(item: FilterableItem, now: Date): boolean {
  const reference = new Date(item.publishedAt ?? item.discoveredAt);
  const ageMs = now.getTime() - reference.getTime();
  return ageMs > TOO_OLD_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Rules run in this order; the first one that rejects wins. Order matters:
 * the broadest, last-resort gate (no_food_signal) runs last so a more
 * specific, more informative reason is stored whenever one applies.
 */
export function applyFilter(item: FilterableItem, now: Date = new Date()): FilterVerdict {
  const text = `${item.title ?? ''} ${item.excerpt ?? ''}`.toLowerCase();

  if (LEGAL_OR_LAWSUIT_PATTERN.test(text))
    return { passed: false, reason: 'legal_or_lawsuit_noise' };
  if (SPONSORED_FILLER_PATTERN.test(text)) return { passed: false, reason: 'sponsored_filler' };
  if (RECIPE_OR_LISTICLE_PATTERN.test(text)) return { passed: false, reason: 'recipe_or_listicle' };
  if (REVIEW_OR_OPINION_PATTERN.test(text)) return { passed: false, reason: 'review_or_opinion' };
  if (isTooOld(item, now)) return { passed: false, reason: 'too_old' };
  if (!FOOD_SIGNAL_PATTERN.test(text)) return { passed: false, reason: 'no_food_signal' };

  return { passed: true, reason: null };
}
