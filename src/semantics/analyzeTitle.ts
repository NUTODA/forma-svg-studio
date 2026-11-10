// CONTRACT STUB — owned by the semantics agent. Signature is fixed; body to be implemented.
import type { MotifId, TitleAnalysis } from '../domain/types';

export interface AnalyzeOptions {
  /** Max motifs to select (default 3, clamp 1..5). */
  max?: number;
}

/** Deterministic Russian title → motif interpretation (no network). */
export function analyzeTitle(
  _input: string,
  _available: ReadonlySet<MotifId>,
  _opts?: AnalyzeOptions,
): TitleAnalysis {
  throw new Error('not implemented');
}
