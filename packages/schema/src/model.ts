import { z } from 'zod';
import { cubeShapeSchema } from './cube.ts';
import { cuboidShapeSchema } from './cuboid.ts';
import { prismShapeSchema } from './prism.ts';
import { pyramidShapeSchema } from './pyramid.ts';
import { coneShapeSchema, cylinderShapeSchema } from './round.ts';
import { DEFAULT_LONGEST_DIMENSION_MM, physicalScaleSchema } from './scale.ts';
import { tetrahedronShapeSchema } from './tetrahedron.ts';

export const shapeSchema = z.discriminatedUnion('kind', [
  cubeShapeSchema,
  cuboidShapeSchema,
  prismShapeSchema,
  pyramidShapeSchema,
  tetrahedronShapeSchema,
  cylinderShapeSchema,
  coneShapeSchema,
]);

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
  prism: { shape: { kind: 'prism', baseSides: 3, heightRatio: 2 }, scale: defaultScale },
  pyramid: { shape: { kind: 'pyramid', baseSides: 4, heightRatio: 1 }, scale: defaultScale },
  tetrahedron: { shape: { kind: 'tetrahedron' }, scale: defaultScale },
  cylinder: { shape: { kind: 'cylinder', heightRatio: 2 }, scale: defaultScale },
  cone: { shape: { kind: 'cone', heightRatio: 2 }, scale: defaultScale },
} as const satisfies { readonly [Kind in ShapeKind]: ModelSpec & { shape: { kind: Kind } } };
