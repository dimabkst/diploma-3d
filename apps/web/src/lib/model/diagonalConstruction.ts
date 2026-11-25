/**
 * Picking the base diagonal of a cube's or a parallelepiped's longitudinal plane through a diagonal on the model: the two families
 * of diagonal sections, AC and BD, each with its upper equivalent A₁C₁ and B₁D₁, which lies in the same plane parallel to the
 * lateral edges. The plane itself, its position and its moving off the diagonal are the longitudinal mode's own; see
 * `traceSelection` and `followTrace`.
 */
import type { BoxSegment, BoxVertex, ShapeKind } from '@diploma-3d/schema';
import { type BoxChoices, type BoxKeysOf, type SegmentKey, segmentKey, segmentName } from './box.ts';
import { isThroughPointSolid } from './throughPoint.ts';

/** Whether a box's longitudinal plane is the one through a base diagonal, of a cube or a parallelepiped. */
export const diagonalPilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  isThroughPointSolid(keys.Section.slice(0, -'Section'.length) as ShapeKind) &&
  choices[keys.Section] === 'longitudinal' &&
  choices[keys.Trace] === 'diagonal';

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

/** The vertex of the same base opposite this one, which completes a diagonal with it. */
export function oppositeVertex(families: readonly DiagonalFamily[], vertex: BoxVertex): BoxVertex | undefined {
  for (const { lower, upper } of families) {
    for (const [first, second] of [lower, upper]) {
      if (first === vertex) return second;
      if (second === vertex) return first;
    }
  }
  return undefined;
}

/** A family by name, with its upper equivalent: "AC (і A₁C₁)". */
export const familyLabel = ({ lower, upper }: DiagonalFamily): string => `${segmentName(lower)} (і ${segmentName(upper)})`;
