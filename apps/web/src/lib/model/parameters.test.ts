import { obliqueCylinderSection, roundDimensionsMm, sectionOffsetMm } from '@diploma-3d/engine';
import { describe, expect, it } from 'vitest';
import { formatSteppedDecimal, snapDecimal, stepDecimal } from '../decimal.ts';
import { sectionNumberFields, shapePanel } from '../shapes.ts';
import { formatMillimetres, storedText } from './connectorScale.ts';
import {
  activeConnector,
  activeSection,
  alignedTrapezoidShift,
  type ConnectorEdits,
  canResetShapeParameters,
  canSwitchTiltMode,
  commitConnectorEdit,
  initialParameterChoices,
  initialParameterTexts,
  isScaledConnectorKey,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  partsSeparated,
  resetShapeParameters,
  resolveModelRequest,
  shapeParameterKeys,
  startApexSection,
  switchTiltMode,
  TWIST_UNSUPPORTED_MESSAGE,
  validateAngle,
  validateApex,
  validateApexInclination,
  validateDiametralClearance,
  validateDirection,
  validateObliqueDirection,
  validateObliqueInclination,
  validateOffset,
  validatePrintSize,
  validateRatio,
  validateRoundHeight,
  validateRoundOffset,
  validateSectionPosition,
} from './parameters.ts';
import { initialTiltModes, type TiltMode, type TiltSolid } from './tilt.ts';

// Most cases read as a hand-entered circular connector with earlier clearances, the one that must keep behaving as it did;
// the defaults of new connectors have their own cases at the end.
const entered = {
  cylinderPlugClearanceMm: '0,2',
  cylinderDowelLowerClearanceMm: '0,1',
  cylinderDowelUpperClearanceMm: '0,2',
  conePlugClearanceMm: '0,2',
  coneDowelLowerClearanceMm: '0,1',
  coneDowelUpperClearanceMm: '0,2',
  ballPlugClearanceMm: '0,2',
  ballDowelLowerClearanceMm: '0,1',
  ballDowelUpperClearanceMm: '0,2',
};
const texts = (overrides: Partial<ParameterTexts>): ParameterTexts => ({ ...initialParameterTexts(), ...entered, ...overrides });
const triangle = {
  ...initialParameterChoices(),
  cylinderRoundProfile: 'circle',
  coneRoundProfile: 'circle',
  ballRoundProfile: 'circle',
} as const satisfies ParameterChoices;

/** After a reset, a solid's own connector values are the current defaults again; the other solids' stay as they were. */
const resetTexts = (kind: 'cylinder' | 'cone' | 'ball', overrides: Partial<ParameterTexts>): ParameterTexts => {
  const initial = initialParameterTexts();
  const clearances = (['PlugClearanceMm', 'DowelLowerClearanceMm', 'DowelUpperClearanceMm'] as const).map(
    (name) => `${kind}${name}` as keyof ParameterTexts,
  );
  return { ...texts(overrides), ...Object.fromEntries(clearances.map((key) => [key, initial[key]])) };
};

/** A cube's or parallelepiped's section fields as they start, each solid with its own. */
const boxInitialTexts = (solid: string) => ({
  [`${solid}SectionPercent`]: '50',
  [`${solid}SectionSecondPercent`]: '75',
  [`${solid}TraceAngleDeg`]: '0',
  [`${solid}LineAngleDeg`]: '45',
  [`${solid}PointPercent`]: '50',
  [`${solid}PlaneInclinationDeg`]: '45',
  [`${solid}PlaneDirectionDeg`]: '0',
  [`${solid}DovetailSize`]: '1',
  [`${solid}DovetailLengthPercent`]: '50',
  [`${solid}DovetailClearanceMm`]: '0,2',
  [`${solid}RoundSpacingPercent`]: '45',
  [`${solid}RoundDiameter`]: '1',
  [`${solid}RoundDepth`]: '1',
  [`${solid}PlugClearanceMm`]: '0,5',
  [`${solid}DowelLowerClearanceMm`]: '0,4',
  [`${solid}DowelUpperClearanceMm`]: '0,5',
  [`${solid}MagnetCount`]: '3',
  [`${solid}MagnetDiameterMm`]: '6',
  [`${solid}MagnetThicknessMm`]: '2',
  [`${solid}MagnetDiameterAllowanceMm`]: '0,2',
  [`${solid}MagnetDepthAllowanceMm`]: '0,1',
});

/** Its choices as they start: no section, a plane through the lower base's edge AB by its angle when one is chosen. */
const boxInitialChoices = (solid: string) => ({
  [`${solid}Section`]: 'none',
  [`${solid}Face`]: 'ABCD',
  [`${solid}Trace`]: 'angle',
  [`${solid}LineFace`]: 'ABCD',
  [`${solid}Line`]: 'A-B',
  [`${solid}LineMethod`]: 'angle',
  [`${solid}PointEdge`]: 'C-C1',
  [`${solid}NormalAlong`]: 'none',
  [`${solid}Connector`]: 'none',
  [`${solid}DovetailEntrance`]: 'standard',
  [`${solid}RoundCount`]: 1,
  [`${solid}RoundProfile`]: 'flatted-circle',
  [`${solid}PartsSeparated`]: true,
  [`${solid}SecondCut`]: false,
  [`${solid}LineAngleFor`]: '',
  [`${solid}PointFor`]: '',
});

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
      coneSectionPercent: '50',
      conePlateThicknessMm: '1,6',
      conePlateMarginMm: '10',
      coneSectionOffsetPercent: '0',
      coneObliquePositionPercent: '50',
      coneObliqueInclinationDeg: '45',
      coneObliqueDirectionDeg: '0',
      coneApexInclinationDeg: '90',
      coneApexDirectionDeg: '0',
      coneDovetailSize: '1',
      coneDovetailLengthPercent: '50',
      coneDovetailClearanceMm: '0,2',
      coneRoundSpacingPercent: '45',
      coneRoundDiameter: '1',
      coneRoundDepth: '1',
      conePlugClearanceMm: '0,5',
      coneDowelLowerClearanceMm: '0,4',
      coneDowelUpperClearanceMm: '0,5',
      ballSectionOffsetPercent: '0',
      ballSectionSecondOffsetPercent: '40',
      ballPlateThicknessMm: '1,6',
      ballPlateMarginMm: '10',
      ballDovetailSize: '1',
      ballDovetailLengthPercent: '50',
      ballDovetailClearanceMm: '0,2',
      ballRoundSpacingPercent: '45',
      ballRoundDiameter: '1',
      ballRoundDepth: '1',
      ballPlugClearanceMm: '0,5',
      ballDowelLowerClearanceMm: '0,4',
      ballDowelUpperClearanceMm: '0,5',
      cylinderSectionPercent: '50',
      cylinderSectionOffsetPercent: '0',
      cylinderObliquePositionPercent: '50',
      cylinderObliqueInclinationDeg: '45',
      cylinderObliqueDirectionDeg: '0',
      cylinderAxisOffsetPercent: '0',
      cylinderAxisDirectionDeg: '90',
      cylinderDovetailSize: '1',
      cylinderDovetailLengthPercent: '50',
      cylinderDovetailClearanceMm: '0,2',
      cylinderRoundSpacingPercent: '45',
      cylinderRoundDiameter: '1',
      cylinderRoundDepth: '1',
      cylinderPlugClearanceMm: '0,5',
      cylinderDowelLowerClearanceMm: '0,4',
      cylinderDowelUpperClearanceMm: '0,5',
      cylinderTwistSizeMm: '18',
      cylinderTwistClearanceMm: '0,5',
      cylinderTwistAxialMm: '0,2',
      cylinderPlateThicknessMm: '1,6',
      cylinderPlateMarginMm: '10',
      cylinderMagnetCount: '3',
      cylinderMagnetDiameterMm: '6',
      cylinderMagnetThicknessMm: '2',
      cylinderMagnetDiameterAllowanceMm: '0,2',
      cylinderMagnetDepthAllowanceMm: '0,1',
      coneMagnetCount: '3',
      coneMagnetDiameterMm: '6',
      coneMagnetThicknessMm: '2',
      coneMagnetDiameterAllowanceMm: '0,2',
      coneMagnetDepthAllowanceMm: '0,1',
      ballMagnetCount: '3',
      ballMagnetDiameterMm: '6',
      ballMagnetThicknessMm: '2',
      ballMagnetDiameterAllowanceMm: '0,2',
      ballMagnetDepthAllowanceMm: '0,1',
      ...boxInitialTexts('cube'),
      ...boxInitialTexts('cuboid'),
      ...boxInitialTexts('parallelepiped'),
    });
    expect(initialParameterChoices()).toEqual({
      prismBaseType: 'regular',
      prismBaseSides: 3,
      pyramidBaseType: 'regular',
      pyramidBaseSides: 4,
      cylinderSection: 'none',
      cylinderPartsSeparated: true,
      cylinderPlate: false,
      cylinderConnector: 'none',
      cylinderDovetailEntrance: 'standard',
      cylinderRoundCount: 1,
      cylinderRoundProfile: 'flatted-circle',
      coneSection: 'none',
      conePartsSeparated: true,
      conePlate: false,
      coneConnector: 'none',
      coneDovetailEntrance: 'standard',
      coneRoundCount: 1,
      coneRoundProfile: 'flatted-circle',
      coneObliqueThrough: 'axis',
      coneApexStarted: false,
      coneApexAxial: false,
      ballSection: 'none',
      ballConnector: 'none',
      ballDovetailEntrance: 'standard',
      ballRoundCount: 1,
      ballRoundProfile: 'flatted-circle',
      ballPartsSeparated: true,
      ballPlate: false,
      ballSecondCut: false,
      ...boxInitialChoices('cube'),
      ...boxInitialChoices('cuboid'),
      ...boxInitialChoices('parallelepiped'),
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
    const initial = resolveModelRequest(kind, texts({}), choices, options);
    // The defaults of every figure are valid in both modes.
    expect(initial.errors).toEqual({});
    const panel = shapePanel(kind, choices, { tiltModes, values: initial.values, sectionRanges: initial.sectionRanges });
    if (panel.type === 'fixed') throw new Error('A configurable figure has fields.');
    for (const field of panel.sections.flatMap(sectionNumberFields)) {
      if (field.range === undefined) throw new Error(`${field.key} has no range at the defaults.`);
      const { min, max } = field.range;
      // A field shown in millimetres stores what its entry converts the millimetres to.
      const stored = (value: number) => {
        const text = formatSteppedDecimal(value);
        const { key, unit } = field;
        return unit === undefined || !isScaledConnectorKey(key) ? text : storedText(text, unit);
      };
      // A connector setting's range is what the solid, the cut and the other settings allow; the same check explains
      // a value beyond it.
      const rangeErrorAt = (value: number) =>
        resolveModelRequest(kind, texts({ [field.key]: stored(value) }), choices, options).errors[field.key] !== undefined;
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
    // The switch itself is on, but a model without a section has no separated preview to show.
    expect(partsSeparated('cylinder', triangle)).toBe(true);
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
      ['toggle', 'cylinderPlate'],
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

  it('is chosen per solid, and not offered by solids without sections', () => {
    for (const kind of ['cone', 'prism', 'cube'] as const) {
      expect(resolveModelRequest(kind, texts({}), parallel).spec).not.toHaveProperty('section');
      expect(activeSection(kind, parallel)).toBeUndefined();
    }
    for (const kind of ['prism', 'tetrahedron'] as const) expect(partsSeparated(kind, parallel)).toBe(false);
    const cone = shapePanel('cone', parallel);
    // The cone's own choice is still "no section": no connector group.
    expect(cone.type === 'parameters' && cone.sections.map((part) => part.title)).toEqual(['Висота', 'Нахил', 'Переріз']);
  });

  it('resets to no section at 50 % with the parts apart, keeping the print size and the other shapes', () => {
    const edited: ParameterState = {
      texts: texts({ cylinderSectionPercent: '15', cylinderHeightRatio: '3', printSizeMm: '120', coneHeightRatio: '4' }),
      choices: { ...parallel, cylinderPartsSeparated: false, prismBaseSides: 6 },
    };
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.texts).toEqual(resetTexts('cylinder', { printSizeMm: '120', coneHeightRatio: '4' }));
    expect(reset.choices).toEqual({ ...triangle, prismBaseSides: 6, cylinderRoundProfile: 'flatted-circle' });
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
    const { values, sectionRanges } = request({}, choices);
    const panel = shapePanel('cylinder', choices, { values, sectionRanges });
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
      'cylinderPlate',
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
          { value: 'twist', label: 'Поворотне з’єднання' },
          { value: 'magnet', label: 'Магнітні гнізда' },
        ],
      },
    ]);

    expect(request({}).spec?.section).toEqual({
      type: 'parallel-to-bases',
      positionPercent: 50,
      connector: { type: 'dovetail', sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2, entrance: 'standard' },
    });
    // At M = 80 mm and r = 40 mm, h = 2 mm and L = 40 mm: h from the 1,2 mm minimum to where the groove's closed end
    // keeps 1,2 mm of wall; L from the straight 1,2 mm after the 0,5 mm lead-in to the same wall.
    const settings = groupsOf(joined).find((group) => group.title === 'Кріплення');
    expect(settings?.fields.map((field) => [field.type, field.key])).toEqual([
      ['choice', 'cylinderConnector'],
      ['choice', 'cylinderDovetailEntrance'],
      ['note', 'cylinder-connector-scale'],
      ['number', 'cylinderDovetailSize'],
      ['note', 'cylinder-dovetail-widths'],
      ['number', 'cylinderDovetailLengthPercent'],
      ['number', 'cylinderDovetailClearanceMm'],
    ]);
    expect(settings?.help?.text).toMatch(/^На нижній частині є виступ, у верхній — паз\./);
    expect(settings?.help?.text).toMatch(/проміжок між відповідними поверхнями виступу й паза\.\n\nМежі повзунків/);
    expect(settings?.help?.text).toMatch(/міцність і зручність посадки перевіряє пробний друк\.$/);
    expect(
      sectionNumberFields(settings as NonNullable<typeof settings>).map(({ key, label, suffix, range, unit }) => [
        key,
        label,
        suffix,
        range,
        unit,
      ]),
    ).toEqual([
      ['cylinderDovetailSize', 'Висота виступу, мм', '', { min: 1.2, max: 13.035, increment: 0.25 }, 2],
      ['cylinderDovetailLengthPercent', 'Довжина виступу, мм', '', { min: 1.7, max: 76.323, increment: 0.25 }, 0.8],
      ['cylinderDovetailClearanceMm', 'Зазор між поверхнями, мм', '', { min: 0.1, max: 0.4, increment: 0.05 }, undefined],
    ]);
    const notes = settings?.fields.filter((field) => field.type === 'note').map((field) => field.type === 'note' && field.text);
    expect(notes).toEqual([
      'Показано фактичні розміри для поточного масштабу моделі. Розміри кріплення змінюються разом із найбільшим габаритом.',
      'Ширина виступу: біля основи 6 мм, угорі 10 мм.',
    ]);
  });

  it('keeps typed values between the steps, accepts what the cylinder allows and explains the rest without clamping', () => {
    expect(request({ cylinderDovetailClearanceMm: '0,23', cylinderDovetailSize: '1,1' }).spec?.section?.connector).toEqual({
      type: 'dovetail',
      sizeFactor: 1.1,
      lengthPercent: 50,
      clearanceMm: 0.23,
      entrance: 'standard',
    });
    // Beyond the former limits of 3 mm and 48 mm: 5 mm high and 70 mm long.
    expect(request({ cylinderDovetailSize: '2,5', cylinderDovetailLengthPercent: '87,5' }).spec?.section?.connector).toEqual({
      type: 'dovetail',
      sizeFactor: 2.5,
      lengthPercent: 87.5,
      clearanceMm: 0.2,
      entrance: 'standard',
    });
    // Values outside the feasible ranges are explained in the millimetres that the fields show, with those ranges.
    for (const [key, text, message] of [
      [
        'cylinderDovetailSize',
        '0,5',
        'Виступ заввишки 1 мм, потрібно щонайменше 1,2 мм. Збільште висоту виступу. Зараз допустимо від 1,2 мм до 13,035 мм.',
      ],
      [
        'cylinderDovetailLengthPercent',
        '1',
        'Пряма ділянка виступу після фаски — 0,3 мм, потрібно щонайменше 1,2 мм. Збільште довжину виступу. ' +
          'Зараз допустимо від 1,7 мм до 76,323 мм.',
      ],
      ['cylinderDovetailClearanceMm', '0,05', 'Допустимі значення — від 0,1 мм до 0,4 мм.'],
      ['cylinderDovetailSize', '', 'Введіть значення.'],
      ['cylinderDovetailSize', 'два', 'Введіть число, наприклад 2.'],
    ] as const) {
      const result = request({ [key]: text });
      expect(result.errors[key]).toBe(message);
      expect(result.spec).toBeUndefined();
    }
    // The straight length couples L and h: with L = 0,8 mm no height helps, and its field says so.
    expect(request({ cylinderDovetailLengthPercent: '1' }).errors.cylinderDovetailSize).toMatch(
      /^Пряма ділянка виступу після фаски — 0,3 мм.* Зараз жодне значення цього поля не підходить: змініть інші параметри\.$/,
    );
  });

  it('explains a combination that cannot carry the dovetail at the field to change, and builds nothing', () => {
    // M = 60 mm, k = 0,75: h = 1,125 mm.
    const low = request({ printSizeMm: '60', cylinderDovetailSize: '0,75' });
    expect(low.spec).toBeUndefined();
    expect(low.errors).toEqual({
      cylinderDovetailSize:
        'Виступ заввишки 1,12 мм, потрібно щонайменше 1,2 мм. Збільште висоту виступу. Зараз допустимо від 1,2 мм до 9,574 мм.',
    });
    // h/r = 0,5 at 90 %: the upper part is 2 mm thick over a 2,2 mm groove. No height of at least 1,2 mm leaves 1,2 mm
    // above it, and no clearance in the window does at this height: both fields say so, the problem first.
    const thin = request({ cylinderHeightRatio: '0,5', cylinderSectionPercent: '90' });
    const backing =
      'Над пазом лишається 0 мм, потрібно щонайменше 1,2 мм верхньої частини. Опустіть переріз або зменште висоту виступу.';
    expect(thin.errors).toEqual({
      cylinderDovetailSize: `${backing} Зараз жодне значення не підходить: потрібно щонайменше 1,2 мм, але не більше 0,6 мм.`,
      cylinderDovetailClearanceMm: `${backing} Зараз жодне значення цього поля не підходить: змініть інші параметри.`,
    });
    expect(thin.values.cylinderSectionPercent).toBe(90);
    expect(thin.sectionRanges).toMatchObject({ cylinderDovetailSize: null, cylinderDovetailClearanceMm: null });
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
    expect(reset.texts).toEqual(resetTexts('cylinder', { printSizeMm: '120' }));
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
    const { values, sectionRanges } = request({}, choices);
    const panel = shapePanel('cylinder', choices, { values, sectionRanges });
    return panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Кріплення') : undefined;
  };
  const fieldsOf = (choices: typeof triangle) => connectorGroup(choices)?.fields.map((field) => [field.type, field.key]);
  const groupsOfDovetail = () => connectorGroup({ ...sectioned, cylinderConnector: 'dovetail' })?.help?.text;

  it('builds one plug or dowel by default: d and e multipliers 1 and the type’s own diametral clearances', () => {
    expect(request({}, choose('plug')).spec?.section?.connector).toEqual({
      type: 'plug',
      count: 1,
      profile: 'circle',
      diameterFactor: 1,
      depthFactor: 1,
      holeClearanceMm: 0.2,
    });
    expect(request({}, choose('dowel')).spec?.section?.connector).toEqual({
      type: 'dowel',
      count: 1,
      profile: 'circle',
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
      ['choice', 'cylinderRoundProfile'],
      ['choice', 'cylinderRoundCount'],
      ['note', 'cylinder-connector-count'],
      ['number', 'cylinderRoundDiameter'],
      ['number', 'cylinderRoundDepth'],
      ['note', 'cylinder-plug-height'],
      ['number', 'cylinderPlugClearanceMm'],
      ['note', 'cylinder-connector-clearance'],
    ]);
    expect(fieldsOf(choose('dowel', 2))).toEqual([
      ['choice', 'cylinderConnector'],
      ['note', 'cylinder-connector-scale'],
      ['choice', 'cylinderRoundProfile'],
      ['choice', 'cylinderRoundCount'],
      ['note', 'cylinder-connector-count'],
      ['number', 'cylinderRoundDiameter'],
      ['note', 'cylinder-connector-second-diameter'],
      ['number', 'cylinderRoundSpacingPercent'],
      ['number', 'cylinderRoundDepth'],
      ['note', 'cylinder-dowel-insertion'],
      ['number', 'cylinderDowelLowerClearanceMm'],
      ['number', 'cylinderDowelUpperClearanceMm'],
      ['note', 'cylinder-connector-clearance'],
      ['action', 'cylinder-download-pins'],
    ]);
    const group = connectorGroup(choose('dowel', 2));
    expect(group?.status).toEqual({ text: 'знімні штифти', highlighted: true });
    expect(group?.help?.text).toMatch(/^Штифти друкуються окремо/);
    expect(group?.help?.text).toMatch(/Номінально в кожну половинку входить половина цієї довжини\./);
    // At M = 80 mm and r = 40 mm, with d = 5 mm, e = 4 mm and s = 18 mm: a pair's d from 0,8·d ≥ 3 mm to where the
    // holes keep their walls; s from (3 + 2,42 + 1,2)/2 mm between the entrances to the wall at the side; a dowel from
    // 2·3,1 mm, the straight 2 mm after both 0,4 mm chamfers and 0,3 mm of play, to 2·(40 − 1,2 − 0,3) mm.
    expect(
      sectionNumberFields(group as NonNullable<typeof group>).map(({ label, suffix, range }) => [label, suffix, range]),
    ).toEqual([
      ['Діаметр штифта, мм', '', { min: 3.75, max: 36.666, increment: 0.1 }],
      ['Від центра до осі кріплення, мм', '', { min: 3.31, max: 35.751, increment: 0.25 }],
      ['Повна довжина штифта, мм', '', { min: 6.2, max: 77, increment: 0.25 }],
      ['Збільшення діаметра нижніх отворів, мм', '', { min: 0, max: 0.5, increment: 0.05 }],
      ['Збільшення діаметра верхніх отворів, мм', '', { min: 0, max: 0.5, increment: 0.05 }],
    ]);
    const notes = (choices: typeof triangle) =>
      connectorGroup(choices)?.fields.flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(notes(choose('dowel', 2))).toEqual([
      'Показано фактичні розміри кріплення. Спочатку їх визначає місце в обох частинах; задані вручну змінюються разом із ' +
        'найбільшим габаритом, а якщо вже не вміщуються, зменшуються автоматично.',
      'Одне кругле кріплення дозволяє повертати половинки. Два кріплення різного діаметра задають їхнє взаємне положення.',
      'Друге кріплення: діаметр 4 мм.',
      'У кожну половинку штифт входить на 4 мм.',
      'Значення 0,4 мм дає зазор 0,2 мм з кожного боку.',
    ]);
    // A plug's field is its height above the cut, e = 4 mm, from 2,8 to 38,5 mm; it enters the upper part only.
    const plug = connectorGroup(choose('plug'));
    expect(sectionNumberFields(plug as NonNullable<typeof plug>).map(({ label, range }) => [label, range])).toEqual([
      ['Діаметр виступу, мм', { min: 3, max: 75.703, increment: 0.1 }],
      ['Висота виступу, мм', { min: 2.8, max: 38.5, increment: 0.25 }],
      ['Збільшення діаметра отвору, мм', { min: 0, max: 1, increment: 0.05 }],
    ]);
    expect(plug?.help?.text).toMatch(/^Виступ друкується разом із нижньою половинкою та входить в отвір верхньої\./);
    expect(plug?.help?.text).toMatch(/значення 0,2 мм дає отвір діаметром 5,2 мм\.\n\nМежі повзунків/);
    for (const help of [plug?.help?.text, group?.help?.text, groupsOfDovetail()]) {
      expect(help).not.toMatch(/×|множник|ластівчин|k\b/i);
    }
  });

  it('gives a pair its spacing, keeps typed values between steps and explains values beyond the feasible ranges', () => {
    expect(request({ cylinderRoundSpacingPercent: '47,5' }, choose('plug', 2)).spec?.section?.connector).toMatchObject({
      count: 2,
      spacingPercent: 47.5,
    });
    // Beyond the former limits: an 8 mm plug, 16 mm dowels 10 mm wide, a pair 32 mm from the centre.
    expect(request({ cylinderRoundDepth: '2' }, choose('plug')).spec?.section?.connector).toMatchObject({ depthFactor: 2 });
    expect(
      request({ cylinderRoundDepth: '2', cylinderRoundDiameter: '2', cylinderRoundSpacingPercent: '80' }, choose('dowel', 2)).spec
        ?.section?.connector,
    ).toMatchObject({ count: 2, diameterFactor: 2, depthFactor: 2, spacingPercent: 80 });
    for (const [key, text, message] of [
      [
        'cylinderRoundDiameter',
        '0,7',
        'Найменший діаметр штифта — 2,8 мм, потрібно щонайменше 3 мм. Збільште діаметр штифта. ' +
          'Зараз допустимо від 3,75 мм до 36,666 мм.',
      ],
      [
        'cylinderRoundDepth',
        '0,7',
        'Після фасок й осьового зміщення пряма ділянка в отворі — 1,7 мм, потрібно щонайменше 2 мм. ' +
          'Збільште довжину штифта або зменште діаметр штифта. Зараз допустимо від 6,2 мм до 77 мм.',
      ],
      [
        'cylinderRoundSpacingPercent',
        '95',
        'Стінка біля отвору у верхній частині — 0 мм, потрібно щонайменше 1,2 мм. Зменште діаметр штифта або відстань ' +
          'від центра до осей. Стінка біля отвору у нижній частині — 0 мм, потрібно щонайменше 1,2 мм. Зменште діаметр ' +
          'штифта або відстань від центра до осей. Зараз допустимо від 3,31 мм до 35,751 мм.',
      ],
      ['cylinderDowelLowerClearanceMm', '-0,05', 'Допустимі значення — від 0 мм до 1 мм.'],
      ['cylinderDowelUpperClearanceMm', '1,05', 'Допустимі значення — від 0 мм до 1 мм.'],
    ] as const) {
      const result = request({ [key]: text }, choose('dowel', 2));
      expect(result.errors[key]).toBe(message);
      expect(result.sectionRanges === undefined).toBe(key.endsWith('ClearanceMm'));
      expect(result.spec).toBeUndefined();
    }
    // A 5,6 mm dowel leaves 1,7 mm of straight engagement; no pair diameter of at least 3,75 mm repairs that, so the
    // diameter's field names the conflict too.
    expect(request({ cylinderRoundDepth: '0,7' }, choose('dowel', 2)).errors.cylinderRoundDiameter).toMatch(
      /Зараз жодне значення не підходить: потрібно щонайменше 3,75 мм, але не більше 3,125 мм\.$/,
    );
    // A single connector ignores a draft of the hidden spacing.
    expect(request({ cylinderRoundSpacingPercent: '9' }, choose('plug')).errors).toEqual({});
  });

  it('explains an unsuitable combination at the field to change and builds nothing', () => {
    // A 0,4 mm clearance leaves the 3,75 mm pin only 0,35 mm wider than the 3 mm + 0,4 mm hole at M = 60 mm.
    const keyed = request({ printSizeMm: '60', cylinderPlugClearanceMm: '0,4' }, choose('plug', 2));
    expect(keyed.spec).toBeUndefined();
    expect(keyed.errors.cylinderPlugClearanceMm).toBe(
      'Більший виступ ширший за менший отвір на 0,35 мм, потрібно щонайменше 0,5 мм, інакше частини можна з’єднати, ' +
        'повернувши на 180°. Зменште збільшення діаметра отворів або збільште діаметр виступу. ' +
        'Зараз допустимо від 0 мм до 0,25 мм.',
    );
    // The diameter repairs it as well: d − (0,8·d + 0,4) ≥ 0,5 mm from d = 4,5 mm.
    expect(keyed.errors.cylinderRoundDiameter).toMatch(/Зараз допустимо від 4,5 мм до /);
    // Recovery: a smaller clearance makes the same pair valid again.
    expect(request({ printSizeMm: '60', cylinderPlugClearanceMm: '0,25' }, choose('plug', 2)).spec).toBeDefined();
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
    expect(reset.texts).toEqual(resetTexts('cylinder', { printSizeMm: '120' }));
    expect(reset.choices).toMatchObject({ cylinderConnector: 'none', cylinderRoundCount: 1, cylinderSection: 'none' });
    // Without a section its connector's settings shape nothing and offer no reset of their own.
    const hidden = texts({ cylinderRoundSpacingPercent: '60', cylinderPlugClearanceMm: '0,3' });
    expect(
      canResetShapeParameters('cylinder', { texts: hidden, choices: { ...choose('plug', 2), cylinderSection: 'none' } }),
    ).toBe(false);
  });
});

describe('a vertical section of the cylinder', () => {
  const sectioned = { ...triangle, cylinderSection: 'vertical' } as const;
  const choose = (cylinderConnector: 'dovetail' | 'plug' | 'dowel', cylinderRoundCount: 1 | 2 = 1) =>
    ({ ...sectioned, cylinderConnector, cylinderRoundCount }) as const;
  const request = (overrides: Partial<ParameterTexts>, choices: typeof triangle = sectioned) =>
    resolveModelRequest('cylinder', texts(overrides), choices);
  const groupsOf = (choices: typeof triangle, overrides: Partial<ParameterTexts> = {}) => {
    const { values, sectionRanges } = request(overrides, choices);
    const panel = shapePanel('cylinder', choices, { values, sectionRanges });
    return panel.type === 'parameters' ? panel.sections : [];
  };
  const group = (choices: typeof triangle, title: string, overrides: Partial<ParameterTexts> = {}) => {
    const found = groupsOf(choices, overrides).find((part) => part.title === title);
    if (found === undefined) throw new Error(`No group ${title}`);
    return found;
  };
  const rangesOf = (choices: typeof triangle, overrides: Partial<ParameterTexts> = {}) =>
    Object.fromEntries(
      sectionNumberFields(group(choices, 'Кріплення', overrides)).map(({ label, range }) => [
        label,
        range && [range.min, range.max],
      ]),
    );

  it('starts axial, with the distance from the axis in percent of r instead of the position along the height', () => {
    const result = request({});
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({ type: 'vertical', offsetPercent: 0 });
    const cut = group(sectioned, 'Переріз');
    expect(cut.status).toEqual({ text: 'вертикальний', highlighted: true });
    expect(cut.fields.map((field) => [field.type, field.key])).toEqual([
      ['choice', 'cylinderSection'],
      ['number', 'cylinderSectionOffsetPercent'],
      ['toggle', 'cylinderPartsSeparated'],
      ['toggle', 'cylinderPlate'],
    ]);
    // The thinner part keeps 10 % of the extent across the plane: ±0,8·r, in steps of 5 like the position along h.
    const field = sectionNumberFields(cut)[0];
    expect(field).toMatchObject({
      label: 'Зміщення від осі',
      suffix: '% r',
      range: { min: -80, max: 80, increment: 5 },
    });
    expect(field?.unit).toBeUndefined();
    expect(cut.fields[0]).toMatchObject({
      options: [
        { value: 'none', label: 'Без перерізу' },
        { value: 'parallel-to-bases', label: 'Паралельно основам' },
        { value: 'vertical', label: 'Вертикальний' },
        { value: 'oblique', label: 'Похилий' },
      ],
    });
  });

  it('explains itself, and keeps the connectors below that explanation in their own group', () => {
    const titles = groupsOf(sectioned).map(({ title }) => title);
    expect(titles.indexOf('Кріплення')).toBe(titles.indexOf('Переріз') + 1);
    const { help } = group(sectioned, 'Переріз');
    expect(help?.label).toBe('Як задано переріз?');
    expect(help?.text).toMatch(/осьовий переріз/);
    expect(help?.text).toMatch(/прямокутник/);
    expect(help?.text).toMatch(/паралелограм/);
    expect(help?.text).toMatch(/ширина перерізу змінюється/);
    expect(help?.text).toContain(
      '0% — осьовий переріз. Значення 50% зміщує площину на половину радіуса основи. Знак визначає бік зміщення.',
    );
    expect(group(sectioned, 'Кріплення').fields[0]).toMatchObject({
      key: 'cylinderConnector',
      options: [
        { value: 'none' },
        { value: 'dovetail' },
        { value: 'plug' },
        { value: 'dowel' },
        { value: 'twist', disabled: true },
        { value: 'magnet' },
      ],
    });
  });

  it('does not call the parts lower and upper, and explains the dovetail’s motion', () => {
    for (const choices of [choose('dovetail'), choose('plug'), choose('dowel', 2)]) {
      const connector = group(choices, 'Кріплення');
      expect(connector.help?.text).not.toMatch(/верхню частину|нижній частині|верхній частині|нижньою половинкою|насуньте/i);
      for (const field of sectionNumberFields(connector)) expect(field.label).not.toMatch(/(^|\s)(нижн|верхн)/i);
    }
    expect(group(choose('dovetail'), 'Кріплення').help?.text).toContain(
      'Паз відкритий угорі та закінчується упором унизу. Щоб скласти модель, опустіть половинку з виступом уздовж паза до упора. ' +
        'Для розбирання утримуйте половинку з пазом і підніміть половинку з виступом. У такому положенні її вага притискає ' +
        'виступ до нижнього упора.',
    );
    expect(rangesOf(choose('dowel'))).toHaveProperty(['Збільшення діаметра отворів частини 1, мм']);
    expect(rangesOf(choose('dowel'))).toHaveProperty(['Збільшення діаметра отворів частини 2, мм']);
    expect(group(choose('plug'), 'Кріплення').help?.text).toMatch(/підтримок або іншої орієнтації в слайсері/);
    // The horizontal cut keeps its own words.
    const parallel = { ...choose('dowel'), cylinderSection: 'parallel-to-bases' } as const;
    expect(rangesOf(parallel)).toHaveProperty(['Збільшення діаметра нижніх отворів, мм']);
  });

  it('keeps the signed distance as typed, scales it with the radius and refuses a plane beyond its limit, without clamping', () => {
    expect(request({ cylinderSectionOffsetPercent: '-62,5' }).spec?.section).toEqual({ type: 'vertical', offsetPercent: -62.5 });
    const scaled = request({ cylinderSectionOffsetPercent: '50', printSizeMm: '120' });
    expect(scaled.spec?.section).toEqual({ type: 'vertical', offsetPercent: 50 });
    // The percentage and its limits are those of the proportions; only the millimetres scale.
    expect(scaled.sectionRanges?.cylinderSectionOffsetPercent?.max).toBeCloseTo(80, 9);
    for (const text of ['81', '-81', '100', '150']) {
      const refused = request({ cylinderSectionOffsetPercent: text });
      expect(refused.errors).toEqual({
        cylinderSectionOffsetPercent:
          'Допустимі значення — від -80 % до 80 %: обидві частини мають лишатися придатними до друку.',
      });
      expect(refused.spec).toBeUndefined();
    }
    for (const [text, message] of [
      ['', 'Введіть значення.'],
      ['нуль', 'Введіть число, наприклад 25.'],
    ] as const) {
      expect(request({ cylinderSectionOffsetPercent: text }).errors).toEqual({ cylinderSectionOffsetPercent: message });
    }
  });

  it('reads only the active cut’s field, and keeps both between switches', () => {
    expect(request({ cylinderSectionPercent: '5' }).errors).toEqual({});
    const parallel = { ...triangle, cylinderSection: 'parallel-to-bases' } as const;
    expect(request({ cylinderSectionOffsetPercent: '500' }, parallel).errors).toEqual({});
    const edited = { cylinderSectionPercent: '30', cylinderSectionOffsetPercent: '25' };
    expect(request(edited).spec?.section).toEqual({ type: 'vertical', offsetPercent: 25 });
    expect(request(edited, parallel).spec?.section).toEqual({ type: 'parallel-to-bases', positionPercent: 30 });
    // Rebuilds for the distance, but not for the hidden position or the separation.
    const base = request({}).key;
    expect(request({ cylinderSectionOffsetPercent: '25' }).key).not.toBe(base);
    expect(request({ cylinderSectionPercent: '30' }).key).toBe(base);
    expect(request({}, { ...sectioned, cylinderPartsSeparated: false }).key).toBe(base);
  });

  it('resets to no section, on the axis, keeping the print size', () => {
    const edited: ParameterState = {
      texts: texts({ cylinderSectionOffsetPercent: '25', printSizeMm: '120' }),
      choices: choose('plug', 2),
    };
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.texts).toEqual(resetTexts('cylinder', { printSizeMm: '120' }));
    expect(reset.choices).toMatchObject({ cylinderSection: 'none', cylinderConnector: 'none' });
    // A hidden distance offers no reset of its own.
    expect(canResetShapeParameters('cylinder', { texts: texts({ cylinderSectionOffsetPercent: '25' }), choices: triangle })).toBe(
      false,
    );
    expect(
      canResetShapeParameters('cylinder', {
        texts: texts({ cylinderSectionOffsetPercent: '25' }),
        choices: { ...triangle, cylinderSection: 'parallel-to-bases' },
      }),
    ).toBe(true);
  });

  it('bounds the connectors by this cut: depth towards the curved surface, length and spacing along the height', () => {
    // r = 40 mm, H = 80 mm: e up to √(38,75² − 2,6²) − 0,3 mm towards the surface; 2 mm of straight engagement from 2,8 mm.
    const plug = rangesOf(choose('plug'));
    expect(plug['Висота виступу, мм']?.[0]).toBe(2.8);
    expect(plug['Висота виступу, мм']?.[1]).toBeCloseTo(38.4, 0);
    // A dowel's field is the whole length.
    expect(rangesOf(choose('dowel'))['Повна довжина штифта, мм']?.[0]).toBe(6.2);
    // A flat cylinder: H = 20 mm limits the length and the diameter, while the depth stays large.
    const flat = { cylinderHeightRatio: '0,5' };
    const flatPlug = rangesOf(choose('plug'), flat);
    expect(flatPlug['Висота виступу, мм']?.[1]).toBeGreaterThan(38);
    expect(flatPlug['Діаметр виступу, мм']?.[1]).toBeCloseTo(15.8, 1);
    const flatDovetail = rangesOf(choose('dovetail'), flat);
    expect(flatDovetail['Довжина виступу, мм']?.[1]).toBeCloseTo(17.2, 1);
    // The defaults follow the span: half the height, and 45 % of half of it.
    expect(request(flat, choose('dovetail')).errors).toEqual({});
    expect(request(flat, choose('plug', 2)).errors).toEqual({});
  });

  it('gives the plane’s distance in percent of r: signed, unchanged by the print size, and physically the same plane', () => {
    const planeOf = (overrides: Partial<ParameterTexts>) => {
      const { spec } = request(overrides);
      if (spec?.section?.type !== 'vertical' || spec.shape.kind !== 'cylinder') throw new Error('Expected a vertical section.');
      return sectionOffsetMm(spec.section.offsetPercent, roundDimensionsMm(spec.shape, spec.scale).radius);
    };
    // M = 80 mm, r = 40 mm.
    expect(planeOf({ cylinderSectionOffsetPercent: '0' })).toBe(0);
    expect(planeOf({ cylinderSectionOffsetPercent: '25' })).toBeCloseTo(10, 12);
    expect(planeOf({ cylinderSectionOffsetPercent: '-25' })).toBeCloseTo(-10, 12);
    // Scaled by 1,5, +25 % stays and the plane moves from 10 to 15 mm.
    expect(request({ cylinderSectionOffsetPercent: '25', printSizeMm: '120' }).spec?.section).toEqual({
      type: 'vertical',
      offsetPercent: 25,
    });
    expect(planeOf({ cylinderSectionOffsetPercent: '25', printSizeMm: '120' })).toBeCloseTo(15, 12);
    // Of the base circle's radius, not of half the bounding box: an oblique cylinder at M = 80 mm has r = 80/3 mm.
    expect(planeOf({ cylinderSectionOffsetPercent: '25', cylinderOffsetRatio: '1' })).toBeCloseTo(20 / 3, 12);
    // The text is the only state: nothing is stored in millimetres.
    expect(request({ cylinderSectionOffsetPercent: '12,5' }).values.cylinderSectionOffsetPercent).toBe(12.5);
  });

  it('converts the geometric limits to percent: the same planes as before, inward only, both ends reachable', () => {
    const limit = (printSizeMm: string, heightRatio = '2') => {
      const overrides = { printSizeMm, cylinderHeightRatio: heightRatio };
      const range = sectionNumberFields(group(sectioned, 'Переріз', overrides))[0]?.range;
      if (range === undefined) throw new Error('Expected a range.');
      return range;
    };
    // ±0,8·r whenever 10 % of the extent exceeds the 1,2 mm wall, whatever the proportions and the lean.
    expect(limit('80')).toEqual({ min: -80, max: 80, increment: 5 });
    expect(limit('1000')).toEqual({ min: -80, max: 80, increment: 5 });
    expect(limit('80', '8')).toEqual({ min: -80, max: 80, increment: 5 });
    // M = 10 mm, r = 5 mm: the wall leaves 3,8 mm, which is 76 %; M = 7 mm, r = 3,5 mm: 2,3 mm, 65,71… % rounded inwards.
    expect(limit('10')).toEqual({ min: -76, max: 76, increment: 5 });
    expect(limit('7')).toEqual({ min: -65.71, max: 65.71, increment: 5 });
    // An end that is not a multiple of the step is reachable by a step, and the end itself is accepted as a value.
    const range = limit('7');
    expect(stepDecimal(65, 1, range)).toBe(65.71);
    expect(stepDecimal(-65, -1, range)).toBe(-65.71);
    expect(snapDecimal(65.7, range)).toBe(65.71);
    const at = (text: string) => request({ printSizeMm: '7', cylinderSectionOffsetPercent: text }).errors;
    expect(at('65,71')).toEqual({});
    expect(at('-65,71')).toEqual({});
    expect(at('65,72').cylinderSectionOffsetPercent).toMatch(/^Допустимі значення — від -65,71 % до 65,71 %/);
    // Too small for any wall beside the axis: only the axial section, 0 to 0.
    expect(limit('2')).toEqual({ min: 0, max: 0, increment: 5 });
    expect(request({ printSizeMm: '2' }).errors).toEqual({});
    expect(request({ printSizeMm: '2', cylinderSectionOffsetPercent: '5' }).errors.cylinderSectionOffsetPercent).toMatch(
      /^Допустимі значення — від 0 % до 0 %/,
    );
  });

  it('makes the connector sliders span exactly the values each field accepts', () => {
    for (const choices of [choose('dovetail'), choose('plug'), choose('plug', 2), choose('dowel'), choose('dowel', 2)]) {
      const { values, sectionRanges } = request({}, choices);
      const panel = shapePanel('cylinder', choices, { values, sectionRanges });
      if (panel.type === 'fixed') throw new Error('A cylinder has fields.');
      const fields = panel.sections
        .filter(({ title }) => title === 'Кріплення' || title === 'Переріз')
        .flatMap(sectionNumberFields);
      for (const field of fields) {
        if (field.range === undefined) throw new Error(`${field.key} has no range.`);
        const { min, max } = field.range;
        const stored = (value: number) =>
          field.unit === undefined ? formatSteppedDecimal(value) : storedText(formatSteppedDecimal(value), field.unit);
        const errorAt = (value: number) => request({ [field.key]: stored(value) }, choices).errors[field.key];
        expect(errorAt(min), `${field.key} at ${min}`).toBeUndefined();
        expect(errorAt(max), `${field.key} at ${max}`).toBeUndefined();
        expect(errorAt(min - 0.01), `${field.key} below ${min}`).toBeDefined();
        expect(errorAt(max + 0.01), `${field.key} above ${max}`).toBeDefined();
      }
    }
  });

  it('explains a connector that does not fit this cut at the fields that repair it, builds nothing and recovers', () => {
    // r = 40 mm, t = 25 mm: 15 mm remain in part 2 on the axis, and a 14 mm plug leaves too little under the hole.
    const deep = request({ cylinderSectionOffsetPercent: '62,5', cylinderRoundDepth: '3,5' }, choose('plug'));
    expect(deep.spec).toBeUndefined();
    expect(deep.errors.cylinderRoundDepth).toMatch(
      /^Під дном отвору у частині 2 лишається 0,\d+ мм, потрібно щонайменше 1,2 мм\./,
    );
    expect(deep.errors.cylinderRoundDepth).toMatch(/Зменште висоту виступу, діаметр виступу або зміщення від осі\./);
    expect(deep.errors.cylinderRoundDepth).toMatch(/Зараз допустимо від 2,8 мм до 13,\d+ мм\.$/);
    expect(deep.errors.cylinderSectionOffsetPercent).toBeUndefined();
    // Moving the plane back repairs it, with nothing else changed.
    expect(request({ cylinderSectionOffsetPercent: '25', cylinderRoundDepth: '3,5' }, choose('plug')).spec).toBeDefined();
    // A dovetail too long for the stop is explained in this cut's words.
    const long = request({ cylinderDovetailLengthPercent: '98' }, choose('dovetail'));
    expect(long.errors.cylinderDovetailLengthPercent).toMatch(
      /^Під нижнім упором паза лишається 0,\d+ мм, потрібно щонайменше 1,2 мм\./,
    );
    // A strongly leaning cylinder refuses the tongue, the slide stays vertical.
    const leaning = request({ cylinderOffsetRatio: '4' }, choose('dovetail'));
    expect(leaning.errors.cylinderDovetailLengthPercent).toMatch(/^Стінка біля паза — /);
    expect(leaning.spec).toBeUndefined();
    const short = request(
      { cylinderOffsetRatio: '4', cylinderDovetailLengthPercent: '15', cylinderDovetailSize: '0,75' },
      choose('dovetail'),
    );
    expect(short.spec).toBeDefined();
  });

  it('accepts dimensions the cut allows beyond what a parallel cut of the same cylinder would', () => {
    const flat = { cylinderHeightRatio: '0,5', cylinderRoundDepth: '6' };
    const parallel = { ...choose('plug'), cylinderSection: 'parallel-to-bases' } as const;
    expect(request(flat, parallel).spec).toBeUndefined();
    expect(request(flat, choose('plug')).spec?.section?.connector).toMatchObject({ depthFactor: 6 });
  });
});

describe('an oblique section of the cylinder', () => {
  const sectioned = { ...triangle, cylinderSection: 'oblique' } as const;
  const choose = (cylinderConnector: 'dovetail' | 'plug' | 'dowel', cylinderRoundCount: 1 | 2 = 1) =>
    ({ ...sectioned, cylinderConnector, cylinderRoundCount }) as const;
  const request = (overrides: Partial<ParameterTexts> = {}, choices: typeof triangle = sectioned) =>
    resolveModelRequest('cylinder', texts(overrides), choices);
  const groupsOf = (choices: typeof triangle, overrides: Partial<ParameterTexts> = {}) => {
    const { values, sectionRanges } = request(overrides, choices);
    const panel = shapePanel('cylinder', choices, { values, sectionRanges });
    return panel.type === 'parameters' ? panel.sections : [];
  };
  const group = (choices: typeof triangle, title: string, overrides: Partial<ParameterTexts> = {}) => {
    const found = groupsOf(choices, overrides).find((part) => part.title === title);
    if (found === undefined) throw new Error(`No group ${title}`);
    return found;
  };
  const containingAxis = { cylinderHeightRatio: '2', cylinderOffsetRatio: '2' } as const;

  it('starts at the default plane, with the three fields in the specified units, ranges and steps', () => {
    const result = request();
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({ type: 'oblique', positionPercent: 50, inclinationDeg: 45, directionDeg: 0 });
    const cut = group(sectioned, 'Переріз');
    expect(cut.status).toEqual({ text: 'похилий', highlighted: true });
    expect(cut.fields[0]).toMatchObject({
      options: [
        { value: 'none', label: 'Без перерізу' },
        { value: 'parallel-to-bases', label: 'Паралельно основам' },
        { value: 'vertical', label: 'Вертикальний' },
        { value: 'oblique', label: 'Похилий' },
      ],
    });
    expect(sectionNumberFields(cut)).toMatchObject([
      {
        key: 'cylinderObliquePositionPercent',
        label: 'Точка на осі від нижньої основи',
        suffix: '% h',
        range: { min: 10, max: 90, increment: 5 },
      },
      {
        key: 'cylinderObliqueInclinationDeg',
        label: 'Кут до площини основи',
        suffix: '°',
        range: { min: 5, max: 85, increment: 5 },
      },
      { key: 'cylinderObliqueDirectionDeg', label: 'Напрям нахилу', suffix: '°', range: { min: 0, max: 360, increment: 5 } },
    ]);
    expect(cut.fields.at(-2)).toMatchObject({ type: 'toggle', key: 'cylinderPartsSeparated' });
    expect(cut.fields.at(-1)).toMatchObject({ type: 'toggle', key: 'cylinderPlate', label: 'Січна пластина' });
  });

  it('holds typed values to the same bounds as the sliders', () => {
    expect(validateObliqueInclination('5')).toEqual({ value: 5 });
    expect(validateObliqueInclination('85')).toEqual({ value: 85 });
    expect(validateObliqueInclination('4,9')).toEqual({ error: 'Допустимі значення — від 5° до 85°.' });
    expect(validateObliqueInclination('85,1')).toEqual({ error: 'Допустимі значення — від 5° до 85°.' });
    expect(validateObliqueDirection('360')).toEqual({ value: 360 });
    expect(validateObliqueDirection('-1')).toEqual({ error: 'Допустимі значення — від 0° до 360°.' });
    expect(validateObliqueDirection('360,5')).toEqual({ error: 'Допустимі значення — від 0° до 360°.' });
    expect(request({ cylinderObliquePositionPercent: '95' }).errors.cylinderObliquePositionPercent).toBe(
      'Допустимі значення — від 10 % до 90 %.',
    );
    for (const key of [
      'cylinderObliquePositionPercent',
      'cylinderObliqueInclinationDeg',
      'cylinderObliqueDirectionDeg',
    ] as const) {
      const result = request({ [key]: '' });
      expect(result.errors[key]).toBe('Введіть значення.');
      expect(result.spec).toBeUndefined();
    }
    // A typed value between the steps is kept.
    expect(request({ cylinderObliqueInclinationDeg: '47,5' }).spec?.section).toMatchObject({ inclinationDeg: 47.5 });
  });

  it('keeps 360° in the field but makes one model of 0° and 360°', () => {
    const [start, end] = [request({ cylinderObliqueDirectionDeg: '0' }), request({ cylinderObliqueDirectionDeg: '360' })];
    expect(end.values.cylinderObliqueDirectionDeg).toBe(360);
    expect(end.key).toBe(start.key);
    expect(end.spec?.section).toMatchObject({ directionDeg: 0 });
    // The slider stays at its end rather than jumping back to the start.
    const direction = sectionNumberFields(group(sectioned, 'Переріз', { cylinderObliqueDirectionDeg: '360' }))[2];
    expect(direction?.range?.max).toBe(360);
    expect(stepDecimal(360, -1, direction?.range as { min: number; max: number; increment: number })).toBe(355);
    expect(snapDecimal(359, direction?.range as { min: number; max: number; increment: number })).toBe(360);
  });

  it('stores the plane apart from the model’s size, so a new maximum dimension keeps it', () => {
    const edited = {
      cylinderObliquePositionPercent: '35',
      cylinderObliqueInclinationDeg: '55',
      cylinderObliqueDirectionDeg: '120',
    };
    const [small, large] = [request(edited), request({ ...edited, printSizeMm: '160' })];
    expect(large.spec?.section).toEqual(small.spec?.section);
    expect(large.spec?.scale.longestDimensionMm).toBe(160);
  });

  it('keeps each mode’s own values, and other modes unaffected', () => {
    const edited = {
      cylinderObliquePositionPercent: '30',
      cylinderSectionPercent: '70',
      cylinderSectionOffsetPercent: '25',
    };
    expect(request(edited).spec?.section).toMatchObject({ type: 'oblique', positionPercent: 30 });
    expect(request(edited, { ...triangle, cylinderSection: 'parallel-to-bases' }).spec?.section).toEqual({
      type: 'parallel-to-bases',
      positionPercent: 70,
    });
    expect(request(edited, { ...triangle, cylinderSection: 'vertical' }).spec?.section).toEqual({
      type: 'vertical',
      offsetPercent: 25,
    });
    // A hidden draft of another mode blocks nothing.
    expect(request({ cylinderSectionPercent: '' }).errors).toEqual({});
    expect(request({ cylinderObliqueInclinationDeg: '' }, { ...triangle, cylinderSection: 'vertical' }).errors).toEqual({});
  });

  it('disables the position while the plane contains the whole axis, and keeps its value for later', () => {
    const edited = { ...containingAxis, cylinderObliquePositionPercent: '30' };
    const result = request(edited);
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toMatchObject({ positionPercent: 30, inclinationDeg: 45, directionDeg: 0 });
    const fields = group(sectioned, 'Переріз', edited).fields;
    const noteId = 'cylinder-oblique-axis-note';
    expect(fields[1]).toMatchObject({ key: 'cylinderObliquePositionPercent', disabled: true, describedBy: noteId });
    expect(fields[2]).toEqual({
      type: 'note',
      key: noteId,
      text: 'Площина містить усю вісь циліндра, тому положення точки за висотою не змінює переріз.',
    });
    // Another angle or another lean brings the field back, with the value it had.
    const turned = { ...edited, cylinderObliqueInclinationDeg: '50' };
    expect(group(sectioned, 'Переріз', turned).fields[1]).not.toHaveProperty('disabled');
    expect(request(turned).spec?.section).toMatchObject({ positionPercent: 30, inclinationDeg: 50 });
    const upright = { ...edited, cylinderOffsetRatio: '0' };
    expect(group(sectioned, 'Переріз', upright).fields[1]).not.toHaveProperty('disabled');
    // Also a right cylinder at the steepest angle keeps the field, as n·a stays positive.
    expect(group(sectioned, 'Переріз', { cylinderObliqueInclinationDeg: '85' }).fields[1]).not.toHaveProperty('disabled');
  });

  it('does not let an invalid draft of the disabled position block the model', () => {
    const edited = { ...containingAxis, cylinderObliquePositionPercent: 'x' };
    const result = request(edited);
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toMatchObject({ positionPercent: 50 });
    // The draft is still there, and an error again once the field matters.
    expect(request({ ...edited, cylinderObliqueInclinationDeg: '50' }).errors.cylinderObliquePositionPercent).toBeDefined();
  });

  it('tells a part too thin to be usable from a connector that does not fit', () => {
    const thin = request({ printSizeMm: '2', cylinderObliquePositionPercent: '10' });
    expect(thin.spec).toBeUndefined();
    expect(thin.errors.cylinderObliquePositionPercent).toMatch(/^Тонша частина сягає від площини лише 0,8\d? мм/);
    // No connector to blame, and none is checked on such a plane.
    expect(thin.sectionRanges).toEqual({});
    const unfit = request({ printSizeMm: '10' }, choose('plug'));
    expect(unfit.errors.cylinderObliquePositionPercent).toBeUndefined();
    expect(unfit.errors.cylinderRoundDiameter).toMatch(/виступу/);
    // On a contained axis the angle is what can repair it.
    const contained = request({ ...containingAxis, printSizeMm: '1' });
    expect(contained.errors.cylinderObliqueInclinationDeg ?? '').toMatch(/^Тонша частина/);
    expect(contained.errors.cylinderObliquePositionPercent).toBeUndefined();
  });

  it('keeps the connector group below the section’s explanation, with the parts by number', () => {
    const titles = groupsOf(choose('dowel')).map(({ title }) => title);
    expect(titles.indexOf('Кріплення')).toBe(titles.indexOf('Переріз') + 1);
    const { help } = group(sectioned, 'Переріз');
    expect(help?.label).toBe('Як задано переріз?');
    expect(help?.text).toMatch(/проходить через вибрану точку на осі/);
    expect(help?.text).toMatch(/відносно площини основи/);
    expect(help?.text).toMatch(/куди площина піднімається/);
    expect(help?.text).toMatch(/перетинає основу/);
    const labels = sectionNumberFields(group(choose('dowel'), 'Кріплення')).map(({ label }) => label);
    expect(labels).toContain('Збільшення діаметра отворів частини 1, мм');
    expect(labels).toContain('Збільшення діаметра отворів частини 2, мм');
    expect(labels.join(' ')).not.toMatch(/нижніх|верхніх/);
  });

  it('explains the uphill removal and the downhill stop of the dovetail, without promising anything about supports', () => {
    const help = group(choose('dovetail'), 'Кріплення').help?.text;
    expect(help).toMatch(/угорі схилу/);
    expect(help).toMatch(/упором унизу/);
    expect(help).toMatch(/вниз по схилу до упора/);
    expect(help).toMatch(/вгору по схилу/);
    expect(help).toMatch(/не обов’язково вертикально/);
    expect(help).toMatch(/не замок/);
    for (const connector of ['dovetail', 'plug', 'dowel'] as const) {
      expect(group(choose(connector), 'Кріплення').help?.text).toMatch(/можуть потребувати підтримок/);
    }
  });

  it('shows connector millimetres of the actual section, whose span follows the plane', () => {
    const { span } = obliqueCylinderSection(
      { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 },
      { longestDimensionMm: 80 },
      { positionPercent: 50, inclinationDeg: 30, directionDeg: 0 },
    );
    const overrides = { cylinderObliqueInclinationDeg: '30' };
    const { values, sectionRanges } = request(overrides, choose('dovetail'));
    const panel = shapePanel('cylinder', choose('dovetail'), {
      values,
      sectionRanges,
      connectorScale: { longestDimensionMm: 80, radiusMm: 40, heightMm: 80, obliqueSpanMm: span },
    });
    const fields = panel.type === 'parameters' ? panel.sections.flatMap(sectionNumberFields) : [];
    expect(fields.find(({ key }) => key === 'cylinderDovetailLengthPercent')?.unit).toBeCloseTo(span / 100, 12);
    expect(span).toBeCloseTo(160 / Math.sqrt(3), 1);
  });

  it('explains a connector’s problem at the field that repairs it, in oblique terms', () => {
    const tooWide = request({ cylinderRoundDiameter: '30' }, choose('plug'));
    expect(tooWide.spec).toBeUndefined();
    expect(tooWide.errors.cylinderRoundDiameter).toMatch(/у частині 2/);
    expect(tooWide.errors.cylinderRoundDiameter).toMatch(/Зараз допустимо/);
    const tooDeep = request(
      { cylinderObliquePositionPercent: '90', cylinderObliqueInclinationDeg: '15', cylinderRoundDepth: '8' },
      choose('plug'),
    );
    expect(tooDeep.errors.cylinderRoundDepth).toMatch(/змініть положення чи кут площини/);
    expect(tooDeep.errors.cylinderRoundDepth).not.toMatch(/зміщення від осі|опустіть|підніміть/);
    const tooLong = request({ cylinderDovetailLengthPercent: '99' }, choose('dovetail'));
    expect(tooLong.errors.cylinderDovetailLengthPercent).toBeDefined();
    expect(tooLong.sectionRanges?.cylinderDovetailLengthPercent).toBeTruthy();
  });

  it('resets its fields with the others, and offers a reset only for what shapes the model', () => {
    const edited: ParameterState = {
      texts: texts({
        printSizeMm: '120',
        cylinderObliquePositionPercent: '30',
        cylinderObliqueInclinationDeg: '60',
        cylinderObliqueDirectionDeg: '360',
      }),
      choices: sectioned,
    };
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.texts).toEqual(resetTexts('cylinder', { printSizeMm: '120' }));
    expect(reset.choices.cylinderSection).toBe('none');
    // Fields of a mode that is not chosen shape nothing.
    expect(canResetShapeParameters('cylinder', { texts: edited.texts, choices: triangle })).toBe(false);
    expect(
      canResetShapeParameters('cylinder', { texts: edited.texts, choices: { ...triangle, cylinderSection: 'vertical' } }),
    ).toBe(true);
    expect(activeSection('cylinder', sectioned)).toBe('oblique');
    expect(activeConnector('cylinder', choose('plug'))).toBe('plug');
  });
});

describe('a section of the cone parallel to its base', () => {
  const sectioned = { ...triangle, coneSection: 'parallel-to-bases' } as const;
  const choose = (coneConnector: 'dovetail' | 'plug' | 'dowel', coneRoundCount: 1 | 2 = 1) =>
    ({ ...sectioned, coneConnector, coneRoundCount }) as const;
  const request = (overrides: Partial<ParameterTexts> = {}, choices: typeof triangle = sectioned) =>
    resolveModelRequest('cone', texts(overrides), choices);
  const groupsOf = (choices: typeof triangle, overrides: Partial<ParameterTexts> = {}) => {
    const { values, sectionRanges } = request(overrides, choices);
    const panel = shapePanel('cone', choices, { values, sectionRanges });
    return panel.type === 'parameters' ? panel.sections : [];
  };
  const group = (choices: typeof triangle, title: string, overrides: Partial<ParameterTexts> = {}) => {
    const found = groupsOf(choices, overrides).find((part) => part.title === title);
    if (found === undefined) throw new Error(`No group ${title}`);
    return found;
  };

  it('offers only that cut, with the position’s label, unit, range and step, starting at 50 %', () => {
    const result = request();
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({ type: 'parallel-to-bases', positionPercent: 50 });
    const cut = group(sectioned, 'Переріз');
    expect(cut.status).toEqual({ text: 'паралельно основі', highlighted: true });
    expect(cut.fields[0]).toMatchObject({
      options: [
        { value: 'none', label: 'Без перерізу' },
        { value: 'parallel-to-bases', label: 'Паралельно основі' },
        { value: 'vertical', label: 'Вертикальний' },
        { value: 'oblique', label: 'Похилий' },
      ],
    });
    expect(sectionNumberFields(cut)).toMatchObject([
      { key: 'coneSectionPercent', label: 'Від основи', suffix: '% h', range: { min: 10, max: 90, increment: 5 } },
    ]);
    // The section plate's switch follows the separation's, off and without its own fields until chosen.
    expect(cut.fields.slice(-2)).toMatchObject([
      { type: 'toggle', key: 'conePartsSeparated' },
      { type: 'toggle', key: 'conePlate', label: 'Січна пластина' },
    ]);
  });

  it('explains itself as asked, with the connectors below that explanation', () => {
    const { help } = group(sectioned, 'Переріз');
    expect(help?.label).toBe('Як задано переріз?');
    expect(help?.text).toContain(
      'Площина перерізу паралельна основі. Положення задається у відсотках від висоти конуса: 50% — на половині висоти. ' +
        'Нижня частина є зрізаним конусом, верхня — меншим конусом. Ближче до вершини переріз стає меншим.',
    );
    const titles = groupsOf(choose('plug')).map(({ title }) => title);
    expect(titles).toEqual(['Висота', 'Нахил', 'Переріз', 'Кріплення']);
  });

  it('holds typed positions to the slider’s bounds', () => {
    expect(request({ coneSectionPercent: '9,9' }).errors.coneSectionPercent).toBe('Допустимі значення — від 10 % до 90 %.');
    expect(request({ coneSectionPercent: '90,1' }).spec).toBeUndefined();
    expect(request({ coneSectionPercent: '' }).errors.coneSectionPercent).toBe('Введіть значення.');
    expect(request({ coneSectionPercent: '37,5' }).spec?.section).toMatchObject({ positionPercent: 37.5 });
  });

  it('keeps its own values, apart from the cylinder’s', () => {
    const cylinderChosen = { ...triangle, cylinderSection: 'parallel-to-bases' } as const;
    const edited = texts({ cylinderSectionPercent: '70', coneSectionPercent: '20', cylinderRoundDiameter: '2' });
    expect(resolveModelRequest('cone', edited, sectioned).spec?.section).toMatchObject({ positionPercent: 20 });
    expect(resolveModelRequest('cylinder', edited, cylinderChosen).spec?.section).toMatchObject({ positionPercent: 70 });
    expect(activeSection('cone', cylinderChosen)).toBeUndefined();
    expect(activeSection('cylinder', sectioned)).toBeUndefined();
    expect(partsSeparated('cone', { ...sectioned, conePartsSeparated: false })).toBe(false);
    expect(partsSeparated('cone', sectioned)).toBe(true);
  });

  it.each([
    ['dovetail', 1],
    ['plug', 1],
    ['plug', 2],
    ['dowel', 1],
    ['dowel', 2],
  ] as const)('takes a %s × %d in the specification, at its defaults', (connector, count) => {
    const result = request({}, choose(connector, count));
    expect(result.errors).toEqual({});
    expect(result.spec?.section?.connector?.type).toBe(connector);
    expect(result.sectionRanges).toBeDefined();
    for (const range of Object.values(result.sectionRanges ?? {})) expect(range).not.toBeNull();
  });

  it('shows connectors in millimetres, with lower and upper parts named as in a parallel cut', () => {
    const { values, sectionRanges } = request({}, choose('dowel', 2));
    const panel = shapePanel('cone', choose('dowel', 2), {
      values,
      sectionRanges,
      connectorScale: { longestDimensionMm: 80, radiusMm: 40, heightMm: 80, parallelSpanMm: 40 },
    });
    const fields = panel.type === 'parameters' ? panel.sections.flatMap(sectionNumberFields) : [];
    const field = (key: string) => fields.find((candidate) => candidate.key === key);
    expect(field('coneRoundDiameter')?.unit).toBe(5);
    expect(field('coneRoundDepth')?.unit).toBe(8);
    expect(field('coneRoundSpacingPercent')?.unit).toBeCloseTo(0.2, 9);
    expect(field('coneDowelLowerClearanceMm')?.label).toBe('Збільшення діаметра нижніх отворів, мм');
    expect(field('coneDowelUpperClearanceMm')?.label).toBe('Збільшення діаметра верхніх отворів, мм');
  });

  it('explains a hole that the narrowing cone cuts short, keeps the settings, and blocks the model', () => {
    const edited = { coneSectionPercent: '80', coneRoundDepth: '3' };
    const result = request(edited, choose('plug'));
    expect(result.spec).toBeUndefined();
    expect(result.errors.coneRoundDepth).toMatch(/конус звужується/);
    expect(result.errors.coneRoundDepth).toMatch(/у верхній частині/);
    expect(result.errors.coneRoundDepth).toMatch(/опустіть переріз/);
    expect(result.errors.coneRoundDepth).toMatch(/Зараз допустимо/);
    expect(result.values.coneRoundDepth).toBe(3);
  });

  it('reports an empty interval near the apex as no value, without reversed bounds', () => {
    const result = request({ coneSectionPercent: '90' }, choose('plug'));
    expect(result.spec).toBeUndefined();
    expect(result.sectionRanges?.coneRoundDiameter).toBeNull();
    const fields = sectionNumberFields(group(choose('plug'), 'Кріплення', { coneSectionPercent: '90' }));
    expect(fields.find(({ key }) => key === 'coneRoundDiameter')?.range).toBeUndefined();
    expect(result.errors.coneRoundDiameter).toMatch(/жодне значення/);
    // Smooth surfaces stay available there.
    expect(request({ coneSectionPercent: '90' }).spec).toBeDefined();
  });

  it('explains what limits a dovetail near the apex in terms of the groove', () => {
    const roof = request(
      { coneSectionPercent: '80', coneDovetailSize: '2', coneDovetailLengthPercent: '18,75' },
      choose('dovetail'),
    );
    expect(roof.spec).toBeUndefined();
    expect(roof.errors.coneDovetailSize).toMatch(/Над пазом лишається/);
    const stop = request({ coneDovetailLengthPercent: '95' }, choose('dovetail'));
    expect(stop.errors.coneDovetailLengthPercent).toMatch(/За упором паза лишається/);
  });

  it('notes the print placement and supports without promising anything', () => {
    for (const connector of ['dovetail', 'plug', 'dowel'] as const) {
      const help = group(choose(connector), 'Кріплення').help?.text;
      expect(help).toMatch(/вершиною догори/);
      expect(help).toMatch(/можуть потребувати підтримок/);
    }
  });

  it('resets its own fields and keeps the print size and the cylinder’s', () => {
    const edited: ParameterState = {
      texts: texts({ printSizeMm: '120', coneSectionPercent: '20', coneRoundDiameter: '2', cylinderSectionPercent: '70' }),
      choices: { ...choose('plug', 2), conePartsSeparated: false, cylinderSection: 'parallel-to-bases' },
    };
    expect(canResetShapeParameters('cone', edited)).toBe(true);
    const reset = resetShapeParameters('cone', edited);
    expect(reset.texts).toEqual(resetTexts('cone', { printSizeMm: '120', cylinderSectionPercent: '70' }));
    expect(reset.choices).toMatchObject({
      coneSection: 'none',
      coneConnector: 'none',
      coneRoundCount: 1,
      conePartsSeparated: true,
      cylinderSection: 'parallel-to-bases',
    });
    // Without a section its settings shape nothing.
    const hidden: ParameterState = { texts: texts({ coneSectionPercent: '20', coneRoundDiameter: '2' }), choices: triangle };
    expect(canResetShapeParameters('cone', hidden)).toBe(false);
    expect(activeConnector('cone', choose('plug'))).toBe('plug');
    expect(shapeParameterKeys.cone.choices).toContain('coneSection');
  });
});

describe('a vertical section of the cone', () => {
  const sectioned = { ...triangle, coneSection: 'vertical' } as const;
  const choose = (coneConnector: 'dovetail' | 'plug' | 'dowel', coneRoundCount: 1 | 2 = 1) =>
    ({ ...sectioned, coneConnector, coneRoundCount }) as const;
  const request = (overrides: Partial<ParameterTexts> = {}, choices: typeof triangle = sectioned) =>
    resolveModelRequest('cone', texts(overrides), choices);
  const group = (choices: typeof triangle, title: string, overrides: Partial<ParameterTexts> = {}) => {
    const { values, sectionRanges } = request(overrides, choices);
    const panel = shapePanel('cone', choices, { values, sectionRanges });
    const found = (panel.type === 'parameters' ? panel.sections : []).find((part) => part.title === title);
    if (found === undefined) throw new Error(`No group ${title}`);
    return found;
  };

  it('starts axial, with the offset in percent of r, the same field as a cylinder’s, and the connectors below', () => {
    const result = request();
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({ type: 'vertical', offsetPercent: 0 });
    const cut = group(sectioned, 'Переріз');
    expect(cut.status).toEqual({ text: 'вертикальний', highlighted: true });
    expect(cut.fields[0]).toMatchObject({
      options: [
        { value: 'none', label: 'Без перерізу' },
        { value: 'parallel-to-bases', label: 'Паралельно основі' },
        { value: 'vertical', label: 'Вертикальний' },
        { value: 'oblique', label: 'Похилий' },
      ],
    });
    expect(sectionNumberFields(cut)).toMatchObject([
      { key: 'coneSectionOffsetPercent', label: 'Зміщення від осі', suffix: '% r', range: { min: -80, max: 80, increment: 5 } },
    ]);
    expect(sectionNumberFields(cut)[0]?.unit).toBeUndefined();
    expect(cut.help?.label).toBe('Як задано переріз?');
    expect(cut.help?.text).toMatch(/трикутник/);
    expect(cut.help?.text).toMatch(/не доходить до вершини/);
    expect(cut.help?.text).toContain('0% — осьовий переріз. Значення 50% зміщує площину на половину радіуса основи.');
  });

  it('holds typed offsets to the limits, which a tangent or thin cut never passes', () => {
    expect(request({ coneSectionOffsetPercent: '80' }).spec?.section).toMatchObject({ offsetPercent: 80 });
    expect(request({ coneSectionOffsetPercent: '-80' }).spec?.section).toMatchObject({ offsetPercent: -80 });
    expect(request({ coneSectionOffsetPercent: '80,5' }).errors.coneSectionOffsetPercent).toMatch(/від -80 % до 80 %/);
    expect(request({ coneSectionOffsetPercent: '100' }).spec).toBeUndefined();
    expect(request({ coneSectionOffsetPercent: '' }).errors.coneSectionOffsetPercent).toBe('Введіть значення.');
    // A small model's wall narrows the limit: M = 10 mm leaves ±76 %.
    const small = request({ printSizeMm: '10', coneSectionOffsetPercent: '77' });
    expect(small.errors.coneSectionOffsetPercent).toMatch(/від -76 % до 76 %/);
  });

  it('keeps the percentage when the model is scaled, and its own value apart from the cylinder’s', () => {
    const [small, large] = [
      request({ coneSectionOffsetPercent: '25' }),
      request({ coneSectionOffsetPercent: '25', printSizeMm: '160' }),
    ];
    expect(large.spec?.section).toEqual(small.spec?.section);
    const cylinderChosen = { ...triangle, cylinderSection: 'vertical' } as const;
    const edited = texts({ cylinderSectionOffsetPercent: '30', coneSectionOffsetPercent: '-40' });
    expect(resolveModelRequest('cone', edited, sectioned).spec?.section).toMatchObject({ offsetPercent: -40 });
    expect(resolveModelRequest('cylinder', edited, cylinderChosen).spec?.section).toMatchObject({ offsetPercent: 30 });
    // Another cut's hidden draft blocks nothing.
    expect(request({ coneSectionPercent: '' }).errors).toEqual({});
  });

  it.each([
    ['dovetail', 1],
    ['plug', 1],
    ['plug', 2],
    ['dowel', 1],
    ['dowel', 2],
  ] as const)('takes a %s × %d at its defaults, with the parts by number', (connector, count) => {
    const result = request({}, choose(connector, count));
    expect(result.errors).toEqual({});
    expect(result.spec?.section?.connector?.type).toBe(connector);
    for (const range of Object.values(result.sectionRanges ?? {})) expect(range).not.toBeNull();
    const labels = sectionNumberFields(group(choose(connector, count), 'Кріплення')).map(({ label }) => label);
    expect(labels.join(' ')).not.toMatch(/нижніх|верхніх/);
  });

  it('names part 1 and part 2 for dowels', () => {
    const labels = sectionNumberFields(group(choose('dowel'), 'Кріплення')).map(({ label }) => label);
    expect(labels).toContain('Збільшення діаметра отворів частини 1, мм');
    expect(labels).toContain('Збільшення діаметра отворів частини 2, мм');
  });

  it('explains the dovetail’s motion as asked, the notch, and no lock', () => {
    const help = group(choose('dovetail'), 'Кріплення').help?.text;
    expect(help).toContain(
      'Щоб скласти модель, опустіть частину з виступом уздовж паза до упора. Для розбирання утримуйте частину з пазом і підніміть частину з виступом.',
    );
    expect(help).toContain('У звуженій верхній частині може бути помітна виїмка для входу в паз.');
    expect(help).toMatch(/це не замок/);
    expect(help).toMatch(/вертикальний, також у похилого конуса/);
  });

  it('does not reuse the horizontal cut’s print note, and promises no print without supports', () => {
    for (const connector of ['plug', 'dowel'] as const) {
      const help = group(choose(connector), 'Кріплення').help?.text;
      expect(help).not.toMatch(/вершиною догори/);
      expect(help).toMatch(/можуть потребувати підтримок/);
      expect(help).toMatch(/увесь її об’єм/);
    }
  });

  it('explains a hole that breaks through deeper in, keeping the settings and blocking the model', () => {
    const result = request({ coneRoundDepth: '7' }, choose('plug'));
    expect(result.spec).toBeUndefined();
    expect(result.errors.coneRoundDepth).toMatch(/Під дном отвору у частині 2/);
    expect(result.errors.coneRoundDepth).toMatch(/зміщення від осі/);
    expect(result.errors.coneRoundDepth).toMatch(/Зараз допустимо/);
    expect(result.values.coneRoundDepth).toBe(7);
  });

  it('explains a dovetail’s walls in terms of this cut', () => {
    const behind = request(
      { coneSectionOffsetPercent: '60', coneDovetailSize: '3', coneDovetailLengthPercent: '30' },
      choose('dovetail'),
    );
    expect(behind.spec).toBeUndefined();
    expect(behind.errors.coneDovetailSize).toMatch(/За пазом у частині 2/);
    expect(behind.errors.coneDovetailSize).not.toMatch(/верхньої частини/);
    const stop = request({ coneDovetailLengthPercent: '99' }, choose('dovetail'));
    expect(stop.errors.coneDovetailLengthPercent).toMatch(/Під нижнім упором/);
  });

  it('reports no value at all where the thin part has no room, without reversed bounds', () => {
    const result = request({ printSizeMm: '20', coneSectionOffsetPercent: '80' }, choose('plug'));
    expect(result.spec).toBeUndefined();
    expect(result.sectionRanges?.coneRoundDepth).toBeNull();
    const field = sectionNumberFields(
      group(choose('plug'), 'Кріплення', { printSizeMm: '20', coneSectionOffsetPercent: '80' }),
    ).find(({ key }) => key === 'coneRoundDepth');
    expect(field?.range).toBeUndefined();
    expect(request({ printSizeMm: '20', coneSectionOffsetPercent: '80' }).spec).toBeDefined();
  });

  it('resets its offset to 0 and keeps the print size', () => {
    const edited: ParameterState = { texts: texts({ printSizeMm: '120', coneSectionOffsetPercent: '40' }), choices: sectioned };
    expect(canResetShapeParameters('cone', edited)).toBe(true);
    const reset = resetShapeParameters('cone', edited);
    expect(reset.texts).toEqual(resetTexts('cone', { printSizeMm: '120' }));
    expect(reset.choices.coneSection).toBe('none');
    // A hidden offset shapes nothing.
    const hidden = {
      texts: texts({ coneSectionOffsetPercent: '40' }),
      choices: { ...triangle, coneSection: 'parallel-to-bases' },
    } as const;
    expect(canResetShapeParameters('cone', hidden)).toBe(true);
    expect(canResetShapeParameters('cone', { texts: hidden.texts, choices: triangle })).toBe(false);
  });
});

describe('an oblique section of the cone', () => {
  const sectioned = { ...triangle, coneSection: 'oblique' } as const;
  const throughApex = { ...sectioned, coneObliqueThrough: 'apex', coneApexStarted: true } as const;
  const choose = (coneConnector: 'dovetail' | 'plug' | 'dowel', base: typeof triangle = throughApex, coneRoundCount: 1 | 2 = 1) =>
    ({ ...base, coneConnector, coneRoundCount }) as const;
  const request = (overrides: Partial<ParameterTexts> = {}, choices: typeof triangle = sectioned) =>
    resolveModelRequest('cone', texts(overrides), choices);
  const group = (choices: typeof triangle, title: string, overrides: Partial<ParameterTexts> = {}) => {
    const { values, sectionRanges } = request(overrides, choices);
    const panel = shapePanel('cone', choices, { values, sectionRanges });
    const found = (panel.type === 'parameters' ? panel.sections : []).find((part) => part.title === title);
    if (found === undefined) throw new Error(`No group ${title}`);
    return found;
  };

  it('starts through a point on the axis, with the oblique cylinder’s fields, and offers the apex alongside', () => {
    const result = request();
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({ type: 'oblique', positionPercent: 50, inclinationDeg: 45, directionDeg: 0 });
    const cut = group(sectioned, 'Переріз');
    expect(cut.status).toEqual({ text: 'похилий', highlighted: true });
    expect(cut.fields[1]).toMatchObject({
      type: 'choice',
      key: 'coneObliqueThrough',
      label: 'Площина проходить через',
      options: [
        { value: 'axis', label: 'Точку на осі' },
        { value: 'apex', label: 'Вершину' },
      ],
    });
    expect(sectionNumberFields(cut)).toMatchObject([
      { key: 'coneObliquePositionPercent', suffix: '% h', range: { min: 10, max: 90, increment: 5 } },
      { key: 'coneObliqueInclinationDeg', label: 'Кут до площини основи', suffix: '°', range: { min: 5, max: 85, increment: 5 } },
      { key: 'coneObliqueDirectionDeg', label: 'Напрям нахилу', suffix: '°', range: { min: 0, max: 360, increment: 5 } },
    ]);
    expect(cut.help?.text).toMatch(/через вибрану точку на осі конуса/);
  });

  it('hides the position through the apex, and bounds the angle by the cone and the direction, with 90° reachable', () => {
    const result = request({ coneApexInclinationDeg: '75' }, throughApex);
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({ type: 'oblique-apex', inclinationDeg: 75, directionDeg: 0 });
    const cut = group(throughApex, 'Переріз', { coneApexInclinationDeg: '75' });
    expect(sectionNumberFields(cut)).toMatchObject([
      { key: 'coneApexInclinationDeg', label: 'Кут до площини основи', suffix: '°', range: { min: 68.2, max: 90, increment: 5 } },
      { key: 'coneApexDirectionDeg', label: 'Напрям нахилу', suffix: '°', range: { min: 0, max: 360, increment: 5 } },
    ]);
    expect(cut.help?.text).toContain(
      'У режимі «Через вершину» площина проходить точно через вершину конуса та перетинає його основу. Переріз є трикутником. Допустимі кути залежать від форми конуса й напряму нахилу площини.',
    );
    const range = sectionNumberFields(cut)[0]?.range as { min: number; max: number; increment: number };
    expect(stepDecimal(85, 1, range)).toBe(90);
    expect(stepDecimal(70, -1, range)).toBe(68.2);
    expect(snapDecimal(68.3, range)).toBe(68.2);
    expect(request({ coneApexInclinationDeg: '90' }, throughApex).spec?.section).toMatchObject({ inclinationDeg: 90 });
  });

  it('keeps separate settings for the two placements, so that switching destroys nothing', () => {
    const edited = {
      coneObliquePositionPercent: '30',
      coneObliqueInclinationDeg: '20',
      coneObliqueDirectionDeg: '40',
      coneApexInclinationDeg: '80',
      coneApexDirectionDeg: '100',
    };
    expect(request(edited, sectioned).spec?.section).toEqual({
      type: 'oblique',
      positionPercent: 30,
      inclinationDeg: 20,
      directionDeg: 40,
    });
    expect(request(edited, throughApex).spec?.section).toEqual({ type: 'oblique-apex', inclinationDeg: 80, directionDeg: 100 });
    expect(activeSection('cone', throughApex)).toBe('oblique-apex');
    expect(activeSection('cone', sectioned)).toBe('oblique');
    // A hidden draft of the other placement blocks nothing, and neither does the cylinder's choice.
    expect(request({ coneObliquePositionPercent: '' }, throughApex).errors).toEqual({});
    expect(request({ coneApexInclinationDeg: '' }, sectioned).errors).toEqual({});
    expect(activeSection('cylinder', { ...triangle, cylinderSection: 'oblique', coneObliqueThrough: 'apex' })).toBe('oblique');
  });

  describe('on first entry through the apex', () => {
    const state = (
      overrides: Partial<ParameterTexts> = {},
      choices: typeof triangle = { ...sectioned, coneObliqueThrough: 'apex' },
    ) => ({ texts: texts(overrides), choices }) as ParameterState;
    const values = (heightRatio: number, offsetRatio = 0) => ({
      printSizeMm: 80,
      coneHeightRatio: heightRatio,
      coneOffsetRatio: offsetRatio,
    });

    it('takes a valid angle in the middle of the interval, rising along the lean', () => {
      const right = startApexSection(state(), values(2));
      expect(right?.texts.coneApexInclinationDeg).toBe('80');
      expect(right?.texts.coneApexDirectionDeg).toBe('0');
      expect(right?.choices.coneApexStarted).toBe(true);
      const oblique = startApexSection(state({ coneOffsetRatio: '1' }), values(2, 1));
      expect(oblique?.texts.coneApexInclinationDeg).toBe('65');
      expect(oblique?.texts.coneApexDirectionDeg).toBe('0');
      const started = oblique as ParameterState;
      const resolved = resolveModelRequest('cone', started.texts, started.choices);
      expect(resolved.errors).toEqual({});
      expect(resolved.spec?.section).toMatchObject({ type: 'oblique-apex', inclinationDeg: 65, directionDeg: 0 });
    });

    it('happens once: nothing changes on its own afterwards, even for a plane that has become invalid', () => {
      const started = startApexSection(state(), values(2)) as ParameterState;
      expect(startApexSection(started, values(2, 3))).toBeUndefined();
      const invalid = resolveModelRequest('cone', texts({ ...started.texts, coneOffsetRatio: '3' }), started.choices);
      expect(invalid.spec).toBeUndefined();
      expect(invalid.errors.coneApexInclinationDeg).toMatch(/Допустимі значення за цього напряму/);
      expect(invalid.values.coneApexInclinationDeg).toBe(80);
    });

    it('waits for a valid cone, and for the apex to be chosen', () => {
      expect(startApexSection(state(), { printSizeMm: 80 })).toBeUndefined();
      expect(startApexSection(state({}, sectioned), values(2))).toBeUndefined();
      // Too small for any plane: nothing to pick, and it does not try again.
      const tiny = startApexSection(state(), { printSizeMm: 2, coneHeightRatio: 2, coneOffsetRatio: 0 });
      expect(tiny?.texts.coneApexInclinationDeg).toBe('90');
      expect(tiny?.choices.coneApexStarted).toBe(true);
    });
  });

  it('keeps 360° in the field and one model with 0°', () => {
    const [start, end] = [
      request({ coneApexDirectionDeg: '0' }, throughApex),
      request({ coneApexDirectionDeg: '360' }, throughApex),
    ];
    expect(end.values.coneApexDirectionDeg).toBe(360);
    expect(end.key).toBe(start.key);
  });

  it('explains an angle that only touches the cone, one that leaves a sliver, and a direction with no angle at all', () => {
    expect(validateApexInclination('0')).toEqual({ error: 'Кут має бути більшим за 0° і не більшим за 90°.' });
    expect(validateApexInclination('90,5')).toEqual({ error: 'Кут має бути більшим за 0° і не більшим за 90°.' });
    expect(validateApexInclination('90')).toEqual({ value: 90 });
    const touches = request({ coneApexInclinationDeg: '45' }, throughApex);
    expect(touches.spec).toBeUndefined();
    expect(touches.errors.coneApexInclinationDeg).toMatch(/лише торкається конуса/);
    expect(touches.errors.coneApexInclinationDeg).toMatch(/від 68,2° до 90°/);
    const sliver = request({ coneApexInclinationDeg: '65' }, throughApex);
    expect(sliver.errors.coneApexInclinationDeg).toMatch(/надто тонкою/);
    const against = request({ coneOffsetRatio: '1', coneApexDirectionDeg: '180', coneApexInclinationDeg: '80' }, throughApex);
    expect(against.spec).toBeUndefined();
    expect(against.errors.coneApexDirectionDeg).toMatch(/не ділить конус/);
    expect(against.sectionRanges?.coneApexInclinationDeg).toBeNull();
    const panel = sectionNumberFields(
      group(throughApex, 'Переріз', { coneOffsetRatio: '1', coneApexDirectionDeg: '180', coneApexInclinationDeg: '80' }),
    );
    expect(panel[0]?.range).toBeUndefined();
    expect(panel[1]?.range).toEqual({ min: 0, max: 360, increment: 5 });
  });

  it('disables the position while the plane through a point holds the whole axis, keeping its value', () => {
    const edited = { coneOffsetRatio: '2', coneObliquePositionPercent: '30' };
    expect(request(edited).errors).toEqual({});
    const fields = group(sectioned, 'Переріз', edited).fields;
    expect(fields[2]).toMatchObject({ key: 'coneObliquePositionPercent', disabled: true });
    expect(fields[3]).toMatchObject({
      type: 'note',
      text: 'Площина містить усю вісь конуса, тому положення точки за висотою не змінює переріз.',
    });
    expect(request({ ...edited, coneObliqueInclinationDeg: '50' }).spec?.section).toMatchObject({ positionPercent: 30 });
  });

  it('refuses a tilted plane near the apex as a split, not as a connector', () => {
    const thin = request({ coneObliquePositionPercent: '90' });
    expect(thin.spec).toBeUndefined();
    expect(thin.errors.coneObliquePositionPercent).toMatch(/^Тонша частина сягає від площини/);
    expect(thin.sectionRanges).toEqual({});
  });

  it.each([
    ['dovetail', 1],
    ['plug', 1],
    ['plug', 2],
    ['dowel', 1],
    ['dowel', 2],
  ] as const)('takes a %s × %d through the apex, in millimetres of the actual section', (connector, count) => {
    const overrides = { coneApexInclinationDeg: '85', coneDovetailLengthPercent: '25', coneRoundSpacingPercent: '30' };
    const result = request(overrides, choose(connector, throughApex, count));
    expect(result.errors).toEqual({});
    expect(result.spec?.section?.connector?.type).toBe(connector);
    for (const range of Object.values(result.sectionRanges ?? {})) expect(range).not.toBeNull();
    const labels = sectionNumberFields(group(choose(connector, throughApex, count), 'Кріплення', overrides)).map(
      ({ label }) => label,
    );
    expect(labels.join(' ')).not.toMatch(/нижніх|верхніх/);
  });

  it('explains the uphill dovetail, its notch and the print note, and names the plane’s own settings', () => {
    const help = group(choose('dovetail'), 'Кріплення', { coneApexInclinationDeg: '85' }).help?.text;
    expect(help).toMatch(/вниз по схилу до упора/);
    expect(help).toMatch(/вгору по схилу/);
    expect(help).toContain('У звуженій верхній частині може бути помітна виїмка для входу в паз.');
    expect(help).toMatch(/можуть потребувати підтримок/);
    const deep = request({ coneApexInclinationDeg: '85', coneRoundDepth: '7' }, choose('plug'));
    expect(deep.errors.coneRoundDepth).toMatch(/змініть кут чи напрям площини/);
    expect(deep.errors.coneRoundDepth).not.toMatch(/положення/);
    const axis = request({ coneRoundDepth: '7' }, choose('plug', sectioned));
    expect(axis.errors.coneRoundDepth).toMatch(/змініть положення чи кут площини/);
    const roof = request(
      { coneApexInclinationDeg: '75', coneDovetailSize: '4', coneDovetailLengthPercent: '10' },
      choose('dovetail'),
    );
    expect(roof.errors.coneDovetailSize).toMatch(/За пазом у частині 2/);
  });

  it('resets its fields, the placement and the first plane, and keeps the print size', () => {
    const edited: ParameterState = {
      texts: texts({ printSizeMm: '120', coneApexInclinationDeg: '75', coneObliquePositionPercent: '30' }),
      choices: throughApex,
    };
    expect(canResetShapeParameters('cone', edited)).toBe(true);
    const reset = resetShapeParameters('cone', edited);
    expect(reset.texts).toEqual(resetTexts('cone', { printSizeMm: '120' }));
    expect(reset.choices).toMatchObject({ coneSection: 'none', coneObliqueThrough: 'axis', coneApexStarted: false });
    // Having once entered the mode is no setting of its own.
    expect(canResetShapeParameters('cone', { texts: texts({}), choices: { ...triangle, coneApexStarted: true } })).toBe(false);
    expect(canResetShapeParameters('cone', { texts: edited.texts, choices: triangle })).toBe(false);
  });
});

describe('a horizontal section of the ball', () => {
  const sectioned = { ...triangle, ballSection: 'horizontal' } as const;
  const choose = (ballConnector: 'dovetail' | 'plug' | 'dowel', ballRoundCount: 1 | 2 = 1) =>
    ({ ...sectioned, ballConnector, ballRoundCount }) as const;
  const request = (overrides: Partial<ParameterTexts> = {}, choices: typeof triangle = sectioned) =>
    resolveModelRequest('ball', texts(overrides), choices);
  const groupsOf = (choices: typeof triangle, overrides: Partial<ParameterTexts> = {}) => {
    const { values, sectionRanges } = request(overrides, choices);
    const panel = shapePanel('ball', choices, { values, sectionRanges });
    return panel.type === 'parameters' ? panel.sections : [];
  };
  const group = (choices: typeof triangle, title: string, overrides: Partial<ParameterTexts> = {}) => {
    const found = groupsOf(choices, overrides).find((part) => part.title === title);
    if (found === undefined) throw new Error(`No group ${title}`);
    return found;
  };

  it('starts whole, with a collapsed group and its fixed proportions noted', () => {
    expect(request({}, triangle).spec).toEqual({ shape: { kind: 'ball' }, scale: { longestDimensionMm: 80 } });
    const panel = shapePanel('ball', triangle);
    expect(panel).toMatchObject({ type: 'parameters', note: 'Суцільна куля. Пропорції фіксовані.' });
    expect(group(triangle, 'Переріз').initiallyOpen).toBe(false);
    expect(group(triangle, 'Переріз').status).toEqual({ text: 'немає', highlighted: false });
    expect(sectionNumberFields(group(triangle, 'Переріз'))).toEqual([]);
  });

  it('offers one plane, through the centre at first, with the offset in percent of r', () => {
    const result = request();
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({ type: 'horizontal', offsetPercent: 0 });
    const cut = group(sectioned, 'Переріз');
    expect(cut.status).toEqual({ text: 'горизонтальний', highlighted: true });
    expect(cut.fields[0]).toMatchObject({
      options: [
        { value: 'none', label: 'Без перерізу' },
        { value: 'horizontal', label: 'Горизонтальний' },
      ],
    });
    expect(sectionNumberFields(cut)).toMatchObject([
      {
        key: 'ballSectionOffsetPercent',
        label: 'Зміщення від центра',
        suffix: '% r',
        range: { min: -80, max: 80, increment: 5 },
      },
    ]);
    expect(cut.help?.label).toBe('Як задано переріз?');
    expect(cut.help?.text).toContain(
      'Переріз кулі площиною — круг. За зміщення 0% площина проходить через центр і ділить кулю на дві півкулі. Додатне значення піднімає площину, від’ємне — опускає. Що далі площина від центра, то менший круг перерізу.',
    );
    // The section plate's switch follows the separation's, off until chosen.
    expect(cut.fields.slice(-2)).toMatchObject([
      { type: 'toggle', key: 'ballPartsSeparated' },
      { type: 'toggle', key: 'ballPlate', label: 'Січна пластина' },
    ]);
    const titles = groupsOf(choose('plug')).map(({ title }) => title);
    expect(titles).toEqual(['Переріз', 'Кріплення']);
  });

  it('holds typed offsets to the same bounds, and keeps the percentage when the model is scaled', () => {
    expect(request({ ballSectionOffsetPercent: '-80' }).spec?.section).toMatchObject({ offsetPercent: -80 });
    expect(request({ ballSectionOffsetPercent: '80' }).spec?.section).toMatchObject({ offsetPercent: 80 });
    expect(request({ ballSectionOffsetPercent: '12,5' }).spec?.section).toMatchObject({ offsetPercent: 12.5 });
    expect(request({ ballSectionOffsetPercent: '80,5' }).errors.ballSectionOffsetPercent).toMatch(/від -80 % до 80 %/);
    expect(request({ ballSectionOffsetPercent: '80,5' }).spec).toBeUndefined();
    expect(request({ ballSectionOffsetPercent: '' }).errors.ballSectionOffsetPercent).toBe('Введіть значення.');
    const [small, large] = [
      request({ ballSectionOffsetPercent: '25' }),
      request({ ballSectionOffsetPercent: '25', printSizeMm: '160' }),
    ];
    expect(large.spec?.section).toEqual(small.spec?.section);
    // A small ball's wall narrows the limit.
    expect(request({ printSizeMm: '10', ballSectionOffsetPercent: '77' }).errors.ballSectionOffsetPercent).toMatch(
      /від -76 % до 76 %/,
    );
  });

  it.each([
    ['dovetail', 1],
    ['plug', 1],
    ['plug', 2],
    ['dowel', 1],
    ['dowel', 2],
  ] as const)('takes a %s × %d at its defaults, with lower and upper parts by name', (connector, count) => {
    const result = request({}, choose(connector, count));
    expect(result.errors).toEqual({});
    expect(result.spec?.section?.connector?.type).toBe(connector);
    for (const range of Object.values(result.sectionRanges ?? {})) expect(range).not.toBeNull();
    const labels = sectionNumberFields(group(choose(connector, count), 'Кріплення')).map(({ label }) => label);
    expect(labels.join(' ')).not.toMatch(/частини [12]/);
  });

  it('notes the curved support for a part with a plug or a tongue, and not otherwise', () => {
    const note = 'Частина з виступом розміщена перерізом догори. Перед друком налаштуйте підтримки під її округлою поверхнею.';
    const notes = (choices: typeof triangle) =>
      group(choices, 'Кріплення').fields.flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(notes(choose('plug'))).toContain(note);
    expect(notes(choose('dovetail'))).toContain(note);
    expect(notes(choose('dowel'))).not.toContain(note);
    expect(notes(sectioned)).not.toContain(note);
    const help = group(choose('dowel'), 'Кріплення').help?.text;
    expect(help).toMatch(/можуть потребувати підтримок/);
    expect(help).toMatch(/розширюється над столом/);
  });

  it('explains a hole that the curving sphere cuts short, keeping the settings and blocking the model', () => {
    const result = request({ ballSectionOffsetPercent: '70', ballRoundDepth: '3' }, choose('plug'));
    expect(result.spec).toBeUndefined();
    expect(result.errors.ballRoundDepth).toMatch(/куля звужується/);
    expect(result.errors.ballRoundDepth).toMatch(/у верхній частині/);
    expect(result.errors.ballRoundDepth).toMatch(/наблизьте переріз до центра кулі/);
    expect(result.errors.ballRoundDepth).toMatch(/Зараз допустимо/);
    expect(result.values.ballRoundDepth).toBe(3);
    const roof = request(
      { ballSectionOffsetPercent: '80', ballDovetailSize: '3', ballDovetailLengthPercent: '20' },
      choose('dovetail'),
    );
    expect(roof.errors.ballDovetailSize).toMatch(/Над пазом лишається/);
    const stop = request({ ballDovetailLengthPercent: '99' }, choose('dovetail'));
    expect(stop.errors.ballDovetailLengthPercent).toMatch(/За упором паза лишається/);
  });

  it('reports no value at all on a thin cap, without reversed bounds, and smooth surfaces stay', () => {
    const edited = { printSizeMm: '20', ballSectionOffsetPercent: '80' };
    const result = request(edited, choose('plug'));
    expect(result.spec).toBeUndefined();
    expect(result.sectionRanges?.ballRoundDepth).toBeNull();
    const field = sectionNumberFields(group(choose('plug'), 'Кріплення', edited)).find(({ key }) => key === 'ballRoundDepth');
    expect(field?.range).toBeUndefined();
    expect(request(edited).spec).toBeDefined();
  });

  it('resets its own settings and keeps the print size; a hidden offset offers no reset', () => {
    const edited: ParameterState = {
      texts: texts({ printSizeMm: '120', ballSectionOffsetPercent: '40' }),
      choices: choose('plug', 2),
    };
    expect(canResetShapeParameters('ball', edited)).toBe(true);
    const reset = resetShapeParameters('ball', edited);
    expect(reset.texts).toEqual(resetTexts('ball', { printSizeMm: '120' }));
    expect(reset.choices).toMatchObject({
      ballSection: 'none',
      ballConnector: 'none',
      ballRoundCount: 1,
      ballPartsSeparated: true,
    });
    expect(canResetShapeParameters('ball', { texts: edited.texts, choices: triangle })).toBe(false);
    expect(activeSection('ball', sectioned)).toBe('horizontal');
    expect(activeConnector('ball', choose('dowel'))).toBe('dowel');
    expect(partsSeparated('ball', { ...sectioned, ballPartsSeparated: false })).toBe(false);
  });
});

describe('a new round connector, and one edited by hand', () => {
  const choices = (connector: 'plug' | 'dowel', overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({
    ...initialParameterChoices(),
    cylinderSection: 'parallel-to-bases',
    cylinderConnector: connector,
    ...overrides,
  });
  // r = 30 mm and H = 100 mm.
  const tall = { printSizeMm: '100', cylinderHeightRatio: '3,3333333333' };
  const initial = (overrides: Partial<ParameterTexts> = {}) => ({ ...initialParameterTexts(), ...tall, ...overrides });
  const resolved = (
    connector: 'plug' | 'dowel',
    overrides: Partial<ParameterTexts> = {},
    edits: ConnectorEdits = {},
    chosen: Partial<ParameterChoices> = {},
  ) => resolveModelRequest('cylinder', initial(overrides), choices(connector, chosen), { connectorEdits: edits });
  const millimetres = (factor: number | undefined, unit: number) => Number(((factor ?? Number.NaN) * unit).toFixed(6));
  const atM100 = { diameter: 6.25, insertion: 5 };

  it('starts from what the section offers, with the flat side and the provisional clearances', () => {
    const plug = resolved('plug');
    expect(plug.errors).toEqual({});
    expect(plug.spec?.section?.connector).toMatchObject({ type: 'plug', profile: 'flatted-circle', holeClearanceMm: 0.5 });
    expect(millimetres(plug.values.cylinderRoundDiameter, atM100.diameter)).toBe(13.9);
    expect(millimetres(plug.values.cylinderRoundDepth, atM100.insertion)).toBe(24.25);
    const dowel = resolved('dowel');
    expect(dowel.spec?.section?.connector).toMatchObject({ lowerClearanceMm: 0.4, upperClearanceMm: 0.5 });
    // The field shows the whole length.
    expect(2 * millimetres(dowel.values.cylinderRoundDepth, atM100.insertion)).toBe(48.5);
    expect(plug.connectorStatus?.corrections).toEqual([]);
  });

  it('keeps following the section until a value is edited by hand', () => {
    const atHalf = resolved('plug');
    const nearTop = resolved('plug', { cylinderSectionPercent: '90' });
    expect(nearTop.values.cylinderRoundDepth as number).toBeLessThan(atHalf.values.cylinderRoundDepth as number);
    expect(nearTop.connectorStatus?.corrections).toEqual([]);
    const pair = resolved('plug', {}, {}, { cylinderRoundCount: 2 });
    expect(pair.values.cylinderRoundDiameter as number).toBeLessThan(atHalf.values.cylinderRoundDiameter as number);
    expect(pair.values.cylinderRoundSpacingPercent).toBe(45);
    expect(pair.errors).toEqual({});
  });

  const state = (connector: 'plug' | 'dowel', overrides: Partial<ParameterTexts> = {}): ParameterState => ({
    texts: initial(overrides),
    choices: choices(connector),
    connectorEdits: {},
  });
  const requestOf = ({ texts: stored, choices: chosen, connectorEdits }: ParameterState) =>
    resolveModelRequest('cylinder', stored, chosen, { connectorEdits });
  /** What a hand edit does: what the fields show is kept, and then the typed value replaces its own. */
  const edit = (before: ParameterState, key: keyof ParameterTexts, text: string): ParameterState => {
    const committed = commitConnectorEdit('cylinder', before, requestOf(before));
    return { ...committed, texts: { ...committed.texts, [key]: text } };
  };

  it('keeps every shown value when one is edited, and counts a typed value out of range as that field’s error', () => {
    const before = state('plug');
    const shown = requestOf(before).values;
    const after = edit(before, 'cylinderRoundDepth', '2');
    const request = requestOf(after);
    expect(request.errors).toEqual({});
    expect(request.values.cylinderRoundDiameter).toBeCloseTo(shown.cylinderRoundDiameter as number, 9);
    expect(request.values.cylinderRoundDepth).toBe(2);
    // Beyond the part's thickness: reported, not corrected.
    const tooLong = requestOf(edit(after, 'cylinderRoundDepth', '20'));
    expect(tooLong.errors.cylinderRoundDepth).toMatch(/^Під дном отвору у верхній частині лишається/);
    expect(tooLong.spec).toBeUndefined();
    expect(tooLong.connectorStatus?.corrections).toEqual([]);
  });

  it('preserves an edited value while it fits, and corrects it with a note when the model changes', () => {
    const edited = edit(state('dowel'), 'cylinderRoundDepth', '6');
    const fits = requestOf({ ...edited, texts: { ...edited.texts, cylinderHeightRatio: '4' } });
    expect(fits.values.cylinderRoundDepth).toBe(6);
    expect(fits.connectorStatus?.corrections).toEqual([]);
    const thin = requestOf({ ...edited, texts: { ...edited.texts, cylinderSectionPercent: '90' } });
    expect(thin.errors).toEqual({});
    const length = 2 * (thin.values.cylinderRoundDepth as number) * atM100.insertion;
    expect(length).toBeLessThan(60);
    expect(thin.connectorStatus?.corrections).toEqual([
      `Довжину штифта зменшено до ${formatMillimetres(length)} мм через товщину частини.`,
    ]);
    expect(thin.spec?.section?.connector).toMatchObject({ depthFactor: thin.values.cylinderRoundDepth });
  });

  it('never shrinks a stored value: a model that returns gets its former dimensions, whatever came between', () => {
    const edited = edit(state('dowel'), 'cylinderRoundDepth', '6');
    const key = requestOf(edited).key;
    let current = edited;
    for (const position of ['90', '10', '85', '50']) {
      current = { ...current, texts: { ...current.texts, cylinderSectionPercent: position } };
      const first = requestOf(current);
      expect(requestOf(current).key).toBe(first.key);
      expect(first.errors).toEqual({});
    }
    expect(current.texts.cylinderRoundDepth).toBe('6');
    expect(requestOf(current).key).toBe(key);
    expect(requestOf(current).connectorStatus?.corrections).toEqual([]);
  });

  it('scales edited dimensions with the model, keeps clearances absolute, and adjusts afterwards', () => {
    const edited = edit(edit(state('dowel'), 'cylinderRoundDiameter', '2'), 'cylinderDowelUpperClearanceMm', '0,75');
    const resized = requestOf({ ...edited, texts: { ...edited.texts, printSizeMm: '200' } });
    expect(resized.spec?.section?.connector).toMatchObject({ diameterFactor: 2, upperClearanceMm: 0.75, lowerClearanceMm: 0.4 });
    const shrunk = requestOf({ ...edited, texts: { ...edited.texts, printSizeMm: '30' } });
    expect(shrunk.errors).toEqual({});
    expect(shrunk.spec?.section?.connector).toMatchObject({ upperClearanceMm: 0.75, lowerClearanceMm: 0.4 });
  });

  it('commits nothing again in the same context, so that typing is left as typed', () => {
    const edited = edit(state('plug'), 'cylinderRoundDepth', '2,50');
    expect(commitConnectorEdit('cylinder', edited, requestOf(edited))).toBe(edited);
    expect(requestOf(edited).values.cylinderRoundDepth).toBe(2.5);
  });

  it('answers a connector that cannot fit with the plain cut, an explanation and a way to choose none', () => {
    const tiny = { printSizeMm: '10', cylinderHeightRatio: '0,5' };
    const request = resolved('dowel', tiny);
    expect(request.errors).toEqual({});
    expect(request.spec?.section).toEqual({ type: 'parallel-to-bases', positionPercent: 50 });
    expect(request.connectorStatus?.unavailable).toMatch(/^Кріплення не вміщується/);
    expect(request.connectorStatus?.unavailable).toMatch(/оберіть «Без кріплення»/);
    // The same model chosen without a connector is another request: only that one is for download.
    const plain = resolveModelRequest('cylinder', initial(tiny), choices('dowel', { cylinderConnector: 'none' }), {
      connectorEdits: {},
    });
    expect(plain.spec).toEqual(request.spec);
    expect(plain.key).not.toBe(request.key);
    expect(plain.connectorStatus).toBeUndefined();
    const panel = shapePanel('cylinder', choices('dowel'), { ...request, connectorStatus: request.connectorStatus });
    const group = panel.type === 'parameters' ? panel.sections.find(({ title }) => title === 'Кріплення') : undefined;
    expect(group?.status).toEqual({ text: 'не вміщується', highlighted: true });
    const fields = group?.fields ?? [];
    expect(fields.some((field) => field.type === 'note' && field.tone === 'alert')).toBe(true);
    expect(fields.map(({ key }) => key)).toContain('cylinder-choose-no-connector');
    expect(fields.map(({ key }) => key)).not.toContain('cylinderRoundDiameter');
    expect(fields.map(({ key }) => key)).not.toContain('cylinder-download-pins');
  });

  it('returns an edited connector to the section’s defaults on a reset', () => {
    const edited = edit(state('plug'), 'cylinderRoundDepth', '2');
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.connectorEdits).toEqual({});
    expect(reset.choices.cylinderConnector).toBe('none');
    const again = resolveModelRequest('cylinder', { ...reset.texts, ...tall }, choices('plug'), { connectorEdits: {} });
    expect(millimetres(again.values.cylinderRoundDiameter, atM100.diameter)).toBe(13.9);
  });

  const fieldsFor = (connector: 'plug' | 'dowel', chosen: Partial<ParameterChoices> = {}) => {
    const request = resolved(connector, {}, {}, chosen);
    const panel = shapePanel('cylinder', choices(connector, chosen), {
      values: request.values,
      sectionRanges: request.sectionRanges,
    });
    const group = panel.type === 'parameters' ? panel.sections.find(({ title }) => title === 'Кріплення') : undefined;
    return group as NonNullable<typeof group>;
  };

  it.each([
    ['circle', 'Діаметр штифта, мм', 'Збільшення діаметра нижніх отворів, мм', undefined],
    [
      'triangle',
      'Діаметр описаного кола, мм',
      'Збільшення нижніх отворів, мм',
      'Розмір — діаметр описаного кола, а не довжина сторони.',
    ],
    [
      'square',
      'Діаметр описаного кола, мм',
      'Збільшення нижніх отворів, мм',
      'Розмір — діаметр описаного кола, тобто діагональ квадрата.',
    ],
    [
      'hexagon',
      'Діаметр описаного кола, мм',
      'Збільшення нижніх отворів, мм',
      'Розмір — діаметр описаного кола, а не довжина сторони.',
    ],
    [
      'flatted-circle',
      'Діаметр вихідного кола, мм',
      'Збільшення нижніх отворів, мм',
      'Розмір — діаметр вихідного кола, з якого зрізано один бік.',
    ],
  ] as const)('names what the size of a %s measures', (profile, size, clearance, note) => {
    const group = fieldsFor('dowel', { cylinderRoundProfile: profile });
    const labels = sectionNumberFields(group).map(({ label }) => label);
    expect(labels).toContain(size);
    expect(labels).toContain(clearance);
    expect(labels.join(' ')).not.toMatch(/сторон|граней/);
    const notes = group.fields.flatMap((field) => (field.type === 'note' ? [field.text] : []));
    if (note !== undefined) expect(notes).toContain(note);
    expect(notes).toContain('Значення 0,4 мм дає зазор 0,2 мм з кожного боку.');
  });

  it('offers the five profiles in Ukrainian, and the pins alone for dowels only', () => {
    const profile = fieldsFor('plug').fields.find(({ key }) => key === 'cylinderRoundProfile');
    expect(profile?.type === 'choice' ? profile.options.map(({ label }) => label) : []).toEqual([
      'Круг',
      'Трикутник',
      'Квадрат',
      'Шестикутник',
      'Круг зі зрізаним боком',
    ]);
    const action = (connector: 'plug' | 'dowel') =>
      fieldsFor(connector).fields.flatMap((field) => (field.type === 'action' ? [field.label] : []));
    expect(action('dowel')).toEqual(['Завантажити лише штифти']);
    expect(action('plug')).toEqual([]);
  });

  it('tells a plug’s height from a dowel’s whole length', () => {
    const notes = (connector: 'plug' | 'dowel') =>
      fieldsFor(connector).fields.flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(notes('plug')).toContain('Висота від площини перерізу: на стільки виступ заходить в отвір другої частини.');
    expect(notes('dowel')).toContain('У кожну половинку штифт входить на 24,25 мм.');
  });

  it('steps the size by 0,1 mm to the next grid value, without binary artefacts', () => {
    const size = sectionNumberFields(fieldsFor('plug')).find(({ key }) => key === 'cylinderRoundDiameter');
    expect(size?.range?.increment).toBe(0.1);
    const range = size?.range as NonNullable<typeof size>['range'] & object;
    expect(stepDecimal(15.05, -1, range)).toBe(15);
    expect(stepDecimal(15.05, 1, range)).toBe(15.1);
    expect(stepDecimal(0.3 + 15, 1, range)).toBe(15.4);
    expect(formatSteppedDecimal(stepDecimal(13.9, 1, range) as number)).toBe('14');
    expect(formatSteppedDecimal(stepDecimal(14, -1, range) as number)).toBe('13,9');
  });

  it('opens the clearance up to 1 mm on both connectors where the walls allow it', () => {
    for (const [connector, key] of [
      ['plug', 'cylinderPlugClearanceMm'],
      ['dowel', 'cylinderDowelUpperClearanceMm'],
      ['dowel', 'cylinderDowelLowerClearanceMm'],
    ] as const) {
      expect(sectionNumberFields(fieldsFor(connector)).find((field) => field.key === key)?.range).toMatchObject({
        min: 0,
        max: 1,
      });
      void key;
      expect(validateDiametralClearance('1')).toEqual({ value: 1 });
      expect(validateDiametralClearance('1,05')).toEqual({ error: 'Допустимі значення — від 0 мм до 1 мм.' });
    }
  });
});

describe('a twist connector between a cylinder’s parts', () => {
  const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({
    ...initialParameterChoices(),
    cylinderSection: 'parallel-to-bases',
    cylinderConnector: 'twist',
    ...overrides,
  });
  // r = 30 mm and H = 100 mm.
  const tall = { printSizeMm: '100', cylinderHeightRatio: '3,3333333333' };
  const initial = (overrides: Partial<ParameterTexts> = {}) => ({ ...initialParameterTexts(), ...tall, ...overrides });
  const resolved = (overrides: Partial<ParameterTexts> = {}, chosen: Partial<ParameterChoices> = {}) =>
    resolveModelRequest('cylinder', initial(overrides), choices(chosen), { connectorEdits: {} });
  const state = (overrides: Partial<ParameterTexts> = {}): ParameterState => ({
    texts: initial(overrides),
    choices: choices(),
    connectorEdits: {},
  });
  const requestOf = ({ texts: stored, choices: chosen, connectorEdits }: ParameterState) =>
    resolveModelRequest('cylinder', stored, chosen, { connectorEdits });
  const edit = (before: ParameterState, key: keyof ParameterTexts, text: string): ParameterState => {
    const committed = commitConnectorEdit('cylinder', before, requestOf(before));
    return { ...committed, texts: { ...committed.texts, [key]: text } };
  };
  const groupOf = (chosen: ParameterChoices, request: ReturnType<typeof resolved>) => {
    const panel = shapePanel('cylinder', chosen, {
      values: request.values,
      sectionRanges: request.sectionRanges,
      connectorStatus: request.connectorStatus,
    });
    return panel.type === 'parameters' ? panel.sections.find(({ title }) => title === 'Кріплення') : undefined;
  };

  it('starts from what the section offers, with the provisional clearances', () => {
    const request = resolved();
    expect(request.errors).toEqual({});
    expect(request.spec?.section?.connector).toEqual({ type: 'twist', sizeMm: 16, holeClearanceMm: 0.5, axialClearanceMm: 0.2 });
    expect(request.values.cylinderTwistSizeMm).toBe(16);
    expect(request.connectorStatus?.corrections).toEqual([]);
  });

  it('shows only its three controls, with their steps and help, and the trial download', () => {
    const request = resolved();
    const fields = groupOf(choices(), request)?.fields ?? [];
    const keys = fields.map(({ key }) => key);
    expect(keys).not.toContain('cylinderRoundProfile');
    expect(keys).not.toContain('cylinderRoundCount');
    const numbers = fields.flatMap((field) => (field.type === 'number' ? [field] : []));
    expect(numbers.map(({ key, label, range }) => [key, label, range?.increment])).toEqual([
      ['cylinderTwistSizeMm', 'Розмір кріплення, мм', 0.1],
      ['cylinderTwistClearanceMm', 'Збільшення гнізда Δ, мм', 0.05],
      ['cylinderTwistAxialMm', 'Осьовий зазор, мм', 0.05],
    ]);
    const texts = fields.flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(texts).toContain('Розмір — діаметр кола навколо всієї головки разом із вушками, а не діаметр шийки.');
    expect(texts.some((text) => text.startsWith('Значення 0,5 мм дає зазор 0,25 мм з кожного боку.'))).toBe(true);
    expect(keys).toContain('cylinder-download-trial');
    expect(groupOf(choices(), request)?.help?.text).toMatch(
      /^Вставте частини, поверніть до упору\. Для розбирання поверніть назад і роз’єднайте\. З’єднання не має окремого фіксатора від зворотного повороту\./,
    );
    // The size's slider spans what fits, from the printable minimum.
    expect(request.sectionRanges?.cylinderTwistSizeMm?.min).toBeCloseTo(16, 1);
  });

  it('keeps clearances in millimetres when the model’s size changes', () => {
    const edited = edit(edit(state(), 'cylinderTwistClearanceMm', '0,35'), 'cylinderTwistSizeMm', '20');
    const larger = requestOf({ ...edited, texts: { ...edited.texts, printSizeMm: '150' } });
    expect(larger.spec?.section?.connector).toEqual({ type: 'twist', sizeMm: 20, holeClearanceMm: 0.35, axialClearanceMm: 0.2 });
  });

  it('keeps valid manual settings, and reports a typed value out of range at its field', () => {
    expect(requestOf(edit(state(), 'cylinderTwistSizeMm', '23,7')).spec?.section?.connector).toMatchObject({ sizeMm: 23.7 });
    expect(requestOf(edit(state(), 'cylinderTwistSizeMm', '58')).errors.cylinderTwistSizeMm).toMatch(/Стінка навколо гнізда/);
    expect(requestOf(edit(state(), 'cylinderTwistSizeMm', '12')).errors.cylinderTwistSizeMm).toMatch(/Збільште розмір/);
    expect(requestOf(edit(state(), 'cylinderTwistClearanceMm', '1,1')).errors.cylinderTwistClearanceMm).toMatch(
      /від 0,1 мм до 1 мм/,
    );
    expect(requestOf(edit(state(), 'cylinderTwistAxialMm', '0,6')).errors.cylinderTwistAxialMm).toMatch(/від 0,1 мм до 0,5 мм/);
  });

  it('adjusts an edited size the changed model no longer allows, with a note; the former model gets it back', () => {
    const edited = edit(state(), 'cylinderTwistSizeMm', '50');
    expect(requestOf(edited).spec?.section?.connector).toMatchObject({ sizeMm: 50 });
    const smaller = { ...edited, texts: { ...edited.texts, printSizeMm: '80' } };
    const after = requestOf(smaller);
    expect(after.errors).toEqual({});
    expect(after.values.cylinderTwistSizeMm as number).toBeLessThan(50);
    expect(after.connectorStatus?.corrections).toEqual([
      `Розмір кріплення зменшено до ${formatMillimetres(after.values.cylinderTwistSizeMm as number)} мм через стінку навколо гнізда.`,
    ]);
    expect(smaller.texts.cylinderTwistSizeMm).toBe('50');
    expect(requestOf(smaller).values).toEqual(after.values);
    const back = requestOf({ ...smaller, texts: { ...smaller.texts, printSizeMm: '100' } });
    expect(back.spec?.section?.connector).toMatchObject({ sizeMm: 50 });
  });

  it('keeps the cut model, with an explanation and no download, when nothing fits', () => {
    const request = resolved({ cylinderSectionPercent: '90', printSizeMm: '40' });
    expect(request.errors).toEqual({});
    expect(request.connectorStatus?.unavailable).toMatch(/^Поворотне з’єднання не вміщується: над гніздом/);
    expect(request.spec?.section).toEqual({ type: 'parallel-to-bases', positionPercent: 90 });
    expect(request.key).toMatch(/:connector-unavailable$/);
    const keys = (groupOf(choices(), request)?.fields ?? []).map(({ key }) => key);
    expect(keys).toContain('cylinder-choose-no-connector');
    expect(keys).not.toContain('cylinder-download-trial');
  });

  it('is listed but not offered on another cut, a leaning cylinder or another solid, with the reason', () => {
    const vertical = { ...initialParameterChoices(), cylinderSection: 'vertical' as const };
    const request = resolveModelRequest('cylinder', initial(), vertical, { connectorEdits: {} });
    const fields = groupOf(vertical, request)?.fields ?? [];
    expect(fields[0]).toMatchObject({
      options: expect.arrayContaining([{ value: 'twist', label: 'Поворотне з’єднання', disabled: true }]),
    });
    expect(fields.map(({ key }) => key)).toContain('cylinder-twist-unsupported');
    const leaning = resolved({ cylinderOffsetRatio: '0,5' });
    expect(leaning.errors).toEqual({});
    expect(leaning.connectorStatus?.unavailable).toBe(TWIST_UNSUPPORTED_MESSAGE);
    expect(leaning.spec?.section?.connector).toBeUndefined();
    expect(resolved({}, { cylinderSection: 'vertical' }).key).toMatch(/:connector-unavailable$/);
    const cone = { ...initialParameterChoices(), coneSection: 'parallel-to-bases' as const };
    const panel = shapePanel('cone', cone, { values: resolveModelRequest('cone', initialParameterTexts(), cone).values });
    const coneFields = panel.type === 'parameters' ? panel.sections.find(({ title }) => title === 'Кріплення')?.fields : [];
    expect(coneFields?.[0]).toMatchObject({
      options: expect.arrayContaining([expect.objectContaining({ value: 'twist', disabled: true })]),
    });
  });

  it('a reset returns it to following the section', () => {
    const edited = edit(state(), 'cylinderTwistSizeMm', '20');
    expect(canResetShapeParameters('cylinder', edited)).toBe(true);
    const reset = resetShapeParameters('cylinder', edited);
    expect(reset.connectorEdits?.cylinder).toBeUndefined();
    expect(reset.choices.cylinderConnector).toBe('none');
  });
});

describe('the dovetail’s entrance', () => {
  const groupOf = (kind: 'cylinder' | 'cone' | 'ball', chosen: ParameterChoices, texts = initialParameterTexts()) => {
    const request = resolveModelRequest(kind, texts, chosen, { connectorEdits: {} });
    const panel = shapePanel(kind, chosen, { values: request.values, sectionRanges: request.sectionRanges });
    const group = panel.type === 'parameters' ? panel.sections.find(({ title }) => title === 'Кріплення') : undefined;
    return { request, group };
  };
  const labelsOf = (group: ReturnType<typeof groupOf>['group']) => {
    const field = group?.fields.find(({ key }) => String(key).endsWith('DovetailEntrance'));
    return field?.type === 'choice' ? [field.label, ...field.options.map(({ label }) => label)] : undefined;
  };

  it('names the ends by the model’s own vertical, or as two sides of a horizontal cut', () => {
    const base = {
      ...initialParameterChoices(),
      cylinderConnector: 'dovetail',
      coneConnector: 'dovetail',
      ballConnector: 'dovetail',
    } as const;
    expect(labelsOf(groupOf('cylinder', { ...base, cylinderSection: 'vertical' }).group)).toEqual([
      'Вхід у паз',
      'Зверху',
      'Знизу',
    ]);
    expect(labelsOf(groupOf('cylinder', { ...base, cylinderSection: 'oblique' }).group)).toEqual([
      'Вхід у паз',
      'Зверху',
      'Знизу',
    ]);
    expect(labelsOf(groupOf('cone', { ...base, coneSection: 'oblique', coneObliqueThrough: 'apex' }).group)).toEqual([
      'Вхід у паз',
      'Зверху',
      'Знизу',
    ]);
    expect(labelsOf(groupOf('cylinder', { ...base, cylinderSection: 'parallel-to-bases' }).group)).toEqual([
      'Вхід у паз',
      'З одного боку',
      'З протилежного боку',
    ]);
    expect(labelsOf(groupOf('ball', { ...base, ballSection: 'horizontal' }).group)).toEqual([
      'Вхід у паз',
      'З одного боку',
      'З протилежного боку',
    ]);
  });

  it('is stored explicitly, kept when the model’s size changes, and reset with the shape', () => {
    const chosen = {
      ...initialParameterChoices(),
      coneSection: 'vertical',
      coneConnector: 'dovetail',
      coneDovetailEntrance: 'opposite',
    } as const;
    expect(groupOf('cone', chosen).request.spec?.section?.connector).toMatchObject({ type: 'dovetail', entrance: 'opposite' });
    const larger = groupOf('cone', chosen, { ...initialParameterTexts(), printSizeMm: '150' }).request;
    expect(larger.spec?.section?.connector).toMatchObject({ entrance: 'opposite' });
    const state: ParameterState = { texts: initialParameterTexts(), choices: chosen };
    expect(canResetShapeParameters('cone', state)).toBe(true);
    expect(resetShapeParameters('cone', state).choices.coneDovetailEntrance).toBe('standard');
    // Without a dovetail the choice shapes nothing, and alone asks for no reset.
    const unused = { ...initialParameterChoices(), coneDovetailEntrance: 'opposite' } as const;
    expect(canResetShapeParameters('cone', { texts: initialParameterTexts(), choices: unused })).toBe(false);
    const withoutDovetail = { ...unused, coneSection: 'vertical' } as const;
    expect(groupOf('cone', withoutDovetail).request.spec?.section).toEqual({ type: 'vertical', offsetPercent: 0 });
  });

  it('explains the assembly for the chosen end, without the apex notch once the groove opens at the base', () => {
    const vertical = { ...initialParameterChoices(), coneSection: 'vertical', coneConnector: 'dovetail' } as const;
    const top = groupOf('cone', vertical).group?.help?.text;
    const bottom = groupOf('cone', { ...vertical, coneDovetailEntrance: 'opposite' }).group?.help?.text;
    expect(top).toMatch(/Паз відкритий угорі, упор — унизу/);
    expect(top).toMatch(/виїмка для входу в паз/);
    expect(bottom).toMatch(/Паз відкритий унизу, біля основи, упор — угорі/);
    expect(bottom).not.toMatch(/виїмка для входу в паз/);
    const apex = {
      ...initialParameterChoices(),
      coneSection: 'oblique',
      coneObliqueThrough: 'apex',
      coneConnector: 'dovetail',
    } as const;
    expect(groupOf('cone', { ...apex, coneDovetailEntrance: 'opposite' }).group?.help?.text).toMatch(
      /^Виступ — на частині 1, паз — у частині 2\. Паз відкритий унизу схилу площини/,
    );
    const cylinder = { ...initialParameterChoices(), cylinderSection: 'vertical', cylinderConnector: 'dovetail' } as const;
    expect(groupOf('cylinder', { ...cylinder, cylinderDovetailEntrance: 'opposite' }).group?.help?.text).toMatch(
      /^Паз відкритий унизу та закінчується упором угорі\./,
    );
  });
});
