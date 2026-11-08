import {
  coneSection,
  coneVerticalSection,
  DOVETAIL_PROPORTIONS,
  obliqueCylinderSection,
  ROUND_CONNECTOR_PROPORTIONS,
  roundDimensionsMm,
  verticalOffsetLimitPercent,
} from '@diploma-3d/engine';
import type { ConeShape, PhysicalScale, SectionType, ShapeKind } from '@diploma-3d/schema';
import { formatDecimal, formatSteppedDecimal, parseDecimal, type StepRange } from '../decimal.ts';

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
};

/** The fields whose stored value is a multiplier or a percentage, shown in millimetres. */
export type ScaledConnectorKey =
  | 'cylinderDovetailSize'
  | 'cylinderDovetailLengthPercent'
  | 'cylinderRoundDiameter'
  | 'cylinderRoundDepth'
  | 'cylinderRoundSpacingPercent'
  | 'coneDovetailSize'
  | 'coneDovetailLengthPercent'
  | 'coneRoundDiameter'
  | 'coneRoundDepth'
  | 'coneRoundSpacingPercent';

/**
 * Millimetres per unit of each stored setting, following the engine's formulas: the dovetail's height h = 0,025·M·k and
 * its length L = (p/100)·S along the section's span S; the
 * round connectors' diameter d = 0,0625·M·k_d, a plug's height e = 0,05·M·k_e or a dowel's whole length 2e, and a pair's
 * distance from the centre s = (p/100)·S/2. The span is the diameter 2r in a cylinder's parallel cut, the height H in a
 * vertical one and the actual section's extent along u in an oblique one and in a cone. The stored values stay the source of truth, so a new M
 * scales every connector as before and a new radius, height or plane keeps the proportions.
 */
export function connectorUnits(
  { longestDimensionMm: m, radiusMm: r, heightMm, obliqueSpanMm, parallelSpanMm, verticalSpanMm }: ConnectorScale,
  roundType: 'plug' | 'dowel',
  sectionType: SectionType = 'parallel-to-bases',
): Readonly<Record<ScaledConnectorKey, number>> {
  const span =
    sectionType === 'vertical'
      ? (verticalSpanMm ?? heightMm)
      : sectionType === 'oblique'
        ? (obliqueSpanMm ?? 2 * r)
        : (parallelSpanMm ?? 2 * r);
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
    coneDovetailSize: size,
    coneDovetailLengthPercent: length,
    coneRoundDiameter: diameter,
    coneRoundDepth: depth,
    coneRoundSpacingPercent: spacing,
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
  return { longestDimensionMm: printSizeMm, radiusMm: radius, heightMm: height, obliqueSpanMm };
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
  return { longestDimensionMm: printSizeMm, radiusMm: radius, heightMm: height, parallelSpanMm, verticalSpanMm };
}

/** The scale of the solid's connector settings; undefined for a solid without them, or while a value it needs is invalid. */
export function connectorScaleOf(
  kind: ShapeKind,
  values: Parameters<typeof cylinderConnectorScale>[0] & Parameters<typeof coneConnectorScale>[0],
  previous?: ConnectorScale,
): ConnectorScale | undefined {
  if (kind === 'cylinder') return cylinderConnectorScale(values, previous);
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
