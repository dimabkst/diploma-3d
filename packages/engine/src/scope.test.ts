import { describe, expect, it } from 'vitest';
import { withScope } from './scope.ts';

const createLog = () => {
  const deleted: string[] = [];
  const object = (name: string) => ({ name, delete: () => deleted.push(name) });
  return { deleted, object };
};

describe('withScope', () => {
  it('returns the result and deletes tracked objects in reverse creation order', () => {
    const { deleted, object } = createLog();
    const result = withScope((track) => {
      const first = track(object('first'));
      const second = track(object('second'));
      return `${first.name}+${second.name}`;
    });
    expect(result).toBe('first+second');
    expect(deleted).toEqual(['second', 'first']);
  });

  it('deletes tracked objects when the body throws', () => {
    const { deleted, object } = createLog();
    expect(() =>
      withScope((track) => {
        track(object('created'));
        throw new Error('generation failed');
      }),
    ).toThrow('generation failed');
    expect(deleted).toEqual(['created']);
  });
});
