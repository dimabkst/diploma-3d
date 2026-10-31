export interface Deletable {
  delete(): void;
}

export type Track = <T extends Deletable>(object: T) => T;

/**
 * Runs `body` and then deletes every tracked WASM object in reverse creation order, also when `body` throws.
 * Results must be copied out of WASM memory (for example, as a mesh) before `body` returns.
 */
export function withScope<T>(body: (track: Track) => T): T {
  const owned: Deletable[] = [];
  const track: Track = (object) => {
    owned.push(object);
    return object;
  };

  try {
    return body(track);
  } finally {
    for (let index = owned.length - 1; index >= 0; index -= 1) {
      owned[index]?.delete();
    }
  }
}
