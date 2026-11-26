/**
 * The construction of a plane parallel to a face of a cube, a parallelepiped or a prism: the face, picked on the model
 * or by its orientation, and the plane's position between that face and the solid's far side along the face's inward normal, at
 * the midpoint or at a ratio of the two distances, d(face, plane) : d(plane, far side) = a : b. The plane lies at t = a / (a + b)
 * of that perpendicular gap, which is the specification's `positionPercent` = 100 t: the solid's extent along the normal, from the
 * face to its farthest vertices, also for an oblique solid. The far side is the opposite face where there is one, as for every
 * face of a parallelepiped and a prism's bases; a lateral face over a base side with no parallel side has none, and its far side
 * is the lateral edge the far support plane passes through, CC₁ for a triangular prism's ABB₁A₁, DD₁ for a pentagonal one's. A second parallel plane has its own position from the same face.
 */
import { type BoxLikeShape, boxFaceOrientations, boxTopologyOf, boxVertices } from '@diploma-3d/engine';
import type { BoxFace, BoxSegment, BoxVertex, PrismTopology } from '@diploma-3d/schema';
import { formatDecimal } from '../decimal.ts';
import { type BoxChoices, type BoxContext, type BoxKeysOf, type BoxNumberKey, faceName, segmentName, vertexName } from './box.ts';
import {
  type ConstructionDraft,
  constructionKeys,
  PILOT_MESSAGES,
  type PilotDraft,
  type PointMode,
  pointPercentOf,
} from './throughPoint.ts';

/** Whether a box's plane parallel to a face is this construction's: for a cube, the parallelepipeds and the prisms. */
export const facePilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  constructionKeys(keys) && choices[keys.Section] === 'face-parallel';

/** What the face construction reads of a solid: its topology and, while it is valid, its geometry; see `BoxContext`. */
export type FaceSolid = Pick<BoxContext, 'topology' | 'orientations' | 'shape'>;

/** The same of a valid solid's specification. */
export const faceSolidOf = (shape: BoxLikeShape): FaceSolid => ({
  topology: boxTopologyOf(shape),
  orientations: boxFaceOrientations(boxVertices(shape, { longestDimensionMm: 100 })),
  shape,
});

/** A prism's lateral face's index among its lateral faces, the one over the base side from its first two corners. */
const lateralIndex = (topology: PrismTopology, face: BoxFace): number => topology.faceNames.slice(2).indexOf(face);

/**
 * The face parallel to this one on the other side of the solid, where there is one: of the same group of parallel faces, as the
 * solid's geometry gives them, the two bases, and two lateral faces over parallel base sides, ABB₁A₁ and DEE₁D₁ of a regular
 * hexagonal prism, but no lateral face of a pentagonal one. While the solid is not valid, the regular base's: side i is parallel
 * to side i + n/2 for an even n.
 */
export function oppositeFace({ topology, orientations }: FaceSolid, face: BoxFace): BoxFace | undefined {
  if (topology.faces[face] === undefined) return undefined;
  if (orientations !== undefined) {
    return topology.faceNames.find((other) => other !== face && orientations[other] === orientations[face]);
  }
  if (face === topology.lowerBase) return topology.upperBase;
  if (face === topology.upperBase) return topology.lowerBase;
  const index = lateralIndex(topology, face);
  if (topology.kind !== 'prism' || index < 0 || topology.sides % 2 !== 0) return undefined;
  return topology.faceNames.slice(2)[(index + topology.sides / 2) % topology.sides];
}

/**
 * The solid's orientations of planes parallel to a face, each by its first face in the solid's order: a pair of parallel faces,
 * or a face with none, which is its own; ABCD, ABB₁A₁, BCC₁B₁ for a cube, ABC, ABB₁A₁, BCC₁B₁, CAA₁C₁ for a triangular prism,
 * the bases and the five lateral faces of a pentagonal one, the bases and three pairs of a regular hexagonal one.
 */
export function faceOrientations(solid: FaceSolid): { readonly face: BoxFace; readonly opposite: BoxFace | undefined }[] {
  const found: { face: BoxFace; opposite: BoxFace | undefined }[] = [];
  for (const face of solid.topology.faceNames) {
    if (found.some((orientation) => orientation.opposite === face)) continue;
    found.push({ face, opposite: oppositeFace(solid, face) });
  }
  return found;
}

/** The first face of the orientation a face belongs to: what the named list shows for it. */
export const facePairOf = (solid: FaceSolid, face: BoxFace): BoxFace =>
  faceOrientations(solid).find((pair) => pair.face === face || pair.opposite === face)?.face ?? face;

// Vertices this close to the farthest one along a face's normal, relative to the solid's extent, are on the far support plane.
const FAR_ROUNDOFF = 1e-9;

/**
 * The vertices of the solid's far support plane from a lateral face without a parallel one: those farthest along its inward
 * normal n, max n·v, a lateral edge as n is perpendicular to the lateral edges, CC₁ for a triangular prism's ABB₁A₁ and DD₁ for
 * a regular pentagonal prism's. While the solid is not valid, the regular base's: the vertex i + ⌈n/2⌉ off side i.
 */
function farVertices({ topology, shape }: FaceSolid, face: BoxFace): BoxVertex[] {
  const corners = topology.faces[face] ?? [];
  // A face the solid lacks, left from another base until the choices settle: nothing beyond it to name.
  if (corners.length < 3) return [];
  if (shape === undefined) {
    const base = topology.faces[topology.lowerBase] ?? [];
    const index = lateralIndex(topology, face);
    if (topology.kind !== 'prism' || index < 0) return topology.vertices.filter((vertex) => !corners.includes(vertex));
    const vertex = base[(index + Math.ceil(topology.sides / 2)) % topology.sides] as BoxVertex;
    return [vertex, `${vertex}1` as BoxVertex];
  }
  const vertices = boxVertices(shape, { longestDimensionMm: 100 });
  const points = topology.vertices.map((vertex) => vertices[vertex]);
  const centre = points.reduce<Vec>((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0]);
  const [p, q, r] = corners.map((vertex) => vertices[vertex]) as [Vec, Vec, Vec];
  const [u, v] = [minus(q, p), minus(r, p)];
  const raw: Vec = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // Turned into the solid, towards the mean of its vertices.
  const inward = dot(raw, minus([centre[0] / points.length, centre[1] / points.length, centre[2] / points.length], p)) > 0;
  const along = topology.vertices.map((vertex) => (inward ? 1 : -1) * dot(raw, vertices[vertex]));
  const [low, high] = [Math.min(...along), Math.max(...along)];
  return topology.vertices.filter((_, index) => (along[index] as number) >= high - FAR_ROUNDOFF * (high - low));
}

type Vec = readonly [number, number, number];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The solid's far side from a face, by name: the parallel face, or else the lateral edge the far support plane passes through,
 * CC₁ for a triangular prism's ABB₁A₁; and whether that is an edge rather than a face. Never a face that is not there.
 */
export function farSideOf(solid: FaceSolid, face: BoxFace): { readonly name: string; readonly edge: boolean } {
  const { topology } = solid;
  const opposite = oppositeFace(solid, face);
  if (opposite !== undefined) return { name: faceName(topology, opposite), edge: false };
  const off = farVertices(solid, face);
  const edge = off.length === 2 && topology.edges.some(([a, b]) => off.includes(a) && off.includes(b));
  return { name: edge ? segmentName(off as unknown as BoxSegment) : off.map(vertexName).join(', '), edge };
}

export type Placement = 'first' | 'second';

/** The mode and the ratio's two fields of a plane's position: the first plane's, or the second parallel one's. */
export const placementKeys = (keys: BoxKeysOf, which: Placement) =>
  which === 'first'
    ? { mode: keys.FaceMode, first: keys.FaceRatioFirst, second: keys.FaceRatioSecond }
    : { mode: keys.SecondMode, first: keys.SecondRatioFirst, second: keys.SecondRatioSecond };

/** A plane's position from the face in percent of the gap to the opposite face, 100 a / (a + b); undefined without one. */
export function placementPercent(
  keys: BoxKeysOf,
  choices: BoxChoices,
  read: (key: BoxNumberKey) => number | undefined,
  which: Placement,
): number | undefined {
  const { mode, first, second } = placementKeys(keys, which);
  return pointPercentOf(choices[mode] as PointMode, read(first), read(second));
}

/** The two distances a ratio compares, as its fields are labelled: "Від ABCD" and "До A₁B₁C₁D₁". */
export function distanceLabels(solid: FaceSolid, face: BoxFace): readonly [string, string] {
  return [`Від ${faceName(solid.topology, face)}`, `До ${farSideOf(solid, face).name}`];
}

/** What a position shows in its field: "Посередині", or the ratio as typed, "1 : 2". */
export const positionTitle = (mode: PointMode, texts: readonly [string, string]): string =>
  mode === 'midpoint' ? 'Посередині' : `${texts[0].trim() || '…'} : ${texts[1].trim() || '…'}`;

/**
 * The construction as drafted, checked before any plane is made: each position a ratio of two numbers not both zero, strictly
 * between the face and the opposite one, and a second plane apart from the first. Whether the parts are thick enough to print is
 * the section's own check. `ratioErrors` are the ratio fields' own messages; `second` whether a second plane is chosen.
 */
export function faceDraft(
  keys: BoxKeysOf,
  choices: BoxChoices,
  values: Readonly<Record<string, number | undefined>>,
  solid: FaceSolid,
  ratioErrors: Readonly<Record<string, string | undefined>>,
  second: boolean,
): PilotDraft {
  const { topology } = solid;
  const face = choices[keys.Face];
  const far = farSideOf(solid, face);
  const check = (which: Placement): { percent: number } | Extract<PilotDraft, { status: 'invalid' }> => {
    const { mode, first, second: other } = placementKeys(keys, which);
    const invalid = (problem: 'ratio' | 'boundary', message: string) =>
      ({ status: 'invalid', problem, message, position: which }) as const;
    if (choices[mode] === 'ratio') {
      const error = ratioErrors[first] ?? ratioErrors[other];
      if (error !== undefined) return invalid('ratio', error);
    }
    const percent = placementPercent(keys, choices, (key) => values[key], which);
    if (percent === undefined) return invalid('ratio', PILOT_MESSAGES.zeroRatio);
    if (percent <= 0 || percent >= 100) {
      const plane = which === 'first' ? 'Переріз' : 'Другий переріз';
      // At the far side: the opposite face, or a triangular prism's lateral edge, along which the plane only touches the solid.
      const at =
        percent <= 0
          ? `збігається з гранню ${faceName(topology, face)}`
          : far.edge
            ? `лише проходить через ребро ${far.name} і не розтинає тіла`
            : `збігається з гранню ${far.name}`;
      return invalid('boundary', `${plane} ${at}. Оберіть положення строго між ${faceName(topology, face)} і ${far.name}.`);
    }
    return { percent };
  };
  const first = check('first');
  if (!('percent' in first)) return first;
  if (!second) return { status: 'valid', percent: first.percent };
  const other = check('second');
  if (!('percent' in other)) return other;
  if (other.percent === first.percent) {
    return {
      status: 'invalid',
      problem: 'boundary',
      message: 'Другий переріз збігається з першим. Оберіть для нього інше положення.',
      position: 'second',
    };
  }
  return { status: 'valid', percent: first.percent, secondPercent: other.percent };
}

type State = {
  readonly texts: Readonly<Record<string, string>>;
  readonly choices: BoxChoices;
  readonly exact?: Readonly<Record<string, number>> | undefined;
};

/**
 * The state with a face chosen on the model. Its opposite face is the same family of planes seen from the other side: the planes
 * stay where they are and each ratio a : b reads b : a from there, a midpoint staying one. A face of another pair takes each
 * position as it is, from the new face.
 */
export function chooseFace<S extends State>(keys: BoxKeysOf, solid: FaceSolid, state: S, face: BoxFace): S {
  const current = state.choices[keys.Face];
  if (face === current || solid.topology.faces[face] === undefined) return state;
  const choices = { ...state.choices, [keys.Face]: face };
  if (oppositeFace(solid, current) !== face) return { ...state, choices };
  const texts = { ...state.texts };
  const exact = { ...state.exact };
  for (const which of ['first', 'second'] as const) {
    const { first, second } = placementKeys(keys, which);
    [texts[first], texts[second]] = [texts[second] ?? '', texts[first] ?? ''];
    const [a, b] = [exact[first], exact[second]];
    delete exact[first];
    delete exact[second];
    if (b !== undefined) exact[first] = b;
    if (a !== undefined) exact[second] = a;
  }
  return { ...state, choices, texts, exact };
}

/**
 * The state with a pair of opposite faces chosen by name, by its first face: the face in effect stays when it belongs to that pair,
 * so that choosing the active pair again changes nothing; otherwise the pair's first face, with each position kept.
 */
export function choosePair<S extends State>(keys: BoxKeysOf, solid: FaceSolid, state: S, pair: BoxFace): S {
  return facePairOf(solid, state.choices[keys.Face]) === pair ? state : chooseFace(keys, solid, state, pair);
}

const greatestDivisor = (a: number, b: number): number => (b === 0 ? a : greatestDivisor(b, a % b));

/**
 * A second plane's first position, as a ratio in lowest terms: halfway between the first plane and the farther end of the
 * positions a plane may take, rounded to a tenth of the gap and kept apart from the first; 7 : 3 beside a first plane at the
 * midpoint.
 */
export function startingSecondRatio(
  firstPercent: number,
  limits: { readonly min: number; readonly max: number },
): [string, string] {
  const far = firstPercent <= (limits.min + limits.max) / 2 ? limits.max : limits.min;
  let tenths = Math.min(9, Math.max(1, Math.round((firstPercent + far) / 20)));
  if (tenths * 10 === firstPercent) tenths += far > firstPercent ? 1 : -1;
  const divisor = greatestDivisor(tenths, 10 - tenths);
  return [formatDecimal(tenths / divisor), formatDecimal((10 - tenths) / divisor)];
}

/**
 * The construction view's draft of a plane parallel to a face: the face it is measured from and, while the construction is valid,
 * its planes, which the view computes at once; see `ConstructionDraft`.
 */
export function faceConstructionDraftOf(face: BoxFace, draft: PilotDraft | undefined): ConstructionDraft {
  return {
    face,
    segment: undefined,
    pointEdge: undefined,
    pointEdgeEligible: false,
    percent: undefined,
    plane:
      draft?.status !== 'valid'
        ? undefined
        : {
            type: 'face-parallel',
            face,
            positionPercent: draft.percent,
            ...(draft.secondPercent === undefined ? {} : { secondPositionPercent: draft.secondPercent }),
          },
  };
}
