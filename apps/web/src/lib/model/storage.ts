/** The browser's `localStorage`, or undefined where site data is blocked: accessing it then throws itself. */
export function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
