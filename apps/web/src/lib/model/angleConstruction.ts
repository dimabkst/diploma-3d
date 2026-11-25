/**
 * The construction of a cube's or a parallelepiped's plane through a segment at an angle to a face: the segment, an edge or a face's
 * diagonal, shared with the plane through a point; the reference face that holds it, the diagonal's own face or either face of an
 * edge; and the smaller dihedral angle α between the plane and that face, 0°–90°. Two planes through the segment make α with the
 * face: turned from the face into the solid by θ = α, or by θ = 180° − α, see the engine's `LineFrame`, which is how the
 * specification gives them. Both are checked against the solid, a plane on a face or only touching the solid refused, and the one
 * chosen is kept as `LineSide` until the user asks for the other.
 */
import { type BoxLikeShape, boxLineAngleOfPoint, boxPlane, boxSection, boxVertices } from '@diploma-3d/engine';
import {
  type BoxFace,
  type BoxSegment,
  boxFacesHolding,
  type PhysicalScale,
  type PrismTopology,
  type ShapeKind,
} from '@diploma-3d/schema';
import { type BoxChoices, type BoxContext, type BoxKeysOf, faceName, segmentName } from './box.ts';
import {
  type ConstructionDraft,
  isThroughPointSolid,
  PILOT_MESSAGES,
  type PilotDraft,
  planeContact,
  throughPointSelection,
} from './throughPoint.ts';

/** The plane turned by θ = α from the face into the solid, or by θ = 180° − α: the two that make α with it. */
export type AngleSide = 'first' | 'second';

/** Whether a box's plane through a line is this construction's: by its angle, for a cube and the parallelepipeds. */
export const anglePilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  isThroughPointSolid(keys.Section.slice(0, -'Section'.length) as ShapeKind) && choices[keys.LineMethod] === 'angle';

/** The faces an angle may be measured from: the two faces of an edge, the one face of a face's diagonal. */
export const referenceFaces = (topology: PrismTopology, segment: BoxSegment): BoxFace[] => boxFacesHolding(topology, segment);

/** The reference face in effect: the one chosen while it holds the segment, else the segment's first face. */
export function referenceFaceOf(topology: PrismTopology, segment: BoxSegment, chosen: BoxFace): BoxFace {
  const faces = referenceFaces(topology, segment);
  return faces.includes(chosen) ? chosen : (faces[0] ?? chosen);
}

/** The turn θ from the reference face of the plane at α on the chosen side. */
export const turnOf = (angleDeg: number, side: AngleSide): number => (side === 'first' ? angleDeg : 180 - angleDeg);

/** The angle α and the side of a plane turned by θ from its reference face; at 90° both sides are one plane. */
export const angleOfTurn = (turnDeg: number): { readonly angleDeg: number; readonly side: AngleSide } =>
  turnDeg <= 90 ? { angleDeg: turnDeg, side: 'first' } : { angleDeg: 180 - turnDeg, side: 'second' };

/** A plane through the segment at α to the face on one side, and how it meets the solid. */
export interface AngleCandidate {
  readonly side: AngleSide;
  readonly turnDeg: number;
  readonly contact: ReturnType<typeof planeContact>;
}

/**
 * The planes through the segment at α to the reference face, from the engine's own plane: on each side, or one where both sides
 * give the same plane, as at 90°, and at 0°, the face itself from either side.
 */
export function angleCandidates(
  shape: BoxLikeShape,
  topology: PrismTopology,
  face: BoxFace,
  segment: BoxSegment,
  angleDeg: number,
): AngleCandidate[] {
  const vertices = boxVertices(shape, { longestDimensionMm: 100 });
  const planes = (['first', 'second'] as const).map((side) => {
    const turnDeg = turnOf(angleDeg, side);
    const { normal } = boxPlane(vertices, { type: 'through-line', face, line: segment, method: 'angle', angleDeg: turnDeg });
    return { side, turnDeg, normal, contact: planeContact(vertices, topology, normal, vertices[segment[0]]) };
  });
  const [first, second] = planes as [(typeof planes)[number], (typeof planes)[number]];
  // Both through the segment: the same plane exactly when their normals are parallel.
  const cross = [
    first.normal[1] * second.normal[2] - first.normal[2] * second.normal[1],
    first.normal[2] * second.normal[0] - first.normal[0] * second.normal[2],
    first.normal[0] * second.normal[1] - first.normal[1] * second.normal[0],
  ];
  const same = Math.hypot(...cross) <= 1e-9;
  return (same ? [first] : planes).map(({ side, turnDeg, contact }) => ({ side, turnDeg, contact }));
}

/** Which candidate is the one chosen: its own side, or the only plane where both sides are one. */
const chosenOf = (candidates: readonly AngleCandidate[], side: AngleSide) =>
  candidates.length === 1 ? candidates[0] : candidates.find((candidate) => candidate.side === side);

/**
 * The construction as drafted, checked before any plane is made: a segment chosen, an angle in 0°–90°, and the chosen plane at
 * that angle cutting the solid rather than lying on a face or only touching it. `alternative` says that the other plane at that
 * angle cuts it, which the page then offers. Whether the parts are thick enough is the section's own check.
 */
export function angleDraft(
  keys: BoxKeysOf,
  choices: BoxChoices,
  values: Readonly<Record<string, number | undefined>>,
  context: BoxContext,
  angleErrors: Readonly<Record<string, string | undefined>>,
): PilotDraft {
  const { segment } = throughPointSelection(keys, choices, context);
  if (segment === undefined) return { status: 'incomplete', message: PILOT_MESSAGES.segment };
  const error = angleErrors[keys.LineDihedralDeg];
  const angleDeg = values[keys.LineDihedralDeg];
  if (error !== undefined || angleDeg === undefined) {
    return { status: 'invalid', problem: 'angle', message: error ?? 'Введіть кут від 0° до 90°.' };
  }
  if (context.shape === undefined) return { status: 'unresolved' };
  const face = referenceFaceOf(context.topology, segment, choices[keys.LineFace]);
  const candidates = angleCandidates(context.shape, context.topology, face, segment, angleDeg);
  const chosen = chosenOf(candidates, choices[keys.LineSide]) as AngleCandidate;
  const alternative = candidates.some((candidate) => candidate !== chosen && candidate.contact.kind === 'cut');
  if (chosen.contact.kind === 'cut') return { status: 'valid', percent: chosen.turnDeg, alternative };
  const instead = alternative ? ' або оберіть «Інше положення перерізу»' : '';
  const on = chosen.contact.kind === 'face' ? chosen.contact.face : undefined;
  return {
    status: 'invalid',
    problem: chosen.contact.kind === 'face' ? 'face' : 'touching',
    message:
      on !== undefined
        ? `Під цим кутом площина збігається з гранню ${faceName(context.topology, on)}. Змініть кут${instead}.`
        : `Під цим кутом площина лише дотикається до тіла вздовж ${segmentName(segment)}, не розтинаючи його. Змініть кут${instead}.`,
    alternative,
  };
}

/**
 * The angle and the side, from a reference face, of the plane through the segment and a point of the solid off it: how a plane given
 * by a point, or at an angle to the segment's other face, is given at an angle to this face without moving. Undefined for a point on
 * the segment's line.
 */
export function angleFromPoint(
  shape: BoxLikeShape,
  scale: PhysicalScale,
  face: BoxFace,
  segment: BoxSegment,
  point: readonly [number, number, number],
): { readonly angleDeg: number; readonly side: AngleSide } | undefined {
  const turnDeg = boxLineAngleOfPoint(shape, scale, face, segment, point);
  return turnDeg === undefined ? undefined : angleOfTurn(turnDeg);
}

/**
 * A point of a plane through the segment, in the solid and off the segment, from which another face reads its angle: the corner of
 * the plane's section farthest from the segment.
 */
export function pointOffSegment(
  shape: BoxLikeShape,
  scale: PhysicalScale,
  plane: Parameters<typeof boxSection>[2]['box'],
  segment: BoxSegment,
): readonly [number, number, number] | undefined {
  type Vec = readonly [number, number, number];
  const vertices = boxVertices(shape, scale);
  const p: Vec = vertices[segment[0]];
  const along: Vec = [vertices[segment[1]][0] - p[0], vertices[segment[1]][1] - p[1], vertices[segment[1]][2] - p[2]];
  const length = Math.hypot(...along);
  // The distance from the segment's line: of the offset from P, what is left without its part along PQ.
  const distance = (point: Vec) => {
    const offset: Vec = [point[0] - p[0], point[1] - p[1], point[2] - p[2]];
    const t = (offset[0] * along[0] + offset[1] * along[1] + offset[2] * along[2]) / (length * length);
    return Math.hypot(offset[0] - t * along[0], offset[1] - t * along[1], offset[2] - t * along[2]);
  };
  try {
    const { contour } = boxSection(shape, scale, { box: plane });
    const farthest = [...contour].sort((a, b) => distance(b as Vec) - distance(a as Vec))[0] as Vec | undefined;
    return farthest === undefined || distance(farthest) <= 1e-9 * length ? undefined : farthest;
  } catch {
    return undefined;
  }
}

/** What the angle field shows: "Кут до ABCD". */
export const angleTitle = (topology: PrismTopology, face: BoxFace): string => `Кут до ${faceName(topology, face)}`;

/**
 * The construction view's draft of a plane at an angle: the segment, the reference face where it is to be shown, and, while the
 * construction is valid, the plane, which the view computes at once; see `ConstructionDraft`.
 */
export function angleConstructionDraftOf(
  segment: BoxSegment | undefined,
  face: BoxFace | undefined,
  shownFace: boolean,
  draft: PilotDraft | undefined,
  secondPercent: number | undefined,
): ConstructionDraft {
  return {
    face: shownFace ? face : undefined,
    segment,
    pointEdge: undefined,
    pointEdgeEligible: false,
    percent: undefined,
    plane:
      draft?.status !== 'valid' || segment === undefined || face === undefined
        ? undefined
        : {
            type: 'through-line',
            face,
            line: segment,
            method: 'angle',
            angleDeg: draft.percent,
            ...(secondPercent === undefined ? {} : { secondPositionPercent: secondPercent }),
          },
  };
}
