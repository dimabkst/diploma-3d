import type { MeshMeasurements, Vec3 } from '@diploma-3d/engine';
import { CUBOID_RATIO_LIMITS, defaultModelSpecs, type PhysicalScale, type ShapeKind } from '@diploma-3d/schema';
import { formatDecimal, type StepRange } from './decimal.ts';
import type { ParameterKey } from './model/parameters.ts';

export type ShapeOption = {
  readonly value: string;
  readonly label: string;
  readonly available: boolean;
};

export type MeasurementItem = {
  readonly label: string;
  readonly value: string;
  /** The widest text the value can take for the current scale; it reserves width so that the layout never shifts. */
  readonly widest: string;
};

/** A multiplier field: "label [value] suffix", e.g. "Ширина b [1,5] × a", with a slider over `range`. */
export type ParameterField = {
  readonly key: ParameterKey;
  readonly label: string;
  readonly suffix: string;
  readonly range: StepRange;
};

const plannedShapes = [
  { value: 'prism', label: 'Призма' },
  { value: 'pyramid', label: 'Піраміда' },
  { value: 'tetrahedron', label: 'Тетраедр' },
  { value: 'sphere', label: 'Сфера' },
  { value: 'cylinder', label: 'Циліндр' },
  { value: 'cone', label: 'Конус' },
] as const;

export const shapeOptions: readonly ShapeOption[] = [
  { value: 'cube', label: 'Куб', available: true },
  { value: 'cuboid', label: 'Прямокутний паралелепіпед', available: true },
  ...plannedShapes.map((shape) => ({ ...shape, available: false })),
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
  }
}

// Buttons, arrow keys and the slider move ratios to multiples of 0,25; typed values keep any precision.
const ratioRange: StepRange = { ...CUBOID_RATIO_LIMITS, increment: 0.25 };

export const shapeParameters: Readonly<Record<ShapeKind, readonly ParameterField[]>> = {
  cube: [],
  cuboid: [
    { key: 'widthRatio', label: 'Ширина b', suffix: '× a', range: ratioRange },
    { key: 'heightRatio', label: 'Висота c', suffix: '× a', range: ratioRange },
  ],
};

export function parameterHint(kind: ShapeKind, scale: PhysicalScale): string | undefined {
  switch (kind) {
    case 'cube':
      return undefined;
    case 'cuboid':
      return (
        'Множники задають ширину b і висоту c відносно довжини a. ' +
        `Найбільший вимір моделі завжди дорівнює ${formatLength(scale)}, тому зміна пропорцій може змінити всі фізичні розміри.`
      );
  }
}

/**
 * Edge lengths follow directly from the validated parameters; area and volume are measured on the generated mesh, so
 * they describe exactly the geometry that is previewed and exported.
 */
export function measurementItems(
  kind: ShapeKind,
  scale: PhysicalScale,
  edges: Vec3 | undefined,
  measurements: MeshMeasurements | undefined,
): MeasurementItem[] {
  // A box whose longest edge is L has edges up to L, surface area up to 6L² and volume up to L³ (all reached by the
  // cube). Formatting the bounds with one decimal gives the widest text any value can take.
  const length = scale.longestDimensionMm;
  const edge = (value: number | undefined) => ({ value: formatQuantity(value, 'мм'), widest: widestQuantity(length, 'мм') });
  const area = { value: formatQuantity(measurements?.surfaceArea, 'мм²'), widest: widestQuantity(6 * length ** 2, 'мм²') };
  const volume = { value: formatQuantity(measurements?.volume, 'мм³'), widest: widestQuantity(length ** 3, 'мм³') };
  switch (kind) {
    case 'cube':
      return [
        { label: 'Ребро a', ...edge(edges?.[0]) },
        { label: 'Площа поверхні', ...area },
        { label: 'Об’єм', ...volume },
      ];
    case 'cuboid':
      return [
        { label: 'Довжина a', ...edge(edges?.[0]) },
        { label: 'Ширина b', ...edge(edges?.[1]) },
        { label: 'Висота c', ...edge(edges?.[2]) },
        { label: 'Площа поверхні', ...area },
        { label: 'Об’єм', ...volume },
      ];
  }
}

const widestQuantity = (bound: number, unit: string): string => formatQuantity(Math.trunc(bound) + 0.5, unit);
