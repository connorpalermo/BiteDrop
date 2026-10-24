import { describe, expect, it } from 'vitest';
import { applyFilter, type FilterableItem } from '../src/filter';

const NOW = new Date('2026-10-24T00:00:00.000Z');

function item(overrides: Partial<FilterableItem> = {}): FilterableItem {
  return {
    title: null,
    excerpt: null,
    bodyText: null,
    publishedAt: null,
    discoveredAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('applyFilter', () => {
  it('passes a real Brand Eating-shaped announcement title', () => {
    const verdict = applyFilter(item({ title: 'Chick-fil-A Unveils New Spicy Chick-fil-A Sauce' }));
    expect(verdict).toEqual({ passed: true, reason: null });
  });

  it('passes a real on-topic PR Newswire-shaped title', () => {
    const verdict = applyFilter(
      item({ title: "New Reese's Candy Cups spotted ahead of nationwide release" }),
    );
    expect(verdict.passed).toBe(true);
  });

  it('rejects the real BBNX securities-lawsuit title as legal_or_lawsuit_noise', () => {
    const verdict = applyFilter(
      item({
        title:
          'BBNX Deadline: BBNX Investors Have Opportunity to Lead Beta Bionics, Inc. Securities Fraud Lawsuit',
      }),
    );
    expect(verdict).toEqual({ passed: false, reason: 'legal_or_lawsuit_noise' });
  });

  it('rejects the real HelloNation sponsored-filler title as sponsored_filler', () => {
    const verdict = applyFilter(
      item({
        title:
          'In HelloNation, Behavioral Health Experts Cody Luke and David Spencer Explain What to Expect',
      }),
    );
    expect(verdict).toEqual({ passed: false, reason: 'sponsored_filler' });
  });

  it('rejects the real World Young Scientist Summit title as no_food_signal', () => {
    const verdict = applyFilter(
      item({ title: 'World Young Scientist Summit 2026 Opens in Wenzhou, Zhejiang' }),
    );
    expect(verdict).toEqual({ passed: false, reason: 'no_food_signal' });
  });

  it('rejects a recipe/listicle title', () => {
    expect(applyFilter(item({ title: 'Top 10 Best Snacks Ranked' })).reason).toBe(
      'recipe_or_listicle',
    );
    expect(applyFilter(item({ title: 'How to Make Homemade Caramel Sauce' })).reason).toBe(
      'recipe_or_listicle',
    );
  });

  it('rejects the real Takeout listicle titles that slipped past the original \\d+ (best|worst) pattern', () => {
    const titles = [
      '12 Best New Costco Kirkland Signature Finds Of 2026 (So Far)',
      'The 12 Hands-Down Best New Chocolatey Candies Of 2026 (So Far)',
    ];
    for (const title of titles) {
      expect(applyFilter(item({ title })).reason).toBe('recipe_or_listicle');
    }
  });

  it('"7-Eleven ..." is not caught by the bare-number listicle rule — the digit is not followed by whitespace', () => {
    const verdict = applyFilter(item({ title: '7-Eleven Launches New Taquito Flavor' }));
    expect(verdict.reason).not.toBe('recipe_or_listicle');
  });

  it('rejects a review/opinion title', () => {
    expect(applyFilter(item({ title: 'Review: We Tried the New Spicy Sauce' })).reason).toBe(
      'review_or_opinion',
    );
  });

  it('rejects an item older than 30 days as too_old', () => {
    const oldDate = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const verdict = applyFilter(
      item({ title: 'New Spicy Chicken Sandwich Launches', publishedAt: oldDate }),
      NOW,
    );
    expect(verdict).toEqual({ passed: false, reason: 'too_old' });
  });

  it('an item within 30 days is not rejected as too_old', () => {
    const recentDate = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString();
    const verdict = applyFilter(
      item({ title: 'New Spicy Chicken Sandwich Launches', publishedAt: recentDate }),
      NOW,
    );
    expect(verdict.reason).not.toBe('too_old');
  });

  it('falls back to discoveredAt when publishedAt is null for the too_old check', () => {
    const oldDiscovered = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const verdict = applyFilter(
      item({ title: 'New Spicy Chicken Sandwich Launches', discoveredAt: oldDiscovered }),
      NOW,
    );
    expect(verdict).toEqual({ passed: false, reason: 'too_old' });
  });

  it('rejects an item with no title, excerpt, or bodyText as no_food_signal', () => {
    expect(applyFilter(item()).reason).toBe('no_food_signal');
  });

  it('rejects an off-topic title with no food signal at all', () => {
    expect(applyFilter(item({ title: 'City Council Approves New Zoning Ordinance' })).reason).toBe(
      'no_food_signal',
    );
  });

  it('rejects announcement-shaped PR with no food content — the real false positives this rule used to let through', () => {
    const titles = [
      'Roadrunner Launches Its First-Ever Outbound Canada-to-U.S. LTL Service',
      'Swanson Vitamins Launches Swanson Vitamins Nexus Pro to Champion Registered Dietitians',
      "CSTS Debuts Global Entertainment IP PremierX at New York's Pier 17",
    ];
    for (const title of titles) {
      expect(applyFilter(item({ title })).reason).toBe('no_food_signal');
    }
  });
});
