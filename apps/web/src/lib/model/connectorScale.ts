import { DOVETAIL_PROPORTIONS, ROUND_CONNECTOR_PROPORTIONS, roundDimensionsMm } from '@diploma-3d/engine';
import { formatDecimal, formatSteppedDecimal, parseDecimal, type StepRange } from '../decimal.ts';

/** What turns the connector settings into millimetres: the assembled model's longest side M and the cylinder's radius. */
export type ConnectorScale = { readonly longestDimensionMm: number; readonly radiusMm: number };

/** The connector fields whose stored value is a multiplier or a percentage, shown in millimetres. */
export type ScaledConnectorKey =
  | 'cylinderDovetailSize'
  | 'cylinderDovetailLengthPercent'
  | 'cylinderRoundDiameter'
  | 'cylinderRoundDepth'
  | 'cylinderRoundSpacingPercent';

/**
 * Millimetres per unit of each stored setting, following the engine's formulas: the dovetail's height h = 0,025·M·k
 * and its length L = (p/100)·2r along a full diameter; the round connectors' diameter d = 0,0625·M·k_d, a plug's height
 * e = 0,05·M·k_e or a dowel's whole length 2e, and a pair's distance from the centre s = (p/100)·r. The stored values
 * stay the source of truth, so a new M scales every connector as before and a new radius keeps the proportions.
 */
export function connectorUnits(
  { longestDimensionMm: m, radiusMm: r }: ConnectorScale,
  roundType: 'plug' | 'dowel',
): Readonly<Record<ScaledConnectorKey, number>> {
  return {
    cylinderDovetailSize: DOVETAIL_PROPORTIONS.height * m,
    cylinderDovetailLengthPercent: (2 * r) / 100,
    cylinderRoundDiameter: ROUND_CONNECTOR_PROPORTIONS.diameter * m,
    cylinderRoundDepth: ROUND_CONNECTOR_PROPORTIONS.insertion * m * (roundType === 'dowel' ? 2 : 1),
    cylinderRoundSpacingPercent: r / 100,
  };
}

/** The cylinder's scale from valid values: M, h/r and d/r give the radius as the engine builds it. */
export function cylinderConnectorScale(values: {
  readonly printSizeMm?: number | undefined;
  readonly cylinderHeightRatio?: number | undefined;
  readonly cylinderOffsetRatio?: number | undefined;
}): ConnectorScale | undefined {
  const { printSizeMm, cylinderHeightRatio, cylinderOffsetRatio } = values;
  if (printSizeMm === undefined || cylinderHeightRatio === undefined || cylinderOffsetRatio === undefined) return undefined;
  const { radius } = roundDimensionsMm(
    { kind: 'cylinder', heightRatio: cylinderHeightRatio, offsetRatio: cylinderOffsetRatio },
    { longestDimensionMm: printSizeMm },
  );
  return { longestDimensionMm: printSizeMm, radiusMm: radius };
}

// Display and slider precision: a thousandth of a millimetre.
const DIGITS = 3;
const FACTOR = 10 ** DIGITS;
// Absorbs the binary roundoff of a bound that is a decimal in exact arithmetic, such as 38,5 computed as
// 38,49999999999999; a ten-billionth of a millimetre, well inside the plans' roundoff tolerance.
const ROUNDOFF_THOUSANDTHS = 1e-7;

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
