import { describe, expect, it } from 'vitest';
import {
  CUBOID_RATIO_LIMITS,
  DEFAULT_LONGEST_DIMENSION_MM,
  defaultModelSpecs,
  MAX_LONGEST_DIMENSION_MM,
  modelSpecSchema,
} from './index.ts';

const scale = { longestDimensionMm: 80 };
const cubeWithLongestDimension = (longestDimensionMm: unknown) => ({ shape: { kind: 'cube' }, scale: { longestDimensionMm } });
const cuboid = (widthRatio: unknown, heightRatio: unknown) => ({ shape: { kind: 'cuboid', widthRatio, heightRatio }, scale });

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
  const { min, max } = CUBOID_RATIO_LIMITS;

  it('limits both ratios to [0.25, 4]', () => {
    expect(CUBOID_RATIO_LIMITS).toEqual({ min: 0.25, max: 4 });
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
