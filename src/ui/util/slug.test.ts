import { describe, expect, it } from 'vitest';
import { exportFileName, SLUG_FALLBACK, slugify, transliterate } from './slug';

describe('transliterate', () => {
  it('maps Russian letters to Latin', () => {
    expect(transliterate('Книга и монета')).toBe('kniga i moneta');
    expect(transliterate('Щёлкунчик')).toBe('shchyolkunchik');
    expect(transliterate('Объём')).toBe('obyom');
  });

  it('keeps non-Russian characters', () => {
    expect(transliterate('A1-б')).toBe('a1-b');
  });
});

describe('slugify', () => {
  it('produces an ascii dash-separated slug', () => {
    expect(slugify('Книга, монета и наушники!')).toBe('kniga-moneta-i-naushniki');
    expect(slugify('  «Лампа»  —  свет  ')).toBe('lampa-svet');
  });

  it('strips diacritics from Latin text', () => {
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu');
  });

  it('falls back when nothing usable remains', () => {
    expect(slugify('')).toBe(SLUG_FALLBACK);
    expect(slugify('— ?! —')).toBe(SLUG_FALLBACK);
    expect(slugify('日本語')).toBe(SLUG_FALLBACK);
  });

  it('limits the length without leaving a trailing dash', () => {
    const slug = slugify('очень длинный заголовок о том как делать иллюстрации для журнала'.repeat(2));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slugify('aaaa bbbb', 5)).toBe('aaaa');
  });
});

describe('exportFileName', () => {
  it('builds the download name', () => {
    expect(exportFileName('Книга и монета', 1200, 630)).toBe('forma-kniga-i-moneta-1200x630.svg');
    expect(exportFileName('', 1080, 1350)).toBe('forma-illustration-1080x1350.svg');
  });
});
