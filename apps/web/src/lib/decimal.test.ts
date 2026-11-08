import { describe, expect, it } from 'vitest';
import { formatSteppedDecimal, halfSumDecimal, parseDecimal, type StepRange, snapDecimal, stepDecimal } from './decimal.ts';

describe('parseDecimal', () => {
  it.each([
    ['1,5', 1.5],
    ['1.5', 1.5],
    [' 2 ', 2],
    ['0,25', 0.25],
    ['2.05', 2.05],
    ['2,05', 2.05],
    [',5', 0.5],
    ['3.', 3],
    ['-1', -1],
  ])('reads "%s" as %s', (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  it.each(['', ' ', '-', ',', '1,2,3', '1.5.', '1,5.', 'abc', '1e2', 'Infinity', 'NaN', '0x10'])('rejects "%s"', (text) => {
    expect(parseDecimal(text)).toBeUndefined();
  });
});

const ratio: StepRange = { min: 0.25, max: 4, increment: 0.25 };

describe('stepDecimal', () => {
  const down = (value: number, range = ratio) => stepDecimal(value, -1, range);
  const up = (value: number, range = ratio) => stepDecimal(value, 1, range);

  it.each([
    [2.05, 2, 2.25],
    [2, 1.75, 2.25],
    [1.1, 1, 1.25],
    [1, 0.75, 1.25],
    [1.25, 1, 1.5],
    [0.25, undefined, 0.5],
    [0.3, 0.25, 0.5],
    [0.5, 0.25, 0.75],
    [3.9, 3.75, 4],
    [4, 3.75, undefined],
  ])('steps %s down to %s and up to %s', (value, below, above) => {
    expect(down(value)).toBe(below);
    expect(up(value)).toBe(above);
  });

  it('moves typed values between the quarters to the neighbouring quarters, anchored at zero', () => {
    expect(down(1.26)).toBe(1.25);
    expect(up(1.24)).toBe(1.25);
    expect(down(1.234)).toBe(1);
    expect(up(1.234)).toBe(1.25);
    expect(down(3.99)).toBe(3.75);
    expect(up(3.76)).toBe(4);
  });

  it('walks the whole range in quarters in either direction', () => {
    const upward = [0.25];
    for (let next = up(0.25); next !== undefined; next = up(next)) upward.push(next);
    expect(upward).toEqual(Array.from({ length: 16 }, (_, index) => (index + 1) / 4));
    expect(upward.map(formatSteppedDecimal).slice(0, 4)).toEqual(['0,25', '0,5', '0,75', '1']);

    const downward = [4];
    for (let next = down(4); next !== undefined; next = down(next)) downward.push(next);
    expect(downward).toEqual([...upward].reverse());
  });

  // Each of these fails with plain floating point: 0,7 / 0,1 = 6,999999999999999 and 3 × 0,1 = 0,30000000000000004.
  it.each([
    [0.3, 0.4],
    [0.6, 0.7],
    [0.7, 0.8],
    [1.1, 1.2],
  ])('steps the on-grid value %s up to exactly %s with the increment 0,1', (value, above) => {
    const tenths: StepRange = { min: 0.25, max: 4, increment: 0.1 };
    expect(up(value, tenths)).toBe(above);
    expect(down(above, tenths)).toBe(value);
  });

  it('treats the nearest binary value of an artifact-laden input by its exact decimal expansion', () => {
    // 0,1 + 0,2 = 0,30000000000000004 lies just above 0,3.
    expect(down(0.1 + 0.2, { min: 0, max: 1, increment: 0.1 })).toBe(0.3);
    expect(up(0.1 + 0.2, { min: 0, max: 1, increment: 0.1 })).toBe(0.4);
  });

  it('clamps a result that crosses a limit which is not a multiple of the increment', () => {
    const range: StepRange = { min: 0.3, max: 3.9, increment: 0.25 };
    expect(up(3.75, range)).toBe(3.9);
    expect(up(3.9, range)).toBeUndefined();
    expect(down(0.5, range)).toBe(0.3);
    expect(down(0.3, range)).toBeUndefined();
  });

  it('brings values outside the range back to the nearest limit and refuses to move further out', () => {
    expect(down(9)).toBe(4);
    expect(up(9)).toBeUndefined();
    expect(up(0.1)).toBe(0.25);
    expect(down(0.1)).toBeUndefined();
  });

  it.each([
    [{ min: -1, max: 1, increment: 0.1 }, -0.05, -0.1, 0],
    [{ min: -1, max: 1, increment: 0.1 }, -0.3, -0.4, -0.2],
    [{ min: 0, max: 10, increment: 1 }, 2.5, 2, 3],
    [{ min: 0, max: 1, increment: 0.05 }, 0.12, 0.1, 0.15],
    [{ min: 0, max: 1000, increment: 25 }, 260, 250, 275],
  ] as const)('supports other ranges and increments: %o from %s', (range, value, below, above) => {
    expect(down(value, range)).toBe(below);
    expect(up(value, range)).toBe(above);
  });

  it('steps the offset range [−2, 2] by quarters through negative values and zero', () => {
    const offset = { min: -2, max: 2, increment: 0.25 };
    // Off-step values move to the neighbouring quarters; zero comes out as +0, not −0.
    expect(down(-0.1, offset)).toBe(-0.25);
    expect(up(-0.1, offset)).toBe(0);
    expect(down(0.1, offset)).toBe(0);
    // From a quarter, one full step.
    expect(down(-0.25, offset)).toBe(-0.5);
    expect(up(-0.25, offset)).toBe(0);
    expect(down(0, offset)).toBe(-0.25);
    expect(up(-1.75, offset)).toBe(-1.5);
    expect(down(-2, offset)).toBeUndefined();
    expect(up(2, offset)).toBeUndefined();
    expect(down(-1.9, offset)).toBe(-2);
    expect(snapDecimal(-0.125, offset)).toBe(0);
    expect(snapDecimal(-0.13, offset)).toBe(-0.25);
    expect(formatSteppedDecimal(-0.25)).toBe('-0,25');
  });

  it.each([0, -0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the increment %s', (increment) => {
    expect(() => stepDecimal(1, 1, { min: 0, max: 4, increment })).toThrow(RangeError);
    expect(() => snapDecimal(1, { min: 0, max: 4, increment })).toThrow(RangeError);
  });

  it('rejects a non-finite value', () => {
    expect(() => up(Number.NaN)).toThrow(RangeError);
    expect(() => snapDecimal(Number.NaN, ratio)).toThrow(RangeError);
  });
});

describe('snapDecimal', () => {
  it('reaches a range end that is no multiple of the increment, and keeps multiples inside the range', () => {
    const range = { min: -65.71, max: 65.71, increment: 5 };
    expect(snapDecimal(65.71, range)).toBe(65.71);
    expect(snapDecimal(-65.71, range)).toBe(-65.71);
    expect(snapDecimal(65.4, range)).toBe(65.71);
    expect(snapDecimal(62, range)).toBe(60);
    expect(snapDecimal(63, range)).toBe(65);
    expect(snapDecimal(0.4, range)).toBe(0);
    // The connector sliders' bounds: 2,8–38,364 mm with the increment 0,25.
    const depth = { min: 2.8, max: 38.364, increment: 0.25 };
    expect(snapDecimal(38.364, depth)).toBe(38.364);
    expect(snapDecimal(2.8, depth)).toBe(2.8);
    expect(snapDecimal(20.1, depth)).toBe(20);
  });

  it.each([
    [2.05, 2],
    [2.12, 2],
    [2.125, 2.25],
    [2.2, 2.25],
    [1.1, 1],
    [1.25, 1.25],
    [0.3, 0.25],
    [3.9, 4],
    // Slider positions are arbitrary doubles.
    [2.0634920634920637, 2],
    [1.6190476190476188, 1.5],
    [1.6253968253968254, 1.75],
  ])('moves %s to the nearest quarter %s', (value, snapped) => {
    expect(snapDecimal(value, ratio)).toBe(snapped);
  });

  it('keeps the result within the range', () => {
    expect(snapDecimal(0.1, ratio)).toBe(0.25);
    expect(snapDecimal(0, ratio)).toBe(0.25);
    expect(snapDecimal(4.2, ratio)).toBe(4);
    expect(snapDecimal(3.9, { min: 0.3, max: 3.8, increment: 0.25 })).toBe(3.8);
  });

  it('rounds exactly, also for increments that binary floating point cannot represent', () => {
    const tenths: StepRange = { min: 0, max: 1, increment: 0.1 };
    expect(snapDecimal(0.35, tenths)).toBe(0.4);
    expect(snapDecimal(0.34999, tenths)).toBe(0.3);
    expect(snapDecimal(-0.35, { ...tenths, min: -1 })).toBe(-0.3);
  });
});

describe('formatSteppedDecimal', () => {
  it.each([
    [2, '2'],
    [2.25, '2,25'],
    [0.25, '0,25'],
    [-0.4, '-0,4'],
  ])('writes %s as "%s"', (value, text) => {
    expect(formatSteppedDecimal(value)).toBe(text);
  });
});

describe('halfSumDecimal', () => {
  it.each([
    [0.5, -1, -0.25],
    [1, -0.5, 0.25],
    [1.1, -1, 0.05],
    [1, -1.1, -0.05],
    [4, -1, 1.5],
    [0.25, -1, -0.375],
    [1, -1, 0],
    [2.05, -1, 0.525],
    [1.234, -1, 0.117],
  ])('gives (%s + %s) / 2 = %s exactly', (x, y, half) => {
    expect(halfSumDecimal(x, y)).toBe(half);
  });
});
