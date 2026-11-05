import { describe, expect, it } from 'vitest';
import {
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  DEFAULT_LONGEST_DIMENSION_MM,
  DEFAULT_PARALLELOGRAM_BASE,
  DEFAULT_TRAPEZOID_BASE,
  DEFAULT_TRIANGLE_BASE,
  defaultModelSpecs,
  MAX_LONGEST_DIMENSION_MM,
  MIN_INCLINATION_DEG,
  MIN_LONGEST_DIMENSION_MM,
  maxTiltDisplacement,
  modelSpecSchema,
  PRISM_BASE_SIDES,
  PRISM_BASE_TYPES,
  PYRAMID_BASE_SIDES,
  PYRAMID_BASE_TYPES,
  RATIO_LIMITS,
  REGULAR_POLYHEDRON_KINDS,
  ROUND_HEIGHT_LIMITS,
  ROUND_OFFSET_LIMITS,
  SECTIONS_BY_SHAPE,
  TETRAHEDRON_HEIGHT_RATIO,
  TILT_OFFSET_LIMITS,
} from './index.ts';

const scale = { longestDimensionMm: 80 };
const cubeWithLongestDimension = (longestDimensionMm: unknown) => ({ shape: { kind: 'cube' }, scale: { longestDimensionMm } });
const cuboid = (widthRatio: unknown, heightRatio: unknown) => ({ shape: { kind: 'cuboid', widthRatio, heightRatio }, scale });
const prism = (baseSides: unknown, heightRatio: unknown) => ({ shape: { kind: 'prism', baseSides, heightRatio }, scale });
const parallelepiped = (baseSideRatio: unknown, heightRatio: unknown, baseAngleDeg: unknown) => ({
  shape: { kind: 'parallelepiped', baseSideRatio, heightRatio, baseAngleDeg },
  scale,
});
const pyramid = (baseSides: unknown, heightRatio: unknown) => ({ shape: { kind: 'pyramid', baseSides, heightRatio }, scale });

const invalidNumbers: readonly (readonly [string, unknown])[] = [
  ['zero', 0],
  ['negative zero', -0],
  ['negative', -1],
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['a numeric string', '1.5'],
  ['null', null],
  ['missing', undefined],
];

describe('modelSpecSchema', () => {
  it('uses one 80 mm default longest dimension for every shape', () => {
    expect(DEFAULT_LONGEST_DIMENSION_MM).toBe(80);
    expect(modelSpecSchema.parse(defaultModelSpecs.cube)).toEqual({ shape: { kind: 'cube' }, scale });
    expect(modelSpecSchema.parse(defaultModelSpecs.cuboid)).toEqual({
      shape: { kind: 'cuboid', widthRatio: 1.5, heightRatio: 2 },
      scale,
    });
    expect(modelSpecSchema.parse(defaultModelSpecs.prism)).toEqual({
      shape: { kind: 'prism', baseType: 'regular', baseSides: 3, heightRatio: 2, offsetXRatio: 0, offsetYRatio: 0 },
      scale,
    });
  });

  it.each([MIN_LONGEST_DIMENSION_MM, 1.5, 12.5, 120, MAX_LONGEST_DIMENSION_MM])(
    'accepts a longest dimension of %s mm',
    (longestDimensionMm) => {
      expect(modelSpecSchema.safeParse(cubeWithLongestDimension(longestDimensionMm)).success).toBe(true);
    },
  );

  it.each([
    ...invalidNumbers,
    ['below the minimum', MIN_LONGEST_DIMENSION_MM - 0.001] as const,
    ['a fraction of a millimetre', 0.001] as const,
    ['above the maximum', MAX_LONGEST_DIMENSION_MM + 0.001] as const,
  ])('rejects a longest dimension that is %s', (_, longestDimensionMm) => {
    expect(modelSpecSchema.safeParse(cubeWithLongestDimension(longestDimensionMm)).success).toBe(false);
  });

  it('rejects independent cube dimensions because all cube edges are equal by definition', () => {
    const result = modelSpecSchema.safeParse({ shape: { kind: 'cube', width: 1, depth: 2, height: 3 }, scale });
    expect(result.success).toBe(false);
  });

  it.each([
    ['an unknown shape', { shape: { kind: 'torus' }, scale }],
    ['a missing shape', { scale }],
    ['a missing scale', { shape: { kind: 'cube' } }],
    ['extra scale fields', { shape: { kind: 'cube' }, scale: { longestDimensionMm: 80, factor: 2 } }],
    ['extra top-level fields', { shape: { kind: 'cube' }, scale, connectors: [] }],
    ['a non-object', 'cube'],
  ])('rejects %s', (_, input) => {
    expect(modelSpecSchema.safeParse(input).success).toBe(false);
  });
});

describe('cuboid proportions', () => {
  const { min, max } = RATIO_LIMITS;

  it('limits both ratios to [0.25, 4], keeping values between the slider steps', () => {
    expect(RATIO_LIMITS).toEqual({ min: 0.25, max: 4 });
    for (const ratio of [2.05, 0.26, 3.99]) {
      expect(modelSpecSchema.parse(cuboid(ratio, ratio)).shape).toMatchObject({ widthRatio: ratio, heightRatio: ratio });
    }
    for (const ratio of [0.2, 4.8]) expect(modelSpecSchema.safeParse(cuboid(ratio, 1)).success).toBe(false);
  });

  it.each([
    [min, min],
    [max, max],
    [min, max],
    [1, 1],
  ])('accepts widthRatio %s and heightRatio %s, including the boundaries', (widthRatio, heightRatio) => {
    expect(modelSpecSchema.parse(cuboid(widthRatio, heightRatio)).shape).toEqual({ kind: 'cuboid', widthRatio, heightRatio });
  });

  it.each([...invalidNumbers, ['just below the minimum', min - 1e-9] as const, ['just above the maximum', max + 1e-9] as const])(
    'rejects a ratio that is %s, without clamping',
    (_, ratio) => {
      expect(modelSpecSchema.safeParse(cuboid(ratio, 2)).success).toBe(false);
      expect(modelSpecSchema.safeParse(cuboid(1.5, ratio)).success).toBe(false);
    },
  );

  it('rejects absolute dimensions instead of proportions', () => {
    const result = modelSpecSchema.safeParse({ shape: { kind: 'cuboid', widthRatio: 1, heightRatio: 1, a: 40 }, scale });
    expect(result.success).toBe(false);
  });
});

describe('right parallelepiped parameters', () => {
  const { min, max } = RATIO_LIMITS;
  const outOfRange = (low: number, high: number) => [
    ...invalidNumbers,
    ['just below the minimum', low - 1e-9] as const,
    ['just above the maximum', high + 1e-9] as const,
  ];

  it('defaults to a rhombus base with α = 60° and h = a, and limits α to [15°, 165°]', () => {
    expect(modelSpecSchema.parse(defaultModelSpecs.parallelepiped)).toEqual({
      shape: { kind: 'parallelepiped', baseSideRatio: 1, heightRatio: 1, baseAngleDeg: 60, offsetXRatio: 0, offsetYRatio: 0 },
      scale,
    });
    expect(BASE_ANGLE_LIMITS).toEqual({ min: 15, max: 165 });
  });

  it.each([
    [min, min, BASE_ANGLE_LIMITS.min],
    [max, max, BASE_ANGLE_LIMITS.max],
    [min, max, 90],
    // Values off the 0,25 and 5° interaction grids are as valid as typed.
    [2.05, 1.1, 62],
    [1, 1, 72.5],
  ])('accepts b/a = %s, h/a = %s and α = %s°, including the boundaries', (baseSideRatio, heightRatio, baseAngleDeg) => {
    expect(modelSpecSchema.parse(parallelepiped(baseSideRatio, heightRatio, baseAngleDeg)).shape).toEqual({
      kind: 'parallelepiped',
      baseSideRatio,
      heightRatio,
      baseAngleDeg,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
  });

  it.each(outOfRange(min, max))('rejects a ratio that is %s, without clamping', (_, ratio) => {
    expect(modelSpecSchema.safeParse(parallelepiped(ratio, 1, 60)).success).toBe(false);
    expect(modelSpecSchema.safeParse(parallelepiped(1, ratio, 60)).success).toBe(false);
  });

  it.each([
    ...outOfRange(BASE_ANGLE_LIMITS.min, BASE_ANGLE_LIMITS.max),
    ['a flat angle', 180] as const,
    ['a reflex angle', 270] as const,
    ['in radians', Math.PI / 3] as const,
  ])('rejects a base angle that is %s', (_, angle) => {
    expect(modelSpecSchema.safeParse(parallelepiped(1, 1, angle)).success).toBe(false);
  });

  it('rejects fields of other shapes, a lateral-edge offset and absolute dimensions', () => {
    for (const extra of [{ widthRatio: 1 }, { baseSides: 4 }, { topOffset: [0.5, 0] }, { a: 40 }]) {
      const shape = { kind: 'parallelepiped', baseSideRatio: 1, heightRatio: 1, baseAngleDeg: 60, ...extra };
      expect(modelSpecSchema.safeParse({ shape, scale }).success).toBe(false);
    }
  });
});

describe('regular prism parameters', () => {
  const { min, max } = RATIO_LIMITS;

  it('supports triangular, square, pentagonal, hexagonal and octagonal bases', () => {
    expect(PRISM_BASE_SIDES).toEqual([3, 4, 5, 6, 8]);
  });

  it.each(PRISM_BASE_SIDES.flatMap((baseSides) => [min, 1.1, max].map((heightRatio) => [baseSides, heightRatio] as const)))(
    'accepts %s base sides with h/a = %s, including the ratio boundaries',
    (baseSides, heightRatio) => {
      // Without a base type the prism keeps its earlier meaning: a regular polygon base.
      expect(modelSpecSchema.parse(prism(baseSides, heightRatio)).shape).toEqual({
        kind: 'prism',
        baseType: 'regular',
        baseSides,
        heightRatio,
        offsetXRatio: 0,
        offsetYRatio: 0,
      });
    },
  );

  it.each([
    ['too few sides', 2],
    ['a side count that is not offered', 7],
    ['too many sides', 9],
    ['a non-integer side count', 3.5],
    ['a numeric string', '3'],
    ['NaN', Number.NaN],
    ['null', null],
    ['missing', undefined],
  ])('rejects a base with %s', (_, baseSides) => {
    expect(modelSpecSchema.safeParse(prism(baseSides, 2)).success).toBe(false);
  });

  it.each([...invalidNumbers, ['just below the minimum', min - 1e-9] as const, ['just above the maximum', max + 1e-9] as const])(
    'rejects a height ratio that is %s, without clamping',
    (_, ratio) => {
      expect(modelSpecSchema.safeParse(prism(4, ratio)).success).toBe(false);
    },
  );

  it('rejects fields of other shapes and absolute dimensions', () => {
    expect(
      modelSpecSchema.safeParse({ shape: { kind: 'prism', baseSides: 3, heightRatio: 2, widthRatio: 1 }, scale }).success,
    ).toBe(false);
    expect(modelSpecSchema.safeParse({ shape: { kind: 'prism', baseSides: 3, heightRatio: 2, a: 40 }, scale }).success).toBe(
      false,
    );
  });
});

describe('prism over a configurable triangle', () => {
  const { min, max } = RATIO_LIMITS;
  const triangle = (baseSideRatio: unknown, baseAngleDeg: unknown, extra: Record<string, unknown> = {}) => ({
    shape: { kind: 'prism', baseType: 'triangle', baseSideRatio, baseAngleDeg, heightRatio: 1, ...extra },
    scale,
  });

  it('shares the angle limits of the parallelogram and defaults to an equilateral triangle', () => {
    expect(BASE_ANGLE_LIMITS).toEqual({ min: 15, max: 165 });
    expect(DEFAULT_TRIANGLE_BASE).toEqual({ baseSideRatio: 1, baseAngleDeg: 60 });
    expect(PRISM_BASE_TYPES).toEqual(['regular', 'triangle', 'trapezoid']);
  });

  it.each([
    [min, BASE_ANGLE_LIMITS.min],
    [max, BASE_ANGLE_LIMITS.max],
    [1, 60],
    [0.75, 90],
    [2.05, 62],
    [1.1, 72.5],
  ])('accepts b/a = %s and α = %s°, including the limits and off-step values', (baseSideRatio, baseAngleDeg) => {
    expect(modelSpecSchema.parse(triangle(baseSideRatio, baseAngleDeg)).shape).toEqual({
      kind: 'prism',
      baseType: 'triangle',
      baseSideRatio,
      baseAngleDeg,
      heightRatio: 1,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['a numeric string', '1'],
    ['missing', undefined],
    ['below the minimum', min - 1e-9],
    ['above the maximum', max + 1e-9],
  ])('rejects a side ratio that is %s', (_, ratio) => {
    expect(modelSpecSchema.safeParse(triangle(ratio, 60)).success).toBe(false);
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.NEGATIVE_INFINITY],
    ['missing', undefined],
    ['below the minimum', BASE_ANGLE_LIMITS.min - 1e-9],
    ['above the maximum', BASE_ANGLE_LIMITS.max + 1e-9],
    ['flat', 180],
  ])('rejects an angle that is %s', (_, angle) => {
    expect(modelSpecSchema.safeParse(triangle(1, angle)).success).toBe(false);
  });

  it('validates only the fields of the selected base type', () => {
    // A triangle with a regular polygon's side count, or a regular base with triangle fields, is rejected.
    expect(modelSpecSchema.safeParse(triangle(1, 60, { baseSides: 3 })).success).toBe(false);
    expect(
      modelSpecSchema.safeParse({
        shape: { kind: 'prism', baseType: 'regular', baseSides: 3, heightRatio: 1, baseSideRatio: 1 },
        scale,
      }).success,
    ).toBe(false);
    expect(
      modelSpecSchema.safeParse({ shape: { kind: 'prism', baseSides: 3, heightRatio: 1, baseAngleDeg: 60 }, scale }).success,
    ).toBe(false);
    expect(modelSpecSchema.safeParse({ shape: { kind: 'prism', baseType: 'trapezoid', heightRatio: 1 }, scale }).success).toBe(
      false,
    );
    // The triangle keeps the shared height and displacement fields.
    expect(modelSpecSchema.parse(triangle(1, 60, { offsetXRatio: -0.5, offsetYRatio: 1.25 })).shape).toMatchObject({
      offsetXRatio: -0.5,
      offsetYRatio: 1.25,
    });
    expect(modelSpecSchema.safeParse(triangle(1, 60, { heightRatio: 0 })).success).toBe(false);
  });
});

describe('prism over a configurable trapezoid', () => {
  const { min, max } = RATIO_LIMITS;
  const trapezoid = (parallelSideRatio: unknown, baseHeightRatio: unknown, baseShiftRatio: unknown, extra = {}) => ({
    shape: { kind: 'prism', baseType: 'trapezoid', parallelSideRatio, baseHeightRatio, baseShiftRatio, heightRatio: 1, ...extra },
    scale,
  });

  it('defaults to b = t = a/2 with b centred and limits the shift to [−2, 2]', () => {
    expect(DEFAULT_TRAPEZOID_BASE).toEqual({ parallelSideRatio: 0.5, baseHeightRatio: 0.5, baseShiftRatio: 0 });
    expect(BASE_SHIFT_LIMITS).toEqual({ min: -2, max: 2 });
    expect(PRISM_BASE_TYPES).toContain('trapezoid');
  });

  it.each([
    [min, min, BASE_SHIFT_LIMITS.min],
    [max, max, BASE_SHIFT_LIMITS.max],
    [0.5, 0.375, -0.25],
    // b = a is a parallelogram, still a valid trapezoid base.
    [1, 0.5, 0],
    [1, 0.5, 0.6],
    [2.05, 1.1, -0.35],
  ])('accepts b/a = %s, t/a = %s and δ/a = %s, including the limits, b = a and off-step values', (b, t, delta) => {
    expect(modelSpecSchema.parse(trapezoid(b, t, delta)).shape).toEqual({
      kind: 'prism',
      baseType: 'trapezoid',
      parallelSideRatio: b,
      baseHeightRatio: t,
      baseShiftRatio: delta,
      heightRatio: 1,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['a numeric string', '0.5'],
    ['missing', undefined],
    ['below the minimum', min - 1e-9],
    ['above the maximum', max + 1e-9],
  ])('rejects a side or base height ratio that is %s', (_, ratio) => {
    expect(modelSpecSchema.safeParse(trapezoid(ratio, 0.5, 0)).success).toBe(false);
    expect(modelSpecSchema.safeParse(trapezoid(0.5, ratio, 0)).success).toBe(false);
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.NEGATIVE_INFINITY],
    ['missing', undefined],
    ['below the minimum', BASE_SHIFT_LIMITS.min - 1e-9],
    ['above the maximum', BASE_SHIFT_LIMITS.max + 1e-9],
  ])('rejects a shift that is %s', (_, shift) => {
    expect(modelSpecSchema.safeParse(trapezoid(0.5, 0.5, shift)).success).toBe(false);
  });

  it('rejects fields of other base types and keeps the shared prism fields', () => {
    expect(modelSpecSchema.safeParse(trapezoid(0.5, 0.5, 0, { baseAngleDeg: 60 })).success).toBe(false);
    expect(modelSpecSchema.safeParse(trapezoid(0.5, 0.5, 0, { baseSides: 4 })).success).toBe(false);
    expect(modelSpecSchema.parse(trapezoid(0.5, 0.5, 0, { offsetXRatio: 1 })).shape).toMatchObject({ offsetXRatio: 1 });
  });
});

describe('prism and parallelepiped displacement of the upper base', () => {
  const withOffsets = (kind: 'prism' | 'parallelepiped', offsets: Record<string, unknown>) => ({
    shape:
      kind === 'prism'
        ? { kind, baseSides: 4, heightRatio: 4, ...offsets }
        : { kind, baseSideRatio: 1, heightRatio: 4, baseAngleDeg: 60, ...offsets },
    scale,
  });
  const kinds = ['prism', 'parallelepiped'] as const;

  it('limits both offsets to [−4, 4]', () => {
    expect(TILT_OFFSET_LIMITS).toEqual({ min: -4, max: 4 });
  });

  it.each(kinds)('defaults missing %s offsets to 0, so earlier specifications keep their right solid', (kind) => {
    expect(modelSpecSchema.parse(withOffsets(kind, {})).shape).toMatchObject({ offsetXRatio: 0, offsetYRatio: 0 });
    expect(modelSpecSchema.parse(withOffsets(kind, { offsetYRatio: 0.5 })).shape).toMatchObject({
      offsetXRatio: 0,
      offsetYRatio: 0.5,
    });
  });

  it.each(
    kinds.flatMap((kind) =>
      [
        [-4, 4],
        [4, -4],
        [-0.1, 0],
        [1.1, -0.75],
        [0, -2],
      ].map(([x, y]) => [kind, x, y] as const),
    ),
  )('accepts a %s at h/a = 4 with offsets (%s, %s), including the corners and negative or off-step values', (kind, x, y) => {
    expect(modelSpecSchema.parse(withOffsets(kind, { offsetXRatio: x, offsetYRatio: y })).shape).toMatchObject({
      offsetXRatio: x,
      offsetYRatio: y,
    });
  });

  it.each(
    kinds.flatMap((kind) =>
      [
        ['NaN', Number.NaN],
        ['positive infinity', Number.POSITIVE_INFINITY],
        ['negative infinity', Number.NEGATIVE_INFINITY],
        ['a numeric string', '0.5'],
        ['null', null],
        ['just below the minimum', -4 - 1e-9],
        ['just above the maximum', 4 + 1e-9],
      ].map(([label, value]) => [kind, label, value] as const),
    ),
  )('rejects a %s offset that is %s, without clamping', (kind, _, value) => {
    expect(modelSpecSchema.safeParse(withOffsets(kind, { offsetXRatio: value })).success).toBe(false);
    expect(modelSpecSchema.safeParse(withOffsets(kind, { offsetYRatio: value })).success).toBe(false);
  });

  it('rejects offsets on solids without a displaceable upper base and a stored oblique flag', () => {
    for (const shape of [
      { kind: 'cube', offsetXRatio: 1 },
      { kind: 'cuboid', widthRatio: 1, heightRatio: 1, offsetXRatio: 1 },
      { kind: 'pyramid', baseSides: 4, heightRatio: 1, offsetYRatio: 1 },
      { kind: 'cylinder', heightRatio: 2, offsetXRatio: 1 },
    ]) {
      expect(modelSpecSchema.safeParse({ shape, scale }).success).toBe(false);
    }
    expect(modelSpecSchema.safeParse(withOffsets('prism', { offsetXRatio: 1, oblique: true })).success).toBe(false);
  });
});

describe('pyramid bases and apex position', () => {
  const pyramidWith = (fields: Record<string, unknown>) => ({ shape: { kind: 'pyramid', heightRatio: 1, ...fields }, scale });
  const bases = {
    regular: { baseType: 'regular', baseSides: 5 },
    triangle: { baseType: 'triangle', baseSideRatio: 0.75, baseAngleDeg: 90 },
    parallelogram: { baseType: 'parallelogram', baseSideRatio: 2.05, baseAngleDeg: 120 },
    trapezoid: { baseType: 'trapezoid', parallelSideRatio: 0.5, baseHeightRatio: 0.375, baseShiftRatio: -0.25 },
  } as const;

  it('offers the regular polygon, triangle, parallelogram and trapezoid', () => {
    expect(PYRAMID_BASE_TYPES).toEqual(['regular', 'triangle', 'parallelogram', 'trapezoid']);
    expect(DEFAULT_PARALLELOGRAM_BASE).toEqual({ baseSideRatio: 1, baseAngleDeg: 60 });
  });

  it.each(Object.entries(bases))('accepts a %s base and defaults the apex to the base centroid', (_, base) => {
    expect(modelSpecSchema.parse(pyramidWith(base)).shape).toEqual({
      kind: 'pyramid',
      heightRatio: 1,
      ...base,
      apexXRatio: 0,
      apexYRatio: 0,
    });
  });

  it.each([
    [-4, 4],
    [4, -4],
    [-0.1, 0],
    [2.35, -3.05],
  ])('accepts the apex at (%s, %s) at h/a = 4, including the limits, negative and off-step values', (x, y) => {
    for (const base of Object.values(bases)) {
      const shape = pyramidWith({ ...base, heightRatio: 4, apexXRatio: x, apexYRatio: y });
      expect(modelSpecSchema.parse(shape).shape).toMatchObject({
        apexXRatio: x,
        apexYRatio: y,
      });
    }
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['a numeric string', '1'],
    ['null', null],
    ['below the minimum', -4 - 1e-9],
    ['above the maximum', 4 + 1e-9],
  ])('rejects an apex coordinate that is %s', (_, value) => {
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.triangle, apexXRatio: value })).success).toBe(false);
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.trapezoid, apexYRatio: value })).success).toBe(false);
  });

  it('validates only the fields of the selected base type and keeps the prism offsets apart', () => {
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.parallelogram, baseSides: 4 })).success).toBe(false);
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.regular, baseAngleDeg: 60 })).success).toBe(false);
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.triangle, baseAngleDeg: 170 })).success).toBe(false);
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.trapezoid, baseShiftRatio: 2.5 })).success).toBe(false);
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.regular, offsetXRatio: 1 })).success).toBe(false);
    expect(modelSpecSchema.safeParse(pyramidWith({ baseType: 'circle' })).success).toBe(false);
    expect(modelSpecSchema.safeParse(pyramidWith({ ...bases.triangle, heightRatio: 0 })).success).toBe(false);
  });
});

describe('regular pyramid parameters', () => {
  const { min, max } = RATIO_LIMITS;

  it('defaults to a square base with h = a and supports triangular to hexagonal and octagonal bases', () => {
    expect(PYRAMID_BASE_SIDES).toEqual([3, 4, 5, 6, 8]);
    expect(modelSpecSchema.parse(defaultModelSpecs.pyramid)).toEqual({
      shape: { kind: 'pyramid', baseType: 'regular', baseSides: 4, heightRatio: 1, apexXRatio: 0, apexYRatio: 0 },
      scale,
    });
  });

  it.each(PYRAMID_BASE_SIDES.flatMap((baseSides) => [min, 1.1, max].map((heightRatio) => [baseSides, heightRatio] as const)))(
    'accepts %s base sides with h/a = %s, including the ratio boundaries',
    (baseSides, heightRatio) => {
      // Without a base type or apex position the pyramid keeps its earlier meaning: regular, apex above the centre.
      expect(modelSpecSchema.parse(pyramid(baseSides, heightRatio)).shape).toEqual({
        kind: 'pyramid',
        baseType: 'regular',
        baseSides,
        heightRatio,
        apexXRatio: 0,
        apexYRatio: 0,
      });
    },
  );

  it.each([
    ['too few sides', 2],
    ['a side count that is not offered', 7],
    ['too many sides', 9],
    ['a non-integer side count', 4.5],
    ['a numeric string', '4'],
    ['missing', undefined],
  ])('rejects a base with %s', (_, baseSides) => {
    expect(modelSpecSchema.safeParse(pyramid(baseSides, 1)).success).toBe(false);
  });

  it.each([...invalidNumbers, ['just below the minimum', min - 1e-9] as const, ['just above the maximum', max + 1e-9] as const])(
    'rejects a height ratio that is %s, without clamping',
    (_, ratio) => {
      expect(modelSpecSchema.safeParse(pyramid(4, ratio)).success).toBe(false);
    },
  );

  it('rejects unknown fields such as an apex offset vector', () => {
    const shape = { kind: 'pyramid', baseSides: 4, heightRatio: 1, apexOffset: [0.1, 0] };
    expect(modelSpecSchema.safeParse({ shape, scale }).success).toBe(false);
  });
});

describe('regular tetrahedron', () => {
  it('has no independent parameters', () => {
    expect(modelSpecSchema.parse(defaultModelSpecs.tetrahedron)).toEqual({ shape: { kind: 'tetrahedron' }, scale });
    for (const extra of [{ baseSides: 3 }, { heightRatio: 1 }, { edge: 40 }]) {
      expect(modelSpecSchema.safeParse({ shape: { kind: 'tetrahedron', ...extra }, scale }).success).toBe(false);
    }
  });

  it('keeps h/a = √(2/3) at full precision, off the 0,25 interaction grid', () => {
    expect(TETRAHEDRON_HEIGHT_RATIO).toBe(Math.sqrt(2 / 3));
    expect(TETRAHEDRON_HEIGHT_RATIO ** 2).toBeCloseTo(2 / 3, 15);
    expect(Number.isInteger(TETRAHEDRON_HEIGHT_RATIO * 4)).toBe(false);
  });
});

describe('octahedron, icosahedron and dodecahedron', () => {
  it.each(REGULAR_POLYHEDRON_KINDS)('accepts the %s with no independent parameters', (kind) => {
    expect(modelSpecSchema.parse(defaultModelSpecs[kind])).toEqual({ shape: { kind }, scale });
    for (const extra of [{ heightRatio: 1 }, { baseSides: 5 }, { offsetXRatio: 0 }, { edge: 40 }, { subdivisions: 2 }]) {
      expect(modelSpecSchema.safeParse({ shape: { kind, ...extra }, scale }).success).toBe(false);
    }
  });

  it.each(REGULAR_POLYHEDRON_KINDS)('validates the export size of the %s like every other solid', (kind) => {
    for (const [, longestDimensionMm] of [...invalidNumbers, ['above the maximum', MAX_LONGEST_DIMENSION_MM + 0.001]]) {
      expect(modelSpecSchema.safeParse({ shape: { kind }, scale: { longestDimensionMm } }).success).toBe(false);
    }
    expect(modelSpecSchema.safeParse({ shape: { kind }, scale: { longestDimensionMm: MAX_LONGEST_DIMENSION_MM } }).success).toBe(
      true,
    );
  });

  it('rejects other names for them', () => {
    for (const kind of ['octahedra', 'icosahedra', 'Dodecahedron', 'regular-polyhedron', '']) {
      expect(modelSpecSchema.safeParse({ shape: { kind }, scale }).success).toBe(false);
    }
  });
});

describe('circular cylinder and cone parameters', () => {
  const { min, max } = ROUND_HEIGHT_LIMITS;
  const round = (kind: string, heightRatio: unknown) => ({ shape: { kind, heightRatio }, scale });

  it('limits h/r as the other ratios limit the diameter: h/(2r) in [0.25, 4]', () => {
    expect(ROUND_HEIGHT_LIMITS).toEqual({ min: 0.5, max: 8 });
  });

  it.each(['cylinder', 'cone'] as const)('defaults the %s to h/r = 2', (kind) => {
    expect(modelSpecSchema.parse(defaultModelSpecs[kind])).toEqual({ shape: { kind, heightRatio: 2, offsetRatio: 0 }, scale });
  });

  it.each(['cylinder', 'cone'].flatMap((kind) => [min, 1.1, 2.05, 4.8, max].map((heightRatio) => [kind, heightRatio] as const)))(
    'accepts a %s with h/r = %s, including the boundaries and values off the 0,25 grid',
    (kind, heightRatio) => {
      // Without a displacement the solid keeps its earlier meaning: a right cylinder or cone.
      expect(modelSpecSchema.parse(round(kind, heightRatio)).shape).toEqual({ kind, heightRatio, offsetRatio: 0 });
    },
  );

  it.each(
    ['cylinder', 'cone'].flatMap((kind) =>
      [...invalidNumbers, ['just below the minimum', min - 1e-9] as const, ['just above the maximum', max + 1e-9] as const].map(
        ([label, ratio]) => [kind, label, ratio] as const,
      ),
    ),
  )('rejects a %s whose height ratio is %s', (kind, _, ratio) => {
    expect(modelSpecSchema.safeParse(round(kind, ratio)).success).toBe(false);
  });

  it.each(['cylinder', 'cone'].flatMap((kind) => [0, 0.25, 1.1, 4].map((offsetRatio) => [kind, offsetRatio] as const)))(
    'accepts a %s at h/r = 2 with d/r = %s, including the limits and off-step values',
    (kind, offsetRatio) => {
      expect(modelSpecSchema.parse({ shape: { kind, heightRatio: 2, offsetRatio }, scale }).shape).toEqual({
        kind,
        heightRatio: 2,
        offsetRatio,
      });
    },
  );

  it.each(
    ['cylinder', 'cone'].flatMap((kind) =>
      [
        ['negative', -0.25],
        ['just above the maximum', 4 + 1e-9],
        ['NaN', Number.NaN],
        ['infinite', Number.POSITIVE_INFINITY],
        ['a numeric string', '1'],
        ['null', null],
      ].map(([label, offset]) => [kind, label, offset] as const),
    ),
  )('rejects a %s whose displacement is %s', (kind, _, offsetRatio) => {
    expect(ROUND_OFFSET_LIMITS).toEqual({ min: 0, max: 4 });
    expect(modelSpecSchema.safeParse({ shape: { kind, heightRatio: 2, offsetRatio }, scale }).success).toBe(false);
  });

  it.each(['cylinder', 'cone'])('rejects a %s with a base, a top radius, a resolution or absolute dimensions', (kind) => {
    for (const extra of [{ baseSides: 4 }, { topRatio: 0.5 }, { segments: 32 }, { radius: 40 }, { offsetYRatio: 1 }]) {
      expect(modelSpecSchema.safeParse({ shape: { kind, heightRatio: 2, ...extra }, scale }).success).toBe(false);
    }
  });
});

describe('solid ball', () => {
  it('has no independent parameters', () => {
    expect(modelSpecSchema.parse(defaultModelSpecs.ball)).toEqual({ shape: { kind: 'ball' }, scale });
    for (const extra of [{ radius: 40 }, { heightRatio: 1 }, { segments: 128 }, { hollow: true }]) {
      expect(modelSpecSchema.safeParse({ shape: { kind: 'ball', ...extra }, scale }).success).toBe(false);
    }
  });

  it.each([...invalidNumbers, ['above the maximum', MAX_LONGEST_DIMENSION_MM + 0.001] as const])(
    'rejects a ball whose longest dimension is %s',
    (_, longestDimensionMm) => {
      expect(modelSpecSchema.safeParse({ shape: { kind: 'ball' }, scale: { longestDimensionMm } }).success).toBe(false);
    },
  );
});

describe('minimum inclination of a tilted solid', () => {
  const tan15 = Math.tan((MIN_INCLINATION_DEG * Math.PI) / 180);
  const prism = (heightRatio: number, offsetXRatio: number, offsetYRatio: number) => ({
    shape: { kind: 'prism', baseSides: 4, heightRatio, offsetXRatio, offsetYRatio },
    scale,
  });

  it('allows a total displacement of h / tan 15°, the same in every direction', () => {
    expect(MIN_INCLINATION_DEG).toBe(15);
    expect(maxTiltDisplacement(1)).toBeCloseTo(1 / tan15, 12);
    const limit = maxTiltDisplacement(0.5);
    // ≈ 1,866 along X and along the diagonal alike: the total displacement counts, not each component.
    expect(modelSpecSchema.safeParse(prism(0.5, limit, 0)).success).toBe(true);
    expect(modelSpecSchema.safeParse(prism(0.5, limit * Math.SQRT1_2, -limit * Math.SQRT1_2)).success).toBe(true);
    expect(modelSpecSchema.safeParse(prism(0.5, limit * 1.001, 0)).success).toBe(false);
    expect(modelSpecSchema.safeParse(prism(0.5, 1.5, 1.5)).success).toBe(false);
  });

  it('applies to pyramids, parallelepipeds, cylinders and cones, with every offset within its own limits', () => {
    const steep = 0.25 / tan15;
    for (const shape of [
      { kind: 'pyramid', baseSides: 4, heightRatio: 0.25, apexXRatio: 0, apexYRatio: steep * 1.01 },
      { kind: 'parallelepiped', baseSideRatio: 1, heightRatio: 0.25, baseAngleDeg: 60, offsetXRatio: -steep * 1.01 },
      { kind: 'cylinder', heightRatio: 0.5, offsetRatio: (0.5 / tan15) * 1.01 },
      { kind: 'cone', heightRatio: 0.5, offsetRatio: (0.5 / tan15) * 1.01 },
    ]) {
      expect(modelSpecSchema.safeParse({ shape, scale }).success).toBe(false);
    }
    expect(
      modelSpecSchema.safeParse({ shape: { kind: 'pyramid', baseSides: 4, heightRatio: 0.25, apexYRatio: steep }, scale })
        .success,
    ).toBe(true);
  });
});

describe('plane sections', () => {
  const cylinder = { kind: 'cylinder', heightRatio: 2, offsetRatio: 1 } as const;
  const at = (positionPercent: number) => ({ type: 'parallel-to-bases', positionPercent }) as const;
  const scale = { longestDimensionMm: 80 } as const;

  it('accepts a cut parallel to a cylinder’s bases at 10–90 % of its height, also between the steps', () => {
    for (const positionPercent of [10, 12.5, 50, 90]) {
      expect(modelSpecSchema.parse({ shape: cylinder, scale, section: at(positionPercent) }).section).toEqual(
        at(positionPercent),
      );
    }
    expect(modelSpecSchema.parse({ shape: cylinder, scale })).not.toHaveProperty('section');
  });

  it('rejects positions outside 10–90 %, non-finite ones and unknown section types', () => {
    for (const positionPercent of [9.999, 90.001, 0, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(modelSpecSchema.safeParse({ shape: cylinder, scale, section: at(positionPercent) }).success).toBe(false);
    }
    expect(modelSpecSchema.safeParse({ shape: cylinder, scale, section: { type: 'axial', positionPercent: 50 } }).success).toBe(
      false,
    );
    expect(modelSpecSchema.safeParse({ shape: cylinder, scale, section: { ...at(50), extra: 1 } }).success).toBe(false);
  });

  it('offers the section only for the cylinder so far', () => {
    expect(SECTIONS_BY_SHAPE).toEqual({ cylinder: ['parallel-to-bases'] });
    const cone = modelSpecSchema.safeParse({ shape: { kind: 'cone', heightRatio: 2 }, scale, section: at(50) });
    expect(cone.success).toBe(false);
    expect(cone.error?.issues[0]?.path).toEqual(['section']);
    expect(modelSpecSchema.safeParse({ shape: { kind: 'cube' }, scale, section: at(50) }).success).toBe(false);
  });
});
