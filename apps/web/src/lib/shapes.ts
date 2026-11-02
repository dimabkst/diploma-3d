import {
  ballMeasurements,
  boxEdgeLengthsMm,
  MAX_CIRCLE_DEVIATION_MM,
  type MeshMeasurements,
  pyramidParameters,
  regularBaseDimensionsMm,
  regularPolygonArea,
  roundSolidMeasurements,
} from '@diploma-3d/engine';
import {
  defaultModelSpecs,
  type PhysicalScale,
  PRISM_BASE_SIDES,
  type PrismBaseSides,
  PYRAMID_BASE_SIDES,
  RATIO_LIMITS,
  type Shape,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, type StepRange } from './decimal.ts';
import type { ChoiceKey, ParameterKey } from './model/parameters.ts';

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

/** A multiplier field: "label [value] suffix", e.g. "Ширина b [1,5] × a", with a slider over `range`. */
export type RatioField = {
  readonly type: 'ratio';
  readonly key: ParameterKey;
  readonly label: string;
  readonly suffix: string;
  readonly range: StepRange;
};

/** A parameter picked from fixed options, such as the base polygon. */
export type ChoiceField = {
  readonly type: 'choice';
  readonly key: ChoiceKey;
  readonly label: string;
  readonly options: readonly { readonly value: PrismBaseSides; readonly label: string }[];
};

export type ParameterField = RatioField | ChoiceField;

export const shapeOptions: readonly ShapeOption[] = [
  { value: 'cube', label: 'Куб' },
  { value: 'cuboid', label: 'Прямокутний паралелепіпед' },
  { value: 'prism', label: 'Правильна призма' },
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
    case 'prism':
      return 'Основи — рівні правильні многокутники, бічні ребра перпендикулярні до основ, а бічні грані — прямокутники.';
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

const idealRoundNote =
  'Розміри нижче — для ідеального тіла; у файлі друку коло наближено многокутником, ' +
  `що відходить від нього не більше ніж на ${formatDecimal(MAX_CIRCLE_DEVIATION_MM)} мм.`;

// Buttons, arrow keys and the slider move ratios to multiples of 0,25; typed values keep any precision.
const ratioRange: StepRange = { ...RATIO_LIMITS, increment: 0.25 };

const baseNames: Readonly<Record<PrismBaseSides, string>> = {
  3: 'Рівносторонній трикутник',
  4: 'Квадрат',
  5: 'Правильний п’ятикутник',
  6: 'Правильний шестикутник',
  8: 'Правильний восьмикутник',
};

export const shapeParameters: Readonly<Record<ShapeKind, readonly ParameterField[]>> = {
  cube: [],
  cuboid: [
    { type: 'ratio', key: 'cuboidWidthRatio', label: 'Ширина b', suffix: '× a', range: ratioRange },
    { type: 'ratio', key: 'cuboidHeightRatio', label: 'Висота c', suffix: '× a', range: ratioRange },
  ],
  prism: [
    {
      type: 'choice',
      key: 'prismBaseSides',
      label: 'Основа',
      options: PRISM_BASE_SIDES.map((sides) => ({ value: sides, label: baseNames[sides] })),
    },
    { type: 'ratio', key: 'prismHeightRatio', label: 'Висота h', suffix: '× a', range: ratioRange },
  ],
  pyramid: [
    {
      type: 'choice',
      key: 'pyramidBaseSides',
      label: 'Основа',
      options: PYRAMID_BASE_SIDES.map((sides) => ({ value: sides, label: baseNames[sides] })),
    },
    { type: 'ratio', key: 'pyramidHeightRatio', label: 'Висота h', suffix: '× a', range: ratioRange },
  ],
  // Fixed proportions: nothing to adjust.
  tetrahedron: [],
  ball: [],
  cylinder: [{ type: 'ratio', key: 'cylinderHeightRatio', label: 'Висота h', suffix: '× r', range: ratioRange }],
  cone: [{ type: 'ratio', key: 'coneHeightRatio', label: 'Висота h', suffix: '× r', range: ratioRange }],
};

export function parameterHint(kind: ShapeKind, scale: PhysicalScale): string | undefined {
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
    case 'prism':
      return (
        'a — сторона основи, h — висота призми, перпендикулярна до основи. ' +
        `Найбільший габаритний вимір завжди ${formatLength(scale)}, тому зміна основи чи висоти може змінити всі розміри.`
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
): MeasurementItem[] {
  // Every solid here fits in its bounding box with longest side L: its edges are at most L, a face at most L², the
  // surface area at most 6L² and the volume at most L³ (convex solids inside a cube). Formatting these bounds with one
  // decimal gives the widest text any value can take.
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
    case 'prism':
    case 'pyramid':
    case 'tetrahedron': {
      const parameters =
        shape?.kind === 'prism'
          ? shape
          : shape?.kind === 'pyramid' || shape?.kind === 'tetrahedron'
            ? pyramidParameters(shape)
            : undefined;
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
