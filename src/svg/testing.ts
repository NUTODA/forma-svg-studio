/** Test helpers shared by the SVG/export/tools tests (not imported by app code). */
import { parseXml, type XmlElement } from './xml';

export interface ReferenceReport {
  ids: string[];
  references: string[];
  /** References that do not resolve to an id defined in the same markup. */
  dangling: string[];
  duplicateIds: string[];
  elements: string[];
}

function walk(el: XmlElement, visit: (el: XmlElement) => void): void {
  visit(el);
  for (const child of el.children) if (child.kind === 'element') walk(child, visit);
}

/** Parses markup (a fragment is wrapped in <svg>) and checks that every local reference resolves. */
export function checkReferences(markup: string): ReferenceReport {
  const root = parseXml(/^\s*<svg[\s>]/.test(markup) ? markup : `<svg xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`);
  const ids: string[] = [];
  const references: string[] = [];
  const elements: string[] = [];
  walk(root, (el) => {
    elements.push(el.name);
    for (const { name, value } of el.attrs) {
      if (name === 'id') ids.push(value);
      else if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) references.push(value.slice(1));
      else for (const m of value.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) references.push(m[1] ?? '');
    }
  });
  const idSet = new Set(ids);
  return {
    ids,
    references,
    dangling: references.filter((ref) => !idSet.has(ref)),
    duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
    elements,
  };
}

export const FORBIDDEN_ELEMENTS = ['script', 'style', 'foreignObject', 'image', 'a', 'animate', 'set', 'iframe'];
