import { type BoxLikeShape, type BoxLineChoice, boxFaceLines, boxPointEdges, boxThroughLineChoices } from '@diploma-3d/engine';
import {
  BOX_EDGES,
  BOX_FACES,
  BOX_VERTICES,
  type BoxFace,
  type BoxSectionSpec,
  type BoxSegment,
  type BoxVertex,
  type ConnectorProfile,
  DEFAULT_CONNECTOR_PROFILE,
  DEFAULT_ROUND_CONNECTOR,
  type DovetailEntrance,
  type ModelSpecInput,
  type ShapeKind,
} from '@diploma-3d/schema';
import type { ConnectorChoice, ParameterValues, SectionChoice } from './parameters.ts';

/** The solids whose sections are planes through their eight named vertices: a cube and the parallelepipeds. */
export const BOX_SOLIDS = ['cube', 'cuboid', 'parallelepiped'] as const;

export type BoxSolid = (typeof BOX_SOLIDS)[number];

export const isBoxSolid = (kind: ShapeKind): kind is BoxSolid => (BOX_SOLIDS as readonly string[]).includes(kind);

/** The numeric fields of a box's sections and connector, each solid with its own, as every other solid has. */
export const BOX_NUMBER_FIELDS = [
  'SectionPercent',
  'SectionSecondPercent',
  'TraceAngleDeg',
  'LineAngleDeg',
  'PointPercent',
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

/** Where a longitudinal plane's trace on the base runs: at an angle to AB, or along a diagonal of the base. */
export type TraceChoice = 'angle' | 'AC' | 'BD';

/** The choices of a box's sections: what each mode is built on, and the connector's choices as other solids have them. */
type BoxChoiceFields = {
  Section: SectionChoice;
  Face: BoxFace;
  Trace: TraceChoice;
  LineFace: BoxFace;
  Line: SegmentKey;
  LineMethod: 'angle' | 'point';
  PointEdge: SegmentKey;
  /** 'none' for a plane given by its angles, otherwise the segment its normal runs along. */
  NormalAlong: 'none' | SegmentKey;
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
  'LineFace',
  'Line',
  'LineMethod',
  'PointEdge',
  'NormalAlong',
  'Connector',
  'DovetailEntrance',
  'RoundCount',
  'RoundProfile',
  'PartsSeparated',
  'SecondCut',
  'LineAngleFor',
  'PointFor',
] as const satisfies readonly BoxChoiceField[];

/** One solid's keys, each a key of every box solid so that the code that reads them serves all three. */
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

export const faceName = (face: BoxFace): string => BOX_FACES[face].map(vertexName).join('');

/** What a face is to the solid: a base or a lateral face. */
export const faceRole = (face: BoxFace): string =>
  face === 'ABCD' ? 'нижня основа' : face === 'A1B1C1D1' ? 'верхня основа' : 'бічна грань';

/** The edges and the diagonals of a face, edges first, in the order around it. */
export const faceLines = boxFaceLines;

/** The edges a point of a plane through a face's line may lie on: those that leave the face. */
export const pointEdges = boxPointEdges;

/** The twelve edges, the twelve face diagonals and the four body diagonals, which a plane may be perpendicular to. */
export function allSegments(): { readonly segment: BoxSegment; readonly kind: 'edge' | 'face' | 'body' }[] {
  const faceDiagonals = (Object.keys(BOX_FACES) as BoxFace[]).flatMap((face) => faceLines(face).slice(4));
  const bodyDiagonals: BoxSegment[] = [
    ['A', 'C1'],
    ['B', 'D1'],
    ['C', 'A1'],
    ['D', 'B1'],
  ];
  return [
    ...BOX_EDGES.map((segment) => ({ segment, kind: 'edge' as const })),
    ...faceDiagonals.map((segment) => ({ segment, kind: 'face' as const })),
    ...bodyDiagonals.map((segment) => ({ segment, kind: 'body' as const })),
  ];
}

/** The texts of a segment as an option: whether it is an edge, a face's diagonal or the solid's own. */
export const segmentLabel = (segment: BoxSegment, kind: 'edge' | 'face' | 'body'): string =>
  `${kind === 'edge' ? 'Ребро' : kind === 'face' ? 'Діагональ грані' : 'Діагональ тіла'} ${segmentName(segment)}`;

const sameSegment = (a: readonly [BoxVertex, BoxVertex], b: readonly [BoxVertex, BoxVertex]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/** Each face's lines that some usable plane passes through, with the edges whose points give one; see `boxThroughLineChoices`. */
export type ThroughLineChoices = Readonly<Record<BoxFace, readonly BoxLineChoice[]>>;

let lastChoices: { readonly key: string; readonly choices: ThroughLineChoices } | undefined;

/** The usable choices of a plane through a line for a valid solid, the last one's kept, as every field change asks again. */
export function throughLineChoicesFor(shape: { readonly kind: string } | undefined): ThroughLineChoices | undefined {
  if (shape === undefined || !isBoxSolid(shape.kind as ShapeKind)) return undefined;
  const key = JSON.stringify(shape);
  if (lastChoices?.key !== key) lastChoices = { key, choices: boxThroughLineChoices(shape as BoxLikeShape) };
  return lastChoices.choices;
}

/** The same for the solid of these values; undefined while it is not valid. */
export const throughLineChoicesOf = (kind: BoxSolid, values: ParameterValues): ThroughLineChoices | undefined =>
  throughLineChoicesFor(boxShapeOf(kind, values));

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
  available: ThroughLineChoices | undefined,
): ThroughLineSelection {
  const allFaces = Object.keys(BOX_FACES) as BoxFace[];
  const usableFaces = available === undefined ? allFaces : allFaces.filter((face) => available[face].length > 0);
  const faces = usableFaces.length > 0 ? usableFaces : allFaces;
  const face = faces.includes(choices[keys.LineFace]) ? choices[keys.LineFace] : (faces[0] as BoxFace);
  const lineChoices = available?.[face];
  const lines = lineChoices === undefined || lineChoices.length === 0 ? faceLines(face) : lineChoices.map(({ line }) => line);
  const chosenLine = segmentOf(choices[keys.Line]);
  const line = lines.find((candidate) => sameSegment(candidate, chosenLine)) ?? (lines[0] as BoxSegment);
  const edges =
    available === undefined
      ? pointEdges(face)
      : (lineChoices?.find((choice) => sameSegment(choice.line, line))?.pointEdges ?? []);
  const methods = edges.length > 0 ? (['angle', 'point'] as const) : (['angle'] as const);
  const method = (methods as readonly string[]).includes(choices[keys.LineMethod]) ? choices[keys.LineMethod] : 'angle';
  const chosenEdge = segmentOf(choices[keys.PointEdge]);
  const pointEdge =
    edges.find((candidate) => sameSegment(candidate, chosenEdge)) ??
    (edges[0] as BoxSegment | undefined) ??
    (pointEdges(face)[0] as BoxSegment);
  return { faces, face, lines, line, methods, method, pointEdges: edges, pointEdge };
}

/** The solid from valid values, its displacement included; undefined while one of them is not valid. */
export function boxShapeOf(
  kind: BoxSolid,
  values: ParameterValues,
): Extract<ModelSpecInput['shape'], { kind: BoxSolid }> | undefined {
  if (kind === 'cube') return { kind };
  if (kind === 'cuboid') {
    const { cuboidWidthRatio: widthRatio, cuboidHeightRatio: heightRatio } = values;
    return widthRatio === undefined || heightRatio === undefined ? undefined : { kind, widthRatio, heightRatio };
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

/** Whether a longitudinal plane along a base diagonal lies through it: the solid's centre, at the middle of its extent. */
export const DIAGONAL_POSITION_PERCENT = 50;

/** The initial choices of each box solid: no section; a plane through the lower base's edge AB, by its angle. */
export const initialBoxChoices = (): BoxChoices =>
  Object.fromEntries(
    BOX_SOLIDS.flatMap((solid) => {
      const initial: BoxChoiceFields = {
        Section: 'none',
        Face: 'ABCD',
        Trace: 'angle',
        LineFace: 'ABCD',
        Line: 'A-B',
        LineMethod: 'angle',
        PointEdge: 'C-C1',
        NormalAlong: 'none',
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

/** The vertices in school order, for the preview's labels. */
export const BOX_VERTEX_ORDER: readonly BoxVertex[] = BOX_VERTICES;

/** The plane fields a mode reads, besides the connector's, and the section it makes from them. */
export function boxModeKeys(
  keys: BoxKeysOf,
  type: BoxSectionSpec['type'],
  choices: BoxChoices,
  available: ThroughLineChoices | undefined,
): BoxNumberKey[] {
  switch (type) {
    case 'face-parallel':
      return [keys.SectionPercent];
    case 'longitudinal':
      return choices[keys.Trace] === 'angle' ? [keys.TraceAngleDeg, keys.SectionPercent] : [keys.SectionPercent];
    case 'through-line':
      return throughLineSelection(keys, choices, available).method === 'angle' ? [keys.LineAngleDeg] : [keys.PointPercent];
    case 'inclined':
      return choices[keys.NormalAlong] === 'none'
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
  available: ThroughLineChoices | undefined,
): BoxSectionSpec {
  const secondPlane = second ? { secondPositionPercent: read(keys.SectionSecondPercent) } : {};
  switch (type) {
    case 'face-parallel':
      return { type, face: choices[keys.Face], positionPercent: read(keys.SectionPercent), ...secondPlane };
    case 'longitudinal': {
      const trace = choices[keys.Trace];
      return {
        type,
        trace,
        traceAngleDeg: trace === 'angle' ? read(keys.TraceAngleDeg) : 0,
        positionPercent: read(keys.SectionPercent),
        ...secondPlane,
      };
    }
    case 'through-line': {
      const { face, line, method, pointEdge } = throughLineSelection(keys, choices, available);
      return method === 'angle'
        ? { type, face, line: [...line], method, angleDeg: read(keys.LineAngleDeg), ...secondPlane }
        : { type, face, line: [...line], method, pointEdge, pointPercent: read(keys.PointPercent), ...secondPlane };
    }
    case 'inclined': {
      const along = choices[keys.NormalAlong];
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
