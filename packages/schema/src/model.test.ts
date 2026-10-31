import { describe, expect, it } from 'vitest';
import { DEFAULT_CUBE_EDGE_LENGTH_MM, defaultModelSpecs, MAX_UNIT_LENGTH_MM, modelSpecSchema } from './index.ts';

const cubeWithUnitLength = (unitLengthMm: unknown) => ({ shape: { kind: 'cube' }, scale: { unitLengthMm } });

describe('modelSpecSchema', () => {
  it('accepts the default cube with an 80 mm edge', () => {
    expect(DEFAULT_CUBE_EDGE_LENGTH_MM).toBe(80);
    expect(modelSpecSchema.parse(defaultModelSpecs.cube)).toEqual({
      shape: { kind: 'cube' },
      scale: { unitLengthMm: 80 },
    });
  });

  it.each([0.001, 1, 12.5, MAX_UNIT_LENGTH_MM])('accepts a positive finite unit length of %s mm', (unitLengthMm) => {
    expect(modelSpecSchema.safeParse(cubeWithUnitLength(unitLengthMm)).success).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative zero', -0],
    ['negative', -80],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['above the maximum', MAX_UNIT_LENGTH_MM + 0.001],
    ['a numeric string', '80'],
    ['null', null],
    ['missing', undefined],
  ])('rejects a unit length that is %s', (_, unitLengthMm) => {
    expect(modelSpecSchema.safeParse(cubeWithUnitLength(unitLengthMm)).success).toBe(false);
  });

  it('rejects independent cube dimensions because all cube edges are equal by definition', () => {
    const result = modelSpecSchema.safeParse({
      shape: { kind: 'cube', width: 1, depth: 2, height: 3 },
      scale: { unitLengthMm: 80 },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['an unknown shape', { shape: { kind: 'dodecahedron' }, scale: { unitLengthMm: 80 } }],
    ['a missing shape', { scale: { unitLengthMm: 80 } }],
    ['a missing scale', { shape: { kind: 'cube' } }],
    ['extra scale fields', { shape: { kind: 'cube' }, scale: { unitLengthMm: 80, factor: 2 } }],
    ['extra top-level fields', { shape: { kind: 'cube' }, scale: { unitLengthMm: 80 }, connectors: [] }],
    ['a non-object', 'cube'],
  ])('rejects %s', (_, input) => {
    expect(modelSpecSchema.safeParse(input).success).toBe(false);
  });
});
