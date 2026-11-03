import { z } from 'zod';
import { ballShapeSchema } from './ball.ts';
import { cubeShapeSchema } from './cube.ts';
import { cuboidShapeSchema } from './cuboid.ts';
import { parallelepipedShapeSchema } from './parallelepiped.ts';
import { prismShapeSchema } from './prism.ts';
import { pyramidShapeSchema } from './pyramid.ts';
import { coneShapeSchema, cylinderShapeSchema } from './round.ts';
import { DEFAULT_LONGEST_DIMENSION_MM, physicalScaleSchema } from './scale.ts';
import { tetrahedronShapeSchema } from './tetrahedron.ts';

export const shapeSchema = z.discriminatedUnion('kind', [
  cubeShapeSchema,
  cuboidShapeSchema,
  parallelepipedShapeSchema,
  prismShapeSchema,
  pyramidShapeSchema,
  tetrahedronShapeSchema,
  cylinderShapeSchema,
  coneShapeSchema,
  ballShapeSchema,
]);

export type Shape = z.infer<typeof shapeSchema>;
export type ShapeKind = Shape['kind'];

export const modelSpecSchema = z.strictObject({
  shape: shapeSchema,
  scale: physicalScaleSchema,
});

/** A validated specification, with every default filled in. */
export type ModelSpec = z.infer<typeof modelSpecSchema>;

/** A specification as accepted before validation: fields with defaults, such as prism offsets, may be omitted. */
export type ModelSpecInput = z.input<typeof modelSpecSchema>;

const defaultScale = { longestDimensionMm: DEFAULT_LONGEST_DIMENSION_MM } as const;

export const defaultModelSpecs = {
  cube: { shape: { kind: 'cube' }, scale: defaultScale },
  cuboid: { shape: { kind: 'cuboid', widthRatio: 1.5, heightRatio: 2 }, scale: defaultScale },
  parallelepiped: {
    shape: { kind: 'parallelepiped', baseSideRatio: 1, heightRatio: 1, baseAngleDeg: 60, offsetXRatio: 0, offsetYRatio: 0 },
    scale: defaultScale,
  },
  prism: {
    shape: { kind: 'prism', baseType: 'regular', baseSides: 3, heightRatio: 2, offsetXRatio: 0, offsetYRatio: 0 },
    scale: defaultScale,
  },
  pyramid: {
    shape: { kind: 'pyramid', baseType: 'regular', baseSides: 4, heightRatio: 1, apexXRatio: 0, apexYRatio: 0 },
    scale: defaultScale,
  },
  tetrahedron: { shape: { kind: 'tetrahedron' }, scale: defaultScale },
  cylinder: { shape: { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 }, scale: defaultScale },
  cone: { shape: { kind: 'cone', heightRatio: 2, offsetRatio: 0 }, scale: defaultScale },
  ball: { shape: { kind: 'ball' }, scale: defaultScale },
} as const satisfies { readonly [Kind in ShapeKind]: ModelSpec & { shape: { kind: Kind } } };
