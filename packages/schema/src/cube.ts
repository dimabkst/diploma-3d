import { z } from 'zod';

export const DEFAULT_CUBE_EDGE_LENGTH_MM = 80;

// A cube has no independent shape parameters: its edge is one model unit, so the scale's unit length is the edge length.
export const cubeShapeSchema = z.strictObject({
  kind: z.literal('cube'),
});

export type CubeShape = z.infer<typeof cubeShapeSchema>;
