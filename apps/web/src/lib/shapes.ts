import type { MeshMeasurements, Vec3 } from '@diploma-3d/engine';
import { CUBOID_RATIO_LIMITS, DEFAULT_LONGEST_DIMENSION_MM, defaultModelSpecs, type ShapeKind } from '@diploma-3d/schema';
import { formatDecimal, type ParameterKey } from './model/parameters.ts';

export type ShapeOption = {
  readonly value: string;
  readonly label: string;
  readonly available: boolean;
};

export type MeasurementItem = {
  readonly label: string;
  readonly value: string;
};

export type ParameterField = {
  readonly key: ParameterKey;
  readonly label: string;
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

const longest = `${formatDecimal(DEFAULT_LONGEST_DIMENSION_MM)} мм`;

export const shapeDescriptions: Readonly<Record<ShapeKind, string>> = {
  cube: `Куб не має окремих параметрів форми: усі ребра рівні, а всі грані — квадрати. Ребро моделі — ${longest}.`,
  cuboid: `Ребра a, b і c напрямлені вздовж осей X, Y і Z, c — висота, усі кути прямі. Найбільший вимір моделі — ${longest}.`,
};

export const shapeParameters: Readonly<Record<ShapeKind, readonly ParameterField[]>> = {
  cube: [],
  cuboid: [
    { key: 'widthRatio', label: 'Ширина, b / a' },
    { key: 'heightRatio', label: 'Висота, c / a' },
  ],
};

export const parameterHints: Readonly<Partial<Record<ShapeKind, string>>> = {
  cuboid: `Ширину й висоту задано відносно довжини a: значення 1,5 означає b = 1,5a. Допустимо від ${formatDecimal(
    CUBOID_RATIO_LIMITS.min,
  )} до ${formatDecimal(CUBOID_RATIO_LIMITS.max)}.`,
};

/**
 * Edge lengths follow directly from the validated parameters; area and volume are measured on the generated mesh, so
 * they describe exactly the geometry that is previewed and exported.
 */
export function measurementItems(
  kind: ShapeKind,
  edges: Vec3 | undefined,
  measurements: MeshMeasurements | undefined,
): MeasurementItem[] {
  const area = formatQuantity(measurements?.surfaceArea, 'мм²');
  const volume = formatQuantity(measurements?.volume, 'мм³');
  switch (kind) {
    case 'cube':
      return [
        { label: 'Ребро a', value: formatQuantity(edges?.[0], 'мм') },
        { label: 'Площа поверхні 6a²', value: area },
        { label: 'Об’єм a³', value: volume },
      ];
    case 'cuboid':
      return [
        { label: 'Довжина a', value: formatQuantity(edges?.[0], 'мм') },
        { label: 'Ширина b', value: formatQuantity(edges?.[1], 'мм') },
        { label: 'Висота c', value: formatQuantity(edges?.[2], 'мм') },
        { label: 'Площа поверхні 2(ab + ac + bc)', value: area },
        { label: 'Об’єм abc', value: volume },
      ];
  }
}
