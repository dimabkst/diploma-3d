import { z } from 'zod';

export const SECTION_TYPES = ['parallel-to-bases', 'vertical'] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

// An application restriction, not a mathematical limit: it keeps the cut away from the bases, where one part would be
// a thin slice. It does not guarantee that either part is printable at every physical size.
export const SECTION_POSITION_LIMITS = { min: 10, max: 90 } as const;

export const DEFAULT_SECTION_POSITION_PERCENT = 50;

export const DEFAULT_SECTION_OFFSET_PERCENT = 0;

/**
 * A vertical plane's signed distance from the axis, in percent of the radius r, which scales it with the model. Beyond
 * ±100 % no plane can cut a solid within that radius; the engine narrows this for the actual solid.
 */
export const sectionOffsetSchema = z.number().gt(-100).lt(100);

/** The cutting plane's distance from the lower base, in percent of the perpendicular height h between the bases. */
export const sectionPositionSchema = z.number().min(SECTION_POSITION_LIMITS.min).max(SECTION_POSITION_LIMITS.max);

// The calibration window for print trials of the dovetail's clearance between mating surfaces, in millimetres: a policy,
// not a geometric limit. The tongue's size and length have no fixed limits; the cylinder, the cut and the connector's
// construction constraints bound them, and the engine checks them before building.
export const DOVETAIL_CLEARANCE_LIMITS = { min: 0.1, max: 0.4 } as const;

export const DEFAULT_DOVETAIL = { sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2 } as const;

/**
 * A sliding dovetail: a tongue on the lower part and a groove in the upper part, open at one end and closed at the
 * other. The upper part slides onto the tongue parallel to the cut; once engaged, the parts cannot be pulled apart
 * normal to the cut, but nothing locks the slide back towards the entrance.
 */
export const dovetailConnectorSchema = z.strictObject({
  type: z.literal('dovetail'),
  /** k in h = 0,025·M·k. */
  sizeFactor: z.number().positive(),
  /** The tongue's length in percent of the section's span along the sliding direction. */
  lengthPercent: z.number().positive(),
  /** The gap between each pair of mating surfaces, measured normal to them; not a difference of total widths. */
  clearanceMm: z.number().min(DOVETAIL_CLEARANCE_LIMITS.min).max(DOVETAIL_CLEARANCE_LIMITS.max),
});

export type DovetailConnector = z.infer<typeof dovetailConnectorSchema>;

// Round connectors: one or a keyed pair, and the calibration window for print trials of their diametral fit clearances
// in millimetres, a policy rather than a geometric limit. The multipliers of the diameter d = 0,0625·M and of the
// insertion length e = 0,05·M and a pair's distance from the centre in percent of the section's half span along u have
// no fixed limits; the cylinder, the cut and the construction constraints bound them, and the engine checks them before
// building.
export const ROUND_CONNECTOR_COUNTS = [1, 2] as const;
export const DIAMETRAL_CLEARANCE_LIMITS = { min: 0, max: 0.4 } as const;

export const DEFAULT_ROUND_CONNECTOR = { count: 1, diameterFactor: 1, depthFactor: 1, spacingPercent: 45 } as const;
export const DEFAULT_PLUG_CLEARANCE_MM = 0.2;
export const DEFAULT_DOWEL_CLEARANCES_MM = { lower: 0.1, upper: 0.2 } as const;

const diametralClearanceSchema = z.number().min(DIAMETRAL_CLEARANCE_LIMITS.min).max(DIAMETRAL_CLEARANCE_LIMITS.max);

/**
 * The fields that plugs and dowels share. One connector sits at the section's centre; a pair sits at ±s along the
 * section's u direction, with diameters d and 0,8d, so that the parts cannot be joined turned by 180°. The spacing
 * belongs to a pair only.
 */
const roundConnectorFields = {
  count: z.union([z.literal(1), z.literal(2)]),
  diameterFactor: z.number().positive(),
  depthFactor: z.number().positive(),
  spacingPercent: z.number().positive().optional(),
};

const spacingOfPairsOnly = (connector: { count: 1 | 2; spacingPercent?: number | undefined }) =>
  (connector.count === 2) === (connector.spacingPercent !== undefined);
const spacingMessage = { message: 'A pair needs its spacing; a single connector has none.', path: ['spacingPercent'] };

/**
 * Integral plugs: a cylindrical protrusion of length e on the lower part and a blind hole in the upper part. The
 * clearance is diametral: the hole is that much wider than the plug, half of it on each side.
 */
export const plugConnectorSchema = z
  .strictObject({ type: z.literal('plug'), ...roundConnectorFields, holeClearanceMm: diametralClearanceSchema })
  .refine(spacingOfPairsOnly, spacingMessage);

/**
 * Separate removable dowels of length 2e in blind holes of both parts, with diametral clearances per part: a tighter
 * lower hole is meant to keep the dowel in the lower part, which only a print can confirm.
 */
export const dowelConnectorSchema = z
  .strictObject({
    type: z.literal('dowel'),
    ...roundConnectorFields,
    lowerClearanceMm: diametralClearanceSchema,
    upperClearanceMm: diametralClearanceSchema,
  })
  .refine(spacingOfPairsOnly, spacingMessage);

export type PlugConnector = z.infer<typeof plugConnectorSchema>;
export type DowelConnector = z.infer<typeof dowelConnectorSchema>;
export type RoundConnector = PlugConnector | DowelConnector;

export const connectorSchema = z.discriminatedUnion('type', [dovetailConnectorSchema, plugConnectorSchema, dowelConnectorSchema]);

export type Connector = z.infer<typeof connectorSchema>;

export const CONNECTOR_TYPES = ['dovetail', 'plug', 'dowel'] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** The plane z = zBottom + t·h with t = positionPercent/100: parallel to the bases, also of an oblique solid. */
export const parallelSectionSchema = z.strictObject({
  type: z.literal('parallel-to-bases'),
  positionPercent: sectionPositionSchema,
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type ParallelSection = z.infer<typeof parallelSectionSchema>;

/**
 * A vertical plane parallel to the cylinder's axis, at a signed distance from it along the plane's normal: at zero it
 * contains the whole axis, an axial section.
 */
export const verticalSectionSchema = z.strictObject({
  type: z.literal('vertical'),
  offsetPercent: sectionOffsetSchema.default(DEFAULT_SECTION_OFFSET_PERCENT),
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type VerticalSection = z.infer<typeof verticalSectionSchema>;

export const sectionSchema = z.discriminatedUnion('type', [parallelSectionSchema, verticalSectionSchema]);

export type Section = z.infer<typeof sectionSchema>;
