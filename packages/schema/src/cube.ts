import { z } from 'zod';

// A cube has no independent shape parameters: all edges are equal, so each edge is the longest dimension L.
export const cubeShapeSchema = z.strictObject({
  kind: z.literal('cube'),
});

export type CubeShape = z.infer<typeof cubeShapeSchema>;
