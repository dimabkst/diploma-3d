import { describe, expect, it } from 'vitest';
import { formatSteppedDecimal } from '../decimal.ts';
import { sectionNumberFields, shapePanel } from '../shapes.ts';
import {
  alignedTrapezoidShift,
  canResetShapeParameters,
  canSwitchTiltMode,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterState,
  type ParameterTexts,
  resetShapeParameters,
  resolveModelRequest,
  shapeParameterKeys,
  switchTiltMode,
  validateAngle,
  validateApex,
  validateDirection,
  validateOffset,
  validatePrintSize,
  validateRatio,
  validateRoundHeight,
  validateRoundOffset,
} from './parameters.ts';
import { initialTiltModes, type TiltMode, type TiltSolid } from './tilt.ts';

const texts = (overrides: Partial<ParameterTexts>): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const triangle = initialParameterChoices();

describe('validateRatio', () => {
  it.each([
    ['0,25', 0.25],
    ['4', 4],
    ['1,5', 1.5],
    // Between the 0,25 stepping grid, kept as typed.
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
    ['4,8', 'Допустимі значення — від 0,25 до 4.'],
    ['0', 'Допустимі значення — від 0,25 до 4.'],
    ['-1', 'Допустимі значення — від 0,25 до 4.'],
    [`1${'0'.repeat(400)}`, 'Число надто велике.'],
  ])('reports "%s" without clamping it', (text, error) => {
    expect(validateRatio(text)).toEqual({ error });
  });
});

describe('validateRoundHeight', () => {
  it.each([
    ['0,5', 0.5],
    ['8', 8],
    ['4,8', 4.8],
    ['2,05', 2.05],
  ])('accepts h/r = %s: h/(2r) from 0,25 to 4', (text, value) => {
    expect(validateRoundHeight(text)).toEqual({ value });
  });

  it.each(['0,49', '0,25', '8,01', '16', '0'])('rejects h/r = %s without clamping it', (text) => {
    expect(validateRoundHeight(text)).toEqual({ error: 'Допустимі значення — від 0,5 до 8.' });
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
    ['-4', -4],
    ['4', 4],
  ])('accepts %s, including the limits and negative values', (text, value) => {
    expect(validateOffset(text)).toEqual({ value });
  });

  it.each([
    ['', 'Введіть значення.'],
    ['-', 'Введіть число, наприклад -0,5.'],
    ['−1', 'Введіть число, наприклад -0,5.'],
    ['1e3', 'Введіть число, наприклад -0,5.'],
    ['4,01', 'Допустимі значення — від -4 до 4.'],
    ['-6,928', 'Допустимі значення — від -4 до 4.'],
    [`-1${'0'.repeat(400)}`, 'Число надто велике.'],
  ])('reports "%s" without clamping it', (text, error) => {
    expect(validateOffset(text)).toEqual({ error });
  });
});

describe('resolveModelRequest', () => {
  it('starts the cuboid at b/a = 1,5 and c/a = 2 and the prism at three sides and h/a = 2, at 80 mm', () => {
    expect(initialParameterTexts()).toEqual({
      printSizeMm: '80',
      cuboidWidthRatio: '1,5',
      cuboidHeightRatio: '2',
      parallelepipedBaseSideRatio: '1',
      parallelepipedHeightRatio: '1',
      parallelepipedBaseAngleDeg: '60',
      parallelepipedOffsetXRatio: '0',
      parallelepipedOffsetYRatio: '0',
      parallelepipedInclinationDeg: '90',
      parallelepipedDirectionDeg: '0',
      prismHeightRatio: '2',
      prismOffsetXRatio: '0',
      prismOffsetYRatio: '0',
      prismInclinationDeg: '90',
      prismDirectionDeg: '0',
      prismTriangleSideRatio: '1',
      prismTriangleAngleDeg: '60',
      prismTrapezoidSideRatio: '0,5',
      prismTrapezoidHeightRatio: '0,5',
      prismTrapezoidShiftRatio: '0',
      pyramidHeightRatio: '1',
      pyramidApexXRatio: '0',
      pyramidApexYRatio: '0',
      pyramidInclinationDeg: '90',
      pyramidDirectionDeg: '0',
      pyramidTriangleSideRatio: '1',
      pyramidTriangleAngleDeg: '60',
      pyramidParallelogramSideRatio: '1',
      pyramidParallelogramAngleDeg: '60',
      pyramidTrapezoidSideRatio: '0,5',
      pyramidTrapezoidHeightRatio: '0,5',
      pyramidTrapezoidShiftRatio: '0',
      cylinderHeightRatio: '2',
      cylinderOffsetRatio: '0',
      cylinderInclinationDeg: '90',
      coneHeightRatio: '2',
      coneOffsetRatio: '0',
      coneInclinationDeg: '90',
    });
    expect(initialParameterChoices()).toEqual({
      prismBaseType: 'regular',
      prismBaseSides: 3,
      pyramidBaseType: 'regular',
      pyramidBaseSides: 4,
    });
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
    expect(request.values).toEqual({ printSizeMm: 80 });

    const prism = resolveModelRequest('prism', texts({ prismHeightRatio: '4,5' }), triangle);
    expect(prism.spec).toBeUndefined();
    expect(prism.errors).toEqual({ prismHeightRatio: 'Допустимі значення — від 0,25 до 4.' });
  });

  it('keeps the validated value of a correct field while the other one is being corrected', () => {
    const partial = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '1,1', cuboidHeightRatio: '-' }), triangle);
    expect(partial.spec).toBeUndefined();
    expect(partial.values).toEqual({ cuboidWidthRatio: 1.1, printSizeMm: 80 });
    expect(partial.errors).toEqual({ cuboidHeightRatio: 'Введіть число, наприклад 1,5.' });
  });

  it('uses the exact typed values between the stepping quarters for the specification', () => {
    const request = resolveModelRequest('cuboid', texts({ cuboidWidthRatio: '2,05', cuboidHeightRatio: '1.1' }), triangle);
    expect(request.values).toEqual({ cuboidWidthRatio: 2.05, cuboidHeightRatio: 1.1, printSizeMm: 80 });
    expect(request.spec?.shape).toEqual({ kind: 'cuboid', widthRatio: 2.05, heightRatio: 1.1 });
    expect(request.spec?.scale).toEqual({ longestDimensionMm: 80 });
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
    expect(request.values).toEqual({ prismHeightRatio: 0.75, prismOffsetXRatio: 0, prismOffsetYRatio: 0, printSizeMm: 80 });
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
      baseType: 'regular',
      baseSides: 4,
      heightRatio: 1,
      apexXRatio: 0,
      apexYRatio: 0,
    });
    for (const pyramidBaseSides of [3, 4, 5, 6, 8] as const) {
      const request = resolveModelRequest('pyramid', texts({ pyramidHeightRatio: '1,1' }), { ...triangle, pyramidBaseSides });
      expect(request.spec?.shape).toEqual({
        kind: 'pyramid',
        baseType: 'regular',
        baseSides: pyramidBaseSides,
        heightRatio: 1.1,
        apexXRatio: 0,
        apexYRatio: 0,
      });
    }
  });

  describe('pyramid bases and apex', () => {
    const withBase = (pyramidBaseType: 'triangle' | 'parallelogram' | 'trapezoid') => ({ ...triangle, pyramidBaseType });
    const typed = texts({
      pyramidHeightRatio: '1,1',
      pyramidApexXRatio: '-0,1',
      pyramidApexYRatio: '3.05',
      pyramidTriangleSideRatio: '0,75',
      pyramidTriangleAngleDeg: '90',
      pyramidParallelogramSideRatio: '2',
      pyramidParallelogramAngleDeg: '120',
      pyramidTrapezoidSideRatio: '0,5',
      pyramidTrapezoidHeightRatio: '0,375',
      pyramidTrapezoidShiftRatio: '-0,25',
    });
    const shared = { kind: 'pyramid', heightRatio: 1.1, apexXRatio: -0.1, apexYRatio: 3.05 };

    it.each([
      ['triangle', { baseType: 'triangle', baseSideRatio: 0.75, baseAngleDeg: 90 }],
      ['parallelogram', { baseType: 'parallelogram', baseSideRatio: 2, baseAngleDeg: 120 }],
      ['trapezoid', { baseType: 'trapezoid', parallelSideRatio: 0.5, baseHeightRatio: 0.375, baseShiftRatio: -0.25 }],
    ] as const)('builds the %s base with the shared height and apex, including negative and off-step values', (type, base) => {
      expect(resolveModelRequest('pyramid', typed, withBase(type)).spec?.shape).toEqual({ ...shared, ...base });
    });

    it('keeps the height and apex when the base type changes and validates only the selected base', () => {
      const regular = resolveModelRequest('pyramid', typed, triangle).spec?.shape;
      expect(regular).toEqual({ ...shared, baseType: 'regular', baseSides: 4 });
      const broken = texts({ pyramidParallelogramAngleDeg: '170', pyramidTriangleSideRatio: '' });
      expect(resolveModelRequest('pyramid', broken, withBase('trapezoid')).errors).toEqual({});
      expect(resolveModelRequest('pyramid', broken, withBase('parallelogram')).errors).toEqual({
        pyramidParallelogramAngleDeg: 'Допустимі значення — від 15° до 165°.',
      });
      expect(resolveModelRequest('pyramid', broken, withBase('triangle')).errors).toEqual({
        pyramidTriangleSideRatio: 'Введіть значення.',
      });
    });

    it.each([
      ['', 'Введіть значення.'],
      ['−1', 'Введіть число, наприклад -0,5.'],
    ])('reports the apex coordinate "%s" without clamping it', (text, error) => {
      expect(validateApex(text)).toEqual({ error });
      const request = resolveModelRequest('pyramid', texts({ pyramidApexXRatio: text }), triangle);
      expect(request.spec).toBeUndefined();
      expect(request.errors).toEqual({ pyramidApexXRatio: error });
    });

    it.each([
      ['-4', -4],
      ['4', 4],
      ['2,35', 2.35],
    ])('accepts the apex coordinate %s', (text, value) => {
      expect(validateApex(text)).toEqual({ value });
    });

    it('keeps the pyramid parallelogram apart from the parallelepiped and the prism offsets apart from the apex', () => {
      const mixed = texts({ pyramidParallelogramSideRatio: '3', parallelepipedBaseSideRatio: '0,5', prismOffsetXRatio: '1' });
      expect(resolveModelRequest('pyramid', mixed, withBase('parallelogram')).spec?.shape).toMatchObject({
        baseSideRatio: 3,
        apexXRatio: 0,
      });
      expect(resolveModelRequest('parallelepiped', mixed, triangle).spec?.shape).toMatchObject({ baseSideRatio: 0.5 });
    });
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

  it('builds the tetrahedron without reading any shape field', () => {
    const empty = {
      ...Object.fromEntries(Object.keys(initialParameterTexts()).map((key) => [key, ''])),
      printSizeMm: '80',
    } as ParameterTexts;
    const request = resolveModelRequest('tetrahedron', empty, triangle);
    expect(request.spec).toEqual({ shape: { kind: 'tetrahedron' }, scale: { longestDimensionMm: 80 } });
    expect(request.errors).toEqual({});
  });

  it.each(['cylinder', 'cone'] as const)('builds the %s from its own h/r, including precise typed values', (kind) => {
    const key = kind === 'cylinder' ? 'cylinderHeightRatio' : 'coneHeightRatio';
    expect(resolveModelRequest(kind, initialParameterTexts(), triangle).spec).toEqual({
      shape: { kind, heightRatio: 2, offsetRatio: 0 },
      scale: { longestDimensionMm: 80 },
    });
    expect(resolveModelRequest(kind, texts({ [key]: '2.05' }), triangle).spec?.shape).toEqual({
      kind,
      heightRatio: 2.05,
      offsetRatio: 0,
    });
    // h/r = 4,8 lies off the slider's quarters and is kept as typed; 8 is the limit.
    expect(resolveModelRequest(kind, texts({ [key]: '4,8' }), triangle).spec?.shape).toMatchObject({ heightRatio: 4.8 });
    expect(resolveModelRequest(kind, texts({ [key]: '8' }), triangle).spec?.shape).toMatchObject({ heightRatio: 8 });
    for (const text of ['8,5', '0,25']) {
      const invalid = resolveModelRequest(kind, texts({ [key]: text }), triangle);
      expect(invalid.spec).toBeUndefined();
      expect(invalid.errors).toEqual({ [key]: 'Допустимі значення — від 0,5 до 8.' });
    }
  });

  it('keeps the cylinder and cone ratios apart', () => {
    const mixed = texts({ cylinderHeightRatio: '1,1', coneHeightRatio: '' });
    expect(resolveModelRequest('cylinder', mixed, triangle).spec?.shape).toEqual({
      kind: 'cylinder',
      heightRatio: 1.1,
      offsetRatio: 0,
    });
    expect(resolveModelRequest('cone', mixed, triangle).errors).toEqual({ coneHeightRatio: 'Введіть значення.' });
  });

  it.each([
    ['cylinder', 'cylinderOffsetRatio', 'cylinderHeightRatio'],
    ['cone', 'coneOffsetRatio', 'coneHeightRatio'],
  ] as const)('displaces the %s by its own d/r, keeping its height, within [0, 4] and β ≥ 15°', (kind, offsetKey, heightKey) => {
    const typed = resolveModelRequest(kind, texts({ [offsetKey]: '1.35', [heightKey]: '0,5' }), triangle);
    expect(typed.spec?.shape).toEqual({ kind, heightRatio: 0.5, offsetRatio: 1.35 });
    expect(resolveModelRequest(kind, texts({ [offsetKey]: '4' }), triangle).spec?.shape).toMatchObject({ offsetRatio: 4 });
    for (const [text, error] of [
      ['-0,25', 'Допустимі значення — від 0 до 4.'],
      ['4,25', 'Допустимі значення — від 0 до 4.'],
      ['', 'Введіть значення.'],
      ['abc', 'Введіть число, наприклад 0,5.'],
    ] as const) {
      const invalid = resolveModelRequest(kind, texts({ [offsetKey]: text }), triangle);
      expect(invalid.spec).toBeUndefined();
      expect(invalid.errors).toEqual({ [offsetKey]: error });
      expect(validateRoundOffset(text)).toEqual({ error });
    }
    // The other round solid keeps its own, still zero, displacement.
    const other = kind === 'cylinder' ? 'cone' : 'cylinder';
    expect(resolveModelRequest(other, texts({ [offsetKey]: '2' }), triangle).spec?.shape).toMatchObject({ offsetRatio: 0 });
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
      printSizeMm: 80,
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
      printSizeMm: 80,
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
    const request = resolveModelRequest(kind, texts({ [x]: '4,25', [y]: '' }), triangle);
    expect(request.spec).toBeUndefined();
    expect(request.errors).toEqual({ [x]: 'Допустимі значення — від -4 до 4.', [y]: 'Введіть значення.' });
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

  it('builds the ball without reading any shape field', () => {
    const empty = {
      ...Object.fromEntries(Object.keys(initialParameterTexts()).map((key) => [key, 'abc'])),
      printSizeMm: '80',
    } as ParameterTexts;
    const request = resolveModelRequest('ball', empty, triangle);
    expect(request.spec).toEqual({ shape: { kind: 'ball' }, scale: { longestDimensionMm: 80 } });
    expect(request.errors).toEqual({});
    expect(request.values).toEqual({ printSizeMm: 80 });
  });
});

describe('print size', () => {
  it.each([
    ['120', 120],
    ['1', 1],
    ['1000', 1000],
    ['62,5', 62.5],
    ['80.25', 80.25],
  ])('accepts %s mm, including the limits', (text, value) => {
    expect(validatePrintSize(text)).toEqual({ value });
  });

  it.each([
    ['', 'Введіть значення.'],
    ['12,5,', 'Введіть число, наприклад 80.'],
    ['-', 'Введіть число, наприклад 80.'],
    ['1e3', 'Введіть число, наприклад 80.'],
    ['0,5', 'Допустимі значення — від 1 мм до 1000 мм.'],
    ['0', 'Допустимі значення — від 1 мм до 1000 мм.'],
    ['1000,5', 'Допустимі значення — від 1 мм до 1000 мм.'],
  ])('rejects %j with an explanation', (text, error) => {
    expect(validatePrintSize(text)).toEqual({ error });
  });

  it.each(['cube', 'cuboid', 'prism', 'pyramid', 'octahedron', 'cylinder', 'cone', 'ball'] as const)(
    'scales the %s to the typed size, with the shape unchanged',
    (kind) => {
      const at80 = resolveModelRequest(kind, initialParameterTexts(), triangle);
      const at120 = resolveModelRequest(kind, texts({ printSizeMm: '120' }), triangle);
      expect(at120.spec?.scale).toEqual({ longestDimensionMm: 120 });
      expect(at120.spec?.shape).toEqual(at80.spec?.shape);
      expect(at120.key).not.toBe(at80.key);
    },
  );

  it('blocks the model, also of a fixed shape, while the size is being typed or invalid', () => {
    for (const printSizeMm of ['', '-', '2000']) {
      const request = resolveModelRequest('cube', texts({ printSizeMm }), triangle);
      expect(request.spec).toBeUndefined();
      expect(request.key).toBeUndefined();
      expect(Object.keys(request.errors)).toEqual(['printSizeMm']);
    }
    // Shape errors and the size error are reported together.
    const both = resolveModelRequest('cuboid', texts({ printSizeMm: '0', cuboidWidthRatio: '9' }), triangle);
    expect(Object.keys(both.errors).sort()).toEqual(['cuboidWidthRatio', 'printSizeMm']);
  });
});

describe('resetShapeParameters', () => {
  const edited: ParameterState = {
    texts: texts({
      printSizeMm: '120',
      prismHeightRatio: '1,1',
      prismOffsetXRatio: '0,5',
      prismOffsetYRatio: '-1',
      prismTriangleSideRatio: '2',
      prismTriangleAngleDeg: '97,5',
      prismTrapezoidSideRatio: '3',
      prismTrapezoidHeightRatio: '0,8',
      prismTrapezoidShiftRatio: '-0,35',
      cuboidWidthRatio: '3',
      pyramidHeightRatio: '2,5',
      coneOffsetRatio: '1',
    }),
    choices: { ...triangle, prismBaseType: 'trapezoid', prismBaseSides: 6, pyramidBaseType: 'parallelogram' },
  };

  it('returns the prism, with all its base variants, to its initial values and keeps the shared size', () => {
    const reset = resetShapeParameters('prism', edited);
    // A default prism at the size that was set: 120 mm.
    const fresh = resolveModelRequest('prism', texts({ printSizeMm: '120' }), initialParameterChoices());
    expect(resolveModelRequest('prism', reset.texts, reset.choices).spec).toEqual(fresh.spec);
    expect(fresh.spec?.scale).toEqual({ longestDimensionMm: 120 });
    for (const key of shapeParameterKeys.prism.texts) expect(reset.texts[key]).toBe(initialParameterTexts()[key]);
    expect(reset.texts.printSizeMm).toBe('120');
    expect(reset.choices.prismBaseType).toBe('regular');
    expect(reset.choices.prismBaseSides).toBe(3);
  });

  it('keeps the parameters of every other shape', () => {
    const reset = resetShapeParameters('prism', edited);
    expect(reset.texts.cuboidWidthRatio).toBe('3');
    expect(reset.texts.pyramidHeightRatio).toBe('2,5');
    expect(reset.texts.coneOffsetRatio).toBe('1');
    expect(reset.choices.pyramidBaseType).toBe('parallelogram');
    expect(edited.texts.prismHeightRatio).toBe('1,1');
  });

  it('clears invalid drafts of the shape, so that one click recovers a valid model at the same size', () => {
    const broken = { ...edited, texts: { ...edited.texts, prismHeightRatio: '', prismOffsetXRatio: '-' } };
    expect(resolveModelRequest('prism', broken.texts, broken.choices).spec).toBeUndefined();
    expect(canResetShapeParameters('prism', broken)).toBe(true);
    const reset = resetShapeParameters('prism', broken);
    const request = resolveModelRequest('prism', reset.texts, reset.choices);
    expect(request.errors).toEqual({});
    expect(request.spec?.scale).toEqual({ longestDimensionMm: 120 });
  });

  it('never touches the print size, not even an invalid draft of it', () => {
    const drafting = { ...edited, texts: { ...edited.texts, printSizeMm: '-' } };
    expect(resetShapeParameters('prism', drafting).texts.printSizeMm).toBe('-');
    expect(resetShapeParameters('cube', drafting)).toEqual(drafting);
  });

  it('is offered only when the shape itself has changed parameters, not for the size alone', () => {
    const initial = { texts: initialParameterTexts(), choices: initialParameterChoices() };
    const resized = { ...initial, texts: { ...initial.texts, printSizeMm: '120' } };
    for (const kind of Object.keys(shapeParameterKeys) as (keyof typeof shapeParameterKeys)[]) {
      expect(canResetShapeParameters(kind, initial)).toBe(false);
      expect(canResetShapeParameters(kind, resized)).toBe(false);
    }
    expect(canResetShapeParameters('prism', edited)).toBe(true);
    expect(canResetShapeParameters('prism', resetShapeParameters('prism', edited))).toBe(false);
    // Another shape's changes do not count: the cuboid's b/a is edited, the cone's offset too.
    expect(canResetShapeParameters('pyramid', { ...resized, texts: { ...resized.texts, cuboidWidthRatio: '3' } })).toBe(false);
    // A choice alone counts, and so does the same value written differently: the reset normalises the text.
    expect(canResetShapeParameters('prism', { ...initial, choices: { ...initial.choices, prismBaseSides: 6 } })).toBe(true);
    expect(canResetShapeParameters('prism', { ...initial, texts: { ...initial.texts, prismHeightRatio: '2,0' } })).toBe(true);
  });

  it('gives exactly the solids without parameters of their own a panel without a reset', () => {
    for (const kind of Object.keys(shapeParameterKeys) as (keyof typeof shapeParameterKeys)[]) {
      const { texts: keys, choices } = shapeParameterKeys[kind];
      expect(shapePanel(kind, triangle).type === 'fixed').toBe(keys.length === 0 && choices.length === 0);
    }
  });

  it('assigns every shape field to exactly one shape, so that a reset reaches all of them', () => {
    const owned = Object.values(shapeParameterKeys).flatMap(({ texts: keys }) => keys);
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned, 'printSizeMm'].sort()).toEqual(Object.keys(initialParameterTexts()).sort());
    const choices = Object.values(shapeParameterKeys).flatMap(({ choices: keys }) => keys);
    expect(choices.sort()).toEqual(Object.keys(initialParameterChoices()).sort());
  });
});

describe('tilt entered as angles', () => {
  const modes = (solid: TiltSolid, mode: TiltMode = 'angle') => ({ ...initialTiltModes(), [solid]: mode });
  const inAngles = (solid: TiltSolid, overrides: Partial<ParameterTexts>, choices = triangle) => ({
    texts: texts(overrides),
    choices,
    exact: {},
    tiltModes: modes(solid),
  });
  const resolve = (kind: TiltSolid, state: ParameterState) =>
    resolveModelRequest(kind, state.texts, state.choices, { exact: state.exact, tiltModes: state.tiltModes });

  it('accepts directions from 0° to 360° and rejects others', () => {
    expect(validateDirection('360')).toEqual({ value: 360 });
    expect(validateDirection('12,5')).toEqual({ value: 12.5 });
    expect(validateDirection('-1')).toEqual({ error: 'Допустимі значення — від 0° до 360°.' });
    expect(validateDirection('')).toEqual({ error: 'Введіть значення.' });
  });

  it('turns H = 1, β = 45°, φ = 90° into (0, 1) and keeps the angles when the height becomes 2', () => {
    const state = inAngles('prism', { prismHeightRatio: '1', prismInclinationDeg: '45', prismDirectionDeg: '90' });
    expect(resolve('prism', state).spec?.shape).toMatchObject({ heightRatio: 1, offsetXRatio: 0, offsetYRatio: 1 });
    const taller = { ...state, texts: { ...state.texts, prismHeightRatio: '2' } };
    const request = resolve('prism', taller);
    expect(request.spec?.shape).toMatchObject({ heightRatio: 2, offsetXRatio: 0, offsetYRatio: 2 });
    // The computed offsets are reported too, for the group status and a switch back.
    expect(request.values).toMatchObject({ prismInclinationDeg: 45, prismDirectionDeg: 90, prismOffsetYRatio: 2 });
  });

  it('keeps the offsets, not the angles, when the height changes in the offset mode', () => {
    const offsets = { prismOffsetXRatio: '0', prismOffsetYRatio: '1' };
    for (const prismHeightRatio of ['1', '2', '0,5']) {
      expect(resolveModelRequest('prism', texts({ ...offsets, prismHeightRatio }), triangle).spec?.shape).toMatchObject({
        offsetXRatio: 0,
        offsetYRatio: 1,
      });
    }
  });

  it.each([
    ['prism', { prismHeightRatio: '1,3', prismOffsetXRatio: '-0,4', prismOffsetYRatio: '1,1' }],
    ['parallelepiped', { parallelepipedHeightRatio: '0,8', parallelepipedOffsetXRatio: '0,5', parallelepipedOffsetYRatio: '-2' }],
    ['pyramid', { pyramidHeightRatio: '1,7', pyramidApexXRatio: '-3,2', pyramidApexYRatio: '-0,15' }],
    ['cylinder', { cylinderHeightRatio: '1,5', cylinderOffsetRatio: '2,2' }],
    ['cone', { coneHeightRatio: '1,5', coneOffsetRatio: '3,75' }],
  ] as const)('builds the same %s from offsets and from the equivalent angles', (solid, offsets) => {
    const offsetState: ParameterState = {
      texts: texts(offsets),
      choices: triangle,
      exact: {},
      tiltModes: modes(solid, 'offset'),
    };
    const before = resolve(solid, offsetState);
    const switched = switchTiltMode(solid, offsetState, before.values);
    expect(switched?.tiltModes?.[solid]).toBe('angle');
    if (switched === undefined) return;
    // The same specification, hence the same preview, file and dimensions: the model is not even rebuilt.
    expect(resolve(solid, switched).key).toBe(before.key);
    expect(resolve(solid, switched).spec).toEqual(before.spec);
  });

  it('builds a pyramid and a cylinder from typed angles as from the offsets they describe', () => {
    // β = atan2(1, 2) along 180° from the centroid: the apex at (−2, 0).
    const typed = inAngles('pyramid', {
      pyramidHeightRatio: '1',
      pyramidInclinationDeg: String((Math.atan2(1, 2) * 180) / Math.PI),
      pyramidDirectionDeg: '180',
    });
    expect(resolve('pyramid', typed).spec?.shape).toMatchObject({ apexXRatio: -2, apexYRatio: 0 });
    // h/r = 2 at 45°: d/r = 2, along +X.
    const cylinder = inAngles('cylinder', { cylinderHeightRatio: '2', cylinderInclinationDeg: '45' });
    expect(resolve('cylinder', cylinder).spec).toEqual(
      resolveModelRequest('cylinder', texts({ cylinderHeightRatio: '2', cylinderOffsetRatio: '2' }), triangle).spec,
    );
  });

  it('switches back and forth from non-round offsets without any drift of the model or the texts', () => {
    let state: ParameterState = {
      texts: texts({ prismHeightRatio: '1,37', prismOffsetXRatio: '-0,3137', prismOffsetYRatio: '1,2345' }),
      choices: triangle,
      exact: {},
      tiltModes: initialTiltModes(),
    };
    const key = resolve('prism', state).key;
    for (let round = 0; round < 5; round += 1) {
      const next = switchTiltMode('prism', state, resolve('prism', state).values);
      if (next === undefined) throw new Error('The valid prism must switch modes.');
      state = next;
      expect(resolve('prism', state).key).toBe(key);
    }
    // An odd number of switches ends in the angle mode, where the rounded angle texts did not replace the exact ones.
    expect(state.tiltModes?.prism).toBe('angle');
    expect(state.texts.prismInclinationDeg).toMatch(/^\d+,\d{1,4}$/);
    const back = switchTiltMode('prism', state, resolve('prism', state).values);
    expect(back?.texts).toMatchObject({ prismOffsetXRatio: '-0,3137', prismOffsetYRatio: '1,2345' });
    expect(back && resolve('prism', back).spec?.shape).toMatchObject({ offsetXRatio: -0.3137, offsetYRatio: 1.2345 });
  });

  it('keeps the exact computed offsets behind rounded texts until the field is edited', () => {
    // 30° from +X at β = 45°: X = cos 30° = 0,866025…, shown as 0,866.
    const angles = inAngles('prism', { prismHeightRatio: '1', prismInclinationDeg: '45', prismDirectionDeg: '30' });
    const offsets = switchTiltMode('prism', angles, resolve('prism', angles).values);
    if (offsets === undefined) throw new Error('The valid prism must switch modes.');
    expect(offsets.texts.prismOffsetXRatio).toBe('0,866');
    expect(resolve('prism', offsets).spec?.shape).toMatchObject({ offsetXRatio: 0.866025403784, offsetYRatio: 0.5 });
    // A new height keeps the exact offset ratios in the offset mode.
    const taller = { ...offsets, texts: { ...offsets.texts, prismHeightRatio: '2' } };
    expect(resolve('prism', taller).spec?.shape).toMatchObject({ offsetXRatio: 0.866025403784 });
    // Typing replaces the exact value with the typed one.
    const typed = { ...offsets, texts: { ...offsets.texts, prismOffsetXRatio: '0,8661' } };
    expect(resolve('prism', typed).spec?.shape).toMatchObject({ offsetXRatio: 0.8661 });
  });

  it('shows 90° without a displacement, retains the last direction and ignores direction edits at 90°', () => {
    const offsetState: ParameterState = {
      texts: texts({ prismDirectionDeg: '135' }),
      choices: triangle,
      exact: {},
      tiltModes: initialTiltModes(),
    };
    const angles = switchTiltMode('prism', offsetState, resolve('prism', offsetState).values);
    expect(angles?.texts).toMatchObject({ prismInclinationDeg: '90', prismDirectionDeg: '135' });
    if (angles === undefined) return;
    const key = resolve('prism', angles).key;
    for (const prismDirectionDeg of ['0', '45', '359,9', '360']) {
      expect(resolve('prism', { ...angles, texts: { ...angles.texts, prismDirectionDeg } }).key).toBe(key);
    }
    // The retained direction applies to the next inclination.
    const tilted = { ...angles, texts: { ...angles.texts, prismHeightRatio: '1', prismInclinationDeg: '45' } };
    const shape = resolve('prism', tilted).spec?.shape;
    expect(shape).toMatchObject({
      offsetXRatio: expect.closeTo(-Math.SQRT1_2, 12),
      offsetYRatio: expect.closeTo(Math.SQRT1_2, 12),
    });
    // An invalid hidden direction starts at 0° instead.
    const broken = { ...offsetState, texts: { ...offsetState.texts, prismDirectionDeg: 'abc' } };
    expect(switchTiltMode('prism', broken, resolve('prism', broken).values)?.texts.prismDirectionDeg).toBe('0');
  });

  it('treats 360° as 0°', () => {
    const along = (prismDirectionDeg: string) =>
      resolve('prism', inAngles('prism', { prismInclinationDeg: '60', prismDirectionDeg })).spec;
    expect(along('360')).toEqual(along('0'));
  });

  it('rejects angles whose offsets would leave [−4, 4], naming the steeper range, without clamping', () => {
    // h/a = 4 at 30° along +X: X/a = 4√3 ≈ 6,93; along +X the limit 4 needs β ≥ 45°.
    const along = inAngles('prism', { prismHeightRatio: '4', prismInclinationDeg: '30', prismDirectionDeg: '0' });
    const request = resolve('prism', along);
    expect(request.spec).toBeUndefined();
    expect(request.errors).toEqual({ prismInclinationDeg: 'Допустимі значення за цієї висоти й напряму — від 45° до 90°.' });
    expect(request.values.prismOffsetXRatio).toBeUndefined();
    // The diagonal reaches the corner (4, 4): β ≥ atan2(4, 4√2) ≈ 35,26°.
    const diagonal = { ...along, texts: { ...along.texts, prismDirectionDeg: '45' } };
    expect(resolve('prism', diagonal).errors).toEqual({
      prismInclinationDeg: 'Допустимі значення за цієї висоти й напряму — від 35,27° до 90°.',
    });
    const steeper = { ...diagonal, texts: { ...diagonal.texts, prismInclinationDeg: '35,27' } };
    const corner = resolve('prism', steeper).spec?.shape as Record<string, number> | undefined;
    expect(corner?.offsetXRatio).toBeLessThanOrEqual(4);
    expect(corner?.offsetXRatio).toBeCloseTo(corner?.offsetYRatio ?? 0, 12);
    // h/r = 8: d ≤ 4 needs β ≥ atan(2) ≈ 63,43°.
    const cone = resolve('cone', inAngles('cone', { coneHeightRatio: '8', coneInclinationDeg: '60' }));
    expect(cone.errors).toEqual({ coneInclinationDeg: 'Допустимі значення за цієї висоти — від 63,44° до 90°.' });
  });

  it('rejects inclinations below 15° or above 90° in the angle mode, keeping both limits', () => {
    const typed = (prismInclinationDeg: string) =>
      resolve('prism', inAngles('prism', { prismHeightRatio: '1', prismInclinationDeg, prismDirectionDeg: '0' }));
    // 15° at h/a = 1: X/a = 1/tan 15° ≈ 3,732.
    expect(typed('15').spec?.shape).toMatchObject({ offsetXRatio: expect.closeTo(1 / Math.tan(Math.PI / 12), 11) });
    expect(typed('90').spec?.shape).toMatchObject({ offsetXRatio: 0, offsetYRatio: 0 });
    for (const [text, error] of [
      ['14,99', 'Допустимі значення — від 15° до 90°.'],
      ['5', 'Допустимі значення — від 15° до 90°.'],
      ['0', 'Допустимі значення — від 15° до 90°.'],
      ['91', 'Допустимі значення — від 15° до 90°.'],
      ['', 'Введіть значення.'],
      ['-', 'Введіть число, наприклад 45.'],
    ] as const) {
      expect(typed(text).errors).toEqual({ prismInclinationDeg: error });
      expect(typed(text).spec).toBeUndefined();
    }
  });

  it('rejects offsets leaning flatter than 15° in the offset mode, at every displacing field, with the values allowed', () => {
    const offsets = (prismOffsetXRatio: string, prismOffsetYRatio: string) =>
      resolveModelRequest('prism', texts({ prismHeightRatio: '0,25', prismOffsetXRatio, prismOffsetYRatio }), triangle);
    // h/a = 0,25: D ≤ 0,25/tan 15° ≈ 0,933, the same in every direction.
    const along = offsets('1', '0');
    expect(along.spec).toBeUndefined();
    expect(along.errors).toEqual({
      prismOffsetXRatio: 'Кут нахилу має бути не менше 15°: за цієї висоти й другого зміщення допустимо від -0,933 до 0,933.',
    });
    expect(along.values.prismOffsetXRatio).toBeUndefined();
    expect(along.values.prismOffsetYRatio).toBe(0);
    // Each component within ±4 and below 0,933, but together D ≈ 0,85·√2 ≈ 1,2: both fields are at fault, each with
    // |X| ≤ √(0,933² − 0,85²) ≈ 0,3847 given the other.
    const diagonal = offsets('0,85', '-0,85');
    expect(Object.keys(diagonal.errors).sort()).toEqual(['prismOffsetXRatio', 'prismOffsetYRatio']);
    expect(diagonal.errors.prismOffsetYRatio).toBe(
      'Кут нахилу має бути не менше 15°: за цієї висоти й другого зміщення допустимо від -0,384 до 0,384.',
    );
    expect(offsets('0,933', '0').errors).toEqual({});
    expect(offsets('0,6', '-0,7').errors).toEqual({});
    const cone = resolveModelRequest('cone', texts({ coneHeightRatio: '0,5', coneOffsetRatio: '2' }), triangle);
    expect(cone.errors).toEqual({
      coneOffsetRatio: 'Кут нахилу має бути не менше 15°: за цієї висоти допустимо від 0 до 1,866.',
    });
  });

  it('checks the combination again when the height or the direction changes, in either mode', () => {
    // Offsets keep their values, so a lower height can make them too flat.
    const tall = texts({ prismHeightRatio: '1', prismOffsetXRatio: '3' });
    expect(resolveModelRequest('prism', tall, triangle).errors).toEqual({});
    const low = resolveModelRequest('prism', { ...tall, prismHeightRatio: '0,5' }, triangle);
    expect(low.spec).toBeUndefined();
    expect(Object.keys(low.errors)).toEqual(['prismOffsetXRatio']);
    // Angles keep their values, so a greater height or another direction can push the offsets past ±4.
    const angles = inAngles('prism', { prismHeightRatio: '2', prismInclinationDeg: '30', prismDirectionDeg: '0' });
    expect(resolve('prism', angles).errors).toEqual({});
    const taller = resolve('prism', { ...angles, texts: { ...angles.texts, prismHeightRatio: '4' } });
    expect(taller.errors).toEqual({ prismInclinationDeg: 'Допустимі значення за цієї висоти й напряму — від 45° до 90°.' });
    const diagonal = inAngles('prism', { prismHeightRatio: '4', prismInclinationDeg: '40', prismDirectionDeg: '45' });
    expect(resolve('prism', diagonal).errors).toEqual({});
    const turned = resolve('prism', { ...diagonal, texts: { ...diagonal.texts, prismDirectionDeg: '0' } });
    expect(turned.errors).toEqual({ prismInclinationDeg: 'Допустимі значення за цієї висоти й напряму — від 45° до 90°.' });
    expect(turned.spec).toBeUndefined();
  });

  it('switches modes at the limits without leaving the domain or changing the model', () => {
    // Exactly 15° along +Y at h/a = 1, and the corner (−4, 4) at h/a = 4.
    for (const offsets of [
      { prismHeightRatio: '1', prismOffsetXRatio: '0', prismOffsetYRatio: String(1 / Math.tan(Math.PI / 12)) },
      { prismHeightRatio: '4', prismOffsetXRatio: '-4', prismOffsetYRatio: '4' },
    ]) {
      const state: ParameterState = { texts: texts(offsets), choices: triangle, exact: {}, tiltModes: initialTiltModes() };
      const before = resolve('prism', state);
      expect(before.errors).toEqual({});
      const angles = switchTiltMode('prism', state, before.values);
      if (angles === undefined) throw new Error('A valid prism must switch modes.');
      expect(resolve('prism', angles).errors).toEqual({});
      expect(resolve('prism', angles).key).toBe(before.key);
      const back = switchTiltMode('prism', angles, resolve('prism', angles).values);
      expect(back && resolve('prism', back).key).toBe(before.key);
    }
  });

  it('switches modes only from valid input', () => {
    const invalidHeight = inAngles('prism', { prismHeightRatio: '', prismInclinationDeg: '60' });
    expect(canSwitchTiltMode('prism', resolve('prism', invalidHeight).values)).toBe(false);
    expect(switchTiltMode('prism', invalidHeight, resolve('prism', invalidHeight).values)).toBeUndefined();
    const invalidOffset = { ...invalidHeight, texts: texts({ prismOffsetXRatio: 'abc' }), tiltModes: initialTiltModes() };
    expect(canSwitchTiltMode('prism', resolve('prism', invalidOffset).values)).toBe(false);
    // Without a displacement the height is not needed: β is 90° whatever it is.
    const right = { ...invalidOffset, texts: texts({ prismHeightRatio: '' }) };
    expect(canSwitchTiltMode('prism', resolve('prism', right).values)).toBe(true);
  });

  it('resets the geometry, not the mode, and is not offered for switching modes alone', () => {
    const initial: ParameterState = {
      texts: initialParameterTexts(),
      choices: triangle,
      exact: {},
      tiltModes: initialTiltModes(),
    };
    for (const solid of ['prism', 'parallelepiped', 'pyramid', 'cylinder', 'cone'] as const) {
      const switched = switchTiltMode(solid, initial, resolve(solid, initial).values);
      expect(switched?.tiltModes?.[solid]).toBe('angle');
      if (switched === undefined) continue;
      expect(canResetShapeParameters(solid, switched)).toBe(false);
      const back = switchTiltMode(solid, switched, resolve(solid, switched).values);
      expect(back && canResetShapeParameters(solid, back)).toBe(false);
    }
    const tilted = inAngles('prism', { prismHeightRatio: '1', prismInclinationDeg: '45', prismDirectionDeg: '90' });
    expect(canResetShapeParameters('prism', tilted)).toBe(true);
    const reset = resetShapeParameters('prism', tilted);
    expect(reset.tiltModes?.prism).toBe('angle');
    expect(reset.texts.prismInclinationDeg).toBe('90');
    expect(resolve('prism', reset).spec).toEqual(resolveModelRequest('prism', initialParameterTexts(), triangle).spec);
    expect(canResetShapeParameters('prism', reset)).toBe(false);
    // An invalid draft of an angle is offered for reset as any other.
    expect(canResetShapeParameters('prism', inAngles('prism', { prismDirectionDeg: '-' }))).toBe(true);
    // A valid direction at 90° shapes nothing.
    expect(canResetShapeParameters('prism', inAngles('prism', { prismDirectionDeg: '45' }))).toBe(false);
  });

  it('removes exact values together with the texts they belong to', () => {
    const angles = inAngles('prism', { prismHeightRatio: '1', prismInclinationDeg: '45', prismDirectionDeg: '30' });
    const offsets = switchTiltMode('prism', angles, resolve('prism', angles).values);
    expect(offsets?.exact?.prismOffsetXRatio).toBeCloseTo(0.866, 3);
    expect(offsets && resetShapeParameters('prism', offsets).exact).toEqual({});
  });
});

describe('one range per control', () => {
  const variants = [
    ...(['cuboid', 'parallelepiped', 'cylinder', 'cone'] as const).map((kind) => ({ kind, choices: triangle })),
    ...(['regular', 'triangle', 'trapezoid'] as const).map((prismBaseType) => ({
      kind: 'prism' as const,
      choices: { ...triangle, prismBaseType },
    })),
    ...(['regular', 'triangle', 'parallelogram', 'trapezoid'] as const).map((pyramidBaseType) => ({
      kind: 'pyramid' as const,
      choices: { ...triangle, pyramidBaseType },
    })),
  ];

  it.each(
    variants.flatMap((variant) => (['offset', 'angle'] as const).map((mode) => [variant.kind, variant.choices, mode] as const)),
  )('makes the slider and buttons of every %s field span exactly the values it accepts (%j, %s mode)', (kind, choices, mode) => {
    const tiltModes = kind === 'cuboid' ? initialTiltModes() : { ...initialTiltModes(), [kind as TiltSolid]: mode as TiltMode };
    const options = { exact: {}, tiltModes };
    const initial = resolveModelRequest(kind, initialParameterTexts(), choices, options);
    // The defaults of every figure are valid in both modes.
    expect(initial.errors).toEqual({});
    const panel = shapePanel(kind, choices, { tiltModes, values: initial.values });
    if (panel.type === 'fixed') throw new Error('A configurable figure has fields.');
    for (const field of panel.sections.flatMap(sectionNumberFields)) {
      const { min, max } = field.range;
      const errorAt = (value: number) =>
        resolveModelRequest(kind, texts({ [field.key]: formatSteppedDecimal(value) }), choices, options).errors[field.key];
      expect(errorAt(min), `${field.key} at ${min}`).toBeUndefined();
      expect(errorAt(max), `${field.key} at ${max}`).toBeUndefined();
      // The direction wraps around; every other field rejects values beyond its ends.
      if (field.key.endsWith('DirectionDeg')) continue;
      expect(errorAt(min - 0.01), `${field.key} below ${min}`).toBeDefined();
      expect(errorAt(max + 0.01), `${field.key} above ${max}`).toBeDefined();
    }
  });

  it('never widens a range for a value outside it: the outer limits stay as they are', () => {
    const tall = texts({ prismHeightRatio: '4,5', prismOffsetXRatio: '6' });
    const request = resolveModelRequest('prism', tall, triangle);
    expect(Object.keys(request.errors).sort()).toEqual(['prismHeightRatio', 'prismOffsetXRatio']);
    const panel = shapePanel('prism', triangle, { values: request.values });
    if (panel.type === 'fixed') throw new Error('A prism has fields.');
    const ranges = Object.fromEntries(panel.sections.flatMap(sectionNumberFields).map((field) => [field.key, field.range]));
    expect(ranges.prismHeightRatio).toMatchObject({ min: 0.25, max: 4 });
    expect(ranges.prismOffsetXRatio).toMatchObject({ min: -4, max: 4 });
  });
});
