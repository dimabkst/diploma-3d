import { safeLocalStorage } from './storage.ts';

export type Theme = 'light' | 'dark';

/** The other browser setting of the editor, beside the print size: the chosen theme, for every shape. index.html reads it too. */
export const THEME_STORAGE_KEY = 'diploma-3d.theme';

/** Light unless dark was chosen here before, whatever the system's theme. */
export const DEFAULT_THEME: Theme = 'light';

/** The stored theme, or the default when there is none, it is not a theme, or storage is unavailable. */
export function loadTheme(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): Theme {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Remembers the theme; failures to write are ignored, the editor works without storage. */
export function saveTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Quota exceeded or storage disabled: the theme simply is not remembered.
  }
}

/** The page's colours follow the root's `data-theme`; see styles.css. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}
