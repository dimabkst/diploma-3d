const decimalFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 4, useGrouping: false });

export const formatDecimal = (value: number): string => decimalFormat.format(value);

// Plain decimals with a comma (Ukrainian) or a point; exponents and fragments such as "-" or "," are not numbers.
const DECIMAL_PATTERN = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

export function parseDecimal(text: string): number | undefined {
  const trimmed = text.trim();
  return DECIMAL_PATTERN.test(trimmed) ? Number(trimmed.replace(',', '.')) : undefined;
}

export type StepRange = { readonly min: number; readonly max: number; readonly increment: number };

export type StepDirection = 1 | -1;

/**
 * The next multiple of `increment` (anchored at zero) strictly above or below `value`, clamped to the range; undefined
 * when the value already lies at or beyond the limit in that direction. Off-grid values such as 2,05 step to the
 * neighbouring multiples (2 and 2,25 for the increment 0,25) rather than by a whole increment.
 */
export function stepDecimal(value: number, direction: StepDirection, range: StepRange): number | undefined {
  if (direction > 0 ? value >= range.max : value <= range.min) return undefined;
  const stepped = multipleOfIncrement(value, range.increment, (units, stepUnits) =>
    direction > 0 ? floorDivide(units, stepUnits) + 1n : -floorDivide(-units, stepUnits) - 1n,
  );
  return clamp(stepped, range);
}

/**
 * The multiple of `increment` (anchored at zero) nearest to `value`, with halves rounded up, clamped to the range. The
 * range's ends count as well: an end that is no multiple, such as 65,71 with the increment 5, is reachable by dragging.
 */
export function snapDecimal(value: number, range: StepRange): number {
  // round(u / s) = floor((2u + s) / 2s), computed exactly.
  const multiple = clamp(
    multipleOfIncrement(value, range.increment, (units, stepUnits) => floorDivide(2n * units + stepUnits, 2n * stepUnits)),
    range,
  );
  const distance = Math.abs(value - multiple);
  if (Math.abs(value - range.max) < distance) return range.max;
  return Math.abs(value - range.min) < distance ? range.min : multiple;
}

/**
 * (x + y) / 2 computed on the decimal values of x and y, so that a typed b/a = 1,1 aligns at (1,1 − 1)/2 = 0,05 rather
 * than at the binary result 0,050000000000000044.
 */
export function halfSumDecimal(x: number, y: number): number {
  const [p, q] = [toExactDecimal(x), toExactDecimal(y)];
  const scale = Math.max(p.scale, q.scale);
  // n / 2 = 5n / 10: one more decimal digit keeps the half exact.
  return Number(`${(rescale(p, scale) + rescale(q, scale)) * 5n}e-${scale + 1}`);
}

/** Formats a stepped value exactly, with the Ukrainian decimal comma. */
export const formatSteppedDecimal = (value: number): string => String(value).replace('.', ',');

const clamp = (value: number, { min, max }: StepRange): number => Math.min(max, Math.max(min, value));

/** `index(units, stepUnits)` × increment, where both are integers at a common decimal scale. */
function multipleOfIncrement(value: number, increment: number, index: (units: bigint, stepUnits: bigint) => bigint): number {
  if (!(increment > 0) || !Number.isFinite(increment)) throw new RangeError(`Invalid step increment: ${increment}.`);
  // Exact decimal arithmetic: 0,3 / 0,1 is 2,9999999999999996 in binary floating point, which would step 0,3 up to 0,3.
  const exact = toExactDecimal(value);
  const step = toExactDecimal(increment);
  const scale = Math.max(exact.scale, step.scale);
  const stepUnits = rescale(step, scale);
  // Parsing the decimal text yields the double nearest to it, without the error that multiplying by 0,1 would add.
  return Number(`${index(rescale(exact, scale), stepUnits) * stepUnits}e-${scale}`);
}

type ExactDecimal = { readonly units: bigint; readonly scale: number };

/** The shortest decimal that round-trips to `value`, as integer units of 10^-scale. */
function toExactDecimal(value: number): ExactDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (match === null) throw new RangeError(`Not a finite number: ${value}.`);
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  const scale = fraction.length - Number(exponent);
  const units = BigInt(`${sign}${whole}${fraction}`);
  return scale >= 0 ? { units, scale } : { units: units * 10n ** BigInt(-scale), scale: 0 };
}

const rescale = ({ units, scale }: ExactDecimal, target: number): bigint => units * 10n ** BigInt(target - scale);

/** Floor division for a positive divisor; BigInt division truncates towards zero. */
function floorDivide(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  return dividend % divisor !== 0n && dividend < 0n ? quotient - 1n : quotient;
}
