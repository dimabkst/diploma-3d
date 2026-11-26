/**
 * Picking the segment an inclined plane of a cube, a parallelepiped or any prism is perpendicular to: any edge, face's diagonal or
 * the solid's diagonal, as the solid's topology classifies the pair, two vertices of no common face being a diagonal of the solid, by its two ends in either order, as the existing choice of the inclined mode stores it, `NormalAlong`. The segment gives
 * the plane's normal only, n = (Q − P)/|Q − P|; the plane's position is the mode's own, along the solid's extent in that direction,
 * so that it need not meet the segment itself.
 */
import type { BoxSegment, BoxVertex, PrismTopology, ShapeKind } from '@diploma-3d/schema';
import { allSegments, type BoxChoices, type BoxKeysOf, type SegmentKey, segmentKey, segmentName } from './box.ts';
import { isConstructionSolid } from './throughPoint.ts';

/** Whether a box's inclined plane is this construction's: of a cube, a parallelepiped or a prism of any base. */
export const normalPilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  isConstructionSolid(keys.Section.slice(0, -'Section'.length) as ShapeKind) && choices[keys.Section] === 'inclined';

/** A segment the plane may be perpendicular to, as the mode lists it: its key, its ends in the listed order, and its kind. */
export interface NormalEntry {
  readonly key: SegmentKey;
  readonly segment: BoxSegment;
  readonly kind: 'lateral' | 'edge' | 'face' | 'body';
}

export const normalEntries = (topology: PrismTopology): NormalEntry[] =>
  allSegments(topology).map(({ segment, kind }) => ({ key: segmentKey(segment), segment, kind }));

const same = (a: readonly [BoxVertex, BoxVertex], b: readonly [BoxVertex, BoxVertex]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

const isLateral = ([first, second]: readonly [BoxVertex, BoxVertex]) => second === `${first}1` || first === `${second}1`;

/**
 * The listed segment two picked vertices give, in either order: the very segment, or for a lateral edge the lateral edges, which
 * a prism lists once as they are parallel and point the same way. Undefined for a vertex twice.
 */
export function entryOf(entries: readonly NormalEntry[], picked: readonly [BoxVertex, BoxVertex]): NormalEntry | undefined {
  if (picked[0] === picked[1]) return undefined;
  return (
    entries.find(({ segment }) => same(segment, picked)) ??
    (isLateral(picked) ? entries.find(({ kind }) => kind === 'lateral') : undefined)
  );
}

/** A listed segment by name: "AB", "AC₁", or the lateral edges, "Бічні ребра (AA₁)". */
export const entryName = ({ segment, kind }: NormalEntry): string =>
  kind === 'lateral' ? `Бічні ребра (${segmentName(segment)})` : segmentName(segment);

/** What the segment is: "ребро", "діагональ грані", "діагональ тіла". */
export const entryKindName = ({ kind }: NormalEntry): string =>
  kind === 'face' ? 'діагональ грані' : kind === 'body' ? 'діагональ тіла' : kind === 'lateral' ? 'усі бічні ребра' : 'ребро';

/** The group of the named list a segment is in. */
export const entryGroup = ({ kind }: NormalEntry): string =>
  kind === 'face' ? 'Діагоналі граней' : kind === 'body' ? 'Діагоналі тіла' : 'Ребра';
