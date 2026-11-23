import {
  type BoxLikeShape,
  type BoxLineChoice,
  type BoxTraceChoices,
  type BoxVertexTrace,
  boxFaceLines,
  boxFaceOrientations,
  boxPointEdges,
  boxThroughLineChoices,
  boxTraceChoices,
  boxVertices,
} from '@diploma-3d/engine';
import {
  type BoxFace,
  type BoxSectionSpec,
  type BoxSegment,
  type BoxVertex,
  boxFaceSegmentKind,
  boxFacesHolding,
  type ConnectorProfile,
  DEFAULT_CONNECTOR_PROFILE,
  DEFAULT_ROUND_CONNECTOR,
  type DovetailEntrance,
  type ModelSpecInput,
  type PrismTopology,
  PYRAMID_APEX,
  prismTopology,
  pyramidTopology,
  type ShapeKind,
} from '@diploma-3d/schema';
import type { ConnectorChoice, ParameterChoices, ParameterValues, SectionChoice } from './parameters.ts';

/**
 * The solids whose sections are planes through their named vertices: a cube, the parallelepipeds and the prisms, each a prism
 * over its base with 2n vertices, and the pyramids and the tetrahedron, each a pyramid with n + 1; see `PrismTopology`.
 */
export const BOX_SOLIDS = ['cube', 'cuboid', 'parallelepiped', 'prism', 'pyramid', 'tetrahedron'] as const;

export type BoxSolid = (typeof BOX_SOLIDS)[number];

export const isBoxSolid = (kind: ShapeKind): kind is BoxSolid => (BOX_SOLIDS as readonly string[]).includes(kind);

/** The numeric fields of a box's sections and connector, each solid with its own, as every other solid has. */
export const BOX_NUMBER_FIELDS = [
  'SectionPercent',
  'SectionSecondPercent',
  'TraceAngleDeg',
  'LineAngleDeg',
  'PointPercent',
  'TracePointPercent',
  'PlaneInclinationDeg',
  'PlaneDirectionDeg',
  'DovetailSize',
  'DovetailLengthPercent',
  'DovetailClearanceMm',
  'RoundSpacingPercent',
  'RoundDiameter',
  'RoundDepth',
  'PlugClearanceMm',
  'DowelLowerClearanceMm',
  'DowelUpperClearanceMm',
] as const;

export type BoxNumberField = (typeof BOX_NUMBER_FIELDS)[number];

export type BoxNumberKey = `${BoxSolid}${BoxNumberField}`;

/** A segment between two vertices as a choice stores it, e.g. "A-C1". */
export type SegmentKey = `${BoxVertex}-${BoxVertex}`;

/**
 * Where a longitudinal plane's trace on the base runs: at an angle to AB, or along a line of the base, a diagonal, or for a
 * triangle the median, altitude or bisector from a vertex or a midline.
 */
export type TraceChoice = 'angle' | 'diagonal' | BoxVertexTrace | 'midline' | 'edge-point' | 'height-edge';

/** Two segments as a choice stores them, e.g. "S-A|B-C". */
export type PairKey = `${SegmentKey}|${SegmentKey}`;

/** The choices of a box's sections: what each mode is built on, and the connector's choices as other solids have them. */
type BoxChoiceFields = {
  Section: SectionChoice;
  Face: BoxFace;
  Trace: TraceChoice;
  /** The diagonal of a diagonal trace, or the side a midline is parallel to. */
  TraceSegment: SegmentKey;
  /** The vertex of a median, an altitude or a bisector. */
  TraceVertex: BoxVertex;
  /** Whether the plane passes through the trace's line itself, as its position field then shows; see `followTrace`. */
  TraceThrough: boolean;
  /** The position text that passing through the line last set, by which an edit of the field is told from it. */
  TraceThroughText: string;
  /** The trace's line last brought through, by kind and reference; another one is passed through when chosen. */
  TraceFor: string;
  LineFace: BoxFace;
  Line: SegmentKey;
  LineMethod: 'angle' | 'point';
  PointEdge: SegmentKey;
  /** 'none' for a plane given by its angles, otherwise the segment its normal runs along. */
  NormalAlong: 'none' | SegmentKey;
  /** 'none', or a pair of opposite edges of a triangular pyramid that the plane is parallel to. */
  ParallelEdges: 'none' | PairKey;
  /**
   * The segment the plane was last perpendicular to, or the pair it was last parallel to, by which giving it by its angles again
   * keeps it; see `followNormal`.
   */
  NormalFrom: '' | SegmentKey | PairKey;
  Connector: ConnectorChoice;
  DovetailEntrance: DovetailEntrance;
  RoundCount: 1 | 2;
  RoundProfile: ConnectorProfile;
  PartsSeparated: boolean;
  SecondCut: boolean;
  /** The line, by face and segment, whose angle was last set to the middle of its usable angles; see `startLineAngle`. */
  LineAngleFor: string;
  /** The line and the point's edge whose point was last brought within its usable positions; see `startPoint`. */
  PointFor: string;
};

export type BoxChoiceField = keyof BoxChoiceFields;

export type BoxChoices = {
  [Key in `${BoxSolid}${BoxChoiceField}`]: Key extends `${BoxSolid}${infer Field extends BoxChoiceField}`
    ? BoxChoiceFields[Field]
    : never;
};

export const boxKeysOf = (solid: BoxSolid) =>
  Object.fromEntries(
    [...BOX_NUMBER_FIELDS, ...BOX_CHOICE_FIELDS].map((field) => [field, `${solid}${field}`]),
  ) as unknown as BoxKeysOf;

export const BOX_CHOICE_FIELDS = [
  'Section',
  'Face',
  'Trace',
  'TraceSegment',
  'TraceVertex',
  'TraceThrough',
  'TraceThroughText',
  'TraceFor',
  'LineFace',
  'Line',
  'LineMethod',
  'PointEdge',
  'NormalAlong',
  'ParallelEdges',
  'NormalFrom',
  'Connector',
  'DovetailEntrance',
  'RoundCount',
  'RoundProfile',
  'PartsSeparated',
  'SecondCut',
  'LineAngleFor',
  'PointFor',
] as const satisfies readonly BoxChoiceField[];

/** One solid's keys, each a key of every box solid so that the code that reads them serves them all. */
export type BoxKeysOf = {
  readonly [Field in BoxNumberField]: `${BoxSolid}${Field}`;
} & {
  readonly [Field in BoxChoiceField]: `${BoxSolid}${Field}`;
};

export const segmentKey = ([first, second]: readonly [BoxVertex, BoxVertex]): SegmentKey => `${first}-${second}`;

export const segmentOf = (key: SegmentKey): BoxSegment => key.split('-') as BoxSegment;

/** A vertex as a textbook writes it, A₁ for A1. */
export const vertexName = (vertex: BoxVertex): string => vertex.replace('1', '₁');

export const segmentName = ([first, second]: readonly [BoxVertex, BoxVertex]): string =>
  `${vertexName(first)}${vertexName(second)}`;

export const faceName = (topology: PrismTopology, face: BoxFace): string => (topology.faces[face] ?? []).map(vertexName).join('');

/** What a face is to the solid: a base or a lateral face. */
export const faceRole = (topology: PrismTopology, face: BoxFace): string =>
  face === topology.lowerBase
    ? topology.kind === 'pyramid'
      ? 'основа'
      : 'нижня основа'
    : face === topology.upperBase
      ? 'верхня основа'
      : 'бічна грань';

/** The edges and the diagonals of a face, edges first, in the order around it. */
export const faceLines = boxFaceLines;

/** The edges a point of a plane through a face's line may lie on: those that leave the face. */
export const pointEdges = boxPointEdges;

/**
 * The segments a plane may be perpendicular to: a prism's lateral edges as one, as they are all parallel, and its bases' edges, a
 * pyramid's edges each; the faces' diagonals, which a pyramid's triangular lateral faces do not have; and the body diagonals,
 * which join vertices on no common face, and which a triangular prism and a pyramid do not have.
 */
export function allSegments(
  topology: PrismTopology,
): { readonly segment: BoxSegment; readonly kind: 'lateral' | 'edge' | 'face' | 'body' }[] {
  const { lateralEdges: lateral } = topology;
  const faceDiagonals = topology.faceNames.flatMap((face) =>
    faceLines(topology, face).filter((line) => boxFaceSegmentKind(topology, face, line) === 'diagonal'),
  );
  const bodyDiagonals = topology.vertices.flatMap((first, index) =>
    topology.vertices
      .slice(index + 1)
      .filter((second) => boxFacesHolding(topology, [first, second]).length === 0)
      .map((second): BoxSegment => [first, second]),
  );
  // A prism's lateral edges are parallel and give one plane; a pyramid's meet at its apex, each its own.
  const edges =
    topology.kind === 'prism'
      ? [
          { segment: lateral[0] as BoxSegment, kind: 'lateral' as const },
          ...topology.edges.slice(0, 2 * topology.sides).map((segment) => ({ segment, kind: 'edge' as const })),
        ]
      : topology.edges.map((segment) => ({ segment, kind: 'edge' as const }));
  return [
    ...edges,
    ...faceDiagonals.map((segment) => ({ segment, kind: 'face' as const })),
    ...bodyDiagonals.map((segment) => ({ segment, kind: 'body' as const })),
  ];
}

/** The texts of a segment as an option: the lateral edges, an edge, a face's diagonal or the solid's own. */
export const segmentLabel = (segment: BoxSegment, kind: 'lateral' | 'edge' | 'face' | 'body'): string =>
  kind === 'lateral'
    ? 'Бічні ребра'
    : `${kind === 'edge' ? 'Ребро' : kind === 'face' ? 'Діагональ грані' : 'Діагональ тіла'} ${segmentName(segment)}`;

const sameSegment = (a: readonly [BoxVertex, BoxVertex], b: readonly [BoxVertex, BoxVertex]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** Each face's lines that some usable plane passes through, with the edges whose points give one; see `boxThroughLineChoices`. */
export type ThroughLineChoices = Readonly<Record<BoxFace, readonly BoxLineChoice[]>>;

/**
 * What the fields of a box's sections know of its solid: its topology, from the choices even while a value is not valid, and for
 * a valid solid the choices that lead to usable planes, see `boxThroughLineChoices` and `boxTraceChoices`, and the groups of
 * parallel faces, see `boxFaceOrientations`.
 */
export interface BoxContext {
  readonly topology: PrismTopology;
  readonly shape: BoxLikeShape | undefined;
  readonly lines: ThroughLineChoices | undefined;
  readonly traces: BoxTraceChoices | undefined;
  readonly orientations: Readonly<Record<BoxFace, BoxFace>> | undefined;
  /** A prism over a regular polygon, whose diagonals fall into classes by length. */
  readonly regular: boolean;
}

type BaseChoices = Pick<ParameterChoices, 'prismBaseType' | 'prismBaseSides' | 'pyramidBaseType' | 'pyramidBaseSides'>;

/** The vertices, faces and edges the choices give a solid: a prism's or a pyramid's over its chosen base, a box's four. */
export function boxTopologyFor(kind: BoxSolid, choices: BaseChoices): PrismTopology {
  switch (kind) {
    case 'prism':
      return prismTopology(
        choices.prismBaseType === 'regular' ? choices.prismBaseSides : choices.prismBaseType === 'triangle' ? 3 : 4,
      );
    case 'pyramid':
      return pyramidTopology(
        choices.pyramidBaseType === 'regular' ? choices.pyramidBaseSides : choices.pyramidBaseType === 'triangle' ? 3 : 4,
      );
    case 'tetrahedron':
      return pyramidTopology(3);
    default:
      return prismTopology(4);
  }
}

let lastContext: { readonly key: string; readonly context: BoxContext } | undefined;

/**
 * The context of a solid; the last one's kept, as every field change asks again. A shape of another kind, or one whose base
 * does not match the choices, is no shape here.
 */
export function boxContextOf(kind: BoxSolid, choices: BaseChoices, shape: { readonly kind: string } | undefined): BoxContext {
  const topology = boxTopologyFor(kind, choices);
  const regular =
    (kind === 'prism' && choices.prismBaseType === 'regular') ||
    (kind === 'pyramid' && choices.pyramidBaseType === 'regular') ||
    kind === 'tetrahedron';
  const valid =
    shape !== undefined &&
    shape.kind === kind &&
    Object.keys(boxVertices(shape as BoxLikeShape, UNIT_SCALE)).length === topology.vertices.length;
  if (!valid) return { topology, shape: undefined, lines: undefined, traces: undefined, orientations: undefined, regular };
  const key = JSON.stringify(shape);
  if (lastContext?.key !== key) {
    const solid = shape as BoxLikeShape;
    lastContext = {
      key,
      context: {
        topology,
        shape: solid,
        lines: boxThroughLineChoices(solid),
        traces: boxTraceChoices(solid),
        orientations: boxFaceOrientations(boxVertices(solid, UNIT_SCALE)),
        regular,
      },
    };
  }
  return lastContext.context;
}

// The choices follow the proportional rule, which does not depend on the scale.
const UNIT_SCALE = { longestDimensionMm: 100 };

/** The context of the solid of these values and choices. */
export const boxContextFrom = (kind: BoxSolid, values: ParameterValues, choices: ParameterChoices): BoxContext =>
  boxContextOf(kind, choices, boxShapeOf(kind, values, choices));

/** A plane through a line as the fields offer it: what each list holds now, and the choice in effect in each. */
export interface ThroughLineSelection {
  readonly faces: readonly BoxFace[];
  readonly face: BoxFace;
  readonly lines: readonly BoxSegment[];
  readonly line: BoxSegment;
  readonly methods: readonly ('angle' | 'point')[];
  readonly method: 'angle' | 'point';
  readonly pointEdges: readonly BoxSegment[];
  readonly pointEdge: BoxSegment;
}

/**
 * Each list of a plane through a line holds only the choices that some usable plane continues, given those before it: a face
 * with a usable line, its lines with a usable angle, the point only where some edge has a usable point, and those edges. A
 * choice still offered stays; one no longer offered gives way to the first one that is, in the list's order. While the solid
 * is not valid, the lists are the face's own lines and the edges off it.
 */
export function throughLineSelection(
  keys: BoxKeysOf,
  choices: Pick<BoxChoices, `${BoxSolid}${'LineFace' | 'Line' | 'LineMethod' | 'PointEdge'}`>,
  context: BoxContext,
): ThroughLineSelection {
  const { topology, lines: available } = context;
  // A pyramid's plane through a line is one through an edge of its base: through a lateral edge it passes through the apex.
  const pyramid = topology.kind === 'pyramid';
  const allFaces = pyramid ? [topology.lowerBase] : topology.faceNames;
  const usableFaces = available === undefined ? allFaces : allFaces.filter((face) => (available[face] ?? []).length > 0);
  const faces = usableFaces.length > 0 ? usableFaces : allFaces;
  const face = faces.includes(choices[keys.LineFace]) ? choices[keys.LineFace] : (faces[0] as BoxFace);
  const lineChoices = available?.[face];
  const offered =
    lineChoices === undefined || lineChoices.length === 0 ? faceLines(topology, face) : lineChoices.map(({ line }) => line);
  const lines = pyramid ? offered.filter((line) => boxFaceSegmentKind(topology, face, line) === 'edge') : offered;
  const chosenLine = segmentOf(choices[keys.Line]);
  const line = lines.find((candidate) => sameSegment(candidate, chosenLine)) ?? (lines[0] as BoxSegment);
  const edges =
    available === undefined
      ? pointEdges(topology, face)
      : (lineChoices?.find((choice) => sameSegment(choice.line, line))?.pointEdges ?? []);
  const methods = edges.length > 0 ? (['angle', 'point'] as const) : (['angle'] as const);
  const method = (methods as readonly string[]).includes(choices[keys.LineMethod]) ? choices[keys.LineMethod] : 'angle';
  const chosenEdge = segmentOf(choices[keys.PointEdge]);
  const pointEdge =
    edges.find((candidate) => sameSegment(candidate, chosenEdge)) ??
    (edges[0] as BoxSegment | undefined) ??
    (pointEdges(topology, face)[0] as BoxSegment);
  return { faces, face, lines, line, methods, method, pointEdges: edges, pointEdge };
}

/**
 * A plane parallel to a face as the fields offer it: one face of each group of parallel faces, see `boxFaceOrientations`, the
 * lower base and every lateral face while the solid is not valid; and the face in effect, the chosen one while the solid has
 * it, as an earlier choice of a face parallel to a representative is converted to that one by `settleBoxChoices`, otherwise
 * the lower base.
 */
export function faceSelection(
  keys: BoxKeysOf,
  choices: Pick<BoxChoices, `${BoxSolid}Face`>,
  context: BoxContext,
): { readonly faces: readonly BoxFace[]; readonly face: BoxFace } {
  const { topology, orientations } = context;
  const faces =
    orientations === undefined
      ? topology.faceNames.filter((face) => face !== topology.upperBase)
      : topology.faceNames.filter((face) => orientations[face] === face);
  const chosen = choices[keys.Face];
  return { faces, face: topology.faces[chosen] === undefined ? topology.lowerBase : chosen };
}

/**
 * The segment an inclined plane is perpendicular to, as the fields offer it: 'none' for a plane given by its angles, which is
 * also what a segment between vertices the solid lacks gives way to; any lateral edge is the lateral edges, AA1, as they are
 * all parallel.
 */
export function normalSelection(
  keys: BoxKeysOf,
  choices: Pick<BoxChoices, `${BoxSolid}NormalAlong`>,
  context: BoxContext,
): 'none' | SegmentKey {
  const along = choices[keys.NormalAlong];
  if (along === 'none') return 'none';
  const [first, second] = segmentOf(along);
  if (!context.topology.vertices.includes(first) || !context.topology.vertices.includes(second)) return 'none';
  return context.topology.kind === 'prism' && first.length === 1 && second === `${first}1` ? 'A-A1' : along;
}

/** A longitudinal plane's trace as the fields offer it: the kinds of line, and the diagonal, side or vertex in effect. */
export interface TraceSelection {
  readonly kinds: readonly TraceChoice[];
  readonly kind: TraceChoice;
  /** The diagonals of a diagonal trace, the sides of a midline. */
  readonly segments: readonly BoxSegment[];
  readonly segment: BoxSegment | undefined;
  readonly vertices: readonly BoxVertex[];
  readonly vertex: BoxVertex | undefined;
  /** An equilateral base: the median, the altitude and the bisector from each vertex are one line, offered once. */
  readonly equilateral: boolean;
  /** The lines from the vertex in effect that coincide with each other. */
  readonly sameLines: readonly BoxVertexTrace[];
}

/**
 * The kinds of trace a base offers and their references, only those that lead to a usable plane through the line: a diagonal
 * for a base of four or more vertices, the lines of a triangle for a triangle. A choice still offered stays; one no longer
 * offered gives way to the first one that is, and a kind without any to the angle. While the solid is not valid, a base's
 * structure alone decides.
 */
export function traceSelection(
  keys: BoxKeysOf,
  choices: Pick<BoxChoices, `${BoxSolid}${'Trace' | 'TraceSegment' | 'TraceVertex'}`>,
  context: BoxContext,
): TraceSelection {
  const { topology, traces } = context;
  const base = topology.faces[topology.lowerBase] ?? [];
  const triangle = topology.sides === 3;
  const lines = faceLines(topology, topology.lowerBase);
  const diagonals =
    traces?.diagonal ?? lines.filter((line) => boxFaceSegmentKind(topology, topology.lowerBase, line) === 'diagonal');
  const verticesOf = (kind: BoxVertexTrace) => (traces === undefined ? (triangle ? base : []) : traces[kind]);
  const sides = traces?.midline ?? (triangle ? lines : []);
  const equilateral = triangle && traces !== undefined && base.every((vertex) => (traces.sameLines[vertex] ?? []).length === 3);
  // A pyramid's own lines: through a lateral edge SV and a point of a base edge, or through SV and the pyramid's height.
  const pyramid = topology.kind === 'pyramid';
  const baseEdges = lines.filter((line) => boxFaceSegmentKind(topology, topology.lowerBase, line) === 'edge');
  const edgesFor = (vertex: BoxVertex): readonly BoxSegment[] =>
    traces === undefined ? baseEdges.filter((edge) => !edge.includes(vertex)) : (traces.edgePoint[vertex] ?? []);
  const edgePointVertices = pyramid ? base.filter((vertex) => edgesFor(vertex).length > 0) : [];
  const heightEdgeVertices = pyramid ? (traces?.heightEdge ?? base) : [];
  const kinds: TraceChoice[] = [
    'angle',
    ...(diagonals.length > 0 ? (['diagonal'] as const) : []),
    ...(verticesOf('median').length > 0 ? (['median'] as const) : []),
    ...(!equilateral && verticesOf('height').length > 0 ? (['height'] as const) : []),
    ...(!equilateral && verticesOf('bisector').length > 0 ? (['bisector'] as const) : []),
    ...(sides.length > 0 ? (['midline'] as const) : []),
    ...(edgePointVertices.length > 0 ? (['edge-point'] as const) : []),
    ...(heightEdgeVertices.length > 0 ? (['height-edge'] as const) : []),
  ];
  const chosen = choices[keys.Trace];
  // In an equilateral base the altitude and the bisector from a vertex are its median.
  const wanted = equilateral && (chosen === 'height' || chosen === 'bisector') ? 'median' : chosen;
  const kind = kinds.includes(wanted) ? wanted : 'angle';
  const vertices =
    kind === 'median' || kind === 'height' || kind === 'bisector'
      ? verticesOf(kind)
      : kind === 'edge-point'
        ? edgePointVertices
        : kind === 'height-edge'
          ? heightEdgeVertices
          : [];
  const vertex = vertices.includes(choices[keys.TraceVertex]) ? choices[keys.TraceVertex] : vertices[0];
  const segments =
    kind === 'diagonal'
      ? diagonals
      : kind === 'midline'
        ? sides
        : kind === 'edge-point' && vertex !== undefined
          ? edgesFor(vertex)
          : [];
  const chosenSegment = segmentOf(choices[keys.TraceSegment]);
  const segment = segments.find((candidate) => sameSegment(candidate, chosenSegment)) ?? segments[0];
  const sameLines = vertex === undefined ? [] : (traces?.sameLines[vertex] ?? []);
  return { kinds, kind, segments, segment, vertices, vertex, equilateral, sameLines };
}

/**
 * The pair of opposite edges of a triangular pyramid that an inclined plane is parallel to, n ∝ u × v: 'none' where none is
 * chosen, or where the solid is not a triangular pyramid; the three pairs SA and BC, SB and CA, SC and AB otherwise.
 */
export function oppositeEdgePairs(topology: PrismTopology): PairKey[] {
  if (topology.kind !== 'pyramid' || topology.sides !== 3) return [];
  return (['A', 'B', 'C'] as const).map((vertex) => {
    const [first, second] = (['A', 'B', 'C'] as const).filter((other) => other !== vertex) as [BoxVertex, BoxVertex];
    return `${PYRAMID_APEX}-${vertex}|${first}-${second}` as PairKey;
  });
}

export const pairSelection = (
  keys: BoxKeysOf,
  choices: Pick<BoxChoices, `${BoxSolid}ParallelEdges`>,
  context: BoxContext,
): 'none' | PairKey => {
  const pair = choices[keys.ParallelEdges];
  return pair !== 'none' && oppositeEdgePairs(context.topology).includes(pair) ? pair : 'none';
};

export const pairOf = (pair: PairKey): [BoxSegment, BoxSegment] =>
  pair.split('|').map((key) => segmentOf(key as SegmentKey)) as [BoxSegment, BoxSegment];

/** The solid from valid values, its displacement included, and for a prism its chosen base; undefined while one is not valid. */
export function boxShapeOf(
  kind: BoxSolid,
  values: ParameterValues,
  choices: BaseChoices | undefined,
): Extract<ModelSpecInput['shape'], { kind: BoxSolid }> | undefined {
  if (kind === 'cube' || kind === 'tetrahedron') return { kind };
  if (kind === 'pyramid') {
    // The base is chosen, not typed: without the choices there is no pyramid.
    if (choices === undefined) return undefined;
    const { pyramidHeightRatio: heightRatio, pyramidApexXRatio: apexXRatio, pyramidApexYRatio: apexYRatio } = values;
    if (heightRatio === undefined || apexXRatio === undefined || apexYRatio === undefined) return undefined;
    const apex = { kind, heightRatio, apexXRatio, apexYRatio } as const;
    switch (choices.pyramidBaseType) {
      case 'regular':
        return { ...apex, baseType: 'regular', baseSides: choices.pyramidBaseSides };
      case 'triangle':
      case 'parallelogram': {
        const [baseSideRatio, baseAngleDeg] =
          choices.pyramidBaseType === 'triangle'
            ? [values.pyramidTriangleSideRatio, values.pyramidTriangleAngleDeg]
            : [values.pyramidParallelogramSideRatio, values.pyramidParallelogramAngleDeg];
        if (baseSideRatio === undefined || baseAngleDeg === undefined) return undefined;
        return { ...apex, baseType: choices.pyramidBaseType, baseSideRatio, baseAngleDeg };
      }
      case 'trapezoid': {
        const {
          pyramidTrapezoidSideRatio: parallelSideRatio,
          pyramidTrapezoidHeightRatio: baseHeightRatio,
          pyramidTrapezoidShiftRatio: baseShiftRatio,
        } = values;
        if (parallelSideRatio === undefined || baseHeightRatio === undefined || baseShiftRatio === undefined) return undefined;
        return { ...apex, baseType: 'trapezoid', parallelSideRatio, baseHeightRatio, baseShiftRatio };
      }
    }
  }
  if (kind === 'cuboid') {
    const { cuboidWidthRatio: widthRatio, cuboidHeightRatio: heightRatio } = values;
    return widthRatio === undefined || heightRatio === undefined ? undefined : { kind, widthRatio, heightRatio };
  }
  if (kind === 'prism') {
    // The base is chosen, not typed: without the choices there is no prism.
    if (choices === undefined) return undefined;
    const { prismHeightRatio: heightRatio, prismOffsetXRatio: offsetXRatio, prismOffsetYRatio: offsetYRatio } = values;
    if (heightRatio === undefined || offsetXRatio === undefined || offsetYRatio === undefined) return undefined;
    const tilt = { kind, heightRatio, offsetXRatio, offsetYRatio } as const;
    switch (choices.prismBaseType) {
      case 'regular':
        return { ...tilt, baseType: 'regular', baseSides: choices.prismBaseSides };
      case 'triangle': {
        const { prismTriangleSideRatio: baseSideRatio, prismTriangleAngleDeg: baseAngleDeg } = values;
        if (baseSideRatio === undefined || baseAngleDeg === undefined) return undefined;
        return { ...tilt, baseType: 'triangle', baseSideRatio, baseAngleDeg };
      }
      case 'trapezoid': {
        const {
          prismTrapezoidSideRatio: parallelSideRatio,
          prismTrapezoidHeightRatio: baseHeightRatio,
          prismTrapezoidShiftRatio: baseShiftRatio,
        } = values;
        if (parallelSideRatio === undefined || baseHeightRatio === undefined || baseShiftRatio === undefined) return undefined;
        return { ...tilt, baseType: 'trapezoid', parallelSideRatio, baseHeightRatio, baseShiftRatio };
      }
    }
  }
  const {
    parallelepipedBaseSideRatio: baseSideRatio,
    parallelepipedHeightRatio: heightRatio,
    parallelepipedBaseAngleDeg: baseAngleDeg,
    parallelepipedOffsetXRatio: offsetXRatio,
    parallelepipedOffsetYRatio: offsetYRatio,
  } = values;
  if (
    baseSideRatio === undefined ||
    heightRatio === undefined ||
    baseAngleDeg === undefined ||
    offsetXRatio === undefined ||
    offsetYRatio === undefined
  )
    return undefined;
  return { kind, baseSideRatio, heightRatio, baseAngleDeg, offsetXRatio, offsetYRatio };
}

/**
 * The initial choices of each box solid: no section; a plane through the lower base's edge AB, by its angle, or through the point
 * of CC1, which for the initial triangular prism is the lateral edge opposite AB, or of a pyramid's SC; a plane through a
 * pyramid's apex along SC and a point of AB.
 */
export const initialBoxChoices = (): BoxChoices =>
  Object.fromEntries(
    BOX_SOLIDS.flatMap((solid) => {
      // The initial prism and the tetrahedron are triangular; the initial pyramid has a square base.
      const base = solid === 'prism' || solid === 'tetrahedron' ? 'ABC' : 'ABCD';
      const pyramid = solid === 'pyramid' || solid === 'tetrahedron';
      const initial: BoxChoiceFields = {
        Section: 'none',
        Face: base,
        Trace: 'angle',
        TraceSegment: 'A-C',
        TraceVertex: pyramid ? 'C' : 'A',
        TraceThrough: false,
        TraceThroughText: '',
        TraceFor: '',
        LineFace: base,
        Line: 'A-B',
        LineMethod: 'angle',
        PointEdge: pyramid ? 'S-C' : 'C-C1',
        NormalAlong: 'none',
        ParallelEdges: 'none',
        NormalFrom: '',
        Connector: 'none',
        DovetailEntrance: 'standard',
        RoundCount: DEFAULT_ROUND_CONNECTOR.count,
        RoundProfile: DEFAULT_CONNECTOR_PROFILE,
        PartsSeparated: true,
        SecondCut: false,
        LineAngleFor: '',
        PointFor: '',
      };
      return Object.entries(initial).map(([field, value]) => [`${solid}${field}`, value]);
    }),
  ) as BoxChoices;

/** The plane fields a mode reads, besides the connector's, and the section it makes from them. */
export function boxModeKeys(
  keys: BoxKeysOf,
  type: BoxSectionSpec['type'],
  choices: BoxChoices,
  context: BoxContext,
): BoxNumberKey[] {
  switch (type) {
    case 'face-parallel':
      return [keys.SectionPercent];
    case 'longitudinal':
      return traceSelection(keys, choices, context).kind === 'angle'
        ? [keys.TraceAngleDeg, keys.SectionPercent]
        : [keys.SectionPercent];
    case 'through-line':
      return throughLineSelection(keys, choices, context).method === 'angle' ? [keys.LineAngleDeg] : [keys.PointPercent];
    case 'through-apex': {
      const { kind } = traceSelection(keys, choices, context);
      return kind === 'angle' ? [keys.TraceAngleDeg, keys.SectionPercent] : kind === 'edge-point' ? [keys.TracePointPercent] : [];
    }
    case 'inclined':
      return normalSelection(keys, choices, context) === 'none' && pairSelection(keys, choices, context) === 'none'
        ? [keys.PlaneInclinationDeg, keys.PlaneDirectionDeg, keys.SectionPercent]
        : [keys.SectionPercent];
  }
}

/**
 * The section of a box's mode from its fields, which `boxModeKeys` lists and the caller has validated; a plane through a line
 * takes the choices in effect, see `throughLineSelection`.
 */
export function boxSectionOf(
  keys: BoxKeysOf,
  type: BoxSectionSpec['type'],
  choices: BoxChoices,
  read: (key: BoxNumberKey) => number,
  second: boolean,
  context: BoxContext,
): BoxSectionSpec {
  const secondPlane = second ? { secondPositionPercent: read(keys.SectionSecondPercent) } : {};
  switch (type) {
    case 'face-parallel':
      return {
        type,
        face: faceSelection(keys, choices, context).face,
        positionPercent: read(keys.SectionPercent),
        ...secondPlane,
      };
    case 'longitudinal': {
      const { kind: chosen, segment, vertex } = traceSelection(keys, choices, context);
      const kind = chosen as Extract<BoxSectionSpec, { type: 'longitudinal' }>['trace'];
      const line =
        kind === 'angle'
          ? {}
          : {
              ...(segment === undefined ? {} : { traceSegment: segment }),
              ...(vertex === undefined ? {} : { traceVertex: vertex }),
              ...(choices[keys.TraceThrough] ? { through: true } : {}),
            };
      return {
        type,
        trace: kind,
        traceAngleDeg: kind === 'angle' ? read(keys.TraceAngleDeg) : 0,
        ...line,
        positionPercent: read(keys.SectionPercent),
        ...secondPlane,
      };
    }
    case 'through-apex': {
      const { kind, segment, vertex } = traceSelection(keys, choices, context);
      return {
        type,
        trace: kind as Extract<BoxSectionSpec, { type: 'through-apex' }>['trace'],
        traceAngleDeg: kind === 'angle' ? read(keys.TraceAngleDeg) : 0,
        ...(segment === undefined ? {} : { traceSegment: segment }),
        ...(vertex === undefined ? {} : { traceVertex: vertex }),
        ...(kind === 'edge-point' ? { tracePointPercent: read(keys.TracePointPercent) } : {}),
        positionPercent: kind === 'angle' ? read(keys.SectionPercent) : 50,
        ...secondPlane,
      };
    }
    case 'through-line': {
      const { face, line, method, pointEdge } = throughLineSelection(keys, choices, context);
      return method === 'angle'
        ? { type, face, line: [...line], method, angleDeg: read(keys.LineAngleDeg), ...secondPlane }
        : { type, face, line: [...line], method, pointEdge, pointPercent: read(keys.PointPercent), ...secondPlane };
    }
    case 'inclined': {
      const pair = pairSelection(keys, choices, context);
      if (pair !== 'none') {
        return {
          type,
          inclinationDeg: 0,
          directionDeg: 0,
          parallelTo: pairOf(pair),
          positionPercent: read(keys.SectionPercent),
          ...secondPlane,
        };
      }
      const along = normalSelection(keys, choices, context);
      return along === 'none'
        ? {
            type,
            inclinationDeg: read(keys.PlaneInclinationDeg),
            directionDeg: read(keys.PlaneDirectionDeg) % 360,
            positionPercent: read(keys.SectionPercent),
            ...secondPlane,
          }
        : {
            type,
            inclinationDeg: 0,
            directionDeg: 0,
            normalAlong: segmentOf(along),
            positionPercent: read(keys.SectionPercent),
            ...secondPlane,
          };
    }
  }
}
