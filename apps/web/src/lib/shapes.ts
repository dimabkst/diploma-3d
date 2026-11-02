import {
  ballMeasurements,
  boxEdgeLengthsMm,
  MAX_CIRCLE_DEVIATION_MM,
  type MeshMeasurements,
  parallelepipedDimensionsMm,
  pyramidParameters,
  regularBaseDimensionsMm,
  regularPolygonArea,
  regularPrismDimensionsMm,
  roundSolidMeasurements,
  type TrapezoidKind,
  trapezoidKind,
  trapezoidPrismDimensionsMm,
  trianglePrismDimensionsMm,
} from '@diploma-3d/engine';
import {
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  defaultModelSpecs,
  OFFSET_LIMITS,
  type PhysicalScale,
  PRISM_BASE_SIDES,
  PRISM_BASE_TYPES,
  type PrismBaseSides,
  type PrismBaseType,
  PYRAMID_BASE_SIDES,
  RATIO_LIMITS,
  type Shape,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, type StepRange } from './decimal.ts';
import type { ChoiceKey, ParameterChoices, ParameterKey } from './model/parameters.ts';

export type ShapeOption = {
  readonly value: ShapeKind;
  readonly label: string;
};

export type MeasurementItem = {
  readonly label: string;
  readonly value: string;
  /** The widest text the value can take for the current scale; it reserves width so that the layout never shifts. */
  readonly widest: string;
};

/**
 * A numeric field: "label [value] suffix", e.g. "Ширина b [1,5] × a" for a multiplier or "Кут α [60] °" for an angle,
 * with a slider over `range`.
 */
export type NumericField = {
  readonly type: 'number';
  readonly key: ParameterKey;
  readonly label: string;
  readonly suffix: string;
  readonly range: StepRange;
};

/** A parameter picked from fixed options, such as the base type or the regular polygon. */
export type ChoiceField = {
  readonly type: 'choice';
  readonly key: ChoiceKey;
  readonly label: string;
  readonly options: readonly { readonly value: ParameterChoices[ChoiceKey]; readonly label: string }[];
};

/**
 * The displacement of a prism's upper base: two numeric fields under one legend, with a reset to the right prism. Whether
 * the solid is right or oblique follows from the two values; nothing else stores it.
 */
export type OffsetGroup = {
  readonly type: 'offset';
  readonly key: string;
  readonly legend: string;
  readonly fields: readonly [NumericField, NumericField];
  /** The solid's name in the status line, such as "пряма призма" and "похила призма". */
  readonly solidName: { readonly right: string; readonly oblique: string };
};

/**
 * The trapezoid base: the parallel side b, the base height t and the shift δ of side b under one legend, with one-time
 * alignment actions for δ and a line naming the special case the values describe.
 */
export type TrapezoidGroup = {
  readonly type: 'trapezoid';
  readonly key: string;
  readonly legend: string;
  readonly fields: readonly [side: NumericField, height: NumericField, shift: NumericField];
};

export type ParameterField = NumericField | ChoiceField | OffsetGroup | TrapezoidGroup;

export const shapeOptions: readonly ShapeOption[] = [
  { value: 'cube', label: 'Куб' },
  { value: 'cuboid', label: 'Прямокутний паралелепіпед' },
  { value: 'parallelepiped', label: 'Паралелепіпед' },
  { value: 'prism', label: 'Призма' },
  { value: 'pyramid', label: 'Правильна піраміда' },
  { value: 'tetrahedron', label: 'Правильний тетраедр' },
  { value: 'cylinder', label: 'Циліндр' },
  { value: 'cone', label: 'Конус' },
  { value: 'ball', label: 'Куля' },
];

export const isAvailableShape = (value: string): value is ShapeKind => Object.hasOwn(defaultModelSpecs, value);

export const shapeLabel = (value: string): string => shapeOptions.find((shape) => shape.value === value)?.label ?? '—';

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

export const formatQuantity = (value: number | undefined, unit: string): string =>
  value === undefined ? '—' : `${numberFormat.format(value)} ${unit}`;

export const formatSize = (size: readonly number[] | undefined): string =>
  size === undefined ? '— мм' : `${size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

const formatLength = (scale: PhysicalScale): string => `${formatDecimal(scale.longestDimensionMm)} мм`;

export function shapeDescription(kind: ShapeKind, scale: PhysicalScale): string {
  switch (kind) {
    case 'cube':
      return `Куб не має окремих параметрів форми: усі ребра рівні, а всі грані — квадрати. Ребро моделі — ${formatLength(scale)}.`;
    case 'cuboid':
      return 'Усі грані — прямокутники, усі кути прямі. Ребро a — довжина, b — ширина, c — висота.';
    case 'parallelepiped':
      return (
        'Основа — паралелограм зі сторонами a і b та кутом α між ними. Без зміщення паралелепіпед прямий: бічні ребра ' +
        'перпендикулярні до основи й дорівнюють висоті h. Зі зміщенням він похилий: бічні грані — паралелограми, а бічне ' +
        'ребро l довше за h.'
      );
    case 'prism':
      return (
        'Основа — правильний багатокутник, трикутник або трапеція; верхня основа — це нижня, паралельно перенесена. Без зміщення ' +
        'призма пряма: бічні ребра перпендикулярні до основ, бічні грані — прямокутники; пряма призма з правильною ' +
        'основою — правильна. Зі зміщенням призма похила: бічні грані — паралелограми, а бічне ребро l довше за висоту h.'
      );
    case 'pyramid':
      return 'Основа — правильний многокутник, вершина лежить точно над її центром, а бічні грані — рівні рівнобедрені трикутники.';
    case 'tetrahedron': {
      const { edge } = regularBaseDimensionsMm(pyramidParameters({ kind }), scale);
      return (
        'Усі шість ребер рівні, а всі чотири грані — рівносторонні трикутники; висота h = a·√(2/3) ≈ 0,816a. ' +
        `Ребро моделі — ${formatDecimal(edge)} мм.`
      );
    }
    case 'cylinder':
      return `Прямий круговий циліндр: основи — рівні круги, твірні перпендикулярні до них. ${idealRoundNote}`;
    case 'cone':
      return `Прямий круговий конус: основа — круг, вершина лежить точно над її центром. ${idealRoundNote}`;
    case 'ball':
      return (
        'Суцільна куля, обмежена сферою: усі точки поверхні рівновіддалені від центра. ' +
        `Діаметр моделі — ${formatLength(scale)}. Розміри нижче — для ідеальної кулі; у файлі друку поверхню наближено ` +
        `многогранником, що відходить від неї не більше ніж на ${formatDecimal(MAX_CIRCLE_DEVIATION_MM)} мм.`
      );
  }
}

const obliqueSizeNote = (scale: PhysicalScale): string =>
  `Найбільший габаритний вимір моделі (ширина, глибина чи висота, а не ребро) завжди ${formatLength(scale)}. ` +
  'Зміщення розширює габарит, тому за тих самих множників модель меншає: змінюються всі розміри, зокрема об’єм.';

export const trapezoidHint =
  'a і b — паралельні сторони основи, будь-яка з них може бути довшою; висота трапеції t — відстань між ними в ' +
  'площині основи. Зміщення сторони b зсуває її середину вздовж X відносно середини a і змінює форму кожної основи. ' +
  'Якщо b = a, основа — паралелограм, а без зміщення — прямокутник.';

const trapezoidKindNames: Readonly<Record<TrapezoidKind, string>> = {
  general: 'трапеція',
  isosceles: 'рівнобічна трапеція',
  right: 'прямокутна трапеція',
  parallelogram: 'паралелограм (b = a)',
  rectangle: 'прямокутник (b = a)',
};

/** The special case of the trapezoid base, such as "рівнобічна трапеція"; undefined while b or δ is not valid. */
export const trapezoidKindName = (sideRatio: number | undefined, shiftRatio: number | undefined): string | undefined =>
  sideRatio === undefined || shiftRatio === undefined ? undefined : trapezoidKindNames[trapezoidKind(sideRatio, shiftRatio)];

export const offsetHint =
  'X — уздовж сторони основи a, Y — перпендикулярно до неї в площині основи. Напрямки прив’язані до моделі, а не до ' +
  'камери. Обидва нулі дають пряме тіло, будь-яке інше значення — похиле.';

const idealRoundNote =
  'Розміри нижче — для ідеального тіла; у файлі друку коло наближено многокутником, ' +
  `що відходить від нього не більше ніж на ${formatDecimal(MAX_CIRCLE_DEVIATION_MM)} мм.`;

// Buttons, arrow keys and the slider move ratios to multiples of 0,25; typed values keep any precision.
const ratioRange: StepRange = { ...RATIO_LIMITS, increment: 0.25 };
// The base angle moves in whole multiples of 5°.
const angleRange: StepRange = { ...BASE_ANGLE_LIMITS, increment: 5 };
const offsetRange: StepRange = { ...OFFSET_LIMITS, increment: 0.25 };
const shiftRange: StepRange = { ...BASE_SHIFT_LIMITS, increment: 0.25 };

const offsetGroup = (
  x: ParameterKey,
  y: ParameterKey,
  solidName: { readonly right: string; readonly oblique: string },
): OffsetGroup => ({
  type: 'offset',
  key: `${x}-${y}`,
  legend: 'Зміщення верхньої основи',
  fields: [
    { type: 'number', key: x, label: 'Зміщення X', suffix: '× a', range: offsetRange },
    { type: 'number', key: y, label: 'Зміщення Y', suffix: '× a', range: offsetRange },
  ],
  solidName,
});

const baseTypeNames: Readonly<Record<PrismBaseType, string>> = {
  regular: 'Правильний багатокутник',
  triangle: 'Трикутник',
  trapezoid: 'Трапеція',
};

const baseNames: Readonly<Record<PrismBaseSides, string>> = {
  3: 'Рівносторонній трикутник',
  4: 'Квадрат',
  5: 'Правильний п’ятикутник',
  6: 'Правильний шестикутник',
  8: 'Правильний восьмикутник',
};

const prismBaseFields: Readonly<Record<PrismBaseType, readonly ParameterField[]>> = {
  regular: [
    {
      type: 'choice',
      key: 'prismBaseSides',
      label: 'Багатокутник',
      options: PRISM_BASE_SIDES.map((sides) => ({ value: sides, label: baseNames[sides] })),
    },
  ],
  triangle: [
    { type: 'number', key: 'prismTriangleSideRatio', label: 'Сторона основи b', suffix: '× a', range: ratioRange },
    { type: 'number', key: 'prismTriangleAngleDeg', label: 'Кут α', suffix: '°', range: angleRange },
  ],
  trapezoid: [
    {
      type: 'trapezoid',
      key: 'prismTrapezoid',
      legend: 'Трапеція в основі',
      fields: [
        { type: 'number', key: 'prismTrapezoidSideRatio', label: 'Паралельна сторона b', suffix: '× a', range: ratioRange },
        { type: 'number', key: 'prismTrapezoidHeightRatio', label: 'Висота трапеції t', suffix: '× a', range: ratioRange },
        { type: 'number', key: 'prismTrapezoidShiftRatio', label: 'Зміщення сторони b', suffix: '× a', range: shiftRange },
      ],
    },
  ],
};

/** "Висота призми h" next to the trapezoid's own height t, "Висота h" otherwise. */
const prismHeightLabel = (choices: ParameterChoices): string =>
  choices.prismBaseType === 'trapezoid' ? 'Висота призми h' : 'Висота h';

/** The fields of the selected shape; for a prism, only those of the selected base type besides the shared ones. */
export function parameterFields(kind: ShapeKind, choices: ParameterChoices): readonly ParameterField[] {
  if (kind !== 'prism') return shapeParameters[kind];
  return [
    {
      type: 'choice',
      key: 'prismBaseType',
      label: 'Основа',
      options: PRISM_BASE_TYPES.map((type) => ({ value: type, label: baseTypeNames[type] })),
    },
    ...prismBaseFields[choices.prismBaseType],
    { type: 'number', key: 'prismHeightRatio', label: prismHeightLabel(choices), suffix: '× a', range: ratioRange },
    offsetGroup('prismOffsetXRatio', 'prismOffsetYRatio', { right: 'пряма призма', oblique: 'похила призма' }),
  ];
}

const shapeParameters: Readonly<Record<Exclude<ShapeKind, 'prism'>, readonly ParameterField[]>> = {
  cube: [],
  cuboid: [
    { type: 'number', key: 'cuboidWidthRatio', label: 'Ширина b', suffix: '× a', range: ratioRange },
    { type: 'number', key: 'cuboidHeightRatio', label: 'Висота c', suffix: '× a', range: ratioRange },
  ],
  parallelepiped: [
    { type: 'number', key: 'parallelepipedBaseSideRatio', label: 'Сторона основи b', suffix: '× a', range: ratioRange },
    { type: 'number', key: 'parallelepipedHeightRatio', label: 'Висота h', suffix: '× a', range: ratioRange },
    { type: 'number', key: 'parallelepipedBaseAngleDeg', label: 'Кут α', suffix: '°', range: angleRange },
    offsetGroup('parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio', {
      right: 'прямий паралелепіпед',
      oblique: 'похилий паралелепіпед',
    }),
  ],
  pyramid: [
    {
      type: 'choice',
      key: 'pyramidBaseSides',
      label: 'Основа',
      options: PYRAMID_BASE_SIDES.map((sides) => ({ value: sides, label: baseNames[sides] })),
    },
    { type: 'number', key: 'pyramidHeightRatio', label: 'Висота h', suffix: '× a', range: ratioRange },
  ],
  // Fixed proportions: nothing to adjust.
  tetrahedron: [],
  ball: [],
  cylinder: [{ type: 'number', key: 'cylinderHeightRatio', label: 'Висота h', suffix: '× r', range: ratioRange }],
  cone: [{ type: 'number', key: 'coneHeightRatio', label: 'Висота h', suffix: '× r', range: ratioRange }],
};

export function parameterHint(kind: ShapeKind, scale: PhysicalScale, choices: ParameterChoices): string | undefined {
  switch (kind) {
    case 'cube':
    case 'tetrahedron':
    case 'ball':
      return undefined;
    case 'cuboid':
      return (
        'Множники задають ширину b і висоту c відносно довжини a. ' +
        `Найбільший вимір моделі завжди дорівнює ${formatLength(scale)}, тому зміна пропорцій може змінити всі фізичні розміри.`
      );
    case 'parallelepiped':
      return (
        'Множники задають сторону b, висоту h і зміщення відносно сторони a; α — кут між сторонами a і b, у градусах. ' +
        `Висота h — відстань між площинами основ, а не бічне ребро l. ${obliqueSizeNote(scale)}`
      );
    case 'prism':
      if (choices.prismBaseType === 'trapezoid') {
        return (
          'Висота трапеції t лежить у площині основи, а висота призми h — відстань між площинами основ, не бічне ' +
          'ребро l. Зміщення сторони b змінює форму кожної основи, а зміщення X і Y переносять усю верхню основу ' +
          `відносно нижньої. Усі множники задано відносно a. ${obliqueSizeNote(scale)}`
        );
      }
      return (
        (choices.prismBaseType === 'triangle'
          ? 'Трикутник задається сторонами a і b та кутом α між ними. Довжина третьої сторони c обчислюється автоматично. '
          : '') +
        'a — сторона основи; висота h — відстань між площинами основ, а не бічне ребро l. ' +
        'Висоту й зміщення задано відносно a. ' +
        obliqueSizeNote(scale)
      );
    case 'pyramid':
      return (
        'a — сторона основи, h — висота піраміди: перпендикуляр з вершини до центра основи. ' +
        `Найбільший габаритний вимір завжди ${formatLength(scale)}, тому зміна основи чи висоти може змінити всі розміри.`
      );
    case 'cylinder':
    case 'cone':
      return (
        'Висоту h задано відносно радіуса основи r. ' +
        `Більший із діаметра та висоти завжди дорівнює ${formatLength(scale)}, тому зміна множника може змінити і радіус, і висоту.`
      );
  }
}

/**
 * Edge lengths and the base area follow directly from the validated parameters (`shape` is undefined while they are
 * not valid); for polyhedra, surface area and volume are measured on the generated mesh, so they describe exactly the
 * geometry that is previewed and exported. For the cylinder, cone and ball every value is that of the ideal curved solid,
 * which the exported polygonal approximation undershoots slightly.
 */
export function measurementItems(
  kind: ShapeKind,
  scale: PhysicalScale,
  shape: Shape | undefined,
  measurements: MeshMeasurements | undefined,
  choices: ParameterChoices,
): MeasurementItem[] {
  // Every solid here fits in its bounding box with longest side L: an axis-aligned edge is at most L, a face at most L²,
  // the surface area at most 6L² and the volume at most L³ (convex solids inside a cube). Formatting these bounds with
  // one decimal gives the widest text any value can take.
  const length = scale.longestDimensionMm;
  const edge = (value: number | undefined) => ({ value: formatQuantity(value, 'мм'), widest: widestQuantity(length, 'мм') });
  const area = { value: formatQuantity(measurements?.surfaceArea, 'мм²'), widest: widestQuantity(6 * length ** 2, 'мм²') };
  const volume = { value: formatQuantity(measurements?.volume, 'мм³'), widest: widestQuantity(length ** 3, 'мм³') };
  switch (kind) {
    case 'cube': {
      const edges = shape?.kind === 'cube' ? boxEdgeLengthsMm(shape, scale) : undefined;
      return [
        { label: 'Ребро a', ...edge(edges?.[0]) },
        { label: 'Площа поверхні', ...area },
        { label: 'Об’єм', ...volume },
      ];
    }
    case 'cuboid': {
      const edges = shape?.kind === 'cuboid' ? boxEdgeLengthsMm(shape, scale) : undefined;
      return [
        { label: 'Довжина a', ...edge(edges?.[0]) },
        { label: 'Ширина b', ...edge(edges?.[1]) },
        { label: 'Висота c', ...edge(edges?.[2]) },
        { label: 'Площа поверхні', ...area },
        { label: 'Об’єм', ...volume },
      ];
    }
    case 'parallelepiped':
    case 'prism': {
      const parallelepiped = shape?.kind === 'parallelepiped' ? parallelepipedDimensionsMm(shape, scale) : undefined;
      const triangle =
        shape?.kind === 'prism' && shape.baseType === 'triangle' ? trianglePrismDimensionsMm(shape, scale) : undefined;
      const trapezoid =
        shape?.kind === 'prism' && shape.baseType === 'trapezoid' ? trapezoidPrismDimensionsMm(shape, scale) : undefined;
      const regular =
        shape?.kind === 'prism' && shape.baseType === 'regular' ? regularPrismDimensionsMm(shape, scale) : undefined;
      const dimensions = parallelepiped ?? triangle ?? trapezoid ?? regular;
      // A slanted base side lies in a base face of at most L × L, so it is at most its diagonal √2·L: for a
      // parallelogram with b/a = 4 and α ≈ 55° it is about 1,22·L. A lateral edge lies in the bounding box, so it is
      // at most its diagonal √3·L.
      const slantedSide = (label: string, value: number | undefined) => ({
        label,
        value: formatQuantity(value, 'мм'),
        widest: widestQuantity(Math.SQRT2 * length, 'мм'),
      });
      // The rows follow the selected base type even while its fields are being corrected.
      const baseType = kind === 'parallelepiped' ? 'parallelogram' : choices.prismBaseType;
      const otherSides = {
        parallelogram: [slantedSide('Сторона основи b', parallelepiped?.baseSideB)],
        regular: [],
        triangle: [slantedSide('Сторона основи b', triangle?.baseSideB), slantedSide('Сторона основи c', triangle?.baseSideC)],
        trapezoid: [
          slantedSide('Сторона основи b', trapezoid?.baseSideB),
          slantedSide('Сторона основи c', trapezoid?.baseSideC),
          slantedSide('Сторона основи d', trapezoid?.baseSideD),
          // t is a depth of the base, so at most L.
          { label: 'Висота трапеції t', ...edge(trapezoid?.baseHeight) },
        ],
      }[baseType];
      return [
        { label: 'Сторона основи a', ...edge(dimensions?.edge) },
        ...otherSides,
        { label: baseType === 'trapezoid' ? 'Висота призми h' : 'Висота h', ...edge(dimensions?.height) },
        {
          label: 'Бічне ребро l',
          value: formatQuantity(dimensions?.lateralEdge, 'мм'),
          widest: widestQuantity(Math.sqrt(3) * length, 'мм'),
        },
        {
          label: 'Площа основи',
          value: formatQuantity(dimensions?.baseArea, 'мм²'),
          widest: widestQuantity(length ** 2, 'мм²'),
        },
        { label: 'Площа поверхні', ...area },
        { label: 'Об’єм', ...volume },
      ];
    }
    case 'pyramid':
    case 'tetrahedron': {
      const parameters = shape?.kind === 'pyramid' || shape?.kind === 'tetrahedron' ? pyramidParameters(shape) : undefined;
      const dimensions = parameters === undefined ? undefined : regularBaseDimensionsMm(parameters, scale);
      const baseArea =
        parameters === undefined || dimensions === undefined
          ? undefined
          : regularPolygonArea(parameters.baseSides, dimensions.edge);
      return [
        { label: kind === 'tetrahedron' ? 'Ребро a' : 'Сторона основи a', ...edge(dimensions?.edge) },
        { label: 'Висота h', ...edge(dimensions?.height) },
        { label: 'Площа основи', value: formatQuantity(baseArea, 'мм²'), widest: widestQuantity(length ** 2, 'мм²') },
        { label: 'Площа поверхні', ...area },
        { label: 'Об’єм', ...volume },
      ];
    }
    case 'cylinder':
    case 'cone': {
      const ideal = shape?.kind === 'cylinder' || shape?.kind === 'cone' ? roundSolidMeasurements(shape, scale) : undefined;
      // The cone's slant height reaches √(L² + (L/2)²) for h = L and r = L/2.
      const slantHeight = {
        label: 'Твірна l',
        value: formatQuantity(ideal?.slantHeight, 'мм'),
        widest: widestQuantity((length * Math.sqrt(5)) / 2, 'мм'),
      };
      return [
        { label: 'Радіус r', ...edge(ideal?.radius) },
        { label: 'Діаметр d', ...edge(ideal?.diameter) },
        { label: 'Висота h', ...edge(ideal?.height) },
        ...(kind === 'cone' ? [slantHeight] : []),
        { label: 'Площа основи', value: formatQuantity(ideal?.baseArea, 'мм²'), widest: widestQuantity(length ** 2, 'мм²') },
        { label: 'Площа поверхні', ...area, value: formatQuantity(ideal?.surfaceArea, 'мм²') },
        { label: 'Об’єм', ...volume, value: formatQuantity(ideal?.volume, 'мм³') },
      ];
    }
    case 'ball': {
      const ideal = shape?.kind === 'ball' ? ballMeasurements(scale) : undefined;
      return [
        { label: 'Радіус r', ...edge(ideal?.radius) },
        { label: 'Діаметр d', ...edge(ideal?.diameter) },
        { label: 'Площа поверхні', ...area, value: formatQuantity(ideal?.surfaceArea, 'мм²') },
        { label: 'Об’єм', ...volume, value: formatQuantity(ideal?.volume, 'мм³') },
      ];
    }
  }
}

const widestQuantity = (bound: number, unit: string): string => formatQuantity(Math.trunc(bound) + 0.5, unit);
