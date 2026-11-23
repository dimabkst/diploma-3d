import { z } from 'zod';

export const SECTION_TYPES = [
  'parallel-to-bases',
  'vertical',
  'oblique',
  'oblique-apex',
  'horizontal',
  'axis-parallel',
  'face-parallel',
  'longitudinal',
  'through-apex',
  'through-line',
  'inclined',
] as const;

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
 * Where the groove opens on the part that carries it, in the model's own orientation. `standard`: at the upper end of a cut
 * that is not horizontal, and at the cut frame's −u side of a horizontal one, as dovetails always opened; `opposite`: at the
 * other end, with the stop moved to where the entrance was.
 */
export const DOVETAIL_ENTRANCES = ['standard', 'opposite'] as const;

export type DovetailEntrance = (typeof DOVETAIL_ENTRANCES)[number];

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
  /** Missing in a configuration saved before there was a choice, and then `standard`, the direction it was built with. */
  entrance: z.enum(DOVETAIL_ENTRANCES).optional(),
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

// The magnet pockets' windows, in physical millimetres that never follow the model's size: policies for the interface and for
// print trials, not geometric limits. The solid and the cut decide what actually fits, which the engine checks.
export const MAGNET_LIMITS = {
  count: { min: 1, max: 12 },
  magnetDiameterMm: { min: 1, max: 30 },
  magnetThicknessMm: { min: 0.5, max: 20 },
  diameterAllowanceMm: { min: 0, max: 1 },
  depthAllowanceMm: { min: 0, max: 1 },
} as const;

// Editable starting points for common 6 × 2 mm disc magnets, not a certified printer setting nor a holding force.
export const DEFAULT_MAGNET = {
  count: 3,
  magnetDiameterMm: 6,
  magnetThicknessMm: 2,
  diameterAllowanceMm: 0.2,
  depthAllowanceMm: 0.1,
} as const;

/**
 * Settings that earlier magnet pockets had and the placement now decides itself: the edge distance, the material around,
 * beneath and between the pockets, and the entry chamfer. A connector that still names one is refused rather than read, so
 * that none of them can override the automatic placement unseen.
 */
export const LEGACY_MAGNET_FIELDS = ['edgeClearanceMm', 'wallMm', 'spacingMm', 'chamferMm'] as const;

const magnetMillimetres = (limits: { readonly min: number; readonly max: number }) => z.number().min(limits.min).max(limits.max);

/**
 * Cylindrical blind pockets for disc magnets: `count` pairs per mating interface, each pair one shared axis along the cut's normal
 * with a pocket opening on either mating face, of diameter d + Δd and depth t + Δt. Every value is in printed millimetres; the
 * engine places the pockets and decides their material and chamfer.
 */
export const magnetConnectorSchema = z.strictObject({
  type: z.literal('magnet'),
  count: z.number().int().min(MAGNET_LIMITS.count.min).max(MAGNET_LIMITS.count.max),
  magnetDiameterMm: magnetMillimetres(MAGNET_LIMITS.magnetDiameterMm),
  magnetThicknessMm: magnetMillimetres(MAGNET_LIMITS.magnetThicknessMm),
  /** Added to the whole diameter, not to the radius. */
  diameterAllowanceMm: magnetMillimetres(MAGNET_LIMITS.diameterAllowanceMm),
  depthAllowanceMm: magnetMillimetres(MAGNET_LIMITS.depthAllowanceMm),
});

export type MagnetConnector = z.infer<typeof magnetConnectorSchema>;

/** A pocket's diameter d + Δd and depth t + Δt, from the magnet and its allowances. */
export const magnetPocketMm = (magnet: Omit<MagnetConnector, 'type' | 'count'> | MagnetConnector) => ({
  diameter: magnet.magnetDiameterMm + magnet.diameterAllowanceMm,
  depth: magnet.magnetThicknessMm + magnet.depthAllowanceMm,
});

export const connectorSchema = z.discriminatedUnion('type', [
  dovetailConnectorSchema,
  plugConnectorSchema,
  dowelConnectorSchema,
  twistConnectorSchema,
  magnetConnectorSchema,
]);

export type Connector = z.infer<typeof connectorSchema>;

export const CONNECTOR_TYPES = ['dovetail', 'plug', 'dowel', 'twist', 'magnet'] as const;

export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

// The section plate's windows in millimetres: policies for print trials, not geometric limits. The solid and the cut's
// position narrow the thickness further, which the engine checks.
export const SECTION_PLATE_THICKNESS_LIMITS = { min: 1.2, max: 4 } as const;
export const SECTION_PLATE_MARGIN_LIMITS = { min: 3, max: 30 } as const;

export const DEFAULT_SECTION_PLATE = { thicknessMm: 1.6, marginMm: 10 } as const;

/**
 * A separate flat plate that shows the section: the slab of thickness T, measured along the plane's normal and centred on the
 * plane, is removed from the solid and printed as a third object, whose outline is the slab's own extent within the plane
 * grown by the margin. The
 * parts keep their scale and position, so the assembly is the original solid with the plate's margin around the cut.
 */
export const sectionPlateSchema = z.strictObject({
  thicknessMm: z.number().min(SECTION_PLATE_THICKNESS_LIMITS.min).max(SECTION_PLATE_THICKNESS_LIMITS.max),
  marginMm: z.number().min(SECTION_PLATE_MARGIN_LIMITS.min).max(SECTION_PLATE_MARGIN_LIMITS.max),
});

export type SectionPlate = z.infer<typeof sectionPlateSchema>;

/** The plane z = zBottom + t·h with t = positionPercent/100: parallel to the base or bases, also of an oblique solid. */
export const parallelSectionSchema = z.strictObject({
  type: z.literal('parallel-to-bases'),
  positionPercent: sectionPositionSchema,
  /** A section plate on this plane; only a cone offers one so far, not with a twist connector, which the engine checks. */
  plate: sectionPlateSchema.optional(),
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
  /** A section plate on this plane; only a cone offers one so far, which the engine checks. */
  plate: sectionPlateSchema.optional(),
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
  /** A section plate on this plane; only a cone offers one so far, which the engine checks. */
  plate: sectionPlateSchema.optional(),
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
  /**
   * The axial section: the plane also holds the base's centre, whatever the cone. The angle then follows from the cone and the
   * direction, and the engine derives it anew from the cone it builds; a stored angle only records what was derived.
   */
  axial: z.boolean().optional(),
  /** A section plate on this plane; only a cone offers one so far, which the engine checks. */
  plate: sectionPlateSchema.optional(),
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type ApexSection = z.infer<typeof apexSectionSchema>;

/**
 * A cylinder's plane parallel to its axis a = C1 − C0, oblique or not: the line of the base plane through the point at
 * offsetPercent of the radius from the base's centre along the horizontal direction directionDeg, measured from +X towards +Y,
 * perpendicular to it, swept along a. Its normal is u × a for the line's direction u, so n·a = 0 whatever the lean, and at
 * offset zero it holds the whole axis, an axial section. For a right cylinder it is a vertical plane.
 */
export const axisParallelSectionSchema = z.strictObject({
  type: z.literal('axis-parallel'),
  offsetPercent: sectionOffsetSchema.default(DEFAULT_SECTION_OFFSET_PERCENT),
  directionDeg: z.number().min(OBLIQUE_DIRECTION_LIMITS.min).max(OBLIQUE_DIRECTION_LIMITS.max).default(90),
  /** A section plate on this plane, centred on it. */
  plate: sectionPlateSchema.optional(),
  /** Joins the parts; without one, both cut faces stay flat. */
  connector: connectorSchema.optional(),
});

export type AxisParallelSection = z.infer<typeof axisParallelSectionSchema>;

/** A horizontal plane through a ball, at a signed distance from its centre in percent of the radius, positive upwards. */
/**
 * A ball's horizontal cut, and optionally a second plane parallel to it: each at its own signed distance from the centre in
 * percent of the radius, both of the original ball, so that the two planes make three parts. A missing second plane is the
 * single cut, as every configuration saved before there was a choice. The two planes do not take a section plate.
 */
export const horizontalSectionSchema = z
  .strictObject({
    type: z.literal('horizontal'),
    offsetPercent: z.number().min(BALL_OFFSET_LIMITS.min).max(BALL_OFFSET_LIMITS.max).default(DEFAULT_SECTION_OFFSET_PERCENT),
    /** The second plane, with the first plane's orientation; the engine checks that the part between them is usable. */
    secondOffsetPercent: z.number().min(BALL_OFFSET_LIMITS.min).max(BALL_OFFSET_LIMITS.max).optional(),
    /** A section plate on this plane, centred on it. */
    plate: sectionPlateSchema.optional(),
    /** Joins the parts, at each plane alike; without one, every cut face stays flat. */
    connector: connectorSchema.optional(),
  })
  .refine((section) => section.secondOffsetPercent === undefined || section.plate === undefined, {
    message: 'A second parallel plane does not take a section plate.',
    path: ['plate'],
  });

export type HorizontalSection = z.infer<typeof horizontalSectionSchema>;

/** The letters of a base's vertices in order around it: A, B, C, … for up to eight sides. */
export const PRISM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

type PrismLetter = (typeof PRISM_LETTERS)[number];

/**
 * A vertex of a cube, a parallelepiped or a prism as school notation names it: the lower base A, B, C, … counter-clockwise seen
 * from above, AB along +X, and the upper base A1, B1, C1, … above it, A1 joined to A by a lateral edge.
 */
export type BoxVertex = PrismLetter | `${PrismLetter}1` | typeof PYRAMID_APEX;

/** A pyramid's apex, as school notation names it: SABC, SABCD. */
export const PYRAMID_APEX = 'S';

export const BOX_VERTEX_NAMES: readonly BoxVertex[] = [
  ...PRISM_LETTERS,
  ...PRISM_LETTERS.map((letter) => `${letter}1` as const),
  PYRAMID_APEX,
];

/** A face by its vertices' names in order around it, such as ABC, A1B1C1 or ABB1A1. */
export type BoxFace = string;

/** A segment between two vertices: an edge, a face diagonal or a body diagonal, by its endpoints. */
export const boxSegmentSchema = z
  .tuple([z.enum(BOX_VERTEX_NAMES as [BoxVertex, ...BoxVertex[]]), z.enum(BOX_VERTEX_NAMES as [BoxVertex, ...BoxVertex[]])])
  .refine(([first, second]) => first !== second, { message: 'A segment needs two different vertices.' });

export type BoxSegment = z.infer<typeof boxSegmentSchema>;

/**
 * The vertices, faces and edges of a prism or a pyramid over an n-gon, a cube and the parallelepipeds being prisms over a
 * quadrilateral and the tetrahedron a pyramid over a triangle, each face by its vertices in order around it.
 * - A prism: 2n vertices, the lower base, then the upper one; n + 2 faces, both bases, then the lateral faces XYY1X1 from AB on;
 *   3n edges, the lower base's, the upper base's, then the lateral ones XX1.
 * - A pyramid: n + 1 vertices, the base, then the apex S; n + 1 faces, the base, then the lateral faces SXY from AB on; 2n
 *   edges, the base's, then the lateral ones SX.
 */
export interface PrismTopology {
  readonly kind: 'prism' | 'pyramid';
  readonly sides: number;
  readonly vertices: readonly BoxVertex[];
  readonly faces: Readonly<Record<BoxFace, readonly BoxVertex[]>>;
  readonly faceNames: readonly BoxFace[];
  readonly lowerBase: BoxFace;
  /** A prism's; a pyramid has none. */
  readonly upperBase: BoxFace | undefined;
  /** A pyramid's; a prism has none. */
  readonly apex: BoxVertex | undefined;
  readonly edges: readonly BoxSegment[];
  readonly lateralEdges: readonly BoxSegment[];
}

const topologies = new Map<string, PrismTopology>();

const assertSides = (sides: number) => {
  if (!Number.isInteger(sides) || sides < 3 || sides > PRISM_LETTERS.length) {
    throw new RangeError(`A base needs from 3 to ${PRISM_LETTERS.length} vertices, not ${sides}.`);
  }
};

export function prismTopology(sides: number): PrismTopology {
  const known = topologies.get(`prism${sides}`);
  if (known !== undefined) return known;
  assertSides(sides);
  const lower = PRISM_LETTERS.slice(0, sides) as PrismLetter[];
  const upper = lower.map((letter): BoxVertex => `${letter}1`);
  const next = (index: number) => (index + 1) % sides;
  const lateral = lower.map((letter, index): readonly BoxVertex[] => [
    letter,
    lower[next(index)] as BoxVertex,
    upper[next(index)] as BoxVertex,
    upper[index] as BoxVertex,
  ]);
  const faceList: (readonly BoxVertex[])[] = [lower, upper, ...lateral];
  const faces = Object.fromEntries(faceList.map((corners) => [corners.join(''), corners]));
  const lateralEdges = lower.map((letter, index): BoxSegment => [letter, upper[index] as BoxVertex]);
  const topology: PrismTopology = {
    kind: 'prism',
    sides,
    vertices: [...lower, ...upper],
    faces,
    faceNames: Object.keys(faces),
    lowerBase: lower.join(''),
    upperBase: upper.join(''),
    apex: undefined,
    edges: [
      ...lower.map((letter, index): BoxSegment => [letter, lower[next(index)] as BoxVertex]),
      ...upper.map((vertex, index): BoxSegment => [vertex, upper[next(index)] as BoxVertex]),
      ...lateralEdges,
    ],
    lateralEdges,
  };
  topologies.set(`prism${sides}`, topology);
  return topology;
}

export function pyramidTopology(sides: number): PrismTopology {
  const known = topologies.get(`pyramid${sides}`);
  if (known !== undefined) return known;
  assertSides(sides);
  const base = PRISM_LETTERS.slice(0, sides) as PrismLetter[];
  const next = (index: number) => (index + 1) % sides;
  const faceList: (readonly BoxVertex[])[] = [
    base,
    ...base.map((letter, index): readonly BoxVertex[] => [PYRAMID_APEX, letter, base[next(index)] as BoxVertex]),
  ];
  const faces = Object.fromEntries(faceList.map((corners) => [corners.join(''), corners]));
  const lateralEdges = base.map((letter): BoxSegment => [PYRAMID_APEX, letter]);
  const topology: PrismTopology = {
    kind: 'pyramid',
    sides,
    vertices: [...base, PYRAMID_APEX],
    faces,
    faceNames: Object.keys(faces),
    lowerBase: base.join(''),
    upperBase: undefined,
    apex: PYRAMID_APEX,
    edges: [...base.map((letter, index): BoxSegment => [letter, base[next(index)] as BoxVertex]), ...lateralEdges],
    lateralEdges,
  };
  topologies.set(`pyramid${sides}`, topology);
  return topology;
}

/** A cube's or parallelepiped's: the bases ABCD and A1B1C1D1 and the lateral faces ABB1A1, BCC1B1, CDD1C1 and DAA1D1. */
export const BOX_TOPOLOGY = prismTopology(4);
export const BOX_VERTICES = BOX_TOPOLOGY.vertices;
export const BOX_FACES = BOX_TOPOLOGY.faces;
export const BOX_FACE_NAMES = BOX_TOPOLOGY.faceNames;
export const BOX_EDGES = BOX_TOPOLOGY.edges;

/** Whether two vertices are consecutive around the face, an edge of it, or not, a diagonal of it; undefined off the face. */
export function boxFaceSegmentKind(
  topology: PrismTopology,
  face: BoxFace,
  [first, second]: readonly [BoxVertex, BoxVertex],
): 'edge' | 'diagonal' | undefined {
  const corners = topology.faces[face];
  if (corners === undefined) return undefined;
  const [i, j] = [corners.indexOf(first), corners.indexOf(second)];
  if (i < 0 || j < 0 || i === j) return undefined;
  const apart = Math.abs(i - j);
  return apart === 1 || apart === corners.length - 1 ? 'edge' : 'diagonal';
}

const isEdgeOf = (topology: PrismTopology, [first, second]: readonly [BoxVertex, BoxVertex]) =>
  topology.edges.some(([a, b]) => (a === first && b === second) || (a === second && b === first));

/** The faces that hold both vertices: those of an edge or a face diagonal; none for a body diagonal. */
export const boxFacesHolding = (topology: PrismTopology, [first, second]: readonly [BoxVertex, BoxVertex]): BoxFace[] =>
  topology.faceNames.filter((face) => {
    const corners = topology.faces[face] ?? [];
    return corners.includes(first) && corners.includes(second);
  });

/**
 * The second of two parallel planes of a cube or parallelepiped, at its own percentage of the original solid's extent along
 * the planes' normal: from the plane through the farthest vertex on one side, 0 %, to the one on the other, 100 %, measured
 * the way the first plane's position is. The two planes make three parts.
 */
const secondBoxPlane = { secondPositionPercent: sectionPositionSchema.optional() };

/**
 * A plane of a cube or parallelepiped parallel to one of its faces, at positionPercent of the way from that face to the
 * opposite one, whose distance is the solid's extent along the face's normal.
 */
export const faceParallelSectionSchema = z.strictObject({
  type: z.literal('face-parallel'),
  /** The lower base when absent; see `boxSectionIssues` for the faces a solid has. */
  face: z.string().optional(),
  positionPercent: sectionPositionSchema.default(DEFAULT_SECTION_POSITION_PERCENT),
  ...secondBoxPlane,
  connector: connectorSchema.optional(),
});

/**
 * The lines of the base plane that a longitudinal plane's trace may run along, besides an angle to AB: a diagonal of the base,
 * and for a triangular base the median, the altitude and the bisector from a vertex and the midline parallel to a side. AC and
 * BD are a cube's or parallelepiped's diagonals by their earlier names.
 */
export const LONGITUDINAL_TRACES = ['angle', 'AC', 'BD', 'diagonal', 'median', 'height', 'bisector', 'midline'] as const;

/**
 * The lines of a pyramid's base plane that a plane through its apex may pass through, besides a trace at an angle to AB: those of
 * a longitudinal plane, and two of the pyramid's own: from the base vertex V of the lateral edge SV through the point of a base
 * edge, so that the plane holds SV and that point; from V through H, the foot of the pyramid's height, so that the plane holds
 * SV and the height SH.
 */
export const APEX_TRACES = ['angle', 'diagonal', 'median', 'height', 'bisector', 'midline', 'edge-point', 'height-edge'] as const;

export type ApexTrace = (typeof APEX_TRACES)[number];

export type LongitudinalTrace = (typeof LONGITUDINAL_TRACES)[number];

/**
 * A plane of a pyramid through its apex S and a line of the base plane, whatever the pyramid becomes: a trace at traceAngleDeg
 * to AB, counter-clockwise seen from above, at positionPercent of the base's extent across it; a diagonal traceSegment; the
 * median, altitude or bisector of a triangular base from traceVertex, or its midline parallel to the side traceSegment; from
 * traceVertex V through the point at tracePointPercent of the base edge traceSegment, from its first vertex; or from V through
 * the foot of the pyramid's height.
 */
export const throughApexSectionSchema = z.strictObject({
  type: z.literal('through-apex'),
  trace: z.enum(APEX_TRACES).default('angle'),
  traceAngleDeg: z.number().min(0).max(180).default(0),
  traceVertex: z.enum(BOX_VERTEX_NAMES as [BoxVertex, ...BoxVertex[]]).optional(),
  traceSegment: boxSegmentSchema.optional(),
  tracePointPercent: z.number().min(0).max(100).optional(),
  positionPercent: sectionPositionSchema.default(DEFAULT_SECTION_POSITION_PERCENT),
  ...secondBoxPlane,
  connector: connectorSchema.optional(),
});

/**
 * A plane parallel to the lateral edges, whose direction a = A1 − A is the solid's own: its trace on the base plane runs at
 * traceAngleDeg to the edge AB, counter-clockwise seen from above, or along a line of the base, whatever the base becomes: a
 * diagonal traceSegment; the median, altitude or bisector from traceVertex; the midline parallel to the side traceSegment.
 * positionPercent places it across the solid's extent along its normal; with `through`, the plane passes through the line
 * itself, wherever that lies.
 */
export const longitudinalSectionSchema = z
  .strictObject({
    type: z.literal('longitudinal'),
    trace: z.enum(LONGITUDINAL_TRACES).default('angle'),
    traceAngleDeg: z.number().min(0).max(180).default(0),
    traceVertex: z.enum(BOX_VERTEX_NAMES as [BoxVertex, ...BoxVertex[]]).optional(),
    traceSegment: boxSegmentSchema.optional(),
    through: z.boolean().optional(),
    positionPercent: sectionPositionSchema.default(DEFAULT_SECTION_POSITION_PERCENT),
    ...secondBoxPlane,
    connector: connectorSchema.optional(),
  })
  .refine((section) => section.through !== true || section.trace !== 'angle', {
    message: 'A trace at an angle passes through no line of the base.',
    path: ['through'],
  });

export const throughLineSectionSchema = z
  .strictObject({
    type: z.literal('through-line'),
    face: z.string(),
    line: boxSegmentSchema,
    method: z.enum(['angle', 'point']),
    angleDeg: z.number().gt(0).lt(180).optional(),
    pointEdge: boxSegmentSchema.optional(),
    pointPercent: z.number().min(0).max(100).optional(),
    ...secondBoxPlane,
    connector: connectorSchema.optional(),
  })
  .refine(
    (section) =>
      section.method === 'angle'
        ? section.angleDeg !== undefined
        : section.pointEdge !== undefined && section.pointPercent !== undefined,
    { message: 'An angle, or an edge and the point on it.', path: ['method'] },
  );

/**
 * Any plane of a cube or parallelepiped: at inclinationDeg to the base plane, rising along the horizontal direction
 * directionDeg, from +X towards +Y, or perpendicular to a segment between two vertices, an edge or a diagonal, whatever the
 * solid becomes; positionPercent places it across the solid's extent along its normal.
 */
export const inclinedSectionSchema = z.strictObject({
  type: z.literal('inclined'),
  inclinationDeg: z.number().min(0).max(90).default(45),
  directionDeg: z.number().min(OBLIQUE_DIRECTION_LIMITS.min).max(OBLIQUE_DIRECTION_LIMITS.max).default(0),
  normalAlong: boxSegmentSchema.optional(),
  /** Two skew edges whose directions the plane is parallel to, n ∝ u × v, as a pair of a tetrahedron's opposite edges is. */
  parallelTo: z.tuple([boxSegmentSchema, boxSegmentSchema]).optional(),
  positionPercent: sectionPositionSchema.default(DEFAULT_SECTION_POSITION_PERCENT),
  ...secondBoxPlane,
  connector: connectorSchema.optional(),
});

export type FaceParallelSection = z.infer<typeof faceParallelSectionSchema>;
export type LongitudinalSection = z.infer<typeof longitudinalSectionSchema>;
export type ThroughLineSection = z.infer<typeof throughLineSectionSchema>;
export type InclinedSection = z.infer<typeof inclinedSectionSchema>;
export type ThroughApexSection = z.infer<typeof throughApexSectionSchema>;
export type BoxSectionSpec =
  | FaceParallelSection
  | LongitudinalSection
  | ThroughApexSection
  | ThroughLineSection
  | InclinedSection;

/**
 * What a box section names that the solid does not have, by the solid's topology: a face, a line that is no edge or diagonal of
 * its face, a point's edge that is no edge, a segment between vertices it lacks, a trace that its base does not offer.
 */
export function boxSectionIssues(topology: PrismTopology, section: BoxSectionSpec): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const has = (vertex: BoxVertex) => topology.vertices.includes(vertex);
  const lowerCorners = topology.faces[topology.lowerBase] ?? [];
  const triangle = topology.sides === 3;
  const inBase = (segment: readonly [BoxVertex, BoxVertex] | undefined) =>
    segment === undefined ? undefined : boxFaceSegmentKind(topology, topology.lowerBase, segment);
  const baseVertex = (vertex: BoxVertex | undefined) => vertex !== undefined && lowerCorners.includes(vertex);
  const lineTrace = (
    trace: string,
    section: { traceSegment?: readonly [BoxVertex, BoxVertex] | undefined; traceVertex?: BoxVertex | undefined },
  ) =>
    trace === 'diagonal'
      ? inBase(section.traceSegment) === 'diagonal'
      : trace === 'midline'
        ? triangle && inBase(section.traceSegment) === 'edge'
        : trace === 'median' || trace === 'height' || trace === 'bisector'
          ? triangle && baseVertex(section.traceVertex)
          : undefined;
  switch (section.type) {
    case 'face-parallel':
      if (section.face !== undefined && topology.faces[section.face] === undefined) {
        issues.push({ path: 'face', message: `The solid has no face ${section.face}.` });
      }
      break;
    case 'longitudinal': {
      const valid =
        topology.kind === 'prism' &&
        (section.trace === 'angle' ||
          (section.trace === 'AC' || section.trace === 'BD' ? topology.sides >= 4 : lineTrace(section.trace, section) === true));
      if (!valid) issues.push({ path: 'trace', message: `The solid offers no such longitudinal trace: ${section.trace}.` });
      break;
    }
    case 'through-apex': {
      const valid =
        topology.kind === 'pyramid' &&
        (section.trace === 'angle' ||
          (section.trace === 'edge-point'
            ? baseVertex(section.traceVertex) &&
              inBase(section.traceSegment) === 'edge' &&
              section.tracePointPercent !== undefined
            : section.trace === 'height-edge'
              ? baseVertex(section.traceVertex)
              : lineTrace(section.trace, section) === true));
      if (!valid) issues.push({ path: 'trace', message: `The pyramid offers no such trace through its apex: ${section.trace}.` });
      break;
    }
    case 'through-line':
      if (topology.faces[section.face] === undefined)
        issues.push({ path: 'face', message: `The solid has no face ${section.face}.` });
      else if (boxFaceSegmentKind(topology, section.face, section.line) === undefined) {
        issues.push({ path: 'line', message: 'The line is no edge or diagonal of the face.' });
      }
      if (section.method === 'point' && section.pointEdge !== undefined && !isEdgeOf(topology, section.pointEdge)) {
        issues.push({ path: 'pointEdge', message: 'The point lies on no edge of the solid.' });
      }
      break;
    case 'inclined':
      if (section.normalAlong !== undefined && !section.normalAlong.every(has)) {
        issues.push({ path: 'normalAlong', message: 'The segment joins vertices the solid does not have.' });
      }
      if (section.parallelTo !== undefined) {
        const [first, second] = section.parallelTo;
        const skew = first.every((vertex) => !second.includes(vertex));
        if (!isEdgeOf(topology, first) || !isEdgeOf(topology, second) || !skew) {
          issues.push({ path: 'parallelTo', message: 'The plane is parallel to two edges that do not share a vertex.' });
        }
      }
      break;
  }
  return issues;
}

export const BOX_SECTION_TYPES = ['face-parallel', 'longitudinal', 'through-apex', 'through-line', 'inclined'] as const;

export const sectionSchema = z.discriminatedUnion('type', [
  parallelSectionSchema,
  verticalSectionSchema,
  obliqueSectionSchema,
  apexSectionSchema,
  horizontalSectionSchema,
  axisParallelSectionSchema,
  faceParallelSectionSchema,
  longitudinalSectionSchema,
  throughApexSectionSchema,
  throughLineSectionSchema,
  inclinedSectionSchema,
]);

export type Section = z.infer<typeof sectionSchema>;
