/**
 * One input for two kinds of brief. An explicit list of objects («книга, 2 монеты, лампа») is built exactly as
 * written; anything else is a title or a metaphor and goes through the semantic analysis (and the model, when
 * one is configured).
 *
 * The decision is made on the output of `parseNames`: a text is a list when the parser can read every item
 * of it as an object name, so the rules that recognise a list are the rules that will build it. A name inside
 * a phrase («Книга для чтения»), a negation («лампа без телефона», the negator is a word that is no name) and
 * a lone word («книга») are not lists.
 */
import type { BriefMode, MotifId, NameEntry, NamesParse } from '../domain/types';
import { isNumeric, isStopToken, tokenize } from './normalize';
import { parseNames } from './parseNames';

/** An item the library has no drawing for still reads as an item when it is this short: «зонт», «красный чайник». */
const MAX_UNKNOWN_WORDS = 2;

export interface BriefReading {
  mode: BriefMode;
  /** The parse the decision was made on: it is the result of a list, and free to ignore for a title. */
  parse: NamesParse;
}

/** An object name the parser recognised on its own, without words around it. */
function isKnownItem(entry: NameEntry): boolean {
  return entry.bare === true && entry.motif !== undefined && entry.status !== 'unmatched';
}

/** An unrecognised item that looks like the name of a thing («зонт»), not like a phrase («немного тишины»). */
function isUnknownItem(entry: NameEntry): boolean {
  if (entry.status !== 'unmatched') return false;
  const words = tokenize(entry.raw).filter((t) => !isNumeric(t.norm));
  return words.length >= 1 && words.length <= MAX_UNKNOWN_WORDS && !words.some(isStopToken);
}

function isExplicitList(parse: NamesParse): boolean {
  const { entries } = parse;
  const known = entries.filter(isKnownItem);
  const unknown = entries.filter(isUnknownItem);
  // One phrase among the items («Книга для чтения», «лампа без телефона») makes the whole text prose.
  if (entries.length === 0 || known.length + unknown.length !== entries.length) return false;

  // «3 монеты», «монета ×2»: a quantity says what is wanted. A bare name («книга») is a topic, not a list.
  if (entries.length === 1) return (known[0]?.count ?? 1) > 1;
  // Unknown items are reported in the list result, but only while the objects outnumber them: «весна, цветы,
  // радость» is a title that happens to contain one name.
  return known.length >= 2 && known.length > unknown.length;
}

/** Reads the input as a list or a title; the parse is returned so a list is not parsed twice. */
export function readBrief(input: string, available: ReadonlySet<MotifId>): BriefReading {
  const parse = parseNames(input, available);
  return { mode: isExplicitList(parse) ? 'names' : 'title', parse };
}
