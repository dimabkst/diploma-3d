import { describe, expect, it } from 'vitest';
import {
  alignedTrapezoidShift,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterTexts,
  resolveModelRequest,
  validateAngle,
  validateOffset,
  validateRatio,
} from './parameters.ts';

const texts = (overrides: Partial<ParameterTexts>): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const triangle = initialParameterChoices();

describe('validateRatio', () => {
  it.each([
    ['0,25', 0.25],
    ['4', 4],
    ['1,5', 1.5],
    // Values between the 0,1 stepping grid are as valid as typed.
    ['2.05', 2.05],
    ['1,234', 1.234],
  ])('accepts %s, including the limits', (text, value) => {
    expect(validateRatio(text)).toEqual({ value });
  });

  it.each([
    ['', 'Введіть значення.'],
    ['   ', 'Введіть значення.'],
    ['-', 'Введіть число, наприклад 1,5.'],
    ['abc', 'Введіть число, наприклад 1,5.'],
    ['0,2', 'Допустимі значення — від 0,25 до 4.'],
    ['4,01', 'Допустимі значення — від 0,25 до 4.'],
    ['0', 'Допустимі значення — від 0,25 до 4.'],
    ['-1', 'Допустимі значення — від 0,25 до 4.'],
  ])('reports "%s" without clamping it', (text, error) => {
    expect(validateRatio(text)).toEqual({ error });
  });
});

describe('validateAngle', () => {
  it.each([
    ['15', 15],
    ['165', 165],
    ['60', 60],
    // Values between the 5° stepping grid are as valid as typed, with a comma or a point.
    ['62', 62],
    ['72,5', 72.5],
    ['72.5', 72.5],
  ])('accepts %s, including the limits', (text, value) => {
    expect(validateAngle(text)).toEqual({ value });
  });

  it.each([
    ['', 'Введіть значення.'],
    ['60°', 'Введіть число, наприклад 60.'],
    ['abc', 'Введіть число, наприклад 60.'],
    ['14,9', 'Допустимі значення — від 15° до 165°.'],
    ['165,1', 'Допустимі значення — від 15° до 165°.'],
    ['180', 'Допустимі значення — від 15° до 165°.'],
    ['0', 'Допустимі значення — від 15° до 165°.'],
  ])('reports "%s" without clamping it', (text, error) => {
    expect(validateAngle(text)).toEqual({ error });
  });
});

describe('validateOffset', () => {
  it.each([
    ['0', 0],
    ['-2', -2],
    ['2', 2],
    ['-0,1', -0.1],
    ['-0.75', -0.75],
    ['1,234', 1.234],
  ])('accepts %s, including the limits and negative values', (text, value) => {
    expect(validateOffset(text)).toEqual({ value });
  });

  it.each([
    ['', 'Введіть значення.'],
    ['-', 'Введіть число, наприклад -0,5.'],
    ['−1', 'Введіть число, наприклад -0,5.'],
    ['-2,01', 'Допустимі значення — від -2 до 2.'],
    ['2.5', 'Допустимі значення — від -2 до 2.'],
  ])('reports "%s" without clamping it', (text, error) => {
    expect(validateOffset(text)).toEqual({ error });
  });
});

describe('resolveModelRequest', () => {
  it('starts the cuboid at b/a = 1,5 and c/a = 2 and the prism at three sides and h/a = 2, at 80 mm', () => {
    expect(initialParameterTexts()).toEqual({
      cuboidWidthRatio: '1,5',
      cuboidHeightRatio: '2',
      parallelepipedBaseSideRatio: '1',
      parallelepipedHeightRatio: '1',
      parallelepipedBaseAngleDeg: '60',
      parallelepipedOffsetXRatio: '0',
      parallelepipedOffsetYRatio: '0',
      prismHeightRatio: '2',
      prismOffsetXRatio: '0',
      prismOffsetYRatio: '0',
      prismTriangleSideRatio: '1',
      prismTriangleAngleDeg: '60',
      prismTrapezoidSideRatio: '0,5',
      prismTrapezoidHeightRatio: '0,5',
      prismTrapezoidShiftRatio: '0',
      pyramidHeightRatio: '1',
      cylinderHeightRatio: '2',
      coneHeightRatio: '2',
    });
    expect(initialParameterChoices()).toEqual({ prismBaseType: 'regular', prismBaseSides: 3, pyramidBaseSides: 4 });
    expect(resolveModelRequest('cuboid', initialParameterTexts(), triangle).spec).toEqual({
      shape: { kind: 'cuboid', widthRatio: 1.5, heightRatio: 2 },
      scale: { longestDimensionMm: 80 },
    });
    expect(resolveModelRequest('prism', initialParameterTexts(), triangle).spec).toEqual({
      shape: { kind: 'prism', baseType: 'regular', baseSides: 3, heightRatio: 2, offsetXRatio: 0, offsetYRatio: 0 },
      scale: { longestDimensionMm: 80 },
    });
  });

  it('ignores parameter fields for the cube', () => {
    const request = resolveModelRequest(
      'cube',
      {
        ...initialParameterTexts(),
        cuboidWidthRatio: '',
        cuboidHeightRatio: 'abc',
        prismHeightRatio: '-',
        pyramidHeightRatio: '9',
      },
      triangle,
    );
    expect(request.spec).toEqual({ shape: { kind: 'cube' }, scale: { longestDimensionMm: 80 } });
    expect(request.errors).toEqual({});
  });

  it('reads only the fields of the selected shape', () => {
    const mixed = texts({ cuboidHeightRatio: 'abc', prismHeightRatio: '3' });
    expect(resolveModelRequest('prism', mixed, triangle).spec?.shape).toEqual({
      kind: 'prism',
      baseType: 'regular',
      baseSides: 3,
      heightRatio: 3,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
    expect(resolveModelRequest('cuboid', mixed, triangle).errors).toEqual({ cuboidHeightRatio: 'Введіть число, наприклад 1,5.' });
  });

  it('reports every invalid field and produces no specification', () => {
    const request = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '', cuboidHeightRatio: '9' }), triangle);
    expect(request.spec).toBeUndefined();
    expect(request.key).toBeUndefined();
    expect(request.errors).toEqual({
      cuboidWidthRatio: 'Введіть значення.',
      cuboidHeightRatio: 'Допустимі значення — від 0,25 до 4.',
    });
    expect(request.values).toEqual({});

    const prism = resolveModelRequest('prism', texts({ prismHeightRatio: '4,5' }), triangle);
    expect(prism.spec).toBeUndefined();
    expect(prism.errors).toEqual({ prismHeightRatio: 'Допустимі значення — від 0,25 до 4.' });
  });

  it('keeps the validated value of a correct field while the other one is being corrected', () => {
    const partial = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '1,1', cuboidHeightRatio: '-' }), triangle);
    expect(partial.spec).toBeUndefined();
    expect(partial.values).toEqual({ cuboidWidthRatio: 1.1 });
    expect(partial.errors).toEqual({ cuboidHeightRatio: 'Введіть число, наприклад 1,5.' });
    expect(partial.scale).toEqual({ longestDimensionMm: 80 });
  });

  it('uses the exact typed values between the stepping quarters for the specification', () => {
    const request = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '2,05', cuboidHeightRatio: '1.1' }), triangle);
    expect(request.values).toEqual({ cuboidWidthRatio: 2.05, cuboidHeightRatio: 1.1 });
    expect(request.spec?.shape).toEqual({ kind: 'cuboid', widthRatio: 2.05, heightRatio: 1.1 });
    expect(request.scale).toBe(request.spec?.scale);
    expect(resolveModelRequest('prism', texts({ prismHeightRatio: '1,1' }), triangle).spec?.shape).toEqual({
      kind: 'prism',
      baseType: 'regular',
      baseSides: 3,
      heightRatio: 1.1,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
  });

  it.each([3, 4, 5, 6, 8] as const)('builds a prism with %s base sides and keeps h/a when the base changes', (prismBaseSides) => {
    const request = resolveModelRequest('prism', texts({ prismHeightRatio: '0,75' }), { ...triangle, prismBaseSides });
    expect(request.spec?.shape).toEqual({
      kind: 'prism',
      baseType: 'regular',
      baseSides: prismBaseSides,
      heightRatio: 0.75,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
    expect(request.values).toEqual({ prismHeightRatio: 0.75, prismOffsetXRatio: 0, prismOffsetYRatio: 0 });
  });

  it('gives equal keys to texts that denote the same model and different keys otherwise', () => {
    const comma = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '1,5' }), triangle);
    const point = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '1.50' }), triangle);
    const other = resolveModelRequest('cuboid', texts({ cuboidHeightRatio: '2,5' }), triangle);
    expect(point.key).toBe(comma.key);
    expect(other.key).not.toBe(comma.key);
    expect(resolveModelRequest('cube', initialParameterTexts(), triangle).key).not.toBe(comma.key);
    // The same h/a with another base is another model.
    const square = resolveModelRequest('prism', initialParameterTexts(), { ...triangle, prismBaseSides: 4 });
    expect(square.key).not.toBe(resolveModelRequest('prism', initialParameterTexts(), triangle).key);
  });

  it('starts the pyramid with a square base and h = a, and keeps h/a when its base changes', () => {
    expect(resolveModelRequest('pyramid', initialParameterTexts(), triangle).spec?.shape).toEqual({
      kind: 'pyramid',
      baseSides: 4,
      heightRatio: 1,
    });
    for (const pyramidBaseSides of [3, 4, 5, 6, 8] as const) {
      const request = resolveModelRequest('pyramid', texts({ pyramidHeightRatio: '1,1' }), { ...triangle, pyramidBaseSides });
      expect(request.spec?.shape).toEqual({ kind: 'pyramid', baseSides: pyramidBaseSides, heightRatio: 1.1 });
    }
  });

  it('keeps the pyramid and prism parameters apart', () => {
    const mixed = texts({ prismHeightRatio: '3', pyramidHeightRatio: '' });
    expect(resolveModelRequest('prism', mixed, triangle).spec?.shape).toEqual({
      kind: 'prism',
      baseType: 'regular',
      baseSides: 3,
      heightRatio: 3,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
    const pyramid = resolveModelRequest('pyramid', mixed, triangle);
    expect(pyramid.spec).toBeUndefined();
    expect(pyramid.errors).toEqual({ pyramidHeightRatio: 'Введіть значення.' });
  });

  it('builds the tetrahedron without reading any field', () => {
    const empty = Object.fromEntries(Object.keys(initialParameterTexts()).map((key) => [key, ''])) as ParameterTexts;
    const request = resolveModelRequest('tetrahedron', empty, triangle);
    expect(request.spec).toEqual({ shape: { kind: 'tetrahedron' }, scale: { longestDimensionMm: 80 } });
    expect(request.errors).toEqual({});
  });

  it.each(['cylinder', 'cone'] as const)('builds the %s from its own h/r, including precise typed values', (kind) => {
    const key = kind === 'cylinder' ? 'cylinderHeightRatio' : 'coneHeightRatio';
    expect(resolveModelRequest(kind, initialParameterTexts(), triangle).spec).toEqual({
      shape: { kind, heightRatio: 2 },
      scale: { longestDimensionMm: 80 },
    });
    expect(resolveModelRequest(kind, texts({ [key]: '2.05' }), triangle).spec?.shape).toEqual({ kind, heightRatio: 2.05 });
    const invalid = resolveModelRequest(kind, texts({ [key]: '4,5' }), triangle);
    expect(invalid.spec).toBeUndefined();
    expect(invalid.errors).toEqual({ [key]: 'Допустимі значення — від 0,25 до 4.' });
  });

  it('keeps the cylinder and cone ratios apart', () => {
    const mixed = texts({ cylinderHeightRatio: '1,1', coneHeightRatio: '' });
    expect(resolveModelRequest('cylinder', mixed, triangle).spec?.shape).toEqual({ kind: 'cylinder', heightRatio: 1.1 });
    expect(resolveModelRequest('cone', mixed, triangle).errors).toEqual({ coneHeightRatio: 'Введіть значення.' });
  });

  it('starts the parallelepiped with b = a, h = a and α = 60°', () => {
    expect(resolveModelRequest('parallelepiped', initialParameterTexts(), triangle).spec).toEqual({
      shape: { kind: 'parallelepiped', baseSideRatio: 1, heightRatio: 1, baseAngleDeg: 60, offsetXRatio: 0, offsetYRatio: 0 },
      scale: { longestDimensionMm: 80 },
    });
  });

  it('builds the parallelepiped from its own fields, including typed values off the stepping grids', () => {
    const request = resolveModelRequest(
      'parallelepiped',
      texts({
        parallelepipedBaseSideRatio: '2.05',
        parallelepipedHeightRatio: '1,1',
        parallelepipedBaseAngleDeg: '62',
        cuboidWidthRatio: 'abc',
      }),
      triangle,
    );
    expect(request.errors).toEqual({});
    expect(request.values).toEqual({
      parallelepipedBaseSideRatio: 2.05,
      parallelepipedHeightRatio: 1.1,
      parallelepipedBaseAngleDeg: 62,
      parallelepipedOffsetXRatio: 0,
      parallelepipedOffsetYRatio: 0,
    });
    expect(request.spec?.shape).toEqual({
      kind: 'parallelepiped',
      baseSideRatio: 2.05,
      heightRatio: 1.1,
      baseAngleDeg: 62,
      offsetXRatio: 0,
      offsetYRatio: 0,
    });
  });

  it('reports each invalid parallelepiped field with its own limits and keeps the valid values', () => {
    const request = resolveModelRequest(
      'parallelepiped',
      texts({ parallelepipedBaseSideRatio: '4,5', parallelepipedHeightRatio: '0,5', parallelepipedBaseAngleDeg: '170' }),
      triangle,
    );
    expect(request.spec).toBeUndefined();
    expect(request.key).toBeUndefined();
    expect(request.values).toEqual({
      parallelepipedHeightRatio: 0.5,
      parallelepipedOffsetXRatio: 0,
      parallelepipedOffsetYRatio: 0,
    });
    expect(request.errors).toEqual({
      parallelepipedBaseSideRatio: 'Допустимі значення — від 0,25 до 4.',
      parallelepipedBaseAngleDeg: 'Допустимі значення — від 15° до 165°.',
    });
  });

  it('keeps the parallelepiped apart from the cuboid and gives mirrored angles different keys', () => {
    const mixed = texts({ cuboidWidthRatio: '', parallelepipedHeightRatio: '2' });
    expect(resolveModelRequest('parallelepiped', mixed, triangle).spec?.shape).toMatchObject({ heightRatio: 2 });
    expect(resolveModelRequest('cuboid', mixed, triangle).errors).toEqual({ cuboidWidthRatio: 'Введіть значення.' });
    const acute = resolveModelRequest('parallelepiped', texts({ parallelepipedBaseAngleDeg: '60' }), triangle);
    const obtuse = resolveModelRequest('parallelepiped', texts({ parallelepipedBaseAngleDeg: '120' }), triangle);
    expect(obtuse.key).not.toBe(acute.key);
    expect(resolveModelRequest('parallelepiped', texts({ parallelepipedBaseAngleDeg: '60,0' }), triangle).key).toBe(acute.key);
  });

  it.each([
    ['prism', 'prismOffsetXRatio', 'prismOffsetYRatio'],
    ['parallelepiped', 'parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio'],
  ] as const)('displaces the upper base of the %s by its own typed offsets, negative and off-step', (kind, x, y) => {
    const request = resolveModelRequest(kind, texts({ [x]: '-0,1', [y]: '1.35' }), triangle);
    expect(request.errors).toEqual({});
    expect(request.spec?.shape).toMatchObject({ kind, offsetXRatio: -0.1, offsetYRatio: 1.35 });
    expect(request.values).toMatchObject({ [x]: -0.1, [y]: 1.35 });
    // "0", "0,0" and "-0" all describe the right solid of the default texts.
    const right = resolveModelRequest(kind, initialParameterTexts(), triangle);
    expect(resolveModelRequest(kind, texts({ [x]: '0,0', [y]: '0' }), triangle).key).toBe(right.key);
    expect(request.key).not.toBe(right.key);
  });

  it.each([
    ['prism', 'prismOffsetXRatio', 'prismOffsetYRatio'],
    ['parallelepiped', 'parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio'],
  ] as const)('reports invalid %s offsets with their limits and builds no model', (kind, x, y) => {
    const request = resolveModelRequest(kind, texts({ [x]: '2,25', [y]: '' }), triangle);
    expect(request.spec).toBeUndefined();
    expect(request.errors).toEqual({ [x]: 'Допустимі значення — від -2 до 2.', [y]: 'Введіть значення.' });
  });

  it('keeps the prism and parallelepiped offsets apart', () => {
    const mixed = texts({ prismOffsetXRatio: '1', parallelepipedOffsetXRatio: 'abc' });
    expect(resolveModelRequest('prism', mixed, triangle).spec?.shape).toMatchObject({ offsetXRatio: 1, offsetYRatio: 0 });
    expect(resolveModelRequest('parallelepiped', mixed, triangle).errors).toEqual({
      parallelepipedOffsetXRatio: 'Введіть число, наприклад -0,5.',
    });
  });

  describe('prism over a configurable triangle', () => {
    const triangleBase = { ...triangle, prismBaseType: 'triangle' } as const;

    it('starts the triangle at b = a and α = 60° with the shared height and offsets of the prism', () => {
      expect(resolveModelRequest('prism', initialParameterTexts(), triangleBase).spec?.shape).toEqual({
        kind: 'prism',
        baseType: 'triangle',
        baseSideRatio: 1,
        baseAngleDeg: 60,
        heightRatio: 2,
        offsetXRatio: 0,
        offsetYRatio: 0,
      });
    });

    it('reads typed off-step values and keeps the height and offsets when the base type changes', () => {
      const typed = texts({
        prismTriangleSideRatio: '0.8',
        prismTriangleAngleDeg: '97,5',
        prismHeightRatio: '1,1',
        prismOffsetXRatio: '-0,6',
      });
      expect(resolveModelRequest('prism', typed, triangleBase).spec?.shape).toEqual({
        kind: 'prism',
        baseType: 'triangle',
        baseSideRatio: 0.8,
        baseAngleDeg: 97.5,
        heightRatio: 1.1,
        offsetXRatio: -0.6,
        offsetYRatio: 0,
      });
      expect(resolveModelRequest('prism', typed, triangle).spec?.shape).toEqual({
        kind: 'prism',
        baseType: 'regular',
        baseSides: 3,
        heightRatio: 1.1,
        offsetXRatio: -0.6,
        offsetYRatio: 0,
      });
    });

    it('validates only the fields of the selected base type', () => {
      const broken = texts({ prismTriangleSideRatio: '5', prismTriangleAngleDeg: '' });
      const regular = resolveModelRequest('prism', broken, triangle);
      expect(regular.errors).toEqual({});
      expect(regular.spec?.shape).toMatchObject({ baseType: 'regular' });
      const configurable = resolveModelRequest('prism', broken, triangleBase);
      expect(configurable.spec).toBeUndefined();
      expect(configurable.errors).toEqual({
        prismTriangleSideRatio: 'Допустимі значення — від 0,25 до 4.',
        prismTriangleAngleDeg: 'Введіть значення.',
      });
      expect(resolveModelRequest('prism', texts({ prismTriangleAngleDeg: '170' }), triangleBase).errors).toEqual({
        prismTriangleAngleDeg: 'Допустимі значення — від 15° до 165°.',
      });
    });

    it('gives the equilateral triangle a key of its own: it does not become the regular base', () => {
      const configurable = resolveModelRequest('prism', initialParameterTexts(), triangleBase);
      const regular = resolveModelRequest('prism', initialParameterTexts(), triangle);
      expect(configurable.key).not.toBe(regular.key);
      expect(configurable.spec?.shape).toMatchObject({ baseType: 'triangle' });
    });

    it('keeps the triangle and parallelepiped fields apart', () => {
      const mixed = texts({ prismTriangleSideRatio: '2', parallelepipedBaseSideRatio: 'abc' });
      expect(resolveModelRequest('prism', mixed, triangleBase).spec?.shape).toMatchObject({ baseSideRatio: 2 });
      expect(resolveModelRequest('parallelepiped', mixed, triangleBase).spec).toBeUndefined();
    });
  });

  describe('prism over a configurable trapezoid', () => {
    const trapezoidBase = { ...triangle, prismBaseType: 'trapezoid' } as const;

    it('starts at b = t = a/2 with b centred and the shared height and offsets of the prism', () => {
      expect(resolveModelRequest('prism', initialParameterTexts(), trapezoidBase).spec?.shape).toEqual({
        kind: 'prism',
        baseType: 'trapezoid',
        parallelSideRatio: 0.5,
        baseHeightRatio: 0.5,
        baseShiftRatio: 0,
        heightRatio: 2,
        offsetXRatio: 0,
        offsetYRatio: 0,
      });
    });

    it('reads negative and off-step values, and b = a stays a trapezoid base', () => {
      const typed = texts({
        prismTrapezoidSideRatio: '1',
        prismTrapezoidHeightRatio: '0.375',
        prismTrapezoidShiftRatio: '-0,35',
        prismOffsetYRatio: '1,1',
      });
      expect(resolveModelRequest('prism', typed, trapezoidBase).spec?.shape).toEqual({
        kind: 'prism',
        baseType: 'trapezoid',
        parallelSideRatio: 1,
        baseHeightRatio: 0.375,
        baseShiftRatio: -0.35,
        heightRatio: 2,
        offsetXRatio: 0,
        offsetYRatio: 1.1,
      });
    });

    it('validates only the trapezoid fields when it is selected, and ignores them otherwise', () => {
      const broken = texts({ prismTrapezoidSideRatio: '', prismTrapezoidShiftRatio: '-2,5' });
      expect(resolveModelRequest('prism', broken, trapezoidBase).errors).toEqual({
        prismTrapezoidSideRatio: 'Введіть значення.',
        prismTrapezoidShiftRatio: 'Допустимі значення — від -2 до 2.',
      });
      expect(resolveModelRequest('prism', broken, trapezoidBase).spec).toBeUndefined();
      for (const prismBaseType of ['regular', 'triangle'] as const) {
        expect(resolveModelRequest('prism', broken, { ...triangle, prismBaseType }).errors).toEqual({});
      }
    });
  });

  it.each([
    // [b/a, left, right]: left puts P3 above P0, right P2 above P1.
    [0.5, -0.25, 0.25],
    [2, 0.5, -0.5],
    [1.1, 0.05, -0.05],
    [0.25, -0.375, 0.375],
    [4, 1.5, -1.5],
    [1, 0, 0],
  ])('aligns side b = %s·a at δ/a = %s on the left and %s on the right, exactly', (side, left, right) => {
    expect(alignedTrapezoidShift(side, 'left')).toBe(left);
    expect(alignedTrapezoidShift(side, 'right')).toBe(right);
    expect(alignedTrapezoidShift(side, 'centre')).toBe(0);
  });

  it('builds the ball without reading any field', () => {
    const empty = Object.fromEntries(Object.keys(initialParameterTexts()).map((key) => [key, 'abc'])) as ParameterTexts;
    const request = resolveModelRequest('ball', empty, triangle);
    expect(request.spec).toEqual({ shape: { kind: 'ball' }, scale: { longestDimensionMm: 80 } });
    expect(request.errors).toEqual({});
    expect(request.values).toEqual({});
  });
});
