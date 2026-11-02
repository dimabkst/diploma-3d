import { z } from 'zod';
import { ratioSchema } from './ratio.ts';

/**
 * Right circular cylinder: two equal circular bases of radius r, with the axis perpendicular to them. Its shape is
 * given by one proportion, heightRatio = h/r.
 */
export const cylinderShapeSchema = z.strictObject({
  kind: z.literal('cylinder'),
  heightRatio: ratioSchema,
});

export type CylinderShape = z.infer<typeof cylinderShapeSchema>;

/**
 * Right circular cone: a circular base of radius r and the apex directly above its centre at the perpendicular height
 * h. Its shape is given by one proportion, heightRatio = h/r.
 */
export const coneShapeSchema = z.strictObject({
  kind: z.literal('cone'),
  heightRatio: ratioSchema,
});

export type ConeShape = z.infer<typeof coneShapeSchema>;
