import { z } from 'zod';

// A solid ball has no independent shape parameters: its diameter is the longest dimension L, so r = L/2.
export const ballShapeSchema = z.strictObject({
  kind: z.literal('ball'),
});

export type BallShape = z.infer<typeof ballShapeSchema>;
