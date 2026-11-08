import { z } from 'zod';
import { ballShapeSchema } from './ball.ts';
import { cubeShapeSchema } from './cube.ts';
import { cuboidShapeSchema } from './cuboid.ts';
import { parallelepipedShapeSchema } from './parallelepiped.ts';
import { prismShapeSchema } from './prism.ts';
import { pyramidShapeSchema } from './pyramid.ts';
import { dodecahedronShapeSchema, icosahedronShapeSchema, octahedronShapeSchema } from './regular-polyhedron.ts';
import { coneShapeSchema, cylinderShapeSchema } from './round.ts';
import { DEFAULT_LONGEST_DIMENSION_MM, physicalScaleSchema } from './scale.ts';
import { type SectionType, sectionSchema } from './section.ts';
import { tetrahedronShapeSchema } from './tetrahedron.ts';
import { isWithinMinimumInclination, MIN_INCLINATION_DEG, tiltOf } from './tilt.ts';

export const shapeSchema = z
  .discriminatedUnion('kind', [
    cubeShapeSchema,
    cuboidShapeSchema,
    parallelepipedShapeSchema,
    prismShapeSchema,
    pyramidShapeSchema,
    tetrahedronShapeSchema,
    octahedronShapeSchema,
    icosahedronShapeSchema,
    dodecahedronShapeSchema,
    cylinderShapeSchema,
    coneShapeSchema,
    ballShapeSchema,
  ])
  .superRefine((shape, context) => {
    // Each offset is within its own limits; together they must not lean the solid flatter than the minimum inclination.
    const tilt = tiltOf(shape);
    if (tilt !== undefined && !isWithinMinimumInclination(tilt.height, tilt.displacement)) {
      context.addIssue({
        code: 'custom',
        message: `The solid leans flatter than ${MIN_INCLINATION_DEG}° to its base plane.`,
      });
    }
  });

export type Shape = z.infer<typeof shapeSchema>;
export type ShapeKind = Shape['kind'];

/** The section types each shape offers; a shape that is not listed offers none yet. */
export const SECTIONS_BY_SHAPE: Readonly<Partial<Record<ShapeKind, readonly SectionType[]>>> = {
  cylinder: ['parallel-to-bases', 'vertical', 'oblique'],
  cone: ['parallel-to-bases'],
};

export const supportsSection = (kind: ShapeKind, type: SectionType): boolean => SECTIONS_BY_SHAPE[kind]?.includes(type) ?? false;

/**
 * The shape, its physical scale and, optionally, a plane section that splits it into two parts. The scale describes the
 * whole, assembled solid, so both parts share it.
 */
export const modelSpecSchema = z
  .strictObject({
    shape: shapeSchema,
    scale: physicalScaleSchema,
    section: sectionSchema.optional(),
  })
  .superRefine((spec, context) => {
    if (spec.section !== undefined && !supportsSection(spec.shape.kind, spec.section.type)) {
      context.addIssue({
        code: 'custom',
        path: ['section'],
        message: `A ${spec.shape.kind} does not offer the section ${spec.section.type}.`,
      });
    }
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
  octahedron: { shape: { kind: 'octahedron' }, scale: defaultScale },
  icosahedron: { shape: { kind: 'icosahedron' }, scale: defaultScale },
  dodecahedron: { shape: { kind: 'dodecahedron' }, scale: defaultScale },
  cylinder: { shape: { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 }, scale: defaultScale },
  cone: { shape: { kind: 'cone', heightRatio: 2, offsetRatio: 0 }, scale: defaultScale },
  ball: { shape: { kind: 'ball' }, scale: defaultScale },
} as const satisfies { readonly [Kind in ShapeKind]: ModelSpec & { shape: { kind: Kind } } };
