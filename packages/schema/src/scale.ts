import { z } from 'zod';

// Larger models exceed any desktop printer's build volume; the bound also keeps float32 vertex precision well below 0.1 µm.
export const MAX_UNIT_LENGTH_MM = 1000;

// Shapes are defined in dimensionless model units. One uniform scale converts every solid of a model to millimetres,
// so all parts cut from the same model share it. Each shape family documents which length equals one unit.
export const physicalScaleSchema = z.strictObject({
  unitLengthMm: z.number().positive().max(MAX_UNIT_LENGTH_MM),
});

export type PhysicalScale = z.infer<typeof physicalScaleSchema>;
