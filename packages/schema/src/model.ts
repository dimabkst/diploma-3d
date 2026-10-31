import { z } from 'zod';
import { cubeShapeSchema } from './cube.ts';
import { cuboidShapeSchema } from './cuboid.ts';
import { DEFAULT_LONGEST_DIMENSION_MM, physicalScaleSchema } from './scale.ts';

export const shapeSchema = z.discriminatedUnion('kind', [cubeShapeSchema, cuboidShapeSchema]);

export type Shape = z.infer<typeof shapeSchema>;
export type ShapeKind = Shape['kind'];

export const modelSpecSchema = z.strictObject({
  shape: shapeSchema,
  scale: physicalScaleSchema,
});

export type ModelSpec = z.infer<typeof modelSpecSchema>;

const defaultScale = { longestDimensionMm: DEFAULT_LONGEST_DIMENSION_MM } as const;

export const defaultModelSpecs = {
  cube: { shape: { kind: 'cube' }, scale: defaultScale },
  cuboid: { shape: { kind: 'cuboid', widthRatio: 1.5, heightRatio: 2 }, scale: defaultScale },
} as const satisfies { readonly [Kind in ShapeKind]: ModelSpec & { shape: { kind: Kind } } };
