import { describe, expect, it } from 'vitest';
import {
  anglesFromOffsets,
  directionVector,
  inclinationRange,
  maxDisplacement,
  minInclination,
  normalizeDirection,
  offsetsFromAngles,
  tiltKeys,
} from './tilt.ts';

const prism = tiltKeys.prism.bounds;
const pyramid = tiltKeys.pyramid.bounds;
const cone = tiltKeys.cone.bounds;
const degrees = (radians: number) => (radians * 180) / Math.PI;

function expectClose(actual: readonly number[] | undefined, expected: readonly number[], digits = 12): void {
  expect(actual).toBeDefined();
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual?.[index]).toBeCloseTo(value, digits);
  });
}

describe('the existing offset limits', () => {
  it('reads symmetric component bounds for polygonal bases and a scalar bound for circular ones', () => {
    expect(tiltKeys.prism.bounds).toEqual({ type: 'plane', limit: 2 });
    expect(tiltKeys.parallelepiped.bounds).toEqual({ type: 'plane', limit: 2 });
    expect(tiltKeys.pyramid.bounds).toEqual({ type: 'plane', limit: 4 });
    expect(tiltKeys.cylinder.bounds).toEqual({ type: 'axis', limit: 4 });
    expect(cone).toEqual({ type: 'axis', limit: 4 });
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
    expect(directionVector(360)).toEqual([1, 0]);
    expectClose(directionVector(30), [Math.sqrt(3) / 2, 0.5], 15);
  });
});

describe('maxDisplacement', () => {
  it.each([
    [0, 2],
    [90, 2],
    [180, 2],
    [45, 2 * Math.SQRT2],
    [135, 2 * Math.SQRT2],
    // tan 30° < 1: the ray leaves the square through the side X = 2.
    [30, 2 / Math.cos(Math.PI / 6)],
    [60, 2 / Math.sin(Math.PI / 3)],
  ])('stays in |X|, |Y| ≤ 2 along %s°', (direction, expected) => {
    expect(maxDisplacement(prism, direction)).toBeCloseTo(expected, 12);
  });

  it('uses the scalar limit of a circular base', () => {
    expect(maxDisplacement(cone, 0)).toBe(4);
  });
});

describe('offsetsFromAngles', () => {
  it('turns H = 1, β = 45°, φ = 90° into (0, 1), and H = 2 into (0, 2)', () => {
    expect(offsetsFromAngles(prism, 1, 45, 90)).toEqual([0, 1]);
    // (0, 2) is the edge of the range: roundoff must not push it out.
    expect(offsetsFromAngles(prism, 2, 45, 90)).toEqual([0, 2]);
  });

  it('gives no displacement at exactly 90°, in any direction and at any height', () => {
    for (const direction of [0, 37, 90, 359.5]) {
      for (const height of [0.25, 1, 4]) {
        expect(offsetsFromAngles(prism, height, 90, direction)).toEqual([0, 0]);
      }
    }
    expect(offsetsFromAngles(cone, 3, 90, 0)).toEqual([0]);
  });

  it.each([
    [30, [Math.sqrt(3) / 2, 0.5]],
    [120, [-0.5, Math.sqrt(3) / 2]],
    [210, [-Math.sqrt(3) / 2, -0.5]],
    [300, [0.5, -Math.sqrt(3) / 2]],
    [180, [-1, 0]],
    [270, [0, -1]],
  ] as const)('points the displacement along %s°, with negative offsets where the quadrant has them', (direction, unit) => {
    // β = 45° makes D = H = 1.
    expectClose(offsetsFromAngles(prism, 1, 45, direction), unit);
  });

  it('reaches the corner of the X/Y range along the diagonal', () => {
    const corner = minInclination(1, maxDisplacement(prism, 45));
    expect(corner).toBeCloseTo(degrees(Math.atan(1 / (2 * Math.SQRT2))), 12);
    expect(offsetsFromAngles(prism, 1, corner, 45)).toEqual([2, 2]);
    expect(offsetsFromAngles(prism, 1, corner, 225)).toEqual([-2, -2]);
    expect(offsetsFromAngles(pyramid, 1, minInclination(1, maxDisplacement(pyramid, 135)), 135)).toEqual([-4, 4]);
  });

  it('rejects inclinations below the limit of the direction instead of clamping a component', () => {
    expect(offsetsFromAngles(prism, 1, 20, 45)).toBeDefined();
    expect(offsetsFromAngles(prism, 1, 19, 45)).toBeUndefined();
    // Along +Y alone the limit is 2, so the same 20° is too flat: D = 2,75.
    expect(offsetsFromAngles(prism, 1, 20, 90)).toBeUndefined();
    expect(offsetsFromAngles(prism, 1, 0, 0)).toBeUndefined();
    expect(offsetsFromAngles(prism, 1, -10, 0)).toBeUndefined();
    expect(offsetsFromAngles(prism, 1, 90.5, 0)).toBeUndefined();
    expect(offsetsFromAngles(prism, 1, Number.NaN, 0)).toBeUndefined();
  });

  it('gives a cone or cylinder with h/r = 2 and β = 45° the displacement d/r = 2', () => {
    expect(offsetsFromAngles(cone, 2, 45, 0)).toEqual([2]);
    expect(offsetsFromAngles(cone, 1, degrees(Math.atan2(1, 4)), 0)).toEqual([4]);
    expect(offsetsFromAngles(cone, 1, 14, 0)).toBeUndefined();
  });
});

describe('anglesFromOffsets', () => {
  it('measures β from the height and the displacement and φ from +X', () => {
    expect(anglesFromOffsets(1, [0, 1])).toEqual({ inclinationDeg: 45, directionDeg: 90 });
    const angles = anglesFromOffsets(2, [-1, -1]);
    expect(angles?.inclinationDeg).toBeCloseTo(degrees(Math.atan2(2, Math.SQRT2)), 12);
    expect(angles?.directionDeg).toBeCloseTo(225, 12);
    expect(anglesFromOffsets(1, [1, -1e-17])?.directionDeg).toBeLessThan(360);
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
    ]) {
      for (const height of [0.25, 1.1, 3.9]) {
        const angles = anglesFromOffsets(height, offsets);
        const back = offsetsFromAngles(prism, height, angles?.inclinationDeg ?? 0, angles?.directionDeg ?? 0);
        expect(back).toEqual(offsets);
      }
    }
    for (const offset of [0.01, 1.35, 4]) {
      const angles = anglesFromOffsets(0.5, [offset]);
      expect(offsetsFromAngles(cone, 0.5, angles?.inclinationDeg ?? 0, 0)).toEqual([offset]);
    }
  });
});

describe('inclinationRange', () => {
  it('starts at atan2(H, D_max), rounded up to hundredths, and ends at 90°', () => {
    // H = 1 along +X: D_max = 2, β ≥ 26,565…°.
    expect(inclinationRange(prism, 1, 0)).toEqual({ min: 26.57, max: 90 });
    // Along the diagonal the corner allows D = 2√2: β ≥ 19,47…°.
    expect(inclinationRange(prism, 1, 45)).toEqual({ min: 19.48, max: 90 });
    expect(inclinationRange(cone, 2, 0)).toEqual({ min: 26.57, max: 90 });
    // A value that is already exact is not raised: atan2(4, 4) = 45°.
    expect(inclinationRange(cone, 4, 0)).toEqual({ min: 45, max: 90 });
  });

  it('assumes the least restrictive height and direction while either is unknown', () => {
    expect(inclinationRange(prism, undefined, undefined).min).toBe(
      Math.ceil(degrees(Math.atan2(0.25, 2 * Math.SQRT2)) * 100) / 100,
    );
    expect(inclinationRange(prism, 1, undefined)).toEqual(inclinationRange(prism, 1, 45));
  });

  it('accepts its own displayed minimum', () => {
    for (const [height, direction] of [
      [1, 0],
      [0.25, 33],
      [3.3, 200],
      [4, 315],
    ] as const) {
      const { min } = inclinationRange(prism, height, direction);
      expect(offsetsFromAngles(prism, height, min, direction)).toBeDefined();
      expect(offsetsFromAngles(prism, height, min - 0.01, direction)).toBeUndefined();
    }
  });
});
