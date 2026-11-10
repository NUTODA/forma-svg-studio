const RU_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export const SLUG_MAX_LENGTH = 48;
export const SLUG_FALLBACK = 'illustration';

/** Russian → Latin transliteration (lowercase); other characters pass through unchanged. */
export function transliterate(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase()) out += RU_TO_LATIN[ch] ?? ch;
  return out;
}

/** File-name slug: ascii `[a-z0-9-]`, no edge/double dashes, at most `max` characters. */
export function slugify(text: string, max: number = SLUG_MAX_LENGTH): string {
  const ascii = transliterate(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = ascii.slice(0, max).replace(/-+$/g, '');
  return cut || SLUG_FALLBACK;
}

/** `forma-<slug>-<w>x<h>.svg` */
export function exportFileName(title: string, width: number, height: number): string {
  return `forma-${slugify(title)}-${Math.round(width)}x${Math.round(height)}.svg`;
}
