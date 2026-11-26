/**
 * Picking the base diagonal of a longitudinal plane through a diagonal on the model, for a cube, a parallelepiped or a prism: the
 * n(n − 3)/2 families of diagonal sections of an n-gonal base, AC and BD of a quadrilateral, each with its upper equivalent, A₁C₁
 * over AC, which lies in the same plane parallel to the lateral edges. Parallel diagonals, such as a regular hexagon's BF and CE,
 * are different families: their planes are parallel, not the same. The plane itself, its position and its moving off the diagonal are the longitudinal mode's own; see
 * `traceSelection` and `followTrace`.
 */
import type { BoxSegment, BoxVertex } from '@diploma-3d/schema';
import { type BoxChoices, type BoxKeysOf, type SegmentKey, segmentKey, segmentName } from './box.ts';
import { constructionKeys } from './throughPoint.ts';

/** Whether a box's longitudinal plane is the one through a base diagonal, of a cube, a parallelepiped or a prism. */
export const diagonalPilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  constructionKeys(keys) && choices[keys.Section] === 'longitudinal' && choices[keys.Trace] === 'diagonal';

/** A family of diagonal sections: its lower base's diagonal, which the choice stores, and the upper base's over it. */
export interface DiagonalFamily {
  readonly key: SegmentKey;
  readonly lower: BoxSegment;
  readonly upper: BoxSegment;
}

const upperOf = (vertex: BoxVertex) => `${vertex}1` as BoxVertex;

/** The families of the lower base's diagonals, as the longitudinal mode offers them. */
export const diagonalFamilies = (diagonals: readonly BoxSegment[]): DiagonalFamily[] =>
  diagonals.map((lower) => ({ key: segmentKey(lower), lower, upper: [upperOf(lower[0]), upperOf(lower[1])] }));

const same = (a: readonly [BoxVertex, BoxVertex], b: readonly [BoxVertex, BoxVertex]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** The family of a diagonal of either base, its ends in either order; undefined for any other segment. */
export const familyOf = (families: readonly DiagonalFamily[], segment: readonly [BoxVertex, BoxVertex]) =>
  families.find(({ lower, upper }) => same(lower, segment) || same(upper, segment));

/** The vertices of the same base that complete a diagonal with this one: C for A of a quadrilateral, C and D for a pentagon's. */
export function diagonalPartners(families: readonly DiagonalFamily[], vertex: BoxVertex): BoxVertex[] {
  return families.flatMap(({ lower, upper }) =>
    [lower, upper].flatMap(([first, second]) => (first === vertex ? [second] : second === vertex ? [first] : [])),
  );
}

/** The families of the diagonals through a vertex of either base, as they are drawn on that base. */
export const diagonalsThrough = (families: readonly DiagonalFamily[], vertex: BoxVertex): BoxSegment[] =>
  families.flatMap(({ lower, upper }) => [lower, upper].filter((ends) => ends.includes(vertex)));

/** A family by name, with its upper equivalent: "AC (і A₁C₁)". */
export const familyLabel = ({ lower, upper }: DiagonalFamily): string => `${segmentName(lower)} (і ${segmentName(upper)})`;
