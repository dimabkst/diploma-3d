import {
  axisParallelCylinderSection,
  axisParallelOffsetLimitPercent,
  type BoxLikeShape,
  ballOffsetLimitPercent,
  ballRadiusMm,
  ballSection,
  boxSection,
  boxVertices,
  coneApexChord,
  coneObliqueSection,
  coneSection,
  coneVerticalSection,
  DOVETAIL_PROPORTIONS,
  isApexChordUsable,
  obliqueCylinderSection,
  ROUND_CONNECTOR_PROPORTIONS,
  roundDimensionsMm,
  verticalOffsetLimitPercent,
} from '@diploma-3d/engine';
import type { ConeShape, PhysicalScale, SectionType, ShapeKind } from '@diploma-3d/schema';
import { formatDecimal, formatSteppedDecimal, parseDecimal, type StepRange } from '../decimal.ts';
import {
  BOX_SOLIDS,
  type BoxSolid,
  boxKeysOf,
  boxModeKeys,
  boxSectionOf,
  boxShapeOf,
  isBoxSolid,
  throughLineChoicesFor,
} from './box.ts';
import type { ParameterChoices, ParameterValues } from './parameters.ts';

/** What turns the connector settings into millimetres: the assembled model's longest side M and the solid's size. */
export type ConnectorScale = {
  readonly longestDimensionMm: number;
  readonly radiusMm: number;
  readonly heightMm: number;
  /** The actual section's extent along u of the current or last valid oblique plane. */
  readonly obliqueSpanMm?: number | undefined;
  /** The actual section's extent along u of a cone's current or last valid cut; a cylinder's is its diameter. */
  readonly parallelSpanMm?: number | undefined;
  /** The same of a cone's vertical cut; a cylinder's is its height. */
  readonly verticalSpanMm?: number | undefined;
  /** The same of a plane through a cone's apex. */
  readonly apexSpanMm?: number | undefined;
  /** The same of a ball's horizontal cut. */
  readonly horizontalSpanMm?: number | undefined;
  /** The same of a cylinder's plane parallel to its axis, along the axis. */
  readonly axisSpanMm?: number | undefined;
  /** The same of a cube's or parallelepiped's current or last valid plane, whatever its mode. */
  readonly boxSpanMm?: number | undefined;
};

/** The fields shown in millimetres as generated: a multiplier or percentage, or a twist connector's millimetres. */
export type ScaledConnectorKey =
  | 'cylinderDovetailSize'
  | 'cylinderDovetailLengthPercent'
  | 'cylinderRoundDiameter'
  | 'cylinderRoundDepth'
  | 'cylinderRoundSpacingPercent'
  | 'cylinderTwistSizeMm'
  | 'coneDovetailSize'
  | 'coneDovetailLengthPercent'
  | 'coneRoundDiameter'
  | 'coneRoundDepth'
  | 'coneRoundSpacingPercent'
  | 'ballDovetailSize'
  | 'ballDovetailLengthPercent'
  | 'ballRoundDiameter'
  | 'ballRoundDepth'
  | 'ballRoundSpacingPercent'
  | `${BoxSolid}${'DovetailSize' | 'DovetailLengthPercent' | 'RoundDiameter' | 'RoundDepth' | 'RoundSpacingPercent'}`;

/**
 * Millimetres per unit of each stored setting, following the engine's formulas: the dovetail's height h = 0,025·M·k and
 * its length L = (p/100)·S along the section's span S; the
 * round connectors' diameter d = 0,0625·M·k_d, a plug's height e = 0,05·M·k_e or a dowel's whole length 2e, and a pair's
 * distance from the centre s = (p/100)·S/2. The span is the diameter 2r in a cylinder's parallel cut, the height H in a
 * vertical one and the actual section's extent along u in an oblique one and in a cone. The stored values stay the source of truth, so a new M
 * scales every connector as before and a new radius, height or plane keeps the proportions.
 */
export function connectorUnits(
  {
    longestDimensionMm: m,
    radiusMm: r,
    heightMm,
    obliqueSpanMm,
    parallelSpanMm,
    verticalSpanMm,
    apexSpanMm,
    horizontalSpanMm,
    axisSpanMm,
    boxSpanMm,
  }: ConnectorScale,
  roundType: 'plug' | 'dowel',
  sectionType: SectionType = 'parallel-to-bases',
): Readonly<Record<ScaledConnectorKey, number>> {
  const span =
    sectionType === 'vertical'
      ? (verticalSpanMm ?? heightMm)
      : sectionType === 'oblique'
        ? (obliqueSpanMm ?? 2 * r)
        : sectionType === 'oblique-apex'
          ? (apexSpanMm ?? 2 * r)
          : sectionType === 'horizontal'
            ? (horizontalSpanMm ?? 2 * r)
            : sectionType === 'axis-parallel'
              ? (axisSpanMm ?? heightMm)
              : sectionType === 'parallel-to-bases'
                ? (parallelSpanMm ?? 2 * r)
                : (boxSpanMm ?? heightMm);
  const size = DOVETAIL_PROPORTIONS.height * m;
  const length = span / 100;
  const diameter = ROUND_CONNECTOR_PROPORTIONS.diameter * m;
  const depth = ROUND_CONNECTOR_PROPORTIONS.insertion * m * (roundType === 'dowel' ? 2 : 1);
  const spacing = span / 2 / 100;
  return {
    cylinderDovetailSize: size,
    cylinderDovetailLengthPercent: length,
    cylinderRoundDiameter: diameter,
    cylinderRoundDepth: depth,
    cylinderRoundSpacingPercent: spacing,
    // Stored in millimetres already: it shares the fields that show the generated value rather than the stored one.
    cylinderTwistSizeMm: 1,
    coneDovetailSize: size,
    coneDovetailLengthPercent: length,
    coneRoundDiameter: diameter,
    coneRoundDepth: depth,
    coneRoundSpacingPercent: spacing,
    ballDovetailSize: size,
    ballDovetailLengthPercent: length,
    ballRoundDiameter: diameter,
    ballRoundDepth: depth,
    ballRoundSpacingPercent: spacing,
    ...(Object.fromEntries(
      BOX_SOLIDS.flatMap((solid) => [
        [`${solid}DovetailSize`, size],
        [`${solid}DovetailLengthPercent`, length],
        [`${solid}RoundDiameter`, diameter],
        [`${solid}RoundDepth`, depth],
        [`${solid}RoundSpacingPercent`, spacing],
      ]),
    ) as Record<
      `${BoxSolid}${'DovetailSize' | 'DovetailLengthPercent' | 'RoundDiameter' | 'RoundDepth' | 'RoundSpacingPercent'}`,
      number
    >),
  };
}

/**
 * The cylinder's scale from valid values: M, h/r and d/r give the radius and height as the engine builds them, and a
 * valid oblique plane its section's span; while the plane is being corrected, `previous` keeps the last span.
 */
export function cylinderConnectorScale(
  values: {
    readonly printSizeMm?: number | undefined;
    readonly cylinderHeightRatio?: number | undefined;
    readonly cylinderOffsetRatio?: number | undefined;
    readonly cylinderObliquePositionPercent?: number | undefined;
    readonly cylinderObliqueInclinationDeg?: number | undefined;
    readonly cylinderObliqueDirectionDeg?: number | undefined;
    readonly cylinderAxisOffsetPercent?: number | undefined;
    readonly cylinderAxisDirectionDeg?: number | undefined;
  },
  previous?: ConnectorScale,
): ConnectorScale | undefined {
  const { printSizeMm, cylinderHeightRatio, cylinderOffsetRatio } = values;
  if (printSizeMm === undefined || cylinderHeightRatio === undefined || cylinderOffsetRatio === undefined) return undefined;
  const shape = { kind: 'cylinder', heightRatio: cylinderHeightRatio, offsetRatio: cylinderOffsetRatio } as const;
  const scale = { longestDimensionMm: printSizeMm };
  const { radius, height } = roundDimensionsMm(shape, scale);
  const {
    cylinderObliquePositionPercent: positionPercent,
    cylinderObliqueInclinationDeg: inclinationDeg,
    cylinderObliqueDirectionDeg: directionDeg,
  } = values;
  const obliqueSpanMm =
    positionPercent === undefined || inclinationDeg === undefined || directionDeg === undefined
      ? previous?.obliqueSpanMm
      : obliqueCylinderSection(shape, scale, { positionPercent, inclinationDeg, directionDeg }).span;
  const { cylinderAxisOffsetPercent: axisOffset, cylinderAxisDirectionDeg: axisDirection } = values;
  const axisSpanMm =
    axisOffset === undefined ||
    axisDirection === undefined ||
    Math.abs(axisOffset) > axisParallelOffsetLimitPercent(shape, scale, axisDirection)
      ? previous?.axisSpanMm
      : axisParallelCylinderSection(shape, scale, { offsetPercent: axisOffset, offsetDirectionDeg: axisDirection }).span;
  return { longestDimensionMm: printSizeMm, radiusMm: radius, heightMm: height, obliqueSpanMm, axisSpanMm };
}

/** The span of a vertical cut within its limit; a plane beyond that has no usable section, and keeps the last span. */
function verticalSpanOf(
  shape: ConeShape,
  scale: PhysicalScale,
  offsetPercent: number | undefined,
  previous: number | undefined,
): number | undefined {
  if (offsetPercent === undefined || Math.abs(offsetPercent) > verticalOffsetLimitPercent(shape, scale)) return previous;
  return coneVerticalSection(shape, scale, offsetPercent).span;
}

/**
 * The cone's scale from valid values: its radius and height as the engine builds it, and the actual spans of its valid
 * cuts; while a cut is being corrected, `previous` keeps the last span.
 */
export function coneConnectorScale(
  values: {
    readonly printSizeMm?: number | undefined;
    readonly coneHeightRatio?: number | undefined;
    readonly coneOffsetRatio?: number | undefined;
    readonly coneSectionPercent?: number | undefined;
    readonly coneSectionOffsetPercent?: number | undefined;
    readonly coneObliquePositionPercent?: number | undefined;
    readonly coneObliqueInclinationDeg?: number | undefined;
    readonly coneObliqueDirectionDeg?: number | undefined;
    readonly coneApexInclinationDeg?: number | undefined;
    readonly coneApexDirectionDeg?: number | undefined;
  },
  previous?: ConnectorScale,
): ConnectorScale | undefined {
  const { printSizeMm, coneHeightRatio, coneOffsetRatio, coneSectionPercent, coneSectionOffsetPercent } = values;
  if (printSizeMm === undefined || coneHeightRatio === undefined || coneOffsetRatio === undefined) return undefined;
  const shape = { kind: 'cone', heightRatio: coneHeightRatio, offsetRatio: coneOffsetRatio } as const;
  const scale = { longestDimensionMm: printSizeMm };
  const { radius, height } = roundDimensionsMm(shape, scale);
  const parallelSpanMm =
    coneSectionPercent === undefined ? previous?.parallelSpanMm : coneSection(shape, scale, coneSectionPercent).span;
  const verticalSpanMm = verticalSpanOf(shape, scale, coneSectionOffsetPercent, previous?.verticalSpanMm);
  const { coneObliquePositionPercent: positionPercent, coneObliqueInclinationDeg, coneObliqueDirectionDeg } = values;
  const obliqueSpanMm =
    positionPercent === undefined || coneObliqueInclinationDeg === undefined || coneObliqueDirectionDeg === undefined
      ? previous?.obliqueSpanMm
      : coneObliqueSection(shape, scale, {
          positionPercent,
          inclinationDeg: coneObliqueInclinationDeg,
          directionDeg: coneObliqueDirectionDeg,
        }).span;
  const apex =
    values.coneApexInclinationDeg === undefined || values.coneApexDirectionDeg === undefined
      ? undefined
      : { inclinationDeg: values.coneApexInclinationDeg, directionDeg: values.coneApexDirectionDeg };
  // A plane that does not split the cone has no usable section, and keeps the last span.
  const apexSpanMm =
    apex === undefined || !isApexChordUsable(coneApexChord(shape, scale, apex))
      ? previous?.apexSpanMm
      : coneObliqueSection(shape, scale, apex).span;
  return {
    longestDimensionMm: printSizeMm,
    radiusMm: radius,
    heightMm: height,
    parallelSpanMm,
    verticalSpanMm,
    obliqueSpanMm,
    apexSpanMm,
  };
}

/** The ball's scale: its radius, and the actual span of a cut within the limit; `previous` keeps the last span otherwise. */
export function ballConnectorScale(
  values: { readonly printSizeMm?: number | undefined; readonly ballSectionOffsetPercent?: number | undefined },
  previous?: ConnectorScale,
): ConnectorScale | undefined {
  const { printSizeMm, ballSectionOffsetPercent: offset } = values;
  if (printSizeMm === undefined) return undefined;
  const scale = { longestDimensionMm: printSizeMm };
  const radiusMm = ballRadiusMm(scale);
  const horizontalSpanMm =
    offset === undefined || Math.abs(offset) > ballOffsetLimitPercent(scale)
      ? previous?.horizontalSpanMm
      : ballSection(scale, offset).span;
  return { longestDimensionMm: printSizeMm, radiusMm, heightMm: 2 * radiusMm, horizontalSpanMm };
}

/**
 * A cube's or parallelepiped's scale: its height, and the actual span of its valid plane, whatever the mode, read off the
 * solid as the engine builds it; `previous` keeps the last span while the plane is not valid, or without the choices.
 */
export function boxConnectorScale(
  kind: BoxSolid,
  values: ParameterValues,
  choices: ParameterChoices | undefined,
  previous?: ConnectorScale,
): ConnectorScale | undefined {
  const shape = boxShapeOf(kind, values);
  const { printSizeMm } = values;
  if (shape === undefined || printSizeMm === undefined) return undefined;
  const scale = { longestDimensionMm: printSizeMm };
  const solid = shape as BoxLikeShape;
  const heightMm = boxVertices(solid, scale).A1[2];
  const keys = boxKeysOf(kind);
  const type = choices?.[keys.Section];
  let boxSpanMm = previous?.boxSpanMm;
  if (choices !== undefined && type !== undefined && type !== 'none' && isBoxCut(type)) {
    const available = throughLineChoicesFor(shape);
    const fields = boxModeKeys(keys, type, choices, available);
    if (fields.every((key) => values[key] !== undefined)) {
      try {
        boxSpanMm = boxSection(solid, scale, {
          box: boxSectionOf(keys, type, choices, (key) => values[key] as number, false, available),
        }).span;
      } catch {
        // A plane that does not cut the solid, or through a point on its line, keeps the last span.
      }
    }
  }
  return { longestDimensionMm: printSizeMm, radiusMm: printSizeMm / 2, heightMm, boxSpanMm };
}

const isBoxCut = (type: SectionType): type is 'face-parallel' | 'longitudinal' | 'through-line' | 'inclined' =>
  type === 'face-parallel' || type === 'longitudinal' || type === 'through-line' || type === 'inclined';

/**
 * The scale of the solid's connector settings; undefined for a solid without them, or while a value it needs is invalid. A
 * cube's or parallelepiped's plane depends on the choices of its mode as well.
 */
export function connectorScaleOf(
  kind: ShapeKind,
  values: Parameters<typeof cylinderConnectorScale>[0] &
    Parameters<typeof coneConnectorScale>[0] &
    Parameters<typeof ballConnectorScale>[0],
  previous?: ConnectorScale,
  choices?: ParameterChoices,
): ConnectorScale | undefined {
  if (isBoxSolid(kind)) return boxConnectorScale(kind, values as ParameterValues, choices, previous);
  if (kind === 'cylinder') return cylinderConnectorScale(values, previous);
  if (kind === 'ball') return ballConnectorScale(values, previous);
  return kind === 'cone' ? coneConnectorScale(values, previous) : undefined;
}

// Display and slider precision: a thousandth of a millimetre.
const DIGITS = 3;
const FACTOR = 10 ** DIGITS;
// Absorbs the binary roundoff of a bound that is a decimal in exact arithmetic, such as 38,5 computed as
// 38,49999999999999; a ten-billionth of a millimetre, well inside the plans' roundoff tolerance.
const ROUNDOFF_THOUSANDTHS = 1e-7;
const PERCENT_FACTOR = 100;

/**
 * Feasible millimetres for a slider: rounded inwards to thousandths, so that every slider and button position, and a
 * typed copy of a shown end, is a feasible value. An interval too narrow to hold a thousandth keeps its exact ends
 * rather than reversing them; undefined when no value is feasible.
 */
export function physicalRange(
  interval: { readonly min: number; readonly max: number } | null,
  increment: number,
): StepRange | undefined {
  if (interval === null || !(interval.min <= interval.max)) return undefined;
  // + 0 turns a rounded −0 into 0, which would otherwise read "-0".
  const min = Math.ceil(interval.min * FACTOR - ROUNDOFF_THOUSANDTHS) / FACTOR + 0;
  const max = Math.floor(interval.max * FACTOR + ROUNDOFF_THOUSANDTHS) / FACTOR + 0;
  return min <= max ? { min, max, increment } : { min: interval.min, max: interval.max, increment };
}

/**
 * A vertical plane's allowed distance from the axis in percent of r, for a slider: rounded inwards to hundredths of a
 * percent, and symmetric. Both ends stay reachable, as stepping and the slider stop at them even when they are not
 * multiples of the step.
 */
export function percentRange({ min, max }: { readonly min: number; readonly max: number }, increment: number): StepRange {
  const inwards = (value: number) => Math.floor(value * PERCENT_FACTOR + ROUNDOFF_THOUSANDTHS) / PERCENT_FACTOR;
  return { min: -inwards(-min) + 0, max: inwards(max) + 0, increment };
}

/**
 * A plane's allowed angles in degrees, for a slider: rounded inwards to hundredths, so that every position is an allowed
 * angle. An interval too narrow to hold a hundredth keeps its exact ends rather than reversing them. Both ends stay
 * reachable, as stepping and the slider stop at them even when they are no multiples of the step.
 */
export function planeAngleRange({ min, max }: { readonly min: number; readonly max: number }, increment: number): StepRange {
  const low = Math.ceil(min * PERCENT_FACTOR - ROUNDOFF_THOUSANDTHS) / PERCENT_FACTOR;
  const high = Math.floor(max * PERCENT_FACTOR + ROUNDOFF_THOUSANDTHS) / PERCENT_FACTOR;
  return low <= high ? { min: low, max: high, increment } : { min, max, increment };
}

/** Millimetres for display: rounded to thousandths only here. */
export const formatMillimetres = (value: number): string => formatDecimal(Math.round(value * FACTOR) / FACTOR);

/** A stored value in millimetres, for display. */
export const formatPhysical = (value: number, unit: number): string => formatMillimetres(value * unit);

/**
 * The stored value for a length typed in millimetres. Twelve significant digits remove the binary roundoff of the
 * division, so that 3,3 mm at 1,5 mm per unit stores 2,2 rather than 2,1999999999999997; the remaining error, below a
 * nanometre, is within the plans' roundoff tolerance.
 */
export const storedValue = (physical: number, unit: number): number => Number((physical / unit).toPrecision(12));

/**
 * The stored text for what was typed in millimetres: the exact stored value for a number, or the text itself for a
 * draft that is not one yet, such as "" or "-", which validation then reports.
 */
export function storedText(typed: string, unit: number): string {
  const physical = parseDecimal(typed);
  return physical === undefined || !Number.isFinite(physical) ? typed : formatSteppedDecimal(storedValue(physical, unit));
}

/** The millimetres shown for a stored text: converted when it is a number, as typed otherwise. */
export function shownText(stored: string, unit: number): string {
  const value = parseDecimal(stored);
  return value === undefined || !Number.isFinite(value) ? stored : formatPhysical(value, unit);
}
