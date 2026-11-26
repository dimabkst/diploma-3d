import { formatDecimal } from '../decimal.ts';
import { validatePrintSize } from './parameters.ts';
import { safeLocalStorage } from './storage.ts';

/** A browser setting of the editor, beside the theme: the last valid print size, shared by every shape. */
export const PRINT_SIZE_STORAGE_KEY = 'diploma-3d.print-size-mm';

/**
 * The stored print size as field text, or undefined when there is none, it is no longer valid, or storage is
 * unavailable (private browsing, blocked cookies): the caller then keeps the default.
 */
export function loadPrintSizeText(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): string | undefined {
  try {
    const stored = storage?.getItem(PRINT_SIZE_STORAGE_KEY);
    if (stored == null) return undefined;
    const result = validatePrintSize(stored);
    return 'value' in result ? formatDecimal(result.value) : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers a validated size; failures to write are ignored, the editor works without storage. */
export function savePrintSize(sizeMm: number, storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(PRINT_SIZE_STORAGE_KEY, String(sizeMm));
  } catch {
    // Quota exceeded or storage disabled: the size simply is not remembered.
  }
}
