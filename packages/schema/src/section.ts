import { z } from 'zod';

export const SECTION_TYPES = ['parallel-to-bases', 'vertical', 'oblique', 'oblique-apex', 'horizontal'] as const;

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

/**
 * Application restrictions of an oblique plane, not mathematical limits: the exactly horizontal and vertical planes
 * have their own modes. The direction's 0° and 360° are the same direction, so that a slider can reach either end.
 */
export const OBLIQUE_INCLINATION_LIMITS = { min: 5, max: 85 } as const;
export const OBLIQUE_DIRECTION_LIMITS = { min: 0, max: 360 } as const;

export const APEX_INCLINATION_MAX_DEG = 90;

// An application restriction on a ball's horizontal plane, like the parallel cut's 10–90 % of the height: any plane strictly
// inside ±100 % of the radius would split it.
export const BALL_OFFSET_LIMITS = { min: -80, max: 80 } as const;

export const DEFAULT_OBLIQUE_SECTION = { positionPercent: 50, inclinationDeg: 45, directionDeg: 0 } as const;

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

// Round connectors: one or a keyed pair, and the window of their hole enlargements Δ in millimetres, a policy rather than a
// geometric limit. The multipliers of the nominal size d = 0,0625·M and of the insertion length e = 0,05·M and a pair's
// distance from the centre in percent of the section's half span along u have no fixed limits; the solid, the cut and the
// construction constraints bound them, and the engine checks them before building.
export const ROUND_CONNECTOR_COUNTS = [1, 2] as const;
export const DIAMETRAL_CLEARANCE_LIMITS = { min: 0, max: 1 } as const;

export const DEFAULT_ROUND_CONNECTOR = { count: 1, diameterFactor: 1, depthFactor: 1, spacingPercent: 45 } as const;
// Provisional starting points for print trials, not a validated printer or material preset.
export const DEFAULT_PLUG_CLEARANCE_MM = 0.5;
export const DEFAULT_DOWEL_CLEARANCES_MM = { lower: 0.4, upper: 0.5 } as const;

/**
 * The cross-section of a plug, a dowel and their holes, in the cut plane's coordinates (x, y) = (v, u), for the nominal size
 * d = 2r: a circle of radius r; a regular polygon with circumradius r; or `flatted-circle`, x² + y² ≤ r² with x ≤ r/2.
 */
export const CONNECTOR_PROFILES = ['circle', 'triangle', 'square', 'hexagon', 'flatted-circle'] as const;

export type ConnectorProfile = (typeof CONNECTOR_PROFILES)[number];

/** What a newly created connector starts with: its one flat side leaves a single way to join the parts. */
export const DEFAULT_CONNECTOR_PROFILE: ConnectorProfile = 'flatted-circle';

const diametralClearanceSchema = z.number().min(DIAMETRAL_CLEARANCE_LIMITS.min).max(DIAMETRAL_CLEARANCE_LIMITS.max);

/**
 * The fields that plugs and dowels share. One connector sits at the section's centre; a pair sits at ±s along the
 * section's u direction, with nominal sizes d and 0,8d, so that the parts cannot be joined turned by 180°. The spacing
 * belongs to a pair only.
 */
const roundConnectorFields = {
  count: z.union([z.literal(1), z.literal(2)]),
  /** Missing in a configuration saved before there was a choice, and then a circle. */
  profile: z.enum(CONNECTOR_PROFILES).optional(),
  diameterFactor: z.number().positive(),
  depthFactor: z.number().positive(),
  spacingPercent: z.number().positive().optional(),
};

const spacingOfPairsOnly = (connector: { count: 1 | 2; spacingPercent?: number | undefined }) =>
  (connector.count === 2) === (connector.spacingPercent !== undefined);
const spacingMessage = { message: 'A pair needs its spacing; a single connector has none.', path: ['spacingPercent'] };

/**
 * Integral plugs: a protrusion of length e on the lower part and a blind hole in the upper part. The clearance Δ is
 * diametral: each side surface of the hole lies Δ/2 outside the plug's, whatever the profile.
 */
export const plugConnectorSchema = z
  .strictObject({ type: z.literal('plug'), ...roundConnectorFields, holeClearanceMm: diametralClearanceSchema })
  .refine(spacingOfPairsOnly, spacingMessage);

/**
 * Separate removable dowels of length 2e in blind holes of both parts, with clearances per part as for plugs: a tighter
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

// The twist connector's clearance windows for print trials, in millimetres: policies, not material limits. Its Δ follows the
// holes' convention up to 1 mm; it starts at 0,1 mm, as rigid surfaces that turn against each other need some play.
export const TWIST_CLEARANCE_LIMITS = { min: 0.1, max: 1 } as const;
export const TWIST_AXIAL_CLEARANCE_LIMITS = { min: 0.1, max: 0.5 } as const;

// Provisional starting points for print trials, not a validated printer or material preset.
export const DEFAULT_TWIST = { holeClearanceMm: 0.5, axialClearanceMm: 0.2 } as const;

/**
 * A rigid twist connector between the parts of a right cylinder cut parallel to its bases: a short neck on the lower part with a
 * low head of three radial lugs, one wider, in a shallow blind recess of the upper part with entries, retaining ledges and a
 * closing stop. Inserted turned by −45° and turned to the stop; nothing locks it against turning back. Its dimensions are the
 * printed millimetres, not proportional to the model; the solid, the cut and the construction bound the size.
 */
export const twistConnectorSchema = z.strictObject({
  type: z.literal('twist'),
  /** The diameter of the circle around the whole head, lugs included. */
  sizeMm: z.number().positive(),
  /** Δ: every sliding side surface of the recess lies Δ/2 outside the head's, as for holes. */
  holeClearanceMm: z.number().min(TWIST_CLEARANCE_LIMITS.min).max(TWIST_CLEARANCE_LIMITS.max),
  /** The gap at each opposed axial pair of faces, above and below the head; not their sum. */
  axialClearanceMm: z.number().min(TWIST_AXIAL_CLEARANCE_LIMITS.min).max(TWIST_AXIAL_CLEARANCE_LIMITS.max),
});

export type TwistConnector = z.infer<typeof twistConnectorSchema>;

export const connectorSchema = z.discriminatedUnion('type', [
  dovetailConnectorSchema,
  plugConnectorSchema,
  dowelConnectorSchema,
  twistConnectorSchema,
]);

export type Connector = z.infer<typeof connectorSchema>;

export const CONNECTOR_TYPES = ['dovetail', 'plug', 'dowel', 'twist'] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** The plane z = zBottom + t·h with t = positionPercent/100: parallel to the base or bases, also of an oblique solid. */
export const parallelSectionSchema = z.strictObject({
  type: z.literal('parallel-to-bases'),
  positionPercent: sectionPositionSchema,
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type ParallelSection = z.infer<typeof parallelSectionSchema>;

/**
 * A vertical plane parallel to the axis of a cylinder or cone, at a signed distance from it along the plane's normal: at zero it
 * contains the whole axis, an axial section.
 */
export const verticalSectionSchema = z.strictObject({
  type: z.literal('vertical'),
  offsetPercent: sectionOffsetSchema.default(DEFAULT_SECTION_OFFSET_PERCENT),
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type VerticalSection = z.infer<typeof verticalSectionSchema>;

/**
 * A plane through the axis point C0 + t·(C1 − C0), t = positionPercent/100, at the angle inclinationDeg to the base
 * plane, rising along the horizontal direction directionDeg, measured from the model's +X towards +Y.
 */
export const obliqueSectionSchema = z.strictObject({
  type: z.literal('oblique'),
  positionPercent: sectionPositionSchema.default(DEFAULT_OBLIQUE_SECTION.positionPercent),
  inclinationDeg: z
    .number()
    .min(OBLIQUE_INCLINATION_LIMITS.min)
    .max(OBLIQUE_INCLINATION_LIMITS.max)
    .default(DEFAULT_OBLIQUE_SECTION.inclinationDeg),
  directionDeg: z
    .number()
    .min(OBLIQUE_DIRECTION_LIMITS.min)
    .max(OBLIQUE_DIRECTION_LIMITS.max)
    .default(DEFAULT_OBLIQUE_SECTION.directionDeg),
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type ObliqueSection = z.infer<typeof obliqueSectionSchema>;

/**
 * A plane through a cone's apex, at the angle inclinationDeg to the base plane, rising along the horizontal direction
 * directionDeg. Any such plane is well-formed up to the vertical 90°, which holds the axis of a right cone; whether it
 * splits this cone into two parts depends on the cone and the direction, which the engine checks.
 */
export const apexSectionSchema = z.strictObject({
  type: z.literal('oblique-apex'),
  inclinationDeg: z.number().gt(0).max(APEX_INCLINATION_MAX_DEG),
  directionDeg: z.number().min(OBLIQUE_DIRECTION_LIMITS.min).max(OBLIQUE_DIRECTION_LIMITS.max),
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type ApexSection = z.infer<typeof apexSectionSchema>;

/** A horizontal plane through a ball, at a signed distance from its centre in percent of the radius, positive upwards. */
export const horizontalSectionSchema = z.strictObject({
  type: z.literal('horizontal'),
  offsetPercent: z.number().min(BALL_OFFSET_LIMITS.min).max(BALL_OFFSET_LIMITS.max).default(DEFAULT_SECTION_OFFSET_PERCENT),
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type HorizontalSection = z.infer<typeof horizontalSectionSchema>;

export const sectionSchema = z.discriminatedUnion('type', [
  parallelSectionSchema,
  verticalSectionSchema,
  obliqueSectionSchema,
  apexSectionSchema,
  horizontalSectionSchema,
]);

export type Section = z.infer<typeof sectionSchema>;
