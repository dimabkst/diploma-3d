import { z } from 'zod';

export const DEFAULT_LONGEST_DIMENSION_MM = 80;

// Larger models exceed any desktop printer's build volume; the bound also keeps float32 vertex precision well below 0.1 µm.
export const MAX_LONGEST_DIMENSION_MM = 1000;

// Shapes are defined in dimensionless model units, normalised so that their longest dimension is 1. One uniform scale,
// the longest dimension L in millimetres, converts every solid of a model, so all parts cut from the same model share it.
export const physicalScaleSchema = z.strictObject({
  longestDimensionMm: z.number().positive().max(MAX_LONGEST_DIMENSION_MM),
});

export type PhysicalScale = z.infer<typeof physicalScaleSchema>;
