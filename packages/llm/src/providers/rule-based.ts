import type { LlmProvider } from '@bitedrop/core';
import { runHeuristics, type ExtractionInput } from './ruleBasedHeuristics';

function isExtractionInput(value: unknown): value is ExtractionInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'discoveredAt' in value &&
    'sourceTrustTier' in value &&
    'knownBrandNames' in value
  );
}

/**
 * The first implementation of the LlmProvider seam (docs/01-architecture.md
 * §5) — satisfies the interface with deterministic heuristics instead of a
 * model call, so the pipeline is complete and testable at $0 before Phase 8
 * wires in a real cloud provider.
 */
export const ruleBasedProvider: LlmProvider = {
  extract(opts) {
    let context: unknown;
    try {
      context = JSON.parse(opts.input);
    } catch {
      return Promise.resolve({
        ok: false,
        error: { kind: 'parse_error', message: 'input was not valid JSON' },
      });
    }
    if (!isExtractionInput(context)) {
      return Promise.resolve({
        ok: false,
        error: { kind: 'parse_error', message: 'input JSON did not match ExtractionInput' },
      });
    }

    const extraction = runHeuristics(context);
    const parsed = opts.schema.safeParse(extraction);
    if (!parsed.success) {
      return Promise.resolve({
        ok: false,
        error: { kind: 'parse_error', message: parsed.error.message },
      });
    }
    return Promise.resolve({ ok: true, value: parsed.data });
  },
};
