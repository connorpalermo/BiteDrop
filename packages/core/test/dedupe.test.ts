import { describe, expect, it } from 'vitest';
import {
  DEDUPE_DATE_WINDOW_DAYS,
  DEDUPE_FUZZY_SIMILARITY_THRESHOLD,
  DEDUPE_LINK_CONFIDENCE,
  PUBLISH_CONFIDENCE_THRESHOLD,
  shouldPublish,
} from '../src/dedupe';

describe('dedupe constants', () => {
  it('pins the tunable values this phase doc committed to', () => {
    expect(DEDUPE_FUZZY_SIMILARITY_THRESHOLD).toBe(0.3);
    expect(DEDUPE_DATE_WINDOW_DAYS).toBe(14);
    expect(PUBLISH_CONFIDENCE_THRESHOLD).toBe(0.6);
    expect(DEDUPE_LINK_CONFIDENCE).toEqual({
      exact_url: 1.0,
      content_hash: 1.0,
      name_brand: 0.9,
      fuzzy: 0.7,
    });
  });
});

describe('shouldPublish', () => {
  it('publishes at or above the threshold when not rumored', () => {
    expect(shouldPublish('new', 0.6)).toBe(true);
    expect(shouldPublish('new', 0.8)).toBe(true);
  });

  it('does not publish below the threshold', () => {
    expect(shouldPublish('new', 0.59)).toBe(false);
    expect(shouldPublish('new', 0.3)).toBe(false);
  });

  it('never publishes a rumored drop, even at high confidence', () => {
    expect(shouldPublish('rumored', 0.95)).toBe(false);
  });

  it('every non-rumored status is eligible, given enough confidence', () => {
    for (const status of [
      'new',
      'coming_soon',
      'limited_time',
      'returning',
      'discontinued',
    ] as const) {
      expect(shouldPublish(status, 0.6)).toBe(true);
    }
  });
});
