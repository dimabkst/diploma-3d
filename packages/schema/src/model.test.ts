import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LONGEST_DIMENSION_MM,
  defaultModelSpecs,
  MAX_LONGEST_DIMENSION_MM,
  modelSpecSchema,
  PRISM_BASE_SIDES,
  PYRAMID_BASE_SIDES,
  RATIO_LIMITS,
  TETRAHEDRON_HEIGHT_RATIO,
} from './index.ts';

const scale = { longestDimensionMm: 80 };
const cubeWithLongestDimension = (longestDimensionMm: unknown) => ({ shape: { kind: 'cube' }, scale: { longestDimensionMm } });
const cuboid = (widthRatio: unknown, heightRatio: unknown) => ({ shape: { kind: 'cuboid', widthRatio, heightRatio }, scale });
const prism = (baseSides: unknown, heightRatio: unknown) => ({ shape: { kind: 'prism', baseSides, heightRatio }, scale });
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
      shape: { kind: 'prism', baseSides: 3, heightRatio: 2 },
      scale,
    });
  });

  it.each([0.001, 1, 12.5, MAX_LONGEST_DIMENSION_MM])('accepts a longest dimension of %s mm', (longestDimensionMm) => {
    expect(modelSpecSchema.safeParse(cubeWithLongestDimension(longestDimensionMm)).success).toBe(true);
  });

  it.each([...invalidNumbers, ['above the maximum', MAX_LONGEST_DIMENSION_MM + 0.001] as const])(
    'rejects a longest dimension that is %s',
    (_, longestDimensionMm) => {
      expect(modelSpecSchema.safeParse(cubeWithLongestDimension(longestDimensionMm)).success).toBe(false);
    },
  );

  it('rejects independent cube dimensions because all cube edges are equal by definition', () => {
    const result = modelSpecSchema.safeParse({ shape: { kind: 'cube', width: 1, depth: 2, height: 3 }, scale });
    expect(result.success).toBe(false);
  });

  it.each([
    ['an unknown shape', { shape: { kind: 'dodecahedron' }, scale }],
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

  it('limits both ratios to [0.25, 4]', () => {
    expect(RATIO_LIMITS).toEqual({ min: 0.25, max: 4 });
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

describe('regular prism parameters', () => {
  const { min, max } = RATIO_LIMITS;

  it('supports triangular, square, pentagonal, hexagonal and octagonal bases', () => {
    expect(PRISM_BASE_SIDES).toEqual([3, 4, 5, 6, 8]);
  });

  it.each(PRISM_BASE_SIDES.flatMap((baseSides) => [min, 1.1, max].map((heightRatio) => [baseSides, heightRatio] as const)))(
    'accepts %s base sides with h/a = %s, including the ratio boundaries',
    (baseSides, heightRatio) => {
      expect(modelSpecSchema.parse(prism(baseSides, heightRatio)).shape).toEqual({ kind: 'prism', baseSides, heightRatio });
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

describe('regular pyramid parameters', () => {
  const { min, max } = RATIO_LIMITS;

  it('defaults to a square base with h = a and supports triangular to hexagonal and octagonal bases', () => {
    expect(PYRAMID_BASE_SIDES).toEqual([3, 4, 5, 6, 8]);
    expect(modelSpecSchema.parse(defaultModelSpecs.pyramid)).toEqual({
      shape: { kind: 'pyramid', baseSides: 4, heightRatio: 1 },
      scale,
    });
  });

  it.each(PYRAMID_BASE_SIDES.flatMap((baseSides) => [min, 1.1, max].map((heightRatio) => [baseSides, heightRatio] as const)))(
    'accepts %s base sides with h/a = %s, including the ratio boundaries',
    (baseSides, heightRatio) => {
      expect(modelSpecSchema.parse(pyramid(baseSides, heightRatio)).shape).toEqual({ kind: 'pyramid', baseSides, heightRatio });
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

  it('rejects an apex offset or other extra fields', () => {
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
