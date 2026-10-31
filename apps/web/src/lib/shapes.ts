import type { MeshMeasurements } from '@diploma-3d/engine';
import { defaultModelSpecs, type ShapeKind } from '@diploma-3d/schema';

export type ShapeOption = {
  readonly value: string;
  readonly label: string;
  readonly available: boolean;
};

export type MeasurementItem = {
  readonly label: string;
  readonly value: string;
};

const plannedShapes = [
  { value: 'cuboid', label: 'Прямокутний паралелепіпед' },
  { value: 'prism', label: 'Призма' },
  { value: 'pyramid', label: 'Піраміда' },
  { value: 'tetrahedron', label: 'Тетраедр' },
  { value: 'sphere', label: 'Сфера' },
  { value: 'cylinder', label: 'Циліндр' },
  { value: 'cone', label: 'Конус' },
] as const;

export const shapeOptions: readonly ShapeOption[] = [
  { value: 'cube', label: 'Куб', available: true },
  ...plannedShapes.map((shape) => ({ ...shape, available: false })),
];

export const isAvailableShape = (value: string): value is ShapeKind => Object.hasOwn(defaultModelSpecs, value);

export const shapeLabel = (value: string): string => shapeOptions.find((shape) => shape.value === value)?.label ?? '—';

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

export const formatQuantity = (value: number | undefined, unit: string): string =>
  value === undefined ? '—' : `${numberFormat.format(value)} ${unit}`;

export const formatSize = (size: readonly number[] | undefined): string =>
  size === undefined ? '— мм' : `${size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

export const shapeDescriptions: Readonly<Record<ShapeKind, string>> = {
  cube: 'Куб не має окремих параметрів форми: усі ребра рівні, а всі грані — квадрати.',
};

/** Values are measured on the generated mesh, so they describe exactly the geometry that is previewed and exported. */
export function measurementItems(kind: ShapeKind, measurements: MeshMeasurements | undefined): MeasurementItem[] {
  switch (kind) {
    case 'cube':
      return [
        { label: 'Ребро a', value: formatQuantity(measurements?.size[0], 'мм') },
        { label: 'Площа поверхні 6a²', value: formatQuantity(measurements?.surfaceArea, 'мм²') },
        { label: 'Об’єм a³', value: formatQuantity(measurements?.volume, 'мм³') },
      ];
  }
}
