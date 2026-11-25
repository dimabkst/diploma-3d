/**
 * The construction of a cube's or a parallelepiped's plane parallel to a face: the face, picked on the model or by its pair of
 * opposite faces, and the plane's position between that face and the opposite one, at the midpoint or at a ratio of the two
 * distances, d(face, plane) : d(plane, opposite face) = a : b. The plane lies at t = a / (a + b) of the perpendicular gap from the
 * face, which is the specification's `positionPercent` = 100 t: the solid's extent along the face's inward normal runs from that
 * face to the opposite one, also for an oblique parallelepiped. A second parallel plane has its own position from the same face.
 */
import type { BoxFace, PrismTopology, ShapeKind } from '@diploma-3d/schema';
import { formatDecimal } from '../decimal.ts';
import { type BoxChoices, type BoxKeysOf, type BoxNumberKey, faceName } from './box.ts';
import {
  type ConstructionDraft,
  isThroughPointSolid,
  PILOT_MESSAGES,
  type PilotDraft,
  type PointMode,
  pointPercentOf,
} from './throughPoint.ts';

/** Whether a box's plane parallel to a face is this construction's: for a cube and the parallelepipeds. */
export const facePilotActive = (keys: BoxKeysOf, choices: BoxChoices): boolean =>
  isThroughPointSolid(keys.Section.slice(0, -'Section'.length) as ShapeKind) && choices[keys.Section] === 'face-parallel';

/** The face of a parallelepiped opposite this one: the one with none of its vertices. */
export function oppositeFace(topology: PrismTopology, face: BoxFace): BoxFace | undefined {
  const corners = topology.faces[face] ?? [];
  return topology.faceNames.find(
    (other) => other !== face && !(topology.faces[other] ?? []).some((corner) => corners.includes(corner)),
  );
}

/** The three pairs of opposite faces, each by its first face in the solid's order: ABCD, ABB₁A₁, BCC₁B₁ for a cube. */
export function facePairs(topology: PrismTopology): { readonly face: BoxFace; readonly opposite: BoxFace }[] {
  const pairs: { face: BoxFace; opposite: BoxFace }[] = [];
  for (const face of topology.faceNames) {
    const opposite = oppositeFace(topology, face);
    if (opposite === undefined || pairs.some((pair) => pair.opposite === face)) continue;
    pairs.push({ face, opposite });
  }
  return pairs;
}

/** The first face of the pair a face belongs to: what the named list shows for it. */
export const facePairOf = (topology: PrismTopology, face: BoxFace): BoxFace =>
  facePairs(topology).find((pair) => pair.face === face || pair.opposite === face)?.face ?? face;

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
export function distanceLabels(topology: PrismTopology, face: BoxFace): readonly [string, string] {
  const opposite = oppositeFace(topology, face);
  return [`Від ${faceName(topology, face)}`, `До ${opposite === undefined ? '…' : faceName(topology, opposite)}`];
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
  topology: PrismTopology,
  ratioErrors: Readonly<Record<string, string | undefined>>,
  second: boolean,
): PilotDraft {
  const face = choices[keys.Face];
  const opposite = oppositeFace(topology, face);
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
      const on = percent <= 0 ? face : (opposite ?? face);
      const plane = which === 'first' ? 'Переріз' : 'Другий переріз';
      return invalid(
        'boundary',
        `${plane} збігається з гранню ${faceName(topology, on)}. Оберіть положення строго між ${faceName(topology, face)} і ` +
          `${opposite === undefined ? 'протилежною гранню' : faceName(topology, opposite)}.`,
      );
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
export function chooseFace<S extends State>(keys: BoxKeysOf, topology: PrismTopology, state: S, face: BoxFace): S {
  const current = state.choices[keys.Face];
  if (face === current || topology.faces[face] === undefined) return state;
  const choices = { ...state.choices, [keys.Face]: face };
  if (oppositeFace(topology, current) !== face) return { ...state, choices };
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
export function choosePair<S extends State>(keys: BoxKeysOf, topology: PrismTopology, state: S, pair: BoxFace): S {
  return facePairOf(topology, state.choices[keys.Face]) === pair ? state : chooseFace(keys, topology, state, pair);
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
