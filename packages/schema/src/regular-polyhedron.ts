import { z } from 'zod';

// Regular polyhedra have no independent shape parameters: all edges are equal and all faces are congruent regular
// polygons, so the export size alone fixes every dimension.
export const octahedronShapeSchema = z.strictObject({
  kind: z.literal('octahedron'),
});

export const icosahedronShapeSchema = z.strictObject({
  kind: z.literal('icosahedron'),
});

export const dodecahedronShapeSchema = z.strictObject({
  kind: z.literal('dodecahedron'),
});

export type OctahedronShape = z.infer<typeof octahedronShapeSchema>;
export type IcosahedronShape = z.infer<typeof icosahedronShapeSchema>;
export type DodecahedronShape = z.infer<typeof dodecahedronShapeSchema>;
export type RegularPolyhedronShape = OctahedronShape | IcosahedronShape | DodecahedronShape;
export type RegularPolyhedronKind = RegularPolyhedronShape['kind'];

export const REGULAR_POLYHEDRON_KINDS = [
  'octahedron',
  'icosahedron',
  'dodecahedron',
] as const satisfies readonly RegularPolyhedronKind[];
