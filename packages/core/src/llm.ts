import type { ZodType } from 'zod';

export interface LlmError {
  kind: 'parse_error' | 'no_match' | 'provider_error';
  message: string;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface TokenBudget {
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface LlmExtractOptions<T> {
  schema: ZodType<T>;
  prompt: string;
  input: string;
  budget?: TokenBudget; // unused until Phase 8's cloud provider
}

/**
 * All model access goes through this one interface — a pre-designed seam
 * (docs/01-architecture.md §5): Phases 1-7 ship a RuleBasedProvider against
 * it with zero LLM dependency, and Phase 8 adds a cloud provider against the
 * identical contract.
 */
export interface LlmProvider {
  extract<T>(opts: LlmExtractOptions<T>): Promise<Result<T, LlmError>>;
}
