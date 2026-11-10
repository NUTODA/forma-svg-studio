/**
 * Plug-in boundary for title interpretation.
 *
 * The app ships only the deterministic `ruleInterpreter` and never calls the network. An optional
 * server-side LLM adapter would implement the same interface: send the title and the available
 * motif ids to a backend endpoint that holds the API key, validate the model's answer against the
 * `TitleAnalysis` shape (unknown or unavailable motifs dropped, reasons kept as plain text) and
 * fall back to `ruleInterpreter` on any error or timeout. Nothing else in the app would change.
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
