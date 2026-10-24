import type { CategorySlug, DropStatus, FoodDropExtraction } from '@bitedrop/core';
import { truncateAtWord } from '@bitedrop/core';

export interface ExtractionInput {
  title: string | null;
  excerpt: string | null;
  bodyText: string | null;
  discoveredAt: string; // ISO
  sourceTrustTier: number;
  knownBrandNames: string[];
}

const CATEGORY_PATTERNS: [CategorySlug, RegExp][] = [
  ['chips', /\bchips?\b|tortilla chip|potato chip/i],
  ['snacks', /\bsnack|pretzel|popcorn|cracker|jerky/i],
  ['candy', /candy|chocolate|gumm(y|ies)|caramel/i],
  ['desserts', /dessert|ice cream|donut|doughnut|cookie|\bcake\b|\bpie\b/i],
  ['drinks', /soda|beverage|\bdrink|coffee|latte|energy drink|juice/i],
  [
    'fast_food',
    /burger|taco|burrito|quesadilla|nugget|\bfries\b|mcdonald|taco bell|wendy|burger king|starbucks|dunkin|chick-fil-a|\bkfc\b|popeyes|subway|chipotle|pizza hut|domino/i,
  ],
  ['restaurants', /restaurant|diner|opens (a |its )?new location/i],
  ['convenience', /convenience store|7-eleven|circle k/i],
  ['seasonal', /halloween|christmas|pumpkin spice|holiday edition/i],
  ['grocery', /grocery|supermarket/i],
];

function detectCategory(text: string): CategorySlug {
  for (const [slug, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return slug;
  }
  return 'other';
}

/** Longest known brand name first, so "Taco Bell" is tried before a
 * hypothetical shorter "Taco" would be — a partial match must not steal
 * the slot from a more specific, longer one. */
function detectBrand(text: string, knownBrandNames: string[]): string | null {
  const lowerText = text.toLowerCase();
  const sorted = [...knownBrandNames].sort((a, b) => b.length - a.length);
  return sorted.find((name) => lowerText.includes(name.toLowerCase())) ?? null;
}

const RUMORED_PATTERN =
  /\brumor(ed)?\b|reportedly|leaked|spotted at|might (launch|arrive)|could (be|launch)/i;
const RETURNING_PATTERN = /\bis back\b|\breturns?\b|returning to/i;
const COMING_SOON_PATTERN = /coming soon|launching (soon|next|this)|will (launch|debut|arrive)/i;
const LIMITED_TIME_PATTERN = /limited[- ]time|limited[- ]edition|while supplies last/i;

/** Status priority: rumored > returning > coming_soon > limited_time > new.
 * isLimitedTime is a separate, independent test — a drop can be both
 * 'rumored' AND limited-time at once. */
function detectStatus(text: string): DropStatus {
  if (RUMORED_PATTERN.test(text)) return 'rumored';
  if (RETURNING_PATTERN.test(text)) return 'returning';
  if (COMING_SOON_PATTERN.test(text)) return 'coming_soon';
  if (LIMITED_TIME_PATTERN.test(text)) return 'limited_time';
  return 'new';
}

const DATE_PATTERN =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/;

function detectReleaseDate(text: string): string | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const parsed = new Date(match[0]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

const PRICE_PATTERN = /\$\s?(\d+(?:\.\d{2})?)/;

function detectPrice(text: string): { priceCents: number | null; priceCurrency: string | null } {
  const match = PRICE_PATTERN.exec(text);
  if (!match) return { priceCents: null, priceCurrency: null };
  return { priceCents: Math.round(parseFloat(match[1]!) * 100), priceCurrency: 'USD' };
}

function computeConfidence(opts: {
  sourceTrustTier: number;
  brandMatched: boolean;
  categoryMatched: boolean;
  dateFound: boolean;
  isRumored: boolean;
}): number {
  const base = opts.sourceTrustTier === 1 ? 0.7 : 0.5;
  const bumps =
    (opts.brandMatched ? 0.15 : 0) + (opts.categoryMatched ? 0.1 : 0) + (opts.dateFound ? 0.05 : 0);
  const raw = opts.isRumored ? Math.min(base + bumps, 0.4) : base + bumps;
  return Math.min(1, Math.max(0, raw));
}

export function runHeuristics(context: ExtractionInput): FoodDropExtraction {
  const text = `${context.title ?? ''} ${context.excerpt ?? ''}`;
  const name = context.title ?? '';
  const categorySlug = detectCategory(text);
  const brandName = detectBrand(text, context.knownBrandNames);
  const status = detectStatus(text);
  const releaseDate = detectReleaseDate(text);
  const { priceCents, priceCurrency } = detectPrice(text);

  return {
    name,
    brandName,
    categorySlug,
    subcategory: null,
    shortDescription: truncateAtWord(name, 140),
    description: context.bodyText ?? context.excerpt ?? '',
    status,
    isLimitedTime: LIMITED_TIME_PATTERN.test(text),
    releaseDate,
    priceCents,
    priceCurrency,
    confidence: computeConfidence({
      sourceTrustTier: context.sourceTrustTier,
      brandMatched: brandName !== null,
      categoryMatched: categorySlug !== 'other',
      dateFound: releaseDate !== null,
      isRumored: status === 'rumored',
    }),
  };
}
