import { z } from 'zod';

export const SECTION_TYPES = ['parallel-to-bases'] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

// An application restriction, not a mathematical limit: it keeps the cut away from the bases, where one part would be
// a thin slice. It does not guarantee that either part is printable at every physical size.
export const SECTION_POSITION_LIMITS = { min: 10, max: 90 } as const;

export const DEFAULT_SECTION_POSITION_PERCENT = 50;

/** The cutting plane's distance from the lower base, in percent of the perpendicular height h between the bases. */
export const sectionPositionSchema = z.number().min(SECTION_POSITION_LIMITS.min).max(SECTION_POSITION_LIMITS.max);

// Experimental ranges for the first print trials of the dovetail: its size multiplier k, the tongue's length in percent
// of the section's span along the sliding direction, and the clearance between mating surfaces in millimetres.
export const DOVETAIL_SIZE_LIMITS = { min: 0.75, max: 1.5 } as const;
export const DOVETAIL_LENGTH_LIMITS = { min: 25, max: 60 } as const;
export const DOVETAIL_CLEARANCE_LIMITS = { min: 0.1, max: 0.4 } as const;

export const DEFAULT_DOVETAIL = { sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2 } as const;

/**
 * A sliding dovetail: a tongue on the lower part and a groove in the upper part, open at one end and closed at the
 * other. The upper part slides onto the tongue parallel to the cut; once engaged, the parts cannot be pulled apart
 * normal to the cut, but nothing locks the slide back towards the entrance.
 */
export const dovetailConnectorSchema = z.strictObject({
  type: z.literal('dovetail'),
  sizeFactor: z.number().min(DOVETAIL_SIZE_LIMITS.min).max(DOVETAIL_SIZE_LIMITS.max),
  lengthPercent: z.number().min(DOVETAIL_LENGTH_LIMITS.min).max(DOVETAIL_LENGTH_LIMITS.max),
  /** The gap between each pair of mating surfaces, measured normal to them; not a difference of total widths. */
  clearanceMm: z.number().min(DOVETAIL_CLEARANCE_LIMITS.min).max(DOVETAIL_CLEARANCE_LIMITS.max),
});

export type DovetailConnector = z.infer<typeof dovetailConnectorSchema>;

export const CONNECTOR_TYPES = ['dovetail'] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** The plane z = zBottom + t·h with t = positionPercent/100: parallel to the bases, also of an oblique solid. */
export const parallelSectionSchema = z.strictObject({
  type: z.literal('parallel-to-bases'),
  positionPercent: sectionPositionSchema,
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: dovetailConnectorSchema.optional(),
});

export type ParallelSection = z.infer<typeof parallelSectionSchema>;

export const sectionSchema = z.discriminatedUnion('type', [parallelSectionSchema]);

export type Section = z.infer<typeof sectionSchema>;
