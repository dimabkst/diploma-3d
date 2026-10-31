import { z } from 'zod';
import { cubeShapeSchema, DEFAULT_CUBE_EDGE_LENGTH_MM } from './cube.ts';
import { physicalScaleSchema } from './scale.ts';

export const shapeSchema = z.discriminatedUnion('kind', [cubeShapeSchema]);

export type Shape = z.infer<typeof shapeSchema>;
export type ShapeKind = Shape['kind'];

export const modelSpecSchema = z.strictObject({
  shape: shapeSchema,
  scale: physicalScaleSchema,
});

export type ModelSpec = z.infer<typeof modelSpecSchema>;

export const defaultModelSpecs = {
  cube: { shape: { kind: 'cube' }, scale: { unitLengthMm: DEFAULT_CUBE_EDGE_LENGTH_MM } },
} as const satisfies { readonly [Kind in ShapeKind]: ModelSpec & { shape: { kind: Kind } } };
