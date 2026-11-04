import { describe, expect, it } from 'vitest';
import { loadPrintSizeText, PRINT_SIZE_STORAGE_KEY, savePrintSize } from './printSize.ts';

/** An in-memory stand-in for `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

describe('the remembered print size', () => {
  it('returns the stored size as field text and remembers a new one under one key', () => {
    const storage = memoryStorage();
    expect(loadPrintSizeText(storage)).toBeUndefined();
    savePrintSize(120, storage);
    expect([...storage.items.keys()]).toEqual([PRINT_SIZE_STORAGE_KEY]);
    expect(loadPrintSizeText(storage)).toBe('120');
    savePrintSize(62.5, storage);
    expect(loadPrintSizeText(storage)).toBe('62,5');
  });

  it.each(['', 'abc', '0', '-80', '1001', '1e3', 'NaN'])('falls back to the default for the stored value %j', (stored) => {
    expect(loadPrintSizeText(memoryStorage({ [PRINT_SIZE_STORAGE_KEY]: stored }))).toBeUndefined();
  });

  it('works without storage and ignores failing storage', () => {
    expect(loadPrintSizeText(undefined)).toBeUndefined();
    const failing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadPrintSizeText(failing)).toBeUndefined();
    expect(() => savePrintSize(120, failing)).not.toThrow();
  });
});
