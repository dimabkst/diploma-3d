/**
 * A pilot of the plane through an edge or a face's diagonal and a point M of another edge, for a cube and the parallelepipeds:
 * the segment and M's edge are chosen on the model or by name, with no face to choose first, and M at an edge's midpoint or at a
 * ratio of its parts. Kept apart from the other modes, so that it can be taken back after user testing. The specification is the
 * plane through a line's mode as before: `line`, `pointEdge` and `pointPercent`, with the face that holds the line inferred.
 */
import { type BoxLikeShape, boxSection, boxVertices, toGltfPosition } from '@diploma-3d/engine';
import {
  BOX_TOPOLOGY,
  type BoxFace,
  type BoxSectionSpec,
  type BoxSegment,
  type BoxVertex,
  boxFaceSegmentKind,
  boxFacesHolding,
  type PhysicalScale,
  type PrismTopology,
  type ShapeKind,
} from '@diploma-3d/schema';
import {
  type BoxChoices,
  type BoxContext,
  type BoxKeysOf,
  type BoxSolid,
  boxKeysOf,
  pointEdges as faceEdgesOff,
  faceLines,
  type SegmentKey,
  segmentKey,
  segmentName,
  vertexName,
} from './box.ts';

/** The solids of the pilot: a cube, a rectangular and an oblique parallelepiped. */
export const THROUGH_POINT_SOLIDS = ['cube', 'cuboid', 'parallelepiped'] as const;

export type ThroughPointSolid = (typeof THROUGH_POINT_SOLIDS)[number];

export const isThroughPointSolid = (kind: ShapeKind): kind is ThroughPointSolid =>
  (THROUGH_POINT_SOLIDS as readonly string[]).includes(kind);

/** Where M lies on its edge: at the midpoint, or at UM : MV = a : b for the edge's endpoints U, V in their stable order. */
export type PointMode = 'midpoint' | 'ratio';

/**
 * A construction's field that is open, which the model's picking then serves: the segment's, M's or the angle's of a plane through
 * a segment, the face's or a position's of a plane parallel to a face.
 */
export type ConstructionField = 'segment' | 'point' | 'angle' | 'face' | 'position' | 'second-position' | 'diagonal' | 'normal';

/**
 * A segment's endpoints in a stable order by their names, whatever order they were picked or stored in: by the letter, then the
 * lower base's before the upper one's. DD1 is D → D1 and C1D1 is C1 → D1, so that a ratio always reads the same way.
 */
export function canonicalSegment([first, second]: readonly [BoxVertex, BoxVertex]): BoxSegment {
  const rank = (vertex: BoxVertex) => [vertex.charCodeAt(0), vertex.length > 1 ? 1 : 0] as const;
  const [a, b] = [rank(first), rank(second)];
  return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [first, second] : [second, first];
}

const sameSegment = (a: readonly [BoxVertex, BoxVertex], b: readonly [BoxVertex, BoxVertex]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** A segment the plane may pass through: an edge or a face's diagonal, with what it is. */
export interface PilotSegment {
  readonly segment: BoxSegment;
  readonly kind: 'edge' | 'diagonal';
}

/** The pilot's construction as its fields offer it: what each list holds, and the choices in effect. */
export interface ThroughPointSelection {
  /** The edges and the faces' diagonals with some point that gives a usable plane, edges first. */
  readonly segments: readonly PilotSegment[];
  /** The chosen segment, while it is one of them. */
  readonly segment: BoxSegment | undefined;
  /** The edges with some point that gives a usable plane with the segment, in their stable order. */
  readonly pointEdges: readonly BoxSegment[];
  /**
   * The chosen edge of M, any edge of the solid: kept when the segment changes, so that a combination that gives no plane stays
   * on screen to be changed; see `pointEdgeEligible`.
   */
  readonly pointEdge: BoxSegment | undefined;
  /** Whether the chosen edge is one of `pointEdges`. */
  readonly pointEdgeEligible: boolean;
  /** A face that holds the segment and offers that edge: what the specification records, which the geometry does not read. */
  readonly face: BoxFace | undefined;
  readonly mode: PointMode;
}

/**
 * The lines of each face that some plane through a point of another edge divides usably, with those edges: the solid's own, see
 * `boxThroughLineChoices`; while the solid is not valid, every line of each face with every edge off it.
 */
function usableLines(context: BoxContext) {
  const { topology, lines } = context;
  return topology.faceNames.map((face) => ({
    face,
    choices:
      lines?.[face]?.filter((choice) => choice.pointEdges.length > 0) ??
      faceLines(topology, face).map((line) => ({ line, pointEdges: faceEdgesOff(topology, face) })),
  }));
}

/** The segments of the pilot's planes, with their kinds: no body diagonal, which lies in no face. */
export function pilotSegments(context: BoxContext): PilotSegment[] {
  const { topology } = context;
  const found: PilotSegment[] = [];
  for (const { face, choices } of usableLines(context)) {
    for (const { line } of choices) {
      if (found.some(({ segment }) => sameSegment(segment, line))) continue;
      found.push({ segment: canonicalSegment(line), kind: boxFaceSegmentKind(topology, face, line) ?? 'edge' });
    }
  }
  return [...found.filter(({ kind }) => kind === 'edge'), ...found.filter(({ kind }) => kind === 'diagonal')];
}

/** The edges of M for a segment: those of every face that holds it, which some point of gives a usable plane with it. */
export function pilotPointEdges(context: BoxContext, segment: BoxSegment): { edge: BoxSegment; face: BoxFace }[] {
  const found: { edge: BoxSegment; face: BoxFace }[] = [];
  for (const { face, choices } of usableLines(context)) {
    const choice = choices.find(({ line }) => sameSegment(line, segment));
    for (const edge of choice?.pointEdges ?? []) {
      if (!found.some((other) => sameSegment(other.edge, edge))) found.push({ edge: canonicalSegment(edge), face });
    }
  }
  return found;
}

const segmentFrom = (key: SegmentKey | ''): BoxSegment | undefined =>
  key === '' ? undefined : (key.split('-') as unknown as BoxSegment);

/** The pilot's choices in effect, see `ThroughPointSelection`. */
export function throughPointSelection(keys: BoxKeysOf, choices: BoxChoices, context: BoxContext): ThroughPointSelection {
  const segments = pilotSegments(context);
  const chosen = segmentFrom(choices[keys.Line]);
  const segment =
    chosen === undefined ? undefined : segments.find((candidate) => sameSegment(candidate.segment, chosen))?.segment;
  const edges = segment === undefined ? [] : pilotPointEdges(context, segment);
  const chosenEdge = segmentFrom(choices[keys.PointEdge]);
  const pointEdge =
    chosenEdge !== undefined && context.topology.edges.some((edge) => sameSegment(edge, chosenEdge))
      ? canonicalSegment(chosenEdge)
      : undefined;
  const found = pointEdge === undefined ? undefined : edges.find(({ edge }) => sameSegment(edge, pointEdge));
  return {
    segments,
    segment,
    pointEdges: edges.map(({ edge }) => edge),
    pointEdge,
    pointEdgeEligible: found !== undefined,
    face: found?.face ?? (segment === undefined ? undefined : boxFacesHolding(context.topology, segment)[0]),
    mode: choices[keys.PointMode],
  };
}

/** M's share of its edge from U, in percent, for its mode and the parts UM : MV = a : b; undefined without a positive sum. */
export function pointPercentOf(mode: PointMode, first: number | undefined, second: number | undefined): number | undefined {
  if (mode === 'midpoint') return 50;
  if (first === undefined || second === undefined || !(first >= 0) || !(second >= 0) || !(first + second > 0)) return undefined;
  return (100 * first) / (first + second);
}

/** The ratio's labels, the parts of the edge on either side of M: "DM" and "MD₁" for DD₁. */
export const ratioLabels = ([first, second]: BoxSegment): readonly [string, string] => [
  `${vertexName(first)}M`,
  `M${vertexName(second)}`,
];

/** What the pilot's segment is called: "AB₁". */
export const segmentTitle = (segment: BoxSegment | undefined): string | undefined =>
  segment === undefined ? undefined : segmentName(segment);

/** What M is: "Середина DD₁", or "DM : MD₁ = 1 : 2" as typed. */
export function pointTitle(edge: BoxSegment | undefined, mode: PointMode, texts: readonly [string, string]): string | undefined {
  if (edge === undefined) return undefined;
  if (mode === 'midpoint') return `Середина ${segmentName(edge)}`;
  const [left, right] = ratioLabels(edge);
  return `${left} : ${right} = ${texts[0].trim() || '…'} : ${texts[1].trim() || '…'}`;
}

/**
 * The state with a segment chosen, by its endpoints in any order: the face that holds it follows. M stays as it is, its edge,
 * mode and ratio, also where it then gives no plane with the segment: the construction says so, and either may be changed.
 */
export function chooseSegment(kind: BoxSolid, choices: BoxChoices, segment: BoxSegment, context: BoxContext): BoxChoices {
  const keys = boxKeysOf(kind);
  const canonical = canonicalSegment(segment);
  // The face kept while it holds the new segment, as an angle is measured from it; else the segment's first face.
  const faces = boxFacesHolding(context.topology, canonical);
  const face = faces.includes(choices[keys.LineFace]) ? choices[keys.LineFace] : (faces[0] ?? choices[keys.LineFace]);
  return { ...choices, [keys.Line]: segmentKey(canonical), [keys.LineFace]: face } as BoxChoices;
}

/** The state with M's edge chosen, in its stable order; M keeps its mode and its ratio, read along the new edge. */
export function choosePointEdge(kind: BoxSolid, choices: BoxChoices, edge: BoxSegment): BoxChoices {
  const keys = boxKeysOf(kind);
  return { ...choices, [keys.PointEdge]: segmentKey(canonicalSegment(edge)) } as BoxChoices;
}

/** Distances below this share of the solid's size count as none: M on the segment's line, a vertex on the plane. */
const PILOT_TOLERANCE_RELATIVE = 1e-9;

/** Why the pilot's construction gives no section, as its fields say it. */
export type PilotProblem = 'ratio' | 'collinear' | 'face' | 'touching' | 'thin' | 'boundary' | 'angle';

/**
 * The pilot's construction as drafted: a plane that cuts the solid, at M's share of its edge; a choice still to make, said as
 * the next step; a combination that gives no section, said where it can be changed; or unknown while the solid is not valid.
 */
export type PilotDraft =
  /**
   * `percent` is M's share of its edge, a plane's position from its face, or the turn θ of a plane at an angle from its reference
   * face; `secondPercent` a second parallel plane's position; `alternative` whether the other plane at that angle cuts the solid.
   */
  | { readonly status: 'valid'; readonly percent: number; readonly secondPercent?: number; readonly alternative?: boolean }
  | { readonly status: 'incomplete'; readonly message: string }
  /** `position`: which plane's position the problem is said at, for a plane parallel to a face; the first one otherwise. */
  | {
      readonly status: 'invalid';
      readonly problem: PilotProblem;
      readonly message: string;
      readonly position?: 'first' | 'second';
      readonly alternative?: boolean;
    }
  | { readonly status: 'unresolved' };

export const PILOT_MESSAGES = {
  segment: 'Оберіть відрізок: ребро або діагональ грані.',
  pointEdge: 'Оберіть ребро для точки M.',
  zeroRatio: 'Обидві частини відношення не можуть бути нулями: їхня сума має бути більшою за 0.',
  collinear: 'Точка M лежить на прямій вибраного відрізка, тож площину не визначено. Оберіть інше ребро або положення точки.',
  face: 'Площина збігається з гранню. Оберіть інше ребро або положення точки M.',
  touching: 'Площина лише дотикається до тіла й не розтинає його. Оберіть інше ребро або положення точки M.',
} as const;

type Vec = readonly [number, number, number];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (from: Vec, to: Vec, t: number): Vec => [
  from[0] + t * (to[0] - from[0]),
  from[1] + t * (to[1] - from[1]),
  from[2] + t * (to[2] - from[2]),
];

/**
 * Where the plane through the segment and M stands to a convex solid: M on the segment's line fixes no plane; otherwise the
 * plane cuts the solid exactly when vertices lie strictly on both of its sides. With all of them on one side it holds a whole
 * face, when every corner of one lies on it, or else only touches the solid along an edge or at a vertex. Scale-free: the
 * distances are compared with the solid's size.
 */
export function pilotPlaneKind(
  shape: BoxLikeShape,
  topology: PrismTopology,
  segment: BoxSegment,
  pointEdge: BoxSegment,
  percent: number,
): 'cut' | 'collinear' | 'face' | 'touching' {
  const vertices = boxVertices(shape, { longestDimensionMm: 100 });
  const names = Object.keys(vertices) as BoxVertex[];
  const size = Math.max(...names.flatMap((p) => names.map((q) => Math.hypot(...minus(vertices[p], vertices[q])))));
  const tolerance = PILOT_TOLERANCE_RELATIVE * size;
  const [a, b] = [vertices[segment[0]], vertices[segment[1]]];
  const m = along(vertices[pointEdge[0]], vertices[pointEdge[1]], percent / 100);
  const direction = minus(b, a);
  const normal = cross(direction, minus(m, a));
  // |(M − A) × (B − A)| / |B − A| is M's distance from the line AB.
  const length = Math.hypot(...normal);
  if (length / Math.hypot(...direction) <= tolerance) return 'collinear';
  return planeContact(vertices, topology, normal, a).kind;
}

/**
 * How a plane, by a normal and a point of it, meets a convex solid: it cuts it exactly when vertices lie strictly on both of its
 * sides; with all of them on one side it holds a whole face, when every corner of one lies on it, or else only touches the solid
 * along an edge or at a vertex. The distances are compared with the solid's size, so that the answer does not depend on scale.
 */
export function planeContact(
  vertices: Readonly<Record<BoxVertex, Vec>>,
  topology: PrismTopology,
  normal: Vec,
  point: Vec,
): { readonly kind: 'cut' } | { readonly kind: 'face'; readonly face: BoxFace } | { readonly kind: 'touching' } {
  const names = Object.keys(vertices) as BoxVertex[];
  const size = Math.max(...names.flatMap((p) => names.map((q) => Math.hypot(...minus(vertices[p], vertices[q])))));
  const tolerance = PILOT_TOLERANCE_RELATIVE * size;
  const length = Math.hypot(...normal);
  const unit: Vec = [normal[0] / length, normal[1] / length, normal[2] / length];
  const sides = names.map((name) => dot(unit, minus(vertices[name], point)));
  if (sides.some((side) => side > tolerance) && sides.some((side) => side < -tolerance)) return { kind: 'cut' };
  const on = new Set(names.filter((_, index) => Math.abs(sides[index] as number) <= tolerance));
  const face = topology.faceNames.find((name) => (topology.faces[name] ?? []).every((corner) => on.has(corner)));
  return face === undefined ? { kind: 'touching' } : { kind: 'face', face };
}

/**
 * The pilot's construction from its choices and fields, checked before any plane is made: a segment and M's edge chosen, a
 * ratio of two numbers not both zero, M off the segment's line, and a plane that cuts the solid. Whether the parts are thick
 * enough to print is the section's own check, at the export's scale. `ratioErrors` are the ratio fields' own messages.
 */
export function pilotDraft(
  keys: BoxKeysOf,
  choices: BoxChoices,
  values: Readonly<Record<string, number | undefined>>,
  context: BoxContext,
  ratioErrors: Readonly<Record<string, string | undefined>> = {},
): PilotDraft {
  const { segment, pointEdge, mode } = throughPointSelection(keys, choices, context);
  if (segment === undefined) return { status: 'incomplete', message: PILOT_MESSAGES.segment };
  if (pointEdge === undefined) return { status: 'incomplete', message: PILOT_MESSAGES.pointEdge };
  if (mode === 'ratio') {
    const error = ratioErrors[keys.PointRatioFirst] ?? ratioErrors[keys.PointRatioSecond];
    if (error !== undefined) return { status: 'invalid', problem: 'ratio', message: error };
  }
  const percent = pointPercentOf(mode, values[keys.PointRatioFirst], values[keys.PointRatioSecond]);
  if (percent === undefined) return { status: 'invalid', problem: 'ratio', message: PILOT_MESSAGES.zeroRatio };
  if (context.shape === undefined) return { status: 'unresolved' };
  const kind = pilotPlaneKind(context.shape, context.topology, segment, pointEdge, percent);
  return kind === 'cut' ? { status: 'valid', percent } : { status: 'invalid', problem: kind, message: PILOT_MESSAGES[kind] };
}

/**
 * The construction as drafted, which the view draws over the model at once: what is chosen, and, for a draft that gives a section,
 * the plane's specification with its second parallel plane, from which the section is computed in the same update as M.
 */
export interface ConstructionDraft {
  /** The face a plane parallel to a face is measured from. */
  readonly face?: BoxFace | undefined;
  readonly segment: BoxSegment | undefined;
  readonly pointEdge: BoxSegment | undefined;
  /** Whether M's edge gives a section with the segment for some position; see `ThroughPointSelection`. */
  readonly pointEdgeEligible: boolean;
  /** M's share of its edge from its first vertex, in percent, while the ratio is valid. */
  readonly percent: number | undefined;
  /** The plane of a valid draft: `boxSection`'s own input, the second plane's position included where there is one. */
  readonly plane: Extract<BoxSectionSpec, { type: 'through-line' | 'face-parallel' | 'longitudinal' }> | undefined;
}

/**
 * The draft of the choices in effect, for the view; see `ConstructionDraft`. `secondPercent` is the second parallel plane's valid
 * position, where one is chosen.
 */
export function constructionDraftOf(
  keys: BoxKeysOf,
  selection: ThroughPointSelection,
  values: Readonly<Record<string, number | undefined>>,
  draft: PilotDraft | undefined,
  secondPercent: number | undefined,
): ConstructionDraft {
  const { segment, pointEdge, pointEdgeEligible, mode, face } = selection;
  const percent =
    pointEdge === undefined ? undefined : pointPercentOf(mode, values[keys.PointRatioFirst], values[keys.PointRatioSecond]);
  const plane =
    draft?.status !== 'valid' || segment === undefined || pointEdge === undefined || face === undefined
      ? undefined
      : {
          type: 'through-line' as const,
          face,
          line: segment,
          method: 'point' as const,
          pointEdge,
          pointPercent: draft.percent,
          ...(secondPercent === undefined ? {} : { secondPositionPercent: secondPercent }),
        };
  return { segment, pointEdge, pointEdgeEligible, percent, plane };
}

/**
 * The display-only geometry of the pilot's construction, in the preview's glTF coordinates, on the solid shown: its own vertices
 * and edges, its faces' outward normals for telling hidden edges and vertices, the drafted segment, M's edge and M, and the
 * sections' corners. The corners are `boxSection`'s, of the very plane through the drafted segment and M, so that all of them
 * change together, whatever model is still being built. Never a printed object, a cutting tool or a connector's input.
 */
export interface ConstructionGeometry {
  readonly vertices: readonly BoxVertex[];
  readonly points: Readonly<Record<string, readonly [number, number, number]>>;
  readonly edges: readonly {
    readonly key: SegmentKey;
    readonly ends: readonly [BoxVertex, BoxVertex];
    readonly faces: readonly number[];
  }[];
  readonly faces: readonly {
    readonly name: BoxFace;
    readonly corners: readonly BoxVertex[];
    readonly normal: readonly [number, number, number];
    readonly point: readonly [number, number, number];
  }[];
  /** The face a plane parallel to a face is measured from, while that is the construction. */
  readonly referenceFace: BoxFace | undefined;
  /** The faces each vertex lies on, by their indices in `faces`: a vertex all of whose faces turn away is hidden. */
  readonly vertexFaces: Readonly<Record<string, readonly number[]>>;
  readonly segment: { readonly ends: readonly [BoxVertex, BoxVertex]; readonly diagonal: boolean } | undefined;
  readonly pointEdge: { readonly ends: readonly [BoxVertex, BoxVertex]; readonly eligible: boolean } | undefined;
  /** The id of M among `points`, where it is defined. */
  readonly m: string | undefined;
  /** The corners of the first section and of the second parallel one, by their ids among `points`; none without a plane. */
  readonly sections: readonly (readonly string[])[];
}

export function constructionGeometry(
  shape: BoxLikeShape,
  scale: PhysicalScale,
  draft: ConstructionDraft,
): ConstructionGeometry | undefined {
  if (!isThroughPointSolid(shape.kind)) return undefined;
  const vertices = boxVertices(shape, scale);
  const names = Object.keys(vertices) as BoxVertex[];
  // A cube's and a parallelepiped's: the quadrilateral prism's vertices, edges and faces.
  const topology: PrismTopology = BOX_TOPOLOGY;
  const points: Record<string, readonly [number, number, number]> = {};
  for (const name of names) points[name] = toGltfPosition(vertices[name]);
  const centre = names.reduce<[number, number, number]>(
    (sum, name) => [
      sum[0] + vertices[name][0] / names.length,
      sum[1] + vertices[name][1] / names.length,
      sum[2] + vertices[name][2] / names.length,
    ],
    [0, 0, 0],
  );
  const faces = topology.faceNames.map((face) => {
    const corners = (topology.faces[face] ?? []).map((name) => vertices[name]);
    // Newell's sum, turned away from the solid's centre.
    const normal: [number, number, number] = [0, 0, 0];
    corners.forEach((point, index) => {
      const next = corners[(index + 1) % corners.length] as typeof point;
      normal[0] += (point[1] - next[1]) * (point[2] + next[2]);
      normal[1] += (point[2] - next[2]) * (point[0] + next[0]);
      normal[2] += (point[0] - next[0]) * (point[1] + next[1]);
    });
    const first = corners[0] as (typeof corners)[number];
    const outward =
      normal[0] * (first[0] - centre[0]) + normal[1] * (first[1] - centre[1]) + normal[2] * (first[2] - centre[2]) >= 0 ? 1 : -1;
    return {
      name: face,
      corners: topology.faces[face] ?? [],
      normal: [normal[0] * outward, normal[2] * outward, -normal[1] * outward] as const,
      point: toGltfPosition(first),
    };
  });
  const edges = topology.edges.map((edge) => {
    const ends = canonicalSegment(edge);
    return {
      key: segmentKey(ends),
      ends,
      faces: boxFacesHolding(topology, edge).map((face) => topology.faceNames.indexOf(face)),
    };
  });
  const vertexFaces = Object.fromEntries(
    names.map((name) => [
      name,
      topology.faceNames.flatMap((face, index) => ((topology.faces[face] ?? []).includes(name) ? [index] : [])),
    ]),
  );
  const { segment, pointEdge, percent, plane } = draft;
  let m: string | undefined;
  if (pointEdge !== undefined && percent !== undefined) {
    points.M = toGltfPosition(along(vertices[pointEdge[0]], vertices[pointEdge[1]], percent / 100));
    m = 'M';
  }
  const sections: string[][] = [];
  if (plane !== undefined) {
    const cuts =
      plane.secondPositionPercent === undefined ? [{ box: plane }] : [{ box: plane }, { box: plane, atSecond: true as const }];
    try {
      for (const [index, cut] of cuts.entries()) {
        const { contour } = boxSection(shape, scale, cut);
        sections.push(
          contour.map((corner, cornerIndex) => {
            const id = `S${index}-${cornerIndex}`;
            points[id] = toGltfPosition(corner);
            return id;
          }),
        );
      }
    } catch {
      // A plane valid for the solid being built but not for the one still shown: no section on it until that one is replaced.
      sections.length = 0;
    }
  }
  return {
    vertices: names,
    points,
    edges,
    faces,
    referenceFace: draft.face,
    vertexFaces,
    segment: segment === undefined ? undefined : { ends: segment, diagonal: boxFacesHolding(topology, segment).length === 1 },
    pointEdge: pointEdge === undefined ? undefined : { ends: pointEdge, eligible: draft.pointEdgeEligible },
    m,
    sections,
  };
}

/** The model's elements by name for the lists: edges and the faces' diagonals, each with its kind. */
export const segmentOptionLabel = ({ segment, kind }: PilotSegment): string =>
  `${segmentName(segment)} — ${kind === 'edge' ? 'ребро' : 'діагональ грані'}`;

/** The vertices that complete a segment with the first one picked: those sharing a face with it that give a usable segment. */
export function eligibleSecondVertices(segments: readonly PilotSegment[], first: BoxVertex): BoxVertex[] {
  return segments.flatMap(({ segment }) => (segment[0] === first ? [segment[1]] : segment[1] === first ? [segment[0]] : []));
}

/** What the construction view shows and what a tap may choose: the model's geometry and the page's state of the construction. */
export type ConstructionView = {
  readonly geometry: ConstructionGeometry;
  /** The field open, whose elements a tap chooses; none while the view only shows a construction that gives no section. */
  readonly field: ConstructionField | undefined;
  /** A first vertex picked, waiting for a second one. */
  readonly pending: BoxVertex | undefined;
  /** What a tap may choose now: vertices, edges and other lines by their stable keys, and faces. */
  readonly vertexTargets: readonly BoxVertex[];
  readonly edgeTargets: readonly SegmentKey[];
  readonly faceTargets: readonly BoxFace[];
  /**
   * Lines between vertices drawn besides the solid's edges, such as the base diagonals a longitudinal plane may pass through:
   * offered, chosen, or chosen and lying in the plane. A tap chooses one as it chooses an edge, by its key.
   */
  readonly lines?: readonly {
    readonly key: SegmentKey;
    readonly ends: readonly [BoxVertex, BoxVertex];
    readonly state: 'candidate' | 'selected' | 'in-plane';
  }[];
};

export type ConstructionPick =
  | { readonly kind: 'vertex'; readonly vertex: BoxVertex }
  | { readonly kind: 'edge'; readonly edge: SegmentKey }
  | { readonly kind: 'face'; readonly face: BoxFace };

/** Set on the viewer while the mouse is over an element a tap would choose, which then shows the pointer cursor. */
export const CONSTRUCTION_HOVER_ATTRIBUTE = 'data-construction-hover';

/**
 * What a tap may choose in the construction view now: for the segment, every vertex of a usable segment and, with a first vertex
 * picked, the vertices that complete one with it, and the edges that are usable segments; for M, the edges with a usable point.
 */
export function constructionTargets(
  field: ConstructionField | undefined,
  selection: ThroughPointSelection,
  pending: BoxVertex | undefined,
): { readonly vertexTargets: BoxVertex[]; readonly edgeTargets: SegmentKey[]; readonly faceTargets: BoxFace[] } {
  if (field !== 'segment' && field !== 'point') return { vertexTargets: [], edgeTargets: [], faceTargets: [] };
  if (field === 'point') return { vertexTargets: [], edgeTargets: selection.pointEdges.map(segmentKey), faceTargets: [] };
  const vertices = [...new Set(selection.segments.flatMap(({ segment }) => segment))];
  return {
    vertexTargets: pending === undefined ? vertices : [pending, ...eligibleSecondVertices(selection.segments, pending)],
    edgeTargets: selection.segments.filter(({ kind }) => kind === 'edge').map(({ segment }) => segmentKey(segment)),
    faceTargets: [],
  };
}
