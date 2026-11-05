import { INCLINATION_LIMITS, maxTiltDisplacement } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import {
  anglesFromOffsets,
  DIRECTION_LIMITS,
  directionVector,
  inclinationRange,
  isInclination,
  normalizeDirection,
  offsetRange,
  offsetsFromAngles,
} from './tilt.ts';

const degrees = (radians: number) => (radians * 180) / Math.PI;
const SQRT3 = Math.sqrt(3);
const TAN15 = Math.tan((15 * Math.PI) / 180);
// Polygonal bases take a direction; circular ones keep +X.
const [POLYGON, CIRCLE] = [false, true];

function expectClose(actual: readonly number[] | undefined, expected: readonly number[], digits = 12): void {
  expect(actual).toBeDefined();
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual?.[index]).toBeCloseTo(value, digits);
  });
}

describe('angle limits', () => {
  it('allows inclinations from 15° to 90° and directions from 0° to 360°', () => {
    expect(INCLINATION_LIMITS).toEqual({ min: 15, max: 90 });
    for (const valid of [15, 15.000001, 45, 90]) expect(isInclination(valid)).toBe(true);
    for (const invalid of [14.99, 5, 0, -5, 90.0001, Number.NaN]) expect(isInclination(invalid)).toBe(false);
    expect(DIRECTION_LIMITS).toEqual({ min: 0, max: 360 });
  });
});

describe('directions', () => {
  it.each([
    [0, 0],
    [360, 0],
    [720, 0],
    [-90, 270],
    [450, 90],
    [-1e-20, 0],
    [-0, 0],
  ])('normalises %s° to %s°', (input, expected) => {
    expect(Object.is(normalizeDirection(input), expected)).toBe(true);
  });

  it('is exact on the axes and counterclockwise from +X seen from +Z', () => {
    expect(directionVector(0)).toEqual([1, 0]);
    expect(directionVector(90)).toEqual([0, 1]);
    expect(directionVector(180)).toEqual([-1, 0]);
    expect(directionVector(270)).toEqual([0, -1]);
    expectClose(directionVector(30), [SQRT3 / 2, 0.5], 15);
  });
});

describe('offsetsFromAngles', () => {
  it('turns H = 1, β = 45°, φ = 90° into (0, 1), and H = 2 into (0, 2)', () => {
    expect(offsetsFromAngles(POLYGON, 1, 45, 90)).toEqual([0, 1]);
    expect(offsetsFromAngles(POLYGON, 2, 45, 90)).toEqual([0, 2]);
  });

  it('gives no displacement at exactly 90°, in any direction and at any height', () => {
    for (const direction of [0, 37, 90, 359.5]) {
      for (const height of [0.25, 1, 4]) expect(offsetsFromAngles(POLYGON, height, 90, direction)).toEqual([0, 0]);
    }
    expect(offsetsFromAngles(CIRCLE, 3, 90, 0)).toEqual([0]);
  });

  it.each([
    [30, [SQRT3 / 2, 0.5]],
    [120, [-0.5, SQRT3 / 2]],
    [210, [-SQRT3 / 2, -0.5]],
    [300, [0.5, -SQRT3 / 2]],
  ] as const)('points the displacement along %s°, with negative offsets where the quadrant has them', (direction, unit) => {
    expectClose(offsetsFromAngles(POLYGON, 1, 45, direction), unit);
  });

  it('rejects inclinations below 15° instead of producing flatter offsets', () => {
    expect(offsetsFromAngles(POLYGON, 1, 14.9, 0)).toBeUndefined();
    expect(offsetsFromAngles(POLYGON, 1, 5, 0)).toBeUndefined();
    expect(offsetsFromAngles(POLYGON, 1, 0, 0)).toBeUndefined();
    expect(offsetsFromAngles(POLYGON, 1, 91, 0)).toBeUndefined();
    // 15° itself: D = 1/tan 15° ≈ 3,732.
    expectClose(offsetsFromAngles(POLYGON, 1, 15, 0), [1 / TAN15, 0], 11);
  });

  it('rejects angles whose offsets would leave their limits, without clamping a component', () => {
    // h/a = 4 at 30°: X/a = 4√3 ≈ 6,93 > 4.
    expect(offsetsFromAngles(POLYGON, 4, 30, 0)).toBeUndefined();
    // Along the diagonal the corner (4, 4) allows D = 4√2 ≈ 5,66: atan2(4, 4√2) ≈ 35,26°.
    expectClose(offsetsFromAngles(POLYGON, 4, degrees(Math.atan2(4, 4 * Math.SQRT2)), 45), [4, 4], 9);
    expect(offsetsFromAngles(POLYGON, 4, 35, 45)).toBeUndefined();
    // h/r = 8 at 60°: d = 8/√3 ≈ 4,62 > 4; at 65° it is ≈ 3,73.
    expect(offsetsFromAngles(CIRCLE, 8, 60, 0)).toBeUndefined();
    expect(offsetsFromAngles(CIRCLE, 8, 65, 0)).toBeDefined();
  });

  it('gives a cone or cylinder with h/r = 2 and β = 45° the displacement d/r = 2', () => {
    expect(offsetsFromAngles(CIRCLE, 2, 45, 0)).toEqual([2]);
  });
});

describe('anglesFromOffsets', () => {
  it('measures β from the height and the displacement and φ from +X', () => {
    expect(anglesFromOffsets(1, [0, 1])).toEqual({ inclinationDeg: 45, directionDeg: 90 });
    const angles = anglesFromOffsets(2, [-1, -1]);
    expect(angles?.inclinationDeg).toBeCloseTo(degrees(Math.atan2(2, Math.SQRT2)), 12);
    expect(angles?.directionDeg).toBeCloseTo(225, 12);
    expect(anglesFromOffsets(1, [2])).toEqual({ inclinationDeg: degrees(Math.atan2(1, 2)), directionDeg: 0 });
  });

  it('leaves the direction undefined without a displacement, and needs the height otherwise', () => {
    expect(anglesFromOffsets(undefined, [0, 0])).toEqual({ inclinationDeg: 90, directionDeg: undefined });
    expect(anglesFromOffsets(undefined, [0.5, 0])).toBeUndefined();
  });

  it('returns the same offsets after a round trip through the angles, for non-round values in every quadrant', () => {
    for (const offsets of [
      [0.3137, -1.2345],
      [-1.999, 0.0001],
      [-0.7072, -0.7083],
      [1.234567891234, 0.000000000001],
      [2, 2],
      [-4, 4],
    ]) {
      for (const height of [1.1, 2.5, 4]) {
        if (Math.hypot(...offsets) > maxTiltDisplacement(height)) continue;
        const angles = anglesFromOffsets(height, offsets);
        const back = offsetsFromAngles(POLYGON, height, angles?.inclinationDeg ?? 0, angles?.directionDeg ?? 0);
        expect(back).toEqual(offsets);
      }
    }
    // Exactly at 15°: the largest displacement the height allows survives the round trip.
    const flattest = Number((1 / TAN15).toFixed(12));
    const angles = anglesFromOffsets(1, [flattest, 0]);
    expect(isInclination(angles?.inclinationDeg ?? 0)).toBe(true);
    expect(offsetsFromAngles(POLYGON, 1, angles?.inclinationDeg ?? 0, 0)).toEqual([flattest, 0]);
  });
});

describe('ranges narrowed by the current values', () => {
  it('starts the inclination at 15° unless the offset limits need a steeper one', () => {
    expect(inclinationRange(POLYGON, undefined, undefined)).toEqual({ min: 15, max: 90 });
    expect(inclinationRange(POLYGON, 1, 0)).toEqual({ min: 15, max: 90 });
    // h/a = 4: along +X the limit 4 needs atan(4/4) = 45°; along the diagonal atan2(4, 4√2) ≈ 35,26°.
    expect(inclinationRange(POLYGON, 4, 0)).toEqual({ min: 45, max: 90 });
    expect(inclinationRange(POLYGON, 4, 45)).toEqual({ min: 35.27, max: 90 });
    // h/r = 8: d ≤ 4 needs atan(8/4) ≈ 63,43°.
    expect(inclinationRange(CIRCLE, 8, 0)).toEqual({ min: 63.44, max: 90 });
    // Every angle the range offers is allowed.
    for (const [height, direction] of [
      [4, 0],
      [4, 45],
      [2.5, 200],
    ] as const) {
      expect(offsetsFromAngles(POLYGON, height, inclinationRange(POLYGON, height, direction).min, direction)).toBeDefined();
    }
  });

  it('limits an offset by its own range and by β ≥ 15° together with the other offset', () => {
    expect(offsetRange(POLYGON, undefined, undefined)).toEqual({ min: -4, max: 4 });
    expect(offsetRange(POLYGON, 4, 0)).toEqual({ min: -4, max: 4 });
    // h/a = 0,25: D ≤ 0,25/tan 15° ≈ 0,933, rounded inwards.
    expect(offsetRange(POLYGON, 0.25, 0)).toEqual({ min: -0.933, max: 0.933 });
    // With Y = 0,5: |X| ≤ √(0,933² − 0,25) ≈ 0,787.
    expect(offsetRange(POLYGON, 0.25, 0.5)).toEqual({ min: -0.787, max: 0.787 });
    expect(offsetRange(CIRCLE, 0.5, undefined)).toEqual({ min: 0, max: 1.866 });
    expect(offsetRange(CIRCLE, 8, undefined)).toEqual({ min: 0, max: 4 });
  });
});
