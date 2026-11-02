import { z } from 'zod';

/**
 * h/a of the regular tetrahedron as a triangular pyramid: the apex lies above the base centroid, which is a/√3 from
 * each base vertex, so a lateral edge of length a requires h² = a² − a²/3, i.e. h = a·√(2/3).
 */
export const TETRAHEDRON_HEIGHT_RATIO = Math.sqrt(2 / 3);

// A regular tetrahedron has no independent shape parameters: all six edges are equal by definition.
export const tetrahedronShapeSchema = z.strictObject({
  kind: z.literal('tetrahedron'),
});

export type TetrahedronShape = z.infer<typeof tetrahedronShapeSchema>;
