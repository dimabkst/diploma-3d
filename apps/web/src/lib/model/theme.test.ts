import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRINT_SIZE_STORAGE_KEY } from './printSize.ts';
import { DEFAULT_THEME, loadTheme, saveTheme, THEME_STORAGE_KEY } from './theme.ts';

/** An in-memory stand-in for `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

describe('the remembered theme', () => {
  it('starts light and remembers a choice under its own key, apart from the print size', () => {
    const storage = memoryStorage({ [PRINT_SIZE_STORAGE_KEY]: '120' });
    expect(DEFAULT_THEME).toBe('light');
    expect(loadTheme(storage)).toBe('light');
    saveTheme('dark', storage);
    expect(loadTheme(storage)).toBe('dark');
    saveTheme('light', storage);
    expect(loadTheme(storage)).toBe('light');
    expect(Object.fromEntries(storage.items)).toEqual({ [PRINT_SIZE_STORAGE_KEY]: '120', [THEME_STORAGE_KEY]: 'light' });
  });

  it.each(['', 'Dark', 'auto', 'system', '1'])('falls back to light for the stored value %j', (stored) => {
    expect(loadTheme(memoryStorage({ [THEME_STORAGE_KEY]: stored }))).toBe('light');
  });

  it('works without storage and ignores failing storage', () => {
    expect(loadTheme(undefined)).toBe('light');
    const failing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadTheme(failing)).toBe('light');
    expect(() => saveTheme('dark', failing)).not.toThrow();
  });

  it('is applied before the first paint by index.html, from the same key', () => {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
    expect(html).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}") === "dark"`);
    // In the head, before the application's module script.
    expect(html.indexOf(THEME_STORAGE_KEY)).toBeLessThan(html.indexOf('</head>'));
  });
});
