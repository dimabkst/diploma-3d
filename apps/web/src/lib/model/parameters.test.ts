import { describe, expect, it } from 'vitest';
import { formatSteppedDecimal } from '../decimal.ts';
import { sectionNumberFields, shapePanel } from '../shapes.ts';
import { storedText } from './connectorScale.ts';
import {
  activeConnector,
  activeSection,
  alignedTrapezoidShift,
  canResetShapeParameters,
  canSwitchTiltMode,
  initialParameterChoices,
  initialParameterTexts,
  isScaledConnectorKey,
  type ParameterState,
  type ParameterTexts,
  partsSeparated,
  resetShapeParameters,
  resolveModelRequest,
  scaledConnectorSettings,
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
  validateSectionPosition,
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
      cylinderSectionPercent: '50',
      cylinderDovetailSize: '1',
      cylinderDovetailLengthPercent: '50',
      cylinderDovetailClearanceMm: '0,2',
      cylinderRoundSpacingPercent: '45',
      cylinderRoundDiameter: '1',
      cylinderRoundDepth: '1',
      cylinderPlugClearanceMm: '0,2',
      cylinderDowelLowerClearanceMm: '0,1',
      cylinderDowelUpperClearanceMm: '0,2',
    });
    expect(initialParameterChoices()).toEqual({
      prismBaseType: 'regular',
      prismBaseSides: 3,
      pyramidBaseType: 'regular',
      pyramidBaseSides: 4,
      cylinderSection: 'none',
      cylinderPartsSeparated: true,
      cylinderConnector: 'none',
      cylinderRoundCount: 1,
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
    { kind: 'cylinder' as const, choices: { ...triangle, cylinderSection: 'parallel-to-bases' as const } },
    ...(['dovetail', 'plug', 'dowel'] as const).flatMap((cylinderConnector) =>
      ([1, 2] as const).map((cylinderRoundCount) => ({
        kind: 'cylinder' as const,
        choices: { ...triangle, cylinderSection: 'parallel-to-bases' as const, cylinderConnector, cylinderRoundCount },
      })),
    ),
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
      // A field shown in millimetres stores what its entry converts the millimetres to.
      const stored = (value: number) => {
        const text = formatSteppedDecimal(value);
        const { key, unit } = field;
        return unit === undefined || !isScaledConnectorKey(key)
          ? text
          : storedText(text, unit, scaledConnectorSettings[key].limits);
      };
      // For connector settings only the field's own range counts here: a connector may still not fit the solid at an
      // allowed value, which the field then explains in its own words.
      const rangeErrorAt = (value: number) => {
        const error = resolveModelRequest(kind, texts({ [field.key]: stored(value) }), choices, options).errors[field.key];
        return field.unit === undefined ? error !== undefined : (error?.startsWith('Допустимі значення') ?? false);
      };
      expect(rangeErrorAt(min), `${field.key} at ${min}`).toBe(false);
      expect(rangeErrorAt(max), `${field.key} at ${max}`).toBe(false);
      // The direction wraps around; every other field rejects values beyond its ends.
      if (field.key.endsWith('DirectionDeg')) continue;
      expect(rangeErrorAt(min - 0.01), `${field.key} below ${min}`).toBe(true);
      expect(rangeErrorAt(max + 0.01), `${field.key} above ${max}`).toBe(true);
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

describe('a cylinder section parallel to the bases', () => {
  const parallel = { ...triangle, cylinderSection: 'parallel-to-bases' } as const;
  const section = (positionPercent: number) => ({ type: 'parallel-to-bases', positionPercent });
  const panelOf = (choices: typeof triangle) => {
    const panel = shapePanel('cylinder', choices, { values: resolveModelRequest('cylinder', texts({}), choices).values });
    const group = panel.type === 'parameters' ? panel.sections.find((part) => part.title === 'Переріз') : undefined;
    if (group === undefined) throw new Error('No section group');
    return group;
  };

  it('starts without a section: the whole cylinder, and a collapsed group that offers only the choice', () => {
    expect(triangle.cylinderSection).toBe('none');
    const request = resolveModelRequest('cylinder', texts({}), triangle);
    expect(request.spec).not.toHaveProperty('section');
    expect(activeSection('cylinder', triangle)).toBeUndefined();
    expect(partsSeparated('cylinder', triangle)).toBe(false);
    const group = panelOf(triangle);
    expect(group).toMatchObject({ initiallyOpen: false, status: { text: 'немає', highlighted: false } });
    expect(group.fields.map((field) => field.type)).toEqual(['choice']);
  });

  it('cuts at 50 % of h once chosen, with the position from 10 % to 90 % in steps of 5 and the parts apart', () => {
    const request = resolveModelRequest('cylinder', texts({}), parallel);
    expect(request.errors).toEqual({});
    expect(request.spec?.section).toEqual(section(50));
    expect(request.spec?.shape).toEqual(resolveModelRequest('cylinder', texts({}), triangle).spec?.shape);
    const group = panelOf(parallel);
    expect(group.status).toEqual({ text: 'паралельно основам', highlighted: true });
    expect(group.fields.map((field) => [field.type, field.key])).toEqual([
      ['choice', 'cylinderSection'],
      ['number', 'cylinderSectionPercent'],
      ['toggle', 'cylinderPartsSeparated'],
    ]);
    expect(sectionNumberFields(group)[0]?.range).toEqual({ min: 10, max: 90, increment: 5 });
    expect(partsSeparated('cylinder', parallel)).toBe(true);
  });

  it.each([
    ['10', 10],
    ['12,5', 12.5],
    ['62.25', 62.25],
    ['90', 90],
  ])('keeps the typed position %s %% as it is', (text, value) => {
    expect(validateSectionPosition(text)).toEqual({ value });
    expect(resolveModelRequest('cylinder', texts({ cylinderSectionPercent: text }), parallel).spec?.section).toEqual(
      section(value),
    );
  });

  it.each(['9,99', '90,01', '0', '100', '-50'])('refuses the position %s %% without clamping and builds nothing', (text) => {
    const request = resolveModelRequest('cylinder', texts({ cylinderSectionPercent: text }), parallel);
    expect(request.errors).toEqual({ cylinderSectionPercent: 'Допустимі значення — від 10 % до 90 %.' });
    expect(request.spec).toBeUndefined();
    // The other fields stay valid.
    expect(request.values.cylinderHeightRatio).toBe(2);
  });

  it.each([
    ['', 'Введіть значення.'],
    ['п’ять', 'Введіть число, наприклад 50.'],
  ])('asks for a number for %j', (text, message) => {
    expect(resolveModelRequest('cylinder', texts({ cylinderSectionPercent: text }), parallel).errors).toEqual({
      cylinderSectionPercent: message,
    });
  });

  it('ignores a draft of the hidden position while no section is chosen', () => {
    const request = resolveModelRequest('cylinder', texts({ cylinderSectionPercent: '5' }), triangle);
    expect(request.errors).toEqual({});
    expect(request.spec).not.toHaveProperty('section');
  });

  it('rebuilds for a new position, height, tilt or size, but not for the separation of the preview', () => {
    const key = (overrides: Partial<ParameterTexts>, choices: typeof triangle = parallel) =>
      resolveModelRequest('cylinder', texts(overrides), choices).key;
    const base = key({});
    expect(key({}, { ...parallel, cylinderPartsSeparated: false })).toBe(base);
    for (const change of [
      { cylinderSectionPercent: '55' },
      { cylinderHeightRatio: '3' },
      { cylinderOffsetRatio: '1' },
      { printSizeMm: '120' },
    ]) {
      expect(key(change)).not.toBe(base);
    }
    expect(key({}, triangle)).not.toBe(base);
    // An oblique cylinder keeps the section, and the size scales the whole model, section included.
    const oblique = resolveModelRequest('cylinder', texts({ cylinderOffsetRatio: '1,5', printSizeMm: '120' }), parallel);
    expect(oblique.spec).toEqual({
      shape: { kind: 'cylinder', heightRatio: 2, offsetRatio: 1.5 },
      scale: { longestDimensionMm: 120 },
      section: section(50),
    });
  });

  it('belongs to the cylinder only', () => {
    for (const kind of ['cone', 'prism', 'cube'] as const) {
      expect(resolveModelRequest(kind, texts({}), parallel).spec).not.toHaveProperty('section');
      expect(activeSection(kind, parallel)).toBeUndefined();
      expect(partsSeparated(kind, parallel)).toBe(false);
    }
    const cone = shapePanel('cone', parallel);
    expect(cone.type === 'parameters' && cone.sections.map((part) => part.title)).toEqual(['Висота', 'Нахил']);
  });

  it('resets to no section at 50 % with the parts apart, keeping the print size and the other shapes', () => {
    const edited: ParameterState = {
      texts: texts({ cylinderSectionPercent: '15', cylinderHeightRatio: '3', printSizeMm: '120', coneHeightRatio: '4' }),
      choices: { ...parallel, cylinderPartsSeparated: false, prismBaseSides: 6 },
    };
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.texts).toEqual(texts({ printSizeMm: '120', coneHeightRatio: '4' }));
    expect(reset.choices).toEqual({ ...triangle, prismBaseSides: 6 });
    expect(reset.choices).toMatchObject({ cylinderSection: 'none', cylinderPartsSeparated: true });
    expect(canResetShapeParameters('cylinder', reset)).toBe(false);
  });

  it('offers the reset for the chosen section and its separation, not for hidden values of an unchosen one', () => {
    const initial = { texts: initialParameterTexts(), choices: initialParameterChoices() };
    expect(canResetShapeParameters('cylinder', { ...initial, choices: parallel })).toBe(true);
    const hidden = {
      texts: texts({ cylinderSectionPercent: '20' }),
      choices: { ...triangle, cylinderPartsSeparated: false },
    };
    expect(canResetShapeParameters('cylinder', hidden)).toBe(false);
    expect(
      canResetShapeParameters('cylinder', { ...hidden, choices: { ...hidden.choices, cylinderSection: 'parallel-to-bases' } }),
    ).toBe(true);
    // The section is the cylinder's own: it does not make another shape resettable.
    expect(canResetShapeParameters('cone', { ...initial, choices: parallel })).toBe(false);
  });
});

describe('a dovetail joining the cylinder’s parts', () => {
  const joined = { ...triangle, cylinderSection: 'parallel-to-bases', cylinderConnector: 'dovetail' } as const;
  const request = (overrides: Partial<ParameterTexts>, choices: typeof triangle = joined) =>
    resolveModelRequest('cylinder', texts(overrides), choices);
  const groupsOf = (choices: typeof triangle) => {
    const panel = shapePanel('cylinder', choices, { values: request({}, choices).values });
    return panel.type === 'parameters' ? panel.sections : [];
  };

  it('starts without a connector; choosing the dovetail adds its settings at k = 1, 50 % and 0,2 mm', () => {
    const sectioned = { ...triangle, cylinderSection: 'parallel-to-bases' } as const;
    expect(request({}, sectioned).spec?.section).toEqual({ type: 'parallel-to-bases', positionPercent: 50 });
    // The connector's own group follows the section's, whose explanation ends it.
    expect(groupsOf(sectioned).map((group) => group.title)).toEqual(['Висота', 'Нахил', 'Переріз', 'Кріплення']);
    const cut = groupsOf(sectioned).find((group) => group.title === 'Переріз');
    expect(cut?.fields.map((field) => field.key)).toEqual([
      'cylinderSection',
      'cylinderSectionPercent',
      'cylinderPartsSeparated',
    ]);
    expect(cut?.help?.label).toBe('Як задано переріз?');
    const connector = groupsOf(sectioned).find((group) => group.title === 'Кріплення');
    expect(connector?.status).toEqual({ text: 'немає', highlighted: false });
    expect(connector?.fields).toEqual([
      {
        type: 'choice',
        key: 'cylinderConnector',
        label: 'Тип кріплення',
        options: [
          { value: 'none', label: 'Без кріплення' },
          { value: 'dovetail', label: 'Ластівчин хвіст' },
          { value: 'plug', label: 'Виступ і отвір' },
          { value: 'dowel', label: 'Знімні штифти' },
        ],
      },
    ]);

    expect(request({}).spec?.section).toEqual({
      type: 'parallel-to-bases',
      positionPercent: 50,
      connector: { type: 'dovetail', sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2 },
    });
    // At M = 80 mm and r = 40 mm: h = 0,025·80·k from 1,5 to 3 mm, L = 2r·p/100 from 20 to 48 mm.
    const settings = groupsOf(joined).find((group) => group.title === 'Кріплення');
    expect(settings?.fields.map((field) => [field.type, field.key])).toEqual([
      ['choice', 'cylinderConnector'],
      ['note', 'cylinder-connector-scale'],
      ['number', 'cylinderDovetailSize'],
      ['note', 'cylinder-dovetail-widths'],
      ['number', 'cylinderDovetailLengthPercent'],
      ['number', 'cylinderDovetailClearanceMm'],
    ]);
    expect(settings?.help?.text).toMatch(/^На нижній частині є виступ, у верхній — паз\./);
    expect(settings?.help?.text).toMatch(/проміжок між відповідними поверхнями виступу й паза\.$/);
    expect(
      sectionNumberFields(settings as NonNullable<typeof settings>).map(({ key, label, suffix, range, unit }) => [
        key,
        label,
        suffix,
        range,
        unit,
      ]),
    ).toEqual([
      ['cylinderDovetailSize', 'Висота виступу, мм', '', { min: 1.5, max: 3, increment: 0.25 }, 2],
      ['cylinderDovetailLengthPercent', 'Довжина виступу, мм', '', { min: 20, max: 48, increment: 0.25 }, 0.8],
      ['cylinderDovetailClearanceMm', 'Зазор між поверхнями, мм', '', { min: 0.1, max: 0.4, increment: 0.05 }, undefined],
    ]);
    const notes = settings?.fields.filter((field) => field.type === 'note').map((field) => field.type === 'note' && field.text);
    expect(notes).toEqual([
      'Показано фактичні розміри для поточного масштабу моделі. Розміри кріплення змінюються разом із найбільшим габаритом.',
      'Ширина виступу: біля основи 6 мм, угорі 10 мм.',
    ]);
  });

  it('keeps typed values between the steps and rejects values beyond the ranges without clamping', () => {
    expect(request({ cylinderDovetailClearanceMm: '0,23', cylinderDovetailSize: '1,1' }).spec?.section?.connector).toEqual({
      type: 'dovetail',
      sizeFactor: 1.1,
      lengthPercent: 50,
      clearanceMm: 0.23,
    });
    // Stored values outside the ranges are explained in the millimetres that the fields show.
    for (const [key, text, message] of [
      ['cylinderDovetailSize', '0,7', 'Допустимі значення — від 1,5 мм до 3 мм.'],
      ['cylinderDovetailLengthPercent', '61', 'Допустимі значення — від 20 мм до 48 мм.'],
      ['cylinderDovetailClearanceMm', '0,05', 'Допустимі значення — від 0,1 мм до 0,4 мм.'],
      ['cylinderDovetailSize', '', 'Введіть значення.'],
      ['cylinderDovetailSize', 'два', 'Введіть число, наприклад 2.'],
    ] as const) {
      const result = request({ [key]: text });
      expect(result.errors).toEqual({ [key]: message });
      expect(result.spec).toBeUndefined();
    }
  });

  it('explains a combination that cannot carry the dovetail at the field to change, and builds nothing', () => {
    // M = 60 mm, k = 0,75: h = 1,125 mm.
    const low = request({ printSizeMm: '60', cylinderDovetailSize: '0,75' });
    expect(low.spec).toBeUndefined();
    expect(low.errors).toEqual({
      cylinderDovetailSize:
        'Виступ заввишки 1,12 мм, потрібно щонайменше 1,2 мм. Збільште висоту виступу або найбільший габарит.',
    });
    // h/r = 0,5 at 90 %: the upper part is 2 mm thick over a 2,2 mm groove.
    const thin = request({ cylinderHeightRatio: '0,5', cylinderSectionPercent: '90' });
    expect(thin.errors).toEqual({
      cylinderSectionPercent:
        'Над пазом лишається 0 мм, потрібно щонайменше 1,2 мм верхньої частини. Опустіть переріз або зменште висоту виступу.',
    });
    expect(thin.values.cylinderSectionPercent).toBe(90);
    // The same values without the connector are a valid smooth cut.
    expect(
      request({ cylinderHeightRatio: '0,5', cylinderSectionPercent: '90' }, { ...joined, cylinderConnector: 'none' }).spec,
    ).toBeDefined();
  });

  it('revalidates for the height, tilt, position, size and settings, and rebuilds for each', () => {
    const base = request({}).key;
    for (const change of [
      { cylinderHeightRatio: '3' },
      { cylinderOffsetRatio: '1' },
      { cylinderSectionPercent: '40' },
      { printSizeMm: '120' },
      { cylinderDovetailSize: '1,25' },
      { cylinderDovetailLengthPercent: '40' },
      { cylinderDovetailClearanceMm: '0,3' },
    ]) {
      const changed = request(change);
      expect(changed.errors).toEqual({});
      expect(changed.key).not.toBe(base);
    }
    expect(request({}, { ...joined, cylinderPartsSeparated: false }).key).toBe(base);
  });

  it('is disabled with the cut, and its hidden drafts do not block the model', () => {
    const uncut = { ...joined, cylinderSection: 'none' } as const;
    expect(activeConnector('cylinder', uncut)).toBeUndefined();
    expect(activeConnector('cylinder', joined)).toBe('dovetail');
    expect(request({ cylinderDovetailSize: '9' }, uncut).spec).not.toHaveProperty('section');
    expect(request({ cylinderDovetailSize: '9' }, { ...joined, cylinderConnector: 'none' }).errors).toEqual({});
    expect(groupsOf(uncut).map((group) => group.title)).toEqual(['Висота', 'Нахил', 'Переріз']);
    expect(request({}, uncut).spec?.section).toBeUndefined();
  });

  it('resets to no connector and its default settings, keeping the print size', () => {
    const edited: ParameterState = {
      texts: texts({ printSizeMm: '120', cylinderDovetailSize: '1,5', cylinderDovetailClearanceMm: '0,35' }),
      choices: joined,
    };
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.choices.cylinderConnector).toBe('none');
    expect(reset.choices.cylinderSection).toBe('none');
    expect(reset.texts).toEqual(texts({ printSizeMm: '120' }));
    // Settings of a connector that is not chosen do not offer a reset on their own.
    const hidden = { texts: texts({ cylinderDovetailSize: '1,5' }), choices: { ...joined, cylinderConnector: 'none' } } as const;
    expect(canResetShapeParameters('cylinder', { ...hidden, choices: { ...hidden.choices, cylinderSection: 'none' } })).toBe(
      false,
    );
    expect(
      canResetShapeParameters('cylinder', {
        texts: hidden.texts,
        choices: { ...triangle, cylinderSection: 'parallel-to-bases' },
      }),
    ).toBe(true);
  });
});

describe('plugs and dowels joining the cylinder’s parts', () => {
  const sectioned = { ...triangle, cylinderSection: 'parallel-to-bases' } as const;
  const choose = (cylinderConnector: 'plug' | 'dowel', cylinderRoundCount: 1 | 2 = 1) =>
    ({ ...sectioned, cylinderConnector, cylinderRoundCount }) as const;
  const request = (overrides: Partial<ParameterTexts>, choices: typeof triangle) =>
    resolveModelRequest('cylinder', texts(overrides), choices);
  const connectorGroup = (choices: typeof triangle) => {
    const panel = shapePanel('cylinder', choices, { values: request({}, choices).values });
    return panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Кріплення') : undefined;
  };
  const fieldsOf = (choices: typeof triangle) => connectorGroup(choices)?.fields.map((field) => [field.type, field.key]);
  const groupsOfDovetail = () => connectorGroup({ ...sectioned, cylinderConnector: 'dovetail' })?.help?.text;

  it('builds one plug or dowel by default: d and e multipliers 1 and the type’s own diametral clearances', () => {
    expect(request({}, choose('plug')).spec?.section?.connector).toEqual({
      type: 'plug',
      count: 1,
      diameterFactor: 1,
      depthFactor: 1,
      holeClearanceMm: 0.2,
    });
    expect(request({}, choose('dowel')).spec?.section?.connector).toEqual({
      type: 'dowel',
      count: 1,
      diameterFactor: 1,
      depthFactor: 1,
      lowerClearanceMm: 0.1,
      upperClearanceMm: 0.2,
    });
  });

  it('shows the type, the count and the applicable settings together, in millimetres; the spacing only for a pair', () => {
    expect(fieldsOf(choose('plug'))).toEqual([
      ['choice', 'cylinderConnector'],
      ['note', 'cylinder-connector-scale'],
      ['choice', 'cylinderRoundCount'],
      ['note', 'cylinder-connector-count'],
      ['number', 'cylinderRoundDiameter'],
      ['number', 'cylinderRoundDepth'],
      ['number', 'cylinderPlugClearanceMm'],
    ]);
    expect(fieldsOf(choose('dowel', 2))).toEqual([
      ['choice', 'cylinderConnector'],
      ['note', 'cylinder-connector-scale'],
      ['choice', 'cylinderRoundCount'],
      ['note', 'cylinder-connector-count'],
      ['number', 'cylinderRoundDiameter'],
      ['note', 'cylinder-connector-second-diameter'],
      ['number', 'cylinderRoundSpacingPercent'],
      ['number', 'cylinderRoundDepth'],
      ['note', 'cylinder-dowel-insertion'],
      ['number', 'cylinderDowelLowerClearanceMm'],
      ['number', 'cylinderDowelUpperClearanceMm'],
    ]);
    const group = connectorGroup(choose('dowel', 2));
    expect(group?.status).toEqual({ text: 'знімні штифти', highlighted: true });
    expect(group?.help?.text).toMatch(/^Штифти друкуються окремо/);
    expect(group?.help?.text).toMatch(/Номінально в кожну половинку входить половина цієї довжини\./);
    // At M = 80 mm and r = 40 mm: d = 0,0625·80·k from 3,75 to 7,5 mm, a dowel 2·0,05·80·k from 6 to 12 mm long, a
    // pair's axes from 10 to 26 mm from the centre.
    expect(
      sectionNumberFields(group as NonNullable<typeof group>).map(({ label, suffix, range }) => [label, suffix, range]),
    ).toEqual([
      ['Діаметр штифта, мм', '', { min: 3.75, max: 7.5, increment: 0.25 }],
      ['Від центра до осі кріплення, мм', '', { min: 10, max: 26, increment: 0.25 }],
      ['Повна довжина штифта, мм', '', { min: 6, max: 12, increment: 0.25 }],
      ['Збільшення діаметра нижніх отворів, мм', '', { min: 0, max: 0.4, increment: 0.05 }],
      ['Збільшення діаметра верхніх отворів, мм', '', { min: 0, max: 0.4, increment: 0.05 }],
    ]);
    const notes = (choices: typeof triangle) =>
      connectorGroup(choices)?.fields.flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(notes(choose('dowel', 2))).toEqual([
      'Показано фактичні розміри для поточного масштабу моделі. Розміри кріплення змінюються разом із найбільшим габаритом.',
      'Одне кругле кріплення дозволяє повертати половинки. Два кріплення різного діаметра задають їхнє взаємне положення.',
      'Друге кріплення: діаметр 4 мм.',
      'У кожну половинку штифт входить на 4 мм.',
    ]);
    // A plug's field is its height above the cut, e = 4 mm, from 3 to 6 mm; it enters the upper part only.
    const plug = connectorGroup(choose('plug'));
    expect(sectionNumberFields(plug as NonNullable<typeof plug>).map(({ label, range }) => [label, range])).toEqual([
      ['Діаметр виступу, мм', { min: 3.75, max: 7.5, increment: 0.25 }],
      ['Висота виступу, мм', { min: 3, max: 6, increment: 0.25 }],
      ['Збільшення діаметра отвору, мм', { min: 0, max: 0.4, increment: 0.05 }],
    ]);
    expect(plug?.help?.text).toMatch(/^Виступ друкується разом із нижньою половинкою та входить в отвір верхньої\./);
    expect(plug?.help?.text).toMatch(/значення 0,2 мм дає отвір діаметром 5,2 мм\.$/);
    for (const help of [plug?.help?.text, group?.help?.text, groupsOfDovetail()]) {
      expect(help).not.toMatch(/×|множник|ластівчин|k\b/i);
    }
  });

  it('gives a pair its spacing, keeps typed values between steps and rejects values beyond the ranges', () => {
    expect(request({ cylinderRoundSpacingPercent: '47,5' }, choose('plug', 2)).spec?.section?.connector).toMatchObject({
      count: 2,
      spacingPercent: 47.5,
    });
    for (const [key, text, message] of [
      ['cylinderRoundDiameter', '1,6', 'Допустимі значення — від 3,75 мм до 7,5 мм.'],
      ['cylinderRoundDepth', '0,7', 'Допустимі значення — від 6 мм до 12 мм.'],
      ['cylinderRoundSpacingPercent', '70', 'Допустимі значення — від 10 мм до 26 мм.'],
      ['cylinderDowelLowerClearanceMm', '-0,05', 'Допустимі значення — від 0 мм до 0,4 мм.'],
      ['cylinderDowelUpperClearanceMm', '0,45', 'Допустимі значення — від 0 мм до 0,4 мм.'],
    ] as const) {
      const result = request({ [key]: text }, choose('dowel', 2));
      expect(result.errors).toEqual({ [key]: message });
      expect(result.spec).toBeUndefined();
    }
    // A single connector ignores a draft of the hidden spacing.
    expect(request({ cylinderRoundSpacingPercent: '9' }, choose('plug')).errors).toEqual({});
  });

  it('explains an unsuitable combination at the field to change and builds nothing', () => {
    // A 0,4 mm clearance leaves the 3,75 mm pin only 0,35 mm wider than the 3 mm + 0,4 mm hole at M = 60 mm.
    const keyed = request({ printSizeMm: '60', cylinderPlugClearanceMm: '0,4' }, choose('plug', 2));
    expect(keyed.spec).toBeUndefined();
    expect(keyed.errors.cylinderPlugClearanceMm).toBe(
      'Більший виступ ширший за менший отвір на 0,35 мм, потрібно щонайменше 0,5 мм, інакше частини можна з’єднати, ' +
        'повернувши на 180°. Зменште збільшення діаметра отворів або збільште діаметр виступу.',
    );
    // At 90 % of a flat cylinder the upper part is 2 mm thick over a 4,3 mm hole.
    const thin = request({ cylinderHeightRatio: '0,5', cylinderSectionPercent: '90' }, choose('dowel'));
    expect(thin.errors.cylinderRoundDepth).toMatch(
      /^Під дном отвору у верхній частині лишається 0 мм, потрібно щонайменше 1,2 мм\./,
    );
    expect(thin.spec).toBeUndefined();
    const narrow = request({ printSizeMm: '48', cylinderRoundDiameter: '0,75' }, choose('dowel'));
    expect(narrow.errors.cylinderRoundDiameter).toMatch(/^Найменший діаметр штифта — 2,25 мм, потрібно щонайменше 3 мм\./);
  });

  it('keeps each type’s settings when switching and never reads one type’s clearance for another', () => {
    const edited = texts({
      cylinderPlugClearanceMm: '0,3',
      cylinderDowelUpperClearanceMm: '0,15',
      cylinderDovetailClearanceMm: '0,35',
    });
    expect(resolveModelRequest('cylinder', edited, choose('plug')).spec?.section?.connector).toMatchObject({
      holeClearanceMm: 0.3,
    });
    expect(resolveModelRequest('cylinder', edited, choose('dowel')).spec?.section?.connector).toMatchObject({
      lowerClearanceMm: 0.1,
      upperClearanceMm: 0.15,
    });
    expect(
      resolveModelRequest('cylinder', edited, { ...sectioned, cylinderConnector: 'dovetail' }).spec?.section?.connector,
    ).toMatchObject({ clearanceMm: 0.35 });
    // The shared multipliers and count carry over between plugs and dowels.
    const shared = texts({ cylinderRoundDiameter: '1,25' });
    for (const type of ['plug', 'dowel'] as const) {
      expect(resolveModelRequest('cylinder', shared, choose(type, 2)).spec?.section?.connector).toMatchObject({
        count: 2,
        diameterFactor: 1.25,
      });
    }
  });

  it('resets to no connector with every setting at its default, keeping the print size', () => {
    const edited: ParameterState = {
      texts: texts({ printSizeMm: '120', cylinderRoundDiameter: '1,5', cylinderDowelLowerClearanceMm: '0' }),
      choices: choose('dowel', 2),
    };
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.texts).toEqual(texts({ printSizeMm: '120' }));
    expect(reset.choices).toMatchObject({ cylinderConnector: 'none', cylinderRoundCount: 1, cylinderSection: 'none' });
    // Without a section its connector's settings shape nothing and offer no reset of their own.
    const hidden = texts({ cylinderRoundSpacingPercent: '60', cylinderPlugClearanceMm: '0,3' });
    expect(
      canResetShapeParameters('cylinder', { texts: hidden, choices: { ...choose('plug', 2), cylinderSection: 'none' } }),
    ).toBe(false);
  });
});
