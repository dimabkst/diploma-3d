import { z } from 'zod';

export const DEFAULT_LONGEST_DIMENSION_MM = 80;

// Below a millimetre nothing of a solid's shape survives printing.
export const MIN_LONGEST_DIMENSION_MM = 1;

// Not a particular printer's build volume, which a slicer checks: an upper bound that keeps float32 vertex precision well
// below 0.1 µm and the circle and sphere subdivisions, which grow with the physical radius, bounded.
export const MAX_LONGEST_DIMENSION_MM = 1000;

/** The longest bounding-box dimension of the exported model, in millimetres. */
export const longestDimensionSchema = z.number().min(MIN_LONGEST_DIMENSION_MM).max(MAX_LONGEST_DIMENSION_MM);

// Shapes are defined in dimensionless model units, normalised so that their longest dimension is 1. One uniform scale,
// the longest dimension L in millimetres, converts every solid of a model, so all parts cut from the same model share it.
export const physicalScaleSchema = z.strictObject({
  longestDimensionMm: longestDimensionSchema,
});

export type PhysicalScale = z.infer<typeof physicalScaleSchema>;
