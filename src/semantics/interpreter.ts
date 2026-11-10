/**
 * Plug-in boundary for title interpretation.
 *
 * `ruleInterpreter` is the deterministic, offline baseline. The optional LLM path lives in `llm.ts`
 * (client) and `server/` (holds the API key): it is asked only when the rules are unsure, its answer
 * is reduced to available motif ids and merged into the same `TitleAnalysis`, and any error or
 * timeout leaves the rule-based result in place.
 */
import type { MotifId, TitleAnalysis } from '../domain/types';
import { analyzeTitle, type AnalyzeOptions } from './analyzeTitle';

export interface TitleInterpreter {
  readonly id: string;
  /** Russian label for a settings UI. */
  readonly label: string;
  interpret(input: string, available: ReadonlySet<MotifId>, opts?: AnalyzeOptions): TitleAnalysis | Promise<TitleAnalysis>;
}

export const ruleInterpreter: TitleInterpreter = {
  id: 'rules',
  label: 'Правила и словарь',
  interpret: (input, available, opts) => analyzeTitle(input, available, opts),
};
