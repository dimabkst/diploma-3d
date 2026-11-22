import {
  apexChordCrossesBase,
  ballOffsetLimitPercent,
  ballRadiusMm,
  CONSTRAINT_ROUNDOFF_MM,
  type ConnectorFeasibility,
  coneApexAngleBounds,
  coneApexChord,
  cutOfSection,
  type DovetailIssue,
  defaultRoundConnector,
  defaultTwist,
  dovetailFeasibility,
  hasFeasibleValues,
  type Interval,
  isApexChordUsable,
  type MagnetIssue,
  type MagnetPlan,
  type ModelSettingsInput,
  normalizeRoundConnector,
  normalizeTwist,
  obliquePlaneContainsAxis,
  obliqueSplitReach,
  type ParameterBounds,
  type ParameterFeasibility,
  type PlateCut,
  planMagnets,
  plateSection,
  plateThicknessRange,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorIssue,
  type RoundConnectorOutcome,
  type RoundShape,
  roundConnectorFeasibility,
  roundDimensionsMm,
  type SectionedShape,
  satisfies,
  sectionOffsetMm,
  sectionPlateGeometry,
  type TwistIssue,
  type TwistOutcome,
  twistFeasibility,
  twistSupported,
  verticalOffsetLimitPercent,
} from '@diploma-3d/engine';
import {
  APEX_INCLINATION_MAX_DEG,
  apexRatioSchema,
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  baseAngleSchema,
  baseShiftSchema,
  type ConeShape,
  type ConnectorProfile,
  type ConnectorType,
  DEFAULT_CONNECTOR_PROFILE,
  DEFAULT_DOVETAIL,
  DEFAULT_DOWEL_CLEARANCES_MM,
  DEFAULT_LONGEST_DIMENSION_MM,
  DEFAULT_MAGNET,
  DEFAULT_OBLIQUE_SECTION,
  DEFAULT_PARALLELOGRAM_BASE,
  DEFAULT_PLUG_CLEARANCE_MM,
  DEFAULT_ROUND_CONNECTOR,
  DEFAULT_SECTION_OFFSET_PERCENT,
  DEFAULT_SECTION_PLATE,
  DEFAULT_SECTION_POSITION_PERCENT,
  DEFAULT_TRAPEZOID_BASE,
  DEFAULT_TRIANGLE_BASE,
  DEFAULT_TWIST,
  DIAMETRAL_CLEARANCE_LIMITS,
  DOVETAIL_CLEARANCE_LIMITS,
  type DovetailEntrance,
  defaultModelSpecs,
  dovetailConnectorSchema,
  isWithinMinimumInclination,
  longestDimensionSchema,
  MAGNET_LIMITS,
  MAX_LONGEST_DIMENSION_MM,
  type MagnetConnector,
  MIN_INCLINATION_DEG,
  MIN_LONGEST_DIMENSION_MM,
  type ModelSpec,
  type ModelSpecInput,
  magnetPocketMm,
  modelSpecSchema,
  OBLIQUE_DIRECTION_LIMITS,
  OBLIQUE_INCLINATION_LIMITS,
  offsetRatioSchema,
  type PrismBaseSides,
  type PrismBaseType,
  type PyramidBaseSides,
  type PyramidBaseType,
  RATIO_LIMITS,
  ROUND_HEIGHT_LIMITS,
  ROUND_OFFSET_LIMITS,
  type RoundConnector,
  ratioSchema,
  roundHeightRatioSchema,
  roundOffsetSchema,
  SECTION_PLATE_MARGIN_LIMITS,
  SECTION_PLATE_THICKNESS_LIMITS,
  SECTION_POSITION_LIMITS,
  type Section,
  type SectionType,
  type ShapeKind,
  sectionPositionSchema,
  TILT_OFFSET_LIMITS,
  TWIST_AXIAL_CLEARANCE_LIMITS,
  TWIST_CLEARANCE_LIMITS,
  type TwistConnector,
} from '@diploma-3d/schema';
import { formatDecimal, formatSteppedDecimal, halfSumDecimal, parseDecimal, snapDecimal } from '../decimal.ts';
import {
  type ConnectorScale,
  connectorScaleOf,
  connectorUnits,
  cylinderConnectorScale,
  formatMillimetres,
  formatPhysical,
  percentRange,
  physicalRange,
  planeAngleRange,
  type ScaledConnectorKey,
} from './connectorScale.ts';
import {
  anglesFromOffsets,
  DIRECTION_LIMITS,
  type InclinationKey,
  inclinationRange,
  initialTiltModes,
  isInclination,
  offsetRange,
  offsetsFromAngles,
  RIGHT_INCLINATION_DEG,
  type TiltModes,
  type TiltSolid,
  tiltKeys,
} from './tilt.ts';

// The default solids are right, so the angle mode starts at 90° with the direction along +X.
const RIGHT_INCLINATION_TEXT = formatDecimal(RIGHT_INCLINATION_DEG);
const INITIAL_DIRECTION_TEXT = formatDecimal(DIRECTION_LIMITS.min);

/**
 * Numeric fields: the shape ratios, kept per shape so that switching shapes never carries a value into a different
 * meaning, and the print size, shared by every shape.
 */
export type ParameterKey =
  | 'printSizeMm'
  | 'cuboidWidthRatio'
  | 'cuboidHeightRatio'
  | 'parallelepipedBaseSideRatio'
  | 'parallelepipedHeightRatio'
  | 'parallelepipedBaseAngleDeg'
  | 'parallelepipedOffsetXRatio'
  | 'parallelepipedOffsetYRatio'
  | 'parallelepipedInclinationDeg'
  | 'parallelepipedDirectionDeg'
  | 'prismHeightRatio'
  | 'prismOffsetXRatio'
  | 'prismOffsetYRatio'
  | 'prismInclinationDeg'
  | 'prismDirectionDeg'
  | 'prismTriangleSideRatio'
  | 'prismTriangleAngleDeg'
  | 'prismTrapezoidSideRatio'
  | 'prismTrapezoidHeightRatio'
  | 'prismTrapezoidShiftRatio'
  | 'pyramidHeightRatio'
  | 'pyramidApexXRatio'
  | 'pyramidApexYRatio'
  | 'pyramidInclinationDeg'
  | 'pyramidDirectionDeg'
  | 'pyramidTriangleSideRatio'
  | 'pyramidTriangleAngleDeg'
  | 'pyramidParallelogramSideRatio'
  | 'pyramidParallelogramAngleDeg'
  | 'pyramidTrapezoidSideRatio'
  | 'pyramidTrapezoidHeightRatio'
  | 'pyramidTrapezoidShiftRatio'
  | 'cylinderHeightRatio'
  | 'cylinderOffsetRatio'
  | 'cylinderInclinationDeg'
  | 'cylinderSectionPercent'
  | 'cylinderSectionOffsetPercent'
  | 'cylinderObliquePositionPercent'
  | 'cylinderObliqueInclinationDeg'
  | 'cylinderObliqueDirectionDeg'
  | 'cylinderDovetailSize'
  | 'cylinderDovetailLengthPercent'
  | 'cylinderDovetailClearanceMm'
  | 'cylinderRoundSpacingPercent'
  | 'cylinderRoundDiameter'
  | 'cylinderRoundDepth'
  | 'cylinderPlugClearanceMm'
  | 'cylinderDowelLowerClearanceMm'
  | 'cylinderDowelUpperClearanceMm'
  | 'cylinderTwistSizeMm'
  | 'cylinderTwistClearanceMm'
  | 'cylinderTwistAxialMm'
  | 'cylinderPlateThicknessMm'
  | 'cylinderPlateMarginMm'
  | 'coneHeightRatio'
  | 'coneOffsetRatio'
  | 'coneInclinationDeg'
  | 'coneSectionPercent'
  | 'conePlateThicknessMm'
  | 'conePlateMarginMm'
  | 'coneSectionOffsetPercent'
  | 'coneObliquePositionPercent'
  | 'coneObliqueInclinationDeg'
  | 'coneObliqueDirectionDeg'
  | 'coneApexInclinationDeg'
  | 'coneApexDirectionDeg'
  | 'coneDovetailSize'
  | 'coneDovetailLengthPercent'
  | 'coneDovetailClearanceMm'
  | 'coneRoundSpacingPercent'
  | 'coneRoundDiameter'
  | 'coneRoundDepth'
  | 'conePlugClearanceMm'
  | 'coneDowelLowerClearanceMm'
  | 'coneDowelUpperClearanceMm'
  | 'ballSectionOffsetPercent'
  | 'ballPlateThicknessMm'
  | 'ballPlateMarginMm'
  | 'ballDovetailSize'
  | 'ballDovetailLengthPercent'
  | 'ballDovetailClearanceMm'
  | 'ballRoundSpacingPercent'
  | 'ballRoundDiameter'
  | 'ballRoundDepth'
  | 'ballPlugClearanceMm'
  | 'ballDowelLowerClearanceMm'
  | 'ballDowelUpperClearanceMm'
  | MagnetKey;

/** The solids whose cuts offer magnet pockets, each with its own settings, as every connector has. */
type MagnetSolid = 'cylinder' | 'cone' | 'ball';

/** The magnet pockets' fields, and the setting of the specification each one sets. */
const MAGNET_FIELDS = {
  Count: 'count',
  DiameterMm: 'magnetDiameterMm',
  ThicknessMm: 'magnetThicknessMm',
  DiameterAllowanceMm: 'diameterAllowanceMm',
  DepthAllowanceMm: 'depthAllowanceMm',
} as const satisfies Record<string, keyof typeof MAGNET_LIMITS>;

type MagnetField = keyof typeof MAGNET_FIELDS;

/** A solid's magnet setting, all of them physical millimetres but the count. */
export type MagnetKey = `${MagnetSolid}Magnet${MagnetField}`;

export type MagnetKeys = { readonly [field in MagnetField]: `${MagnetSolid}Magnet${field}` };

const magnetKeysOf = (solid: MagnetSolid): MagnetKeys =>
  Object.fromEntries(Object.keys(MAGNET_FIELDS).map((field) => [field, `${solid}Magnet${field}`])) as unknown as MagnetKeys;

/** Each field's texts at the defaults, for one solid. */
const magnetTexts = (solid: MagnetSolid) =>
  Object.fromEntries(
    (Object.entries(MAGNET_FIELDS) as [MagnetField, keyof typeof MAGNET_LIMITS][]).map(([field, setting]) => [
      `${solid}Magnet${field}`,
      formatDecimal(DEFAULT_MAGNET[setting]),
    ]),
  ) as Record<MagnetKey, string>;

/** Raw field text, kept separately from parsed values so that empty and partially typed input stays editable. */
export type ParameterTexts = Record<ParameterKey, string>;

/** A plane section of the solid, or none; a plane through a cone's apex is an oblique one, with its own further choice. */
export type SectionChoice = 'none' | Exclude<SectionType, 'oblique-apex'>;

/** What a cone's oblique plane passes through. */
export type ObliqueThrough = 'axis' | 'apex';

/** A connector joining the parts of the section, or flat cut faces. */
export type ConnectorChoice = 'none' | ConnectorType;

/** Parameters picked from fixed options, and switches. */
export type ParameterChoices = {
  prismBaseType: PrismBaseType;
  prismBaseSides: PrismBaseSides;
  pyramidBaseType: PyramidBaseType;
  pyramidBaseSides: PyramidBaseSides;
  cylinderSection: SectionChoice;
  cylinderConnector: ConnectorChoice;
  /** Where the dovetail's groove opens, in the model's own orientation; shared by the solid's cuts, like its other settings. */
  cylinderDovetailEntrance: DovetailEntrance;
  /** One round connector at the centre, or a keyed pair; shared by plugs and dowels, as their cross-section is. */
  cylinderRoundCount: 1 | 2;
  cylinderRoundProfile: ConnectorProfile;
  /** Whether the preview moves the parts of the section apart; it changes neither the geometry nor the print file. */
  cylinderPartsSeparated: boolean;
  /** Whether the cut removes a section plate, printed as a third object between the parts. */
  cylinderPlate: boolean;
  coneSection: SectionChoice;
  coneConnector: ConnectorChoice;
  coneDovetailEntrance: DovetailEntrance;
  coneRoundCount: 1 | 2;
  coneRoundProfile: ConnectorProfile;
  conePartsSeparated: boolean;
  /** Whether a cut parallel to the base removes a section plate, printed as a third object between the parts. */
  conePlate: boolean;
  coneObliqueThrough: ObliqueThrough;
  /** Whether a plane through the apex has its first valid angle yet, which depends on the cone when it is first chosen. */
  coneApexStarted: boolean;
  ballSection: SectionChoice;
  ballConnector: ConnectorChoice;
  ballDovetailEntrance: DovetailEntrance;
  ballRoundCount: 1 | 2;
  ballRoundProfile: ConnectorProfile;
  ballPartsSeparated: boolean;
  ballPlate: boolean;
};

/** The switches among the choices. */
export type ToggleKey =
  | 'cylinderPartsSeparated'
  | 'cylinderPlate'
  | 'conePartsSeparated'
  | 'conePlate'
  | 'ballPartsSeparated'
  | 'ballPlate';

/** The choices picked from options. */
export type ChoiceKey = Exclude<keyof ParameterChoices, ToggleKey | 'coneApexStarted'>;

export type ParameterErrors = Partial<Record<ParameterKey, string>>;

/** Validated field values; the same numbers drive the controls and, when every field is valid, the specification. */
export type ParameterValues = Partial<Record<ParameterKey, number>>;

/**
 * Full-precision values behind texts that were set from a computed number, such as offsets derived from angles. A value
 * applies while its field still shows the text it was formatted to; editing the field replaces it with the typed one.
 * Rounded display texts therefore never feed back into the model.
 */
export type ParameterExact = Partial<Record<ParameterKey, number>>;

/**
 * Where each solid's round connector was last edited by hand: the context of `ConnectorStatus` at that moment. A solid
 * without an entry has an untouched connector, whose dimensions follow from what its section offers. In the context of the
 * last edit the stored values count as they are, so that a typed value out of range is that field's error; in any other,
 * they are corrected if they no longer fit, without being overwritten, so that the former values return with the former
 * model and nothing shrinks step by step while a value is dragged or typed.
 */
export type ConnectorEdits = Partial<Record<ShapeKind, string>>;

/** How the request reads the texts: the exact values behind them and the tilt input mode of each solid. */
export type ParameterOptions = {
  readonly exact?: ParameterExact | undefined;
  readonly tiltModes?: TiltModes | undefined;
  /**
   * The scale that phrases connector errors in millimetres while the current print size or cylinder is not valid;
   * the current one is used whenever it is.
   */
  readonly connectorScale?: ConnectorScale | undefined;
  /** Without it, as in a request made of bare texts, the stored connector values count as just typed. */
  readonly connectorEdits?: ConnectorEdits | undefined;
};

/** What became of the stored dimensions of a round connector. */
export type ConnectorStatus = {
  /** Everything a connector's fit depends on but its own dimensions: the solid, the size, the cut, the type, profile and count. */
  readonly context: string;
  /** One short sentence per dimension that had to change from its stored value. */
  readonly corrections: readonly string[];
  /** Why no usable connector fits; the model is then the plain cut, which the interface does not offer for download. */
  readonly unavailable?: string | undefined;
};

/**
 * The feasible values of a vertical plane's distance from the axis, in percent of r, and of each active connector field,
 * in millimetres, as the fields show them, with the other settings, the solid and the cut as they are: an interval, or
 * null when no value is feasible. The sliders span these intervals, and a value outside one is the field's error.
 */
export type SectionRanges = Partial<Record<ParameterKey, Interval | null>>;

export type ModelRequest = {
  readonly values: ParameterValues;
  readonly errors: ParameterErrors;
  /** Present while the solid, the size, the cut's position and every connector field are valid numbers. */
  readonly sectionRanges?: SectionRanges | undefined;
  /** Present for a round connector on a usable cut, when the request knows the edits. */
  readonly connectorStatus?: ConnectorStatus | undefined;
  /** Whether the lower base of the solid cuts the chosen section plate off, which the panel then says. */
  readonly plateClipped?: boolean | undefined;
} & (
  | {
      readonly spec: ModelSpec;
      readonly key: string;
      /**
       * What the 3MF records besides the specification, from this same request: how the inclination was entered. It changes
       * no geometry, so that it is not part of the key.
       */
      readonly settingsInput: ModelSettingsInput;
    }
  | { readonly spec: undefined; readonly key: undefined; readonly settingsInput?: undefined }
);

/** A twist connector's stored size before anything fits it to a section: only a request without edits reads it. */
const TWIST_PLACEHOLDER_SIZE_MM = 18;

/** The texts every field starts with, and returns to on reset: the single source of the defaults in the interface. */
export const initialParameterTexts = (): ParameterTexts => ({
  printSizeMm: formatDecimal(DEFAULT_LONGEST_DIMENSION_MM),
  cuboidWidthRatio: formatDecimal(defaultModelSpecs.cuboid.shape.widthRatio),
  cuboidHeightRatio: formatDecimal(defaultModelSpecs.cuboid.shape.heightRatio),
  parallelepipedBaseSideRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.baseSideRatio),
  parallelepipedHeightRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.heightRatio),
  parallelepipedBaseAngleDeg: formatDecimal(defaultModelSpecs.parallelepiped.shape.baseAngleDeg),
  parallelepipedOffsetXRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.offsetXRatio),
  parallelepipedOffsetYRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.offsetYRatio),
  parallelepipedInclinationDeg: RIGHT_INCLINATION_TEXT,
  parallelepipedDirectionDeg: INITIAL_DIRECTION_TEXT,
  prismHeightRatio: formatDecimal(defaultModelSpecs.prism.shape.heightRatio),
  prismOffsetXRatio: formatDecimal(defaultModelSpecs.prism.shape.offsetXRatio),
  prismOffsetYRatio: formatDecimal(defaultModelSpecs.prism.shape.offsetYRatio),
  prismInclinationDeg: RIGHT_INCLINATION_TEXT,
  prismDirectionDeg: INITIAL_DIRECTION_TEXT,
  prismTriangleSideRatio: formatDecimal(DEFAULT_TRIANGLE_BASE.baseSideRatio),
  prismTriangleAngleDeg: formatDecimal(DEFAULT_TRIANGLE_BASE.baseAngleDeg),
  prismTrapezoidSideRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.parallelSideRatio),
  prismTrapezoidHeightRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.baseHeightRatio),
  prismTrapezoidShiftRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.baseShiftRatio),
  pyramidHeightRatio: formatDecimal(defaultModelSpecs.pyramid.shape.heightRatio),
  pyramidApexXRatio: formatDecimal(defaultModelSpecs.pyramid.shape.apexXRatio),
  pyramidApexYRatio: formatDecimal(defaultModelSpecs.pyramid.shape.apexYRatio),
  pyramidInclinationDeg: RIGHT_INCLINATION_TEXT,
  pyramidDirectionDeg: INITIAL_DIRECTION_TEXT,
  pyramidTriangleSideRatio: formatDecimal(DEFAULT_TRIANGLE_BASE.baseSideRatio),
  pyramidTriangleAngleDeg: formatDecimal(DEFAULT_TRIANGLE_BASE.baseAngleDeg),
  pyramidParallelogramSideRatio: formatDecimal(DEFAULT_PARALLELOGRAM_BASE.baseSideRatio),
  pyramidParallelogramAngleDeg: formatDecimal(DEFAULT_PARALLELOGRAM_BASE.baseAngleDeg),
  pyramidTrapezoidSideRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.parallelSideRatio),
  pyramidTrapezoidHeightRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.baseHeightRatio),
  pyramidTrapezoidShiftRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.baseShiftRatio),
  cylinderHeightRatio: formatDecimal(defaultModelSpecs.cylinder.shape.heightRatio),
  cylinderOffsetRatio: formatDecimal(defaultModelSpecs.cylinder.shape.offsetRatio),
  cylinderInclinationDeg: RIGHT_INCLINATION_TEXT,
  coneHeightRatio: formatDecimal(defaultModelSpecs.cone.shape.heightRatio),
  coneOffsetRatio: formatDecimal(defaultModelSpecs.cone.shape.offsetRatio),
  coneInclinationDeg: RIGHT_INCLINATION_TEXT,
  cylinderSectionPercent: formatDecimal(DEFAULT_SECTION_POSITION_PERCENT),
  cylinderSectionOffsetPercent: formatDecimal(DEFAULT_SECTION_OFFSET_PERCENT),
  cylinderObliquePositionPercent: formatDecimal(DEFAULT_OBLIQUE_SECTION.positionPercent),
  cylinderObliqueInclinationDeg: formatDecimal(DEFAULT_OBLIQUE_SECTION.inclinationDeg),
  cylinderObliqueDirectionDeg: formatDecimal(DEFAULT_OBLIQUE_SECTION.directionDeg),
  cylinderDovetailSize: formatDecimal(DEFAULT_DOVETAIL.sizeFactor),
  cylinderDovetailLengthPercent: formatDecimal(DEFAULT_DOVETAIL.lengthPercent),
  cylinderDovetailClearanceMm: formatDecimal(DEFAULT_DOVETAIL.clearanceMm),
  cylinderRoundSpacingPercent: formatDecimal(DEFAULT_ROUND_CONNECTOR.spacingPercent),
  cylinderRoundDiameter: formatDecimal(DEFAULT_ROUND_CONNECTOR.diameterFactor),
  cylinderRoundDepth: formatDecimal(DEFAULT_ROUND_CONNECTOR.depthFactor),
  cylinderPlugClearanceMm: formatDecimal(DEFAULT_PLUG_CLEARANCE_MM),
  cylinderDowelLowerClearanceMm: formatDecimal(DEFAULT_DOWEL_CLEARANCES_MM.lower),
  cylinderDowelUpperClearanceMm: formatDecimal(DEFAULT_DOWEL_CLEARANCES_MM.upper),
  cylinderTwistSizeMm: formatDecimal(TWIST_PLACEHOLDER_SIZE_MM),
  cylinderTwistClearanceMm: formatDecimal(DEFAULT_TWIST.holeClearanceMm),
  cylinderTwistAxialMm: formatDecimal(DEFAULT_TWIST.axialClearanceMm),
  cylinderPlateThicknessMm: formatDecimal(DEFAULT_SECTION_PLATE.thicknessMm),
  cylinderPlateMarginMm: formatDecimal(DEFAULT_SECTION_PLATE.marginMm),
  coneSectionPercent: formatDecimal(DEFAULT_SECTION_POSITION_PERCENT),
  conePlateThicknessMm: formatDecimal(DEFAULT_SECTION_PLATE.thicknessMm),
  conePlateMarginMm: formatDecimal(DEFAULT_SECTION_PLATE.marginMm),
  coneSectionOffsetPercent: formatDecimal(DEFAULT_SECTION_OFFSET_PERCENT),
  coneObliquePositionPercent: formatDecimal(DEFAULT_OBLIQUE_SECTION.positionPercent),
  coneObliqueInclinationDeg: formatDecimal(DEFAULT_OBLIQUE_SECTION.inclinationDeg),
  coneObliqueDirectionDeg: formatDecimal(DEFAULT_OBLIQUE_SECTION.directionDeg),
  coneApexInclinationDeg: formatDecimal(APEX_INCLINATION_MAX_DEG),
  coneApexDirectionDeg: formatDecimal(DEFAULT_OBLIQUE_SECTION.directionDeg),
  coneDovetailSize: formatDecimal(DEFAULT_DOVETAIL.sizeFactor),
  coneDovetailLengthPercent: formatDecimal(DEFAULT_DOVETAIL.lengthPercent),
  coneDovetailClearanceMm: formatDecimal(DEFAULT_DOVETAIL.clearanceMm),
  coneRoundSpacingPercent: formatDecimal(DEFAULT_ROUND_CONNECTOR.spacingPercent),
  coneRoundDiameter: formatDecimal(DEFAULT_ROUND_CONNECTOR.diameterFactor),
  coneRoundDepth: formatDecimal(DEFAULT_ROUND_CONNECTOR.depthFactor),
  conePlugClearanceMm: formatDecimal(DEFAULT_PLUG_CLEARANCE_MM),
  coneDowelLowerClearanceMm: formatDecimal(DEFAULT_DOWEL_CLEARANCES_MM.lower),
  coneDowelUpperClearanceMm: formatDecimal(DEFAULT_DOWEL_CLEARANCES_MM.upper),
  ballSectionOffsetPercent: formatDecimal(DEFAULT_SECTION_OFFSET_PERCENT),
  ballPlateThicknessMm: formatDecimal(DEFAULT_SECTION_PLATE.thicknessMm),
  ballPlateMarginMm: formatDecimal(DEFAULT_SECTION_PLATE.marginMm),
  ballDovetailSize: formatDecimal(DEFAULT_DOVETAIL.sizeFactor),
  ballDovetailLengthPercent: formatDecimal(DEFAULT_DOVETAIL.lengthPercent),
  ballDovetailClearanceMm: formatDecimal(DEFAULT_DOVETAIL.clearanceMm),
  ballRoundSpacingPercent: formatDecimal(DEFAULT_ROUND_CONNECTOR.spacingPercent),
  ballRoundDiameter: formatDecimal(DEFAULT_ROUND_CONNECTOR.diameterFactor),
  ballRoundDepth: formatDecimal(DEFAULT_ROUND_CONNECTOR.depthFactor),
  ballPlugClearanceMm: formatDecimal(DEFAULT_PLUG_CLEARANCE_MM),
  ballDowelLowerClearanceMm: formatDecimal(DEFAULT_DOWEL_CLEARANCES_MM.lower),
  ballDowelUpperClearanceMm: formatDecimal(DEFAULT_DOWEL_CLEARANCES_MM.upper),
  ...magnetTexts('cylinder'),
  ...magnetTexts('cone'),
  ...magnetTexts('ball'),
});

export const initialParameterChoices = (): ParameterChoices => ({
  prismBaseType: defaultModelSpecs.prism.shape.baseType,
  prismBaseSides: defaultModelSpecs.prism.shape.baseSides,
  pyramidBaseType: defaultModelSpecs.pyramid.shape.baseType,
  pyramidBaseSides: defaultModelSpecs.pyramid.shape.baseSides,
  // The section is optional; once it is chosen, the parts start apart so that the cut faces show.
  cylinderSection: 'none',
  cylinderConnector: 'none',
  cylinderDovetailEntrance: 'standard',
  cylinderRoundCount: DEFAULT_ROUND_CONNECTOR.count,
  cylinderRoundProfile: DEFAULT_CONNECTOR_PROFILE,
  cylinderPartsSeparated: true,
  cylinderPlate: false,
  coneSection: 'none',
  coneConnector: 'none',
  coneDovetailEntrance: 'standard',
  coneRoundCount: DEFAULT_ROUND_CONNECTOR.count,
  coneRoundProfile: DEFAULT_CONNECTOR_PROFILE,
  conePartsSeparated: true,
  conePlate: false,
  coneObliqueThrough: 'axis',
  coneApexStarted: false,
  ballSection: 'none',
  ballConnector: 'none',
  ballDovetailEntrance: 'standard',
  ballRoundCount: DEFAULT_ROUND_CONNECTOR.count,
  ballRoundProfile: DEFAULT_CONNECTOR_PROFILE,
  ballPartsSeparated: true,
  ballPlate: false,
});

type Validation = { value: number } | { error: string };

/**
 * Parses the text, or takes the exact value behind it, and checks it against the schema; the limits, example and unit
 * only phrase the errors.
 */
function validateNumber(
  text: string,
  schema: { safeParse(value: number): { success: boolean } },
  limits: { readonly min: number; readonly max: number },
  example: string,
  unit = '',
  exact?: number,
): Validation {
  const read = readNumber(text, example, exact);
  if ('error' in read) return read;
  return schema.safeParse(read.value).success ? read : { error: rangeMessage(limits, unit) };
}

const rangeMessage = ({ min, max }: { readonly min: number; readonly max: number }, unit = ''): string =>
  `Допустимі значення — від ${formatDecimal(min)}${unit} до ${formatDecimal(max)}${unit}.`;

/** The finite number in the text, or the exact value behind it, without any range check. */
function readNumber(text: string, example: string, exact?: number): Validation {
  if (exact !== undefined) return { value: exact };
  if (text.trim() === '') return { error: 'Введіть значення.' };
  const value = parseDecimal(text);
  if (value === undefined) return { error: `Введіть число, наприклад ${example}.` };
  // A plain decimal with hundreds of digits parses to Infinity.
  return Number.isFinite(value) ? { value } : { error: 'Число надто велике.' };
}

/** An inclusive range in the shape of a schema, for limits that have no schema of their own. */
const inclusiveRange = (limits: { readonly min: number; readonly max: number }) => ({
  safeParse: (value: number) => ({ success: value >= limits.min && value <= limits.max }),
});

export const validateRatio = (text: string, exact?: number): Validation =>
  validateNumber(text, ratioSchema, RATIO_LIMITS, '1,5', '', exact);

/** h/r of a cylinder or cone. */
export const validateRoundHeight = (text: string, exact?: number): Validation =>
  validateNumber(text, roundHeightRatioSchema, ROUND_HEIGHT_LIMITS, '2', '', exact);

export const validateAngle = (text: string, exact?: number): Validation =>
  validateNumber(text, baseAngleSchema, BASE_ANGLE_LIMITS, '60', '°', exact);

/** An offset of an upper base or apex on its own; together with the other offset and the height it must also keep β ≥ 15°. */
export const validateOffset = (text: string, exact?: number): Validation =>
  validateNumber(text, offsetRatioSchema, TILT_OFFSET_LIMITS, '-0,5', '', exact);

export const validateShift = (text: string, exact?: number): Validation =>
  validateNumber(text, baseShiftSchema, BASE_SHIFT_LIMITS, '-0,5', '', exact);

export const validateApex = (text: string, exact?: number): Validation =>
  validateNumber(text, apexRatioSchema, TILT_OFFSET_LIMITS, '-0,5', '', exact);

export const validateRoundOffset = (text: string, exact?: number): Validation =>
  validateNumber(text, roundOffsetSchema, ROUND_OFFSET_LIMITS, '0,5', '', exact);

/** The direction of a displacement, counterclockwise from +X as seen from above; 360° is the same as 0°. */
export const validateDirection = (text: string, exact?: number): Validation =>
  validateNumber(text, inclusiveRange(DIRECTION_LIMITS), DIRECTION_LIMITS, '90', '°', exact);

/** The cutting plane's distance from the lower base, in percent of the height. */
export const validateSectionPosition = (text: string, exact?: number): Validation =>
  validateNumber(text, sectionPositionSchema, SECTION_POSITION_LIMITS, '50', ' %', exact);

/** An oblique plane's angle to the base plane: exactly horizontal and vertical planes have their own modes. */
export const validateObliqueInclination = (text: string, exact?: number): Validation =>
  validateNumber(text, inclusiveRange(OBLIQUE_INCLINATION_LIMITS), OBLIQUE_INCLINATION_LIMITS, '45', '°', exact);

/** The horizontal direction an oblique plane rises along, from +X towards +Y; 360° is the same as 0°. */
export const validateObliqueDirection = (text: string, exact?: number): Validation =>
  validateNumber(text, inclusiveRange(OBLIQUE_DIRECTION_LIMITS), OBLIQUE_DIRECTION_LIMITS, '90', '°', exact);

/** A plane through the apex: any angle up to the vertical here; the cone and the direction narrow it, see `sectionChecks`. */
export const validateApexInclination = (text: string, exact?: number): Validation => {
  const read = readNumber(text, '75', exact);
  if ('error' in read) return read;
  return read.value > 0 && read.value <= APEX_INCLINATION_MAX_DEG
    ? read
    : { error: `Кут має бути більшим за 0° і не більшим за ${APEX_INCLINATION_MAX_DEG}°.` };
};

/** The gap between mating surfaces of a dovetail, in millimetres, within its calibration window. */
export const validateDovetailClearance = (text: string, exact?: number): Validation =>
  validateNumber(text, dovetailConnectorSchema.shape.clearanceMm, DOVETAIL_CLEARANCE_LIMITS, '0,2', ' мм', exact);

/**
 * A connector dimension stored as a multiplier or percentage: any number here. The cylinder, the cut and the other
 * settings bound it; see `connectorChecks`.
 */
export const validateConnectorDimension = (text: string, exact?: number): Validation => readNumber(text, '1', exact);

/**
 * A vertical plane's signed distance from the axis in percent of r: any number here. The solid limits it; see
 * `sectionChecks`.
 */
export const validateSectionOffset = (text: string, exact?: number): Validation => readNumber(text, '25', exact);

/** A hole's enlargement Δ in millimetres: each of its side surfaces lies Δ/2 outside the pin's. */
export const validateDiametralClearance = (text: string, exact?: number): Validation =>
  validateNumber(text, inclusiveRange(DIAMETRAL_CLEARANCE_LIMITS), DIAMETRAL_CLEARANCE_LIMITS, '0,2', ' мм', exact);

export const validatePrintSize = (text: string): Validation =>
  validateNumber(
    text,
    longestDimensionSchema,
    { min: MIN_LONGEST_DIMENSION_MM, max: MAX_LONGEST_DIMENSION_MM },
    formatDecimal(DEFAULT_LONGEST_DIMENSION_MM),
    ' мм',
  );

/** A section plate's thickness and margin within their windows; the solid and the cut narrow the thickness further. */
const validatePlateThickness = (text: string, exact?: number): Validation =>
  validateNumber(text, inclusiveRange(SECTION_PLATE_THICKNESS_LIMITS), SECTION_PLATE_THICKNESS_LIMITS, '1,6', ' мм', exact);
const validatePlateMargin = (text: string, exact?: number): Validation =>
  validateNumber(text, inclusiveRange(SECTION_PLATE_MARGIN_LIMITS), SECTION_PLATE_MARGIN_LIMITS, '10', ' мм', exact);

/**
 * A magnet setting within its window, in printed millimetres that the model's size never changes; the count a whole number of
 * pairs. The solid and the cut decide what actually fits, see `magnetChecks`.
 */
export function validateMagnetField(field: MagnetField, text: string, exact?: number): Validation {
  const limits = MAGNET_LIMITS[MAGNET_FIELDS[field]];
  const read = readNumber(text, formatDecimal(DEFAULT_MAGNET[MAGNET_FIELDS[field]]), exact);
  if ('error' in read) return read;
  if (field === 'Count' && !Number.isInteger(read.value)) {
    return { error: `Введіть ціле число пар від ${limits.min} до ${limits.max}.` };
  }
  return read.value >= limits.min && read.value <= limits.max
    ? read
    : { error: rangeMessage(limits, field === 'Count' ? '' : ' мм') };
}

const magnetValidators = (solid: MagnetSolid) =>
  Object.fromEntries(
    (Object.keys(MAGNET_FIELDS) as MagnetField[]).map((field) => [
      `${solid}Magnet${field}`,
      (text: string, exact?: number) => validateMagnetField(field, text, exact),
    ]),
  ) as Record<MagnetKey, (text: string, exact?: number) => Validation>;

/** Every field validated on its own; inclinations depend on the height and direction and are checked with them. */
type IndependentKey = Exclude<ParameterKey, InclinationKey>;

const validators: Readonly<Record<IndependentKey, (text: string, exact?: number) => Validation>> = {
  printSizeMm: validatePrintSize,
  cuboidWidthRatio: validateRatio,
  cuboidHeightRatio: validateRatio,
  parallelepipedBaseSideRatio: validateRatio,
  parallelepipedHeightRatio: validateRatio,
  parallelepipedBaseAngleDeg: validateAngle,
  parallelepipedOffsetXRatio: validateOffset,
  parallelepipedOffsetYRatio: validateOffset,
  parallelepipedDirectionDeg: validateDirection,
  prismHeightRatio: validateRatio,
  prismOffsetXRatio: validateOffset,
  prismOffsetYRatio: validateOffset,
  prismDirectionDeg: validateDirection,
  prismTriangleSideRatio: validateRatio,
  prismTriangleAngleDeg: validateAngle,
  prismTrapezoidSideRatio: validateRatio,
  prismTrapezoidHeightRatio: validateRatio,
  prismTrapezoidShiftRatio: validateShift,
  pyramidHeightRatio: validateRatio,
  pyramidApexXRatio: validateApex,
  pyramidApexYRatio: validateApex,
  pyramidDirectionDeg: validateDirection,
  pyramidTriangleSideRatio: validateRatio,
  pyramidTriangleAngleDeg: validateAngle,
  pyramidParallelogramSideRatio: validateRatio,
  pyramidParallelogramAngleDeg: validateAngle,
  pyramidTrapezoidSideRatio: validateRatio,
  pyramidTrapezoidHeightRatio: validateRatio,
  pyramidTrapezoidShiftRatio: validateShift,
  cylinderHeightRatio: validateRoundHeight,
  cylinderOffsetRatio: validateRoundOffset,
  coneHeightRatio: validateRoundHeight,
  coneOffsetRatio: validateRoundOffset,
  cylinderSectionPercent: validateSectionPosition,
  cylinderSectionOffsetPercent: validateSectionOffset,
  cylinderObliquePositionPercent: validateSectionPosition,
  cylinderObliqueInclinationDeg: validateObliqueInclination,
  cylinderObliqueDirectionDeg: validateObliqueDirection,
  cylinderDovetailSize: validateConnectorDimension,
  cylinderDovetailLengthPercent: validateConnectorDimension,
  cylinderDovetailClearanceMm: validateDovetailClearance,
  cylinderRoundSpacingPercent: validateConnectorDimension,
  cylinderRoundDiameter: validateConnectorDimension,
  cylinderRoundDepth: validateConnectorDimension,
  cylinderPlugClearanceMm: validateDiametralClearance,
  cylinderDowelLowerClearanceMm: validateDiametralClearance,
  cylinderDowelUpperClearanceMm: validateDiametralClearance,
  cylinderTwistSizeMm: validateConnectorDimension,
  cylinderTwistClearanceMm: (text, exact) =>
    validateNumber(text, inclusiveRange(TWIST_CLEARANCE_LIMITS), TWIST_CLEARANCE_LIMITS, '0,5', ' мм', exact),
  cylinderTwistAxialMm: (text, exact) =>
    validateNumber(text, inclusiveRange(TWIST_AXIAL_CLEARANCE_LIMITS), TWIST_AXIAL_CLEARANCE_LIMITS, '0,2', ' мм', exact),
  cylinderPlateThicknessMm: validatePlateThickness,
  cylinderPlateMarginMm: validatePlateMargin,
  coneSectionPercent: validateSectionPosition,
  conePlateThicknessMm: validatePlateThickness,
  conePlateMarginMm: validatePlateMargin,
  coneSectionOffsetPercent: validateSectionOffset,
  coneObliquePositionPercent: validateSectionPosition,
  coneObliqueInclinationDeg: validateObliqueInclination,
  coneObliqueDirectionDeg: validateObliqueDirection,
  coneApexInclinationDeg: validateApexInclination,
  coneApexDirectionDeg: validateObliqueDirection,
  coneDovetailSize: validateConnectorDimension,
  coneDovetailLengthPercent: validateConnectorDimension,
  coneDovetailClearanceMm: validateDovetailClearance,
  coneRoundSpacingPercent: validateConnectorDimension,
  coneRoundDiameter: validateConnectorDimension,
  coneRoundDepth: validateConnectorDimension,
  conePlugClearanceMm: validateDiametralClearance,
  coneDowelLowerClearanceMm: validateDiametralClearance,
  coneDowelUpperClearanceMm: validateDiametralClearance,
  ballSectionOffsetPercent: validateSectionOffset,
  ballPlateThicknessMm: validatePlateThickness,
  ballPlateMarginMm: validatePlateMargin,
  ballDovetailSize: validateConnectorDimension,
  ballDovetailLengthPercent: validateConnectorDimension,
  ballDovetailClearanceMm: validateDovetailClearance,
  ballRoundSpacingPercent: validateConnectorDimension,
  ballRoundDiameter: validateConnectorDimension,
  ballRoundDepth: validateConnectorDimension,
  ballPlugClearanceMm: validateDiametralClearance,
  ballDowelLowerClearanceMm: validateDiametralClearance,
  ballDowelUpperClearanceMm: validateDiametralClearance,
  ...magnetValidators('cylinder'),
  ...magnetValidators('cone'),
  ...magnetValidators('ball'),
};

/** The exact value behind a field's text while the field still shows that value's formatted text. */
function exactValueOf(key: ParameterKey, texts: ParameterTexts, exact: ParameterExact | undefined): number | undefined {
  const value = exact?.[key];
  return value !== undefined && texts[key] === formatDecimal(value) ? value : undefined;
}

function validateFields(
  keys: readonly IndependentKey[],
  texts: ParameterTexts,
  exact?: ParameterExact,
): { values: ParameterValues; errors: ParameterErrors } {
  const values: ParameterValues = {};
  const errors: ParameterErrors = {};
  for (const key of keys) {
    const result = validators[key](texts[key], exactValueOf(key, texts, exact));
    if ('error' in result) errors[key] = result.error;
    else values[key] = result.value;
  }
  return { values, errors };
}

type TiltResolution = {
  readonly values: ParameterValues;
  readonly errors: ParameterErrors;
  /** [X, Y] or [d] for the specification; undefined while any input is invalid. */
  readonly offsets: readonly number[] | undefined;
};

// Relative difference below which an offset computed from angles is the same offset, differing only by roundoff.
const ROUNDOFF = 1e-9;

/** The inclination's error, naming the range allowed at the current height and direction. */
function inclinationMessage(circular: boolean, range: { readonly min: number; readonly max: number }): string {
  if (range.min <= MIN_INCLINATION_DEG) return rangeMessage(range, '°');
  const context = circular ? 'цієї висоти' : 'цієї висоти й напряму';
  return `Допустимі значення за ${context} — від ${formatDecimal(range.min)}° до ${formatDecimal(range.max)}°.`;
}

/**
 * The offsets of a solid in its tilt input mode, within the same domain in both modes: every offset within its own
 * limits and the inclination β = atan2(h, hypot(X, Y)) at least 15°. In the offset mode the offsets are the fields
 * themselves, and a combination that leans flatter is reported at every offset that displaces it, with the values that
 * the other offset and the height still allow. In the angle mode the offsets follow from the height, the inclination
 * and the direction, so a new height keeps the angles; an inclination whose offsets would leave their limits is
 * reported with the range allowed at this height and direction. The computed offsets are also reported among the
 * values, where the group status and a switch back to offsets read them. Nothing is clamped.
 */
function resolveTilt(
  solid: TiltSolid,
  texts: ParameterTexts,
  { exact, tiltModes = initialTiltModes() }: ParameterOptions,
  height: number | undefined,
): TiltResolution {
  const keys = tiltKeys[solid];
  const circular = keys.direction === undefined;
  if (tiltModes[solid] === 'offset') {
    const { values, errors } = validateFields(keys.offsets, texts, exact);
    const offsets = keys.offsets.map((key) => values[key]);
    if (!offsets.every((offset) => offset !== undefined)) return { values, errors, offsets: undefined };
    if (height === undefined || isWithinMinimumInclination(height, Math.hypot(...offsets))) {
      return { values, errors, offsets };
    }
    const context = circular ? 'цієї висоти' : 'цієї висоти й другого зміщення';
    keys.offsets.forEach((key, index) => {
      if (offsets[index] === 0) return;
      const range = offsetRange(circular, height, offsets[1 - index]);
      errors[key] =
        `Кут нахилу має бути не менше ${MIN_INCLINATION_DEG}°: за ${context} допустимо ` +
        `від ${formatDecimal(range.min)} до ${formatDecimal(range.max)}.`;
      delete values[key];
    });
    return { values, errors, offsets: undefined };
  }
  const { values, errors } = validateFields(circular ? [] : [keys.direction], texts, exact);
  // Circular bases keep their displacement along +X.
  const direction = keys.direction === undefined ? DIRECTION_LIMITS.min : values[keys.direction];
  const inclination = readNumber(texts[keys.inclination], '45', exactValueOf(keys.inclination, texts, exact));
  const invalid = (message: string): TiltResolution => ({
    values,
    errors: { ...errors, [keys.inclination]: message },
    offsets: undefined,
  });
  if ('error' in inclination) return invalid(inclination.error);
  const range = inclinationRange(circular, height, direction);
  if (!isInclination(inclination.value)) return invalid(inclinationMessage(circular, range));
  // 90° needs no height: the displacement is zero whatever it is.
  const known = direction !== undefined && (height !== undefined || inclination.value === RIGHT_INCLINATION_DEG);
  if (!known) return { values: { ...values, [keys.inclination]: inclination.value }, errors, offsets: undefined };
  const computed = offsetsFromAngles(circular, height ?? 1, inclination.value, direction);
  // Angles shown for offsets that were typed with more digits than the conversion keeps give them back only to within
  // roundoff; the typed offsets, still behind the hidden fields, are used then, so switching modes changes nothing.
  const stored = validateFields(keys.offsets, texts, exact).values;
  const offsets = computed?.map((offset, index) => {
    const previous = stored[keys.offsets[index] as ParameterKey];
    return previous !== undefined && Math.abs(offset - previous) <= ROUNDOFF * Math.max(1, Math.abs(previous))
      ? previous
      : offset;
  });
  if (offsets === undefined || !isWithinMinimumInclination(height ?? 1, Math.hypot(...offsets))) {
    return invalid(inclinationMessage(circular, range));
  }
  const resolved: ParameterValues = { [keys.inclination]: inclination.value };
  keys.offsets.forEach((key, index) => {
    resolved[key] = offsets[index] ?? 0;
  });
  return { values: { ...values, ...resolved }, errors, offsets };
}

type ShapeInput = ModelSpecInput['shape'];

/** The validated fields of a shape, and the shape itself once all of them are valid. */
type ShapeResolution = {
  readonly values: ParameterValues;
  readonly errors: ParameterErrors;
  readonly shape: ShapeInput | undefined;
};

/**
 * Turns the selected shape, field texts and choices into a validated specification, or field errors when it is not
 * valid. Only the fields of the selected shape and the shared print size are read; the size scales the shape uniformly.
 * A displacement entered as angles becomes the same offsets as one entered directly, so both feed the same model.
 */
export function resolveModelRequest(
  kind: ShapeKind,
  texts: ParameterTexts,
  choices: ParameterChoices,
  options: ParameterOptions = {},
): ModelRequest {
  const resolved = resolveShape(kind, texts, choices, options);
  const size = validatePrintSize(texts.printSizeMm);
  const scale =
    connectorScaleOf(
      kind,
      { ...resolved.values, printSizeMm: 'value' in size ? size.value : undefined },
      options.connectorScale,
    ) ??
    options.connectorScale ??
    INITIAL_CONNECTOR_SCALE;
  const section = resolveSection(kind, texts, choices, options.exact, scale, resolved.shape);
  const values: ParameterValues = { ...resolved.values, ...section.values };
  const errors = { ...resolved.errors, ...section.errors };
  if ('error' in size) errors.printSizeMm = size.error;
  else values.printSizeMm = size.value;
  if (resolved.shape === undefined || section.section === undefined || 'error' in size) {
    return { values, errors, spec: undefined, key: undefined };
  }
  // The cut and the connector are checked before the specification is parsed: their settings have no fixed limits here.
  const checked =
    section.section === 'none'
      ? undefined
      : sectionChecks(kind, resolved.shape, size.value, section.section, options.connectorEdits);
  if (checked !== undefined) {
    for (const [key, message] of Object.entries(checked.errors) as [ParameterKey, string][]) {
      errors[key] = errors[key] === undefined ? message : `${errors[key]} ${message}`;
    }
  }
  const sectionRanges = checked?.ranges;
  const connectorStatus = twistElsewhere(kind, choices, resolved.shape)
    ? { context: '', corrections: [], unavailable: twistElsewhereMessage(kind, choices) }
    : checked?.resolved?.status;
  Object.assign(values, checked?.resolved?.values);
  if (Object.keys(errors).length > 0) {
    const plateClipped = checked?.plateClipped;
    return { values, errors, sectionRanges, connectorStatus, plateClipped, spec: undefined, key: undefined };
  }
  const built = checked?.resolved?.section ?? section.section;
  const spec = modelSpecSchema.parse({
    shape: resolved.shape,
    scale: { longestDimensionMm: size.value },
    ...(built === 'none' ? {} : { section: built }),
  });
  // The plain cut shown for an unavailable connector is not the plain cut chosen without one: only the latter is for download.
  const key = `${JSON.stringify(spec)}${connectorStatus?.unavailable === undefined ? '' : ':connector-unavailable'}`;
  const settingsInput: ModelSettingsInput = inclinationInputOf(kind, values, options.tiltModes);
  const plateClipped = checked?.plateClipped;
  return { values, errors, sectionRanges, connectorStatus, plateClipped, spec, key, settingsInput };
}

/** What a twist connector became when a section plate was turned on: no connector, said so rather than done silently. */
export const PLATE_TWIST_NOTICE = 'Поворотне з’єднання не працює із січною пластиною, тому обрано «Без кріплення».';

/**
 * The choices after a section plate was turned on with a connector that cannot join the parts through it: none instead,
 * whose replacement the page then announces. Undefined when nothing has to change; the twist connector is the only such one.
 */
export function plateConnectorFallback(kind: ShapeKind, state: ParameterState): ParameterState | undefined {
  const keys = sectionKeys[kind];
  const plate = keys?.plate;
  if (keys === undefined || plate === undefined || !state.choices[plate.toggle]) return undefined;
  if (activeSection(kind, state.choices) === undefined || state.choices[keys.connector] !== 'twist') return undefined;
  return { ...state, choices: { ...state.choices, [keys.connector]: 'none' } };
}

/** Whether a section plate is chosen for the shape's active cut. */
export function plateChosen(kind: ShapeKind, choices: ParameterChoices): boolean {
  const keys = sectionKeys[kind];
  const plate = keys?.plate;
  return plate !== undefined && choices[plate.toggle] && activeSection(kind, choices) !== undefined;
}

/** Why the twist connector is not offered here, for a choice made before the solid or the cut changed. */
export const TWIST_UNSUPPORTED_MESSAGE =
  'Поворотне з’єднання поки доступне лише для прямого циліндра з перерізом, паралельним основам. Завантаження вимкнено: змініть ' +
  'тіло чи переріз або оберіть «Без кріплення».';

/** Why the twist connector is not offered beside a section plate, which it cannot join the parts through. */
export const TWIST_WITH_PLATE_MESSAGE =
  'Поворотне з’єднання не працює із січною пластиною. Завантаження вимкнено: вимкніть пластину або оберіть інше кріплення.';

/**
 * Whether the solid and the cut are those the twist connector works for, without a section plate; the solid's own values count
 * once they are valid.
 */
function twistFits(kind: ShapeKind, choices: ParameterChoices, shape: ShapeInput | undefined): boolean {
  if (kind !== 'cylinder' || activeSection(kind, choices) !== 'parallel-to-bases' || plateChosen(kind, choices)) return false;
  return shape?.kind !== 'cylinder' || twistSupported(shape as SectionedShape, 0);
}

/** Whether the twist connector can be offered now. */
export const twistAvailable = (kind: ShapeKind, choices: ParameterChoices, values: ParameterValues): boolean =>
  twistFits(
    kind,
    choices,
    kind !== 'cylinder' || values.cylinderOffsetRatio === undefined
      ? undefined
      : { kind: 'cylinder', heightRatio: values.cylinderHeightRatio ?? 1, offsetRatio: values.cylinderOffsetRatio },
  );

/** A twist connector chosen where it does not work: the model is then the plain cut, not offered for download. */
const twistElsewhere = (kind: ShapeKind, choices: ParameterChoices, shape: ShapeInput | undefined): boolean =>
  activeConnector(kind, choices) === 'twist' && !twistFits(kind, choices, shape);

/** Why a twist connector chosen where it does not work is left out. */
export const twistElsewhereMessage = (kind: ShapeKind, choices: ParameterChoices): string =>
  plateChosen(kind, choices) ? TWIST_WITH_PLATE_MESSAGE : TWIST_UNSUPPORTED_MESSAGE;

/** How a displaced figure's inclination was entered, with the angles themselves when they were. */
function inclinationInputOf(
  kind: ShapeKind,
  values: ParameterValues,
  tiltModes: TiltModes = initialTiltModes(),
): Pick<ModelSettingsInput, 'inclinationInput'> {
  if (!isTiltSolid(kind)) return {};
  if (tiltModes[kind] === 'offset') return { inclinationInput: { enteredAs: 'offsets' } };
  const { inclination, direction } = tiltKeys[kind];
  const [inclinationDeg, directionDeg] = [values[inclination], direction === undefined ? undefined : values[direction]];
  if (inclinationDeg === undefined) return {};
  return {
    inclinationInput: { enteredAs: 'angles', inclinationDeg, ...(directionDeg === undefined ? {} : { directionDeg }) },
  };
}

// Feasibility depends only on the solid, the size, the cut and the connector; the panel and the request read it for every
// edit of any field, so recent results are kept.
const FEASIBILITY_CACHE_SIZE = 32;
const feasibilityCache = new Map<
  string,
  | ConnectorFeasibility<string, DovetailIssue>
  | ConnectorFeasibility<string, RoundConnectorIssue>
  | ConnectorFeasibility<string, TwistIssue>
>();

function cachedFeasibility(shape: SectionedShape, longestDimensionMm: number, section: Section) {
  const { connector } = section;
  if (connector === undefined || connector.type === 'magnet') return undefined;
  const cut = cutOfSection(section);
  const key = JSON.stringify([shape, longestDimensionMm, cut, connector]);
  const cached = feasibilityCache.get(key);
  if (cached !== undefined) return cached;
  const scale = { longestDimensionMm };
  const result =
    connector.type === 'dovetail'
      ? dovetailFeasibility(shape, scale, cut, connector)
      : connector.type === 'twist'
        ? twistFeasibility(shape, scale, cut, connector)
        : roundConnectorFeasibility(shape, scale, cut, connector);
  if (feasibilityCache.size >= FEASIBILITY_CACHE_SIZE) feasibilityCache.delete(feasibilityCache.keys().next().value as string);
  feasibilityCache.set(key, result);
  return result;
}

type RoundResolution = {
  readonly status: ConnectorStatus;
  /** The dimensions actually generated, for the fields to show. */
  readonly values: ParameterValues;
  /** The section to build: with those dimensions, or without a connector when none fits. */
  readonly section: Section;
};

type SectionCheck = {
  errors: ParameterErrors;
  ranges: SectionRanges;
  resolved?: RoundResolution | undefined;
  plateClipped?: boolean | undefined;
};

const roundOutcomeCache = new Map<string, RoundConnectorOutcome>();

function cachedRoundOutcome(
  untouched: boolean,
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Section,
  connector: RoundConnector,
) {
  const cut = cutOfSection(section);
  const key = JSON.stringify([untouched, shape, longestDimensionMm, cut, connector]);
  const cached = roundOutcomeCache.get(key);
  if (cached !== undefined) return cached;
  const scale = { longestDimensionMm };
  const outcome = (untouched ? defaultRoundConnector : normalizeRoundConnector)(shape, scale, cut, connector);
  if (roundOutcomeCache.size >= FEASIBILITY_CACHE_SIZE) roundOutcomeCache.delete(roundOutcomeCache.keys().next().value as string);
  roundOutcomeCache.set(key, outcome);
  return outcome;
}

/** What a correction blames, from what failed at the stored dimensions. */
function correctionReason(issues: readonly RoundConnectorIssue[]): string {
  const codes = issues.map(({ code }) => code);
  if (codes.includes('hole-bottom-thin') || codes.includes('base-thin')) return 'через товщину частини';
  if (codes.includes('hole-wall-thin')) return 'через стінки навколо отвору';
  if (codes.includes('holes-too-close')) return 'через відстань між отворами';
  return 'щоб кріплення лишалося придатним';
}

/** One sentence per dimension that differs from the stored one, in the millimetres its field shows. */
function correctionsOf(
  stated: RoundConnector,
  actual: RoundConnector,
  longest: number,
  issues: readonly RoundConnectorIssue[],
  plated = false,
): string[] {
  const reason = correctionReason(issues);
  const pin = stated.type === 'plug' ? 'виступу' : 'штифта';
  const sentence = (subject: string, from: number, to: number, millimetresPerUnit: number) =>
    from === to
      ? []
      : [`${subject} ${to < from ? 'зменшено' : 'збільшено'} до ${formatMillimetres(to * millimetresPerUnit)} мм ${reason}.`];
  const { diameter, insertion } = ROUND_CONNECTOR_PROPORTIONS;
  const dowelLength = stated.type === 'dowel' ? 2 : 1;
  return [
    ...sentence(
      `${(stated.profile ?? 'circle') === 'circle' ? 'Діаметр' : 'Розмір'} ${pin}`,
      stated.diameterFactor,
      actual.diameterFactor,
      diameter * longest,
    ),
    ...sentence(
      // Beside a section plate the field leaves out the plate's thickness, which the pin crosses as well.
      stated.type === 'plug'
        ? plated
          ? 'Заглиблення виступу'
          : 'Висоту виступу'
        : plated
          ? 'Довжину штифта в частинах'
          : 'Довжину штифта',
      stated.depthFactor,
      actual.depthFactor,
      insertion * longest * dowelLength,
    ),
  ];
}

/** Why even the smallest connector does not fit, briefly, and the ways on. */
function unavailableMessage(issues: readonly RoundConnectorIssue[], type: 'plug' | 'dowel'): string {
  const issue = issues.find(({ code }) => code !== 'pin-too-thin' && code !== 'engagement-short') ?? issues[0];
  const pin = type === 'plug' ? 'виступ' : 'штифт';
  const shortfall =
    issue === undefined ? '' : `${millimetres(issue.valueMm)}, потрібно щонайменше ${millimetres(issue.minimumMm)}`;
  const what: Partial<Record<RoundConnectorIssue['code'], string>> = {
    'hole-wall-thin': `навіть за найменшого розміру стінка біля отвору — ${shortfall}`,
    'hole-bottom-thin': `навіть за найменшого розміру під дном отвору лишається ${shortfall}`,
    'holes-too-close': `навіть за найменшого розміру між отворами лишається ${shortfall}`,
    'base-thin': `за виступом лишається ${shortfall}`,
    'keying-lost': `більший ${pin} ширший за менший отвір лише на ${shortfall}`,
  };
  const reason = issue === undefined ? undefined : what[issue.code];
  return (
    `Кріплення не вміщується${reason === undefined ? '' : `: ${reason}`}. Змініть переріз або розмір моделі, спробуйте інший профіль ` +
    'чи кількість або оберіть «Без кріплення». Доти завантаження вимкнено.'
  );
}

/**
 * The round connector to build, unless the stored values count as they are: a new one from what the section offers, an
 * edited one as it is if it still fits, and corrected otherwise. Pure in the stored values, so that evaluating it again, as
 * every edit of any field does, changes nothing.
 */
function resolveRound(
  { round }: SectionKeys,
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Section,
  edits: ConnectorEdits | undefined,
): RoundResolution | undefined {
  const { connector } = section;
  if (edits === undefined || connector === undefined || connector.type === 'dovetail' || connector.type === 'magnet') {
    return undefined;
  }
  if (connector.type === 'twist') return resolveTwist(shape, longestDimensionMm, section, connector, edits);
  const { type, count, profile } = connector;
  const context = JSON.stringify([shape, longestDimensionMm, cutOfSection(section), type, profile, count]);
  const edited = edits[shape.kind];
  if (edited === context) return { status: { context, corrections: [] }, values: {}, section };
  const outcome = cachedRoundOutcome(edited === undefined, shape, longestDimensionMm, section, connector);
  if (outcome.status === 'unavailable') {
    const { connector: _none, ...plain } = section;
    return {
      status: { context, corrections: [], unavailable: unavailableMessage(outcome.issues, type) },
      values: {},
      section: plain as Section,
    };
  }
  const actual = outcome.connector as RoundConnector;
  return {
    status: {
      context,
      corrections: outcome.adjusted
        ? correctionsOf(connector, actual, longestDimensionMm, outcome.issues, 'plate' in section && section.plate !== undefined)
        : [],
    },
    values: {
      [round.diameter]: actual.diameterFactor,
      [round.depth]: actual.depthFactor,
      ...(actual.spacingPercent === undefined ? {} : { [round.spacing]: actual.spacingPercent }),
    },
    section: { ...section, connector: actual },
  };
}

const twistOutcomeCache = new Map<string, TwistOutcome>();

/** What a twist connector's correction blames, from what failed at the stored size. */
function twistCorrectionReason(issues: readonly TwistIssue[]): string {
  const codes = issues.map(({ code }) => code);
  if (codes.includes('recess-roof-thin') || codes.includes('base-thin')) return 'через товщину частини';
  if (codes.includes('recess-wall-thin')) return 'через стінку навколо гнізда';
  return 'щоб вушка лишалися придатними';
}

/** Why no usable twist connector fits, from what falls short at its smallest printable size, and the ways on. */
function twistUnavailableMessage(issues: readonly TwistIssue[]): string {
  const issue = issues.find(({ code }) => code.startsWith('recess') || code === 'base-thin') ?? issues[0];
  const shortfall =
    issue === undefined ? '' : `${millimetres(issue.valueMm)}, потрібно щонайменше ${millimetres(issue.minimumMm)}`;
  const what: Partial<Record<TwistIssue['code'], string>> = {
    'recess-roof-thin': `над гніздом лишається ${shortfall}`,
    'recess-wall-thin': `стінка навколо гнізда — ${shortfall}`,
    'base-thin': `під кріпленням лишається ${shortfall}`,
  };
  const reason = issue === undefined ? undefined : what[issue.code];
  return (
    `Поворотне з’єднання не вміщується${reason === undefined ? '' : `: ${reason}`}. Змініть переріз або розмір моделі, зменште ` +
    'зазори чи оберіть «Без кріплення». Доти завантаження вимкнено.'
  );
}

/**
 * As for plugs and dowels: a new connector's size from the section and the clearances, an edited one as it is in the context
 * of its last edit, and otherwise corrected if it must be, without overwriting what is stored.
 */
function resolveTwist(
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Section,
  connector: TwistConnector,
  edits: ConnectorEdits,
): RoundResolution {
  const cut = cutOfSection(section);
  const context = JSON.stringify([shape, longestDimensionMm, cut, 'twist']);
  const edited = edits[shape.kind];
  if (edited === context) return { status: { context, corrections: [] }, values: {}, section };
  const key = JSON.stringify([edited === undefined, shape, longestDimensionMm, cut, connector]);
  const outcome =
    twistOutcomeCache.get(key) ??
    (edited === undefined ? defaultTwist : normalizeTwist)(shape, { longestDimensionMm }, cut, connector);
  if (twistOutcomeCache.size >= FEASIBILITY_CACHE_SIZE) twistOutcomeCache.delete(twistOutcomeCache.keys().next().value as string);
  twistOutcomeCache.set(key, outcome);
  if (outcome.status === 'unavailable') {
    const { connector: _none, ...plain } = section;
    return {
      status: { context, corrections: [], unavailable: twistUnavailableMessage(outcome.issues) },
      values: {},
      section: plain as Section,
    };
  }
  const actual = outcome.connector;
  const changed = actual.sizeMm !== connector.sizeMm;
  return {
    status: {
      context,
      corrections:
        outcome.adjusted && changed
          ? [
              `Розмір кріплення ${actual.sizeMm < connector.sizeMm ? 'зменшено' : 'збільшено'} до ` +
                `${formatMillimetres(actual.sizeMm)} мм ${twistCorrectionReason(outcome.issues)}.`,
            ]
          : [],
    },
    values: { cylinderTwistSizeMm: actual.sizeMm },
    section: { ...section, connector: actual },
  };
}

/**
 * The ranges of the section's fields and their problems. A vertical plane stays within the distance from the axis that
 * leaves two usable parts, from the engine's limit, and an oblique plane leaves both parts a usable thickness; a
 * connector is not checked on a plane beyond that, which has no usable section. Nothing is moved to make the plane fit.
 */
function sectionChecks(
  kind: ShapeKind,
  shape: ShapeInput,
  longestDimensionMm: number,
  section: Section,
  edits: ConnectorEdits | undefined,
): SectionCheck | undefined {
  const keys = sectionKeys[kind];
  if (keys === undefined || (shape.kind !== 'cylinder' && shape.kind !== 'cone' && shape.kind !== 'ball')) return undefined;
  if (section.type === 'parallel-to-bases') return connectorChecks(keys, shape as RoundShape, longestDimensionMm, section, edits);
  const solid = shape as RoundShape;
  const scale = { longestDimensionMm };
  if (section.type === 'horizontal')
    return offsetChecks(
      keys,
      shape as SectionedShape,
      longestDimensionMm,
      section,
      ballOffsetLimitPercent(scale),
      ballRadiusMm(scale),
      edits,
    );
  if (section.type === 'oblique-apex') return apexChecks(keys, shape as ConeShape, longestDimensionMm, section, edits);
  if (section.type === 'oblique') {
    const reach = obliqueSplitReach(solid, scale, section);
    if (satisfies(reach)) return connectorChecks(keys, solid, longestDimensionMm, section, edits);
    const contained = obliquePlaneContainsAxis(solid, section.inclinationDeg, section.directionDeg);
    const { oblique } = planarKeysOf(keys);
    const field = contained ? oblique.inclination : oblique.position;
    return {
      errors: {
        [field]:
          `Тонша частина сягає від площини лише ${millimetres(reach.valueMm)}, потрібно щонайменше ` +
          `${millimetres(reach.minimumMm)}. Змініть положення чи кут площини або збільште найбільший габарит.`,
      },
      ranges: {},
    };
  }
  return offsetChecks(
    keys,
    solid,
    longestDimensionMm,
    section,
    verticalOffsetLimitPercent(solid, scale),
    roundDimensionsMm(solid, scale).radius,
    edits,
  );
}

/** Said where the solid's lower base cuts a section plate's margin off; its margin stays as given elsewhere. */
export const PLATE_CLIPPED_NOTE = 'Знизу пластина обрізається по рівню основи фігури.';

/** Why no section plate fits at this cut, briefly, and the ways on. */
export const PLATE_UNAVAILABLE_MESSAGE =
  'Січна пластина тут не вміщується: навіть найтонша залишила б одну з частин тоншою за 1,2 мм. Пересуньте переріз ' +
  'ближче до середини, збільште найбільший габарит або вимкніть пластину.';

/** The same for a cut with no position along the height to move: its offset or angles change it instead. */
export const PLATE_UNAVAILABLE_ELSEWHERE_MESSAGE =
  'Січна пластина тут не вміщується: навіть найтонша залишила б одну з частин тоншою за 1,2 мм уздовж нормалі до ' +
  'перерізу. Змініть переріз, збільште найбільший габарит або вимкніть пластину.';

/** The section plate's fields of a solid that offers one. */
const plateKeysOf = (keys: SectionKeys) => keys.plate;

/** The section as it is without a plate. */
const withoutPlate = (section: Section): Section => {
  if (!('plate' in section)) return section;
  const { plate: _plate, ...plane } = section;
  return plane as Section;
};

/**
 * A section plate on any cut of a solid that offers one, and the connector's checks, which already read the plate: each part's
 * face lies half of it from the plane, along the plane's normal. The thicknesses that leave both parts their thickness are a
 * range of every valid cut, also while the plate is off, so that the switch says when none fits. Nothing is moved to make the
 * plate fit, and it is never left out silently: a thickness beyond the range, or a cut where none fits, is the thickness
 * field's error.
 */
function connectorChecks(
  keys: SectionKeys,
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Section,
  edits: ConnectorEdits | undefined,
): SectionCheck | undefined {
  const plate = plateKeysOf(keys);
  if (plate === undefined) return jointChecks(keys, shape, longestDimensionMm, section, edits);
  const plane = cutOfSection(withoutPlate(section));
  const range = plateThicknessRange(shape, { longestDimensionMm }, plane as Exclude<typeof plane, { plate: unknown }>);
  const fits = range.min <= range.max + CONSTRAINT_ROUNDOFF_MM;
  const ranges: SectionRanges = { [plate.thickness]: fits ? range : null };
  const chosen = 'plate' in section ? section.plate : undefined;
  const withRanges = (joint: SectionCheck | undefined): SectionCheck =>
    joint === undefined ? { errors: {}, ranges } : { ...joint, ranges: { ...ranges, ...joint.ranges } };
  if (chosen === undefined) return withRanges(jointChecks(keys, shape, longestDimensionMm, section, edits));
  ranges[plate.margin] = SECTION_PLATE_MARGIN_LIMITS;
  const parallel = section.type === 'parallel-to-bases';
  if (!fits) {
    return { errors: { [plate.thickness]: parallel ? PLATE_UNAVAILABLE_MESSAGE : PLATE_UNAVAILABLE_ELSEWHERE_MESSAGE }, ranges };
  }
  if (chosen.thicknessMm > range.max + CONSTRAINT_ROUNDOFF_MM) {
    const shown = physicalRange(range, PLATE_THICKNESS_INCREMENT_MM) ?? { ...range, increment: PLATE_THICKNESS_INCREMENT_MM };
    return {
      errors: {
        [plate.thickness]:
          `За цього ${parallel ? 'положення перерізу' : 'перерізу'} допустимо від ${formatMillimetres(shown.min)} мм до ` +
          `${formatMillimetres(shown.max)} мм: кожна частина має лишатися не тоншою за 1,2 мм.`,
      },
      ranges,
    };
  }
  const scale = { longestDimensionMm };
  const geometry = sectionPlateGeometry(plateSection(shape, scale, cutOfSection(section) as PlateCut));
  return { ...withRanges(jointChecks(keys, shape, longestDimensionMm, section, edits)), plateClipped: geometry.clippedAtBase };
}

/** The magnet connector from its fields, as the specification takes it. */
function magnetConnectorOf(keys: MagnetKeys, read: (key: ParameterKey) => number): MagnetConnector {
  return {
    type: 'magnet',
    ...(Object.fromEntries(
      (Object.entries(MAGNET_FIELDS) as [MagnetField, string][]).map(([field, setting]) => [setting, read(keys[field])]),
    ) as Omit<MagnetConnector, 'type'>),
  };
}

const magnetPlanCache = new Map<string, MagnetPlan>();

function cachedMagnetPlan(shape: SectionedShape, longestDimensionMm: number, section: Section, connector: MagnetConnector) {
  const cut = cutOfSection(section);
  const key = JSON.stringify([shape, longestDimensionMm, cut, connector]);
  const cached = magnetPlanCache.get(key);
  if (cached !== undefined) return cached;
  const plan = planMagnets(shape, { longestDimensionMm }, cut, connector);
  if (magnetPlanCache.size >= FEASIBILITY_CACHE_SIZE) magnetPlanCache.delete(magnetPlanCache.keys().next().value as string);
  magnetPlanCache.set(key, plan);
  return plan;
}

/**
 * The magnet pockets placed by the engine on this cut. Where they do not fit, nothing is changed to make them fit: the settings
 * stay as entered, the model is the plain cut, which is not for download, and the reason is said with the ways on.
 */
function magnetChecks(shape: SectionedShape, longestDimensionMm: number, section: Section, connector: MagnetConnector) {
  const plan = cachedMagnetPlan(shape, longestDimensionMm, section, connector);
  if (plan.issues.length === 0) return { errors: {}, ranges: {} };
  const { connector: _none, ...plain } = section;
  const unavailable = magnetIssuesMessage(plan.issues, section.type, connector);
  return {
    errors: {},
    ranges: {},
    resolved: { status: { context: '', corrections: [], unavailable }, values: {}, section: plain as Section },
  };
}

/** The part as the magnet messages name it: below or above a horizontal cut, by its number beside any other. */
const magnetPart = (part: 'lower' | 'upper', cut: SectionType) =>
  cut === 'parallel-to-bases' || cut === 'horizontal'
    ? part === 'lower'
      ? 'нижня частина'
      : 'верхня частина'
    : part === 'lower'
      ? 'частина 1'
      : 'частина 2';

/** What keeps the requested magnets from fitting, the part it concerns where known, and what to change; in Ukrainian. */
export function magnetIssuesMessage(issues: readonly MagnetIssue[], cut: SectionType, connector: MagnetConnector): string {
  const ending = ' Налаштування збережено; доки магніти не вміщуються, завантаження вимкнено.';
  const first = issues[0] as MagnetIssue;
  const partsOf = (code: MagnetIssue['code']) =>
    issues.flatMap((issue) => (issue.code === code && 'part' in issue ? [magnetPart(issue.part, cut)] : []));
  switch (first.code) {
    case 'too-shallow': {
      const parts = partsOf('too-shallow');
      return (
        `Магніти задовгі для цього перерізу: ${parts.join(' і ')} ${parts.length > 1 ? 'мають' : 'має'} вздовж осі гнізда лише ` +
        `${millimetres(first.valueMm)}, а гнізду разом із дном потрібно ${formatMillimetres(first.minimumMm)} мм. ` +
        `Візьміть тонші магніти, збільште модель чи змініть положення перерізу.${ending}`
      );
    }
    case 'face-too-small':
      return (
        `Переріз замалий для отвору ⌀${formatMillimetres(magnetPocketMm(connector).diameter)} мм. Зменште діаметр магнітів, ` +
        `збільште модель чи змініть положення перерізу.${ending}`
      );
    case 'wall-thin':
      return (
        `${capitalised(partsOf('wall-thin').join(' і '))}: навколо гнізда лишається замало матеріалу, бо поверхня фігури ` +
        `надто близько. Візьміть менші чи тонші магніти, збільште модель чи змініть положення перерізу.${ending}`
      );
    case 'no-arrangement':
      return (
        `Для вибраних магнітів недостатньо місця: вдалося розмістити лише ${first.placed} з ${connector.count} пар. ` +
        `Зменште їх кількість або розмір, збільште модель чи змініть положення перерізу.${ending}`
      );
  }
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The fit allowances as they start; "Відновити стандартні значення" returns these two alone. */
export function resetMagnetAllowances(kind: ShapeKind, state: ParameterState): ParameterState {
  const keys = sectionKeys[kind]?.magnet;
  if (keys === undefined) return state;
  const initial = initialParameterTexts();
  const texts = {
    ...state.texts,
    [keys.DiameterAllowanceMm]: initial[keys.DiameterAllowanceMm],
    [keys.DepthAllowanceMm]: initial[keys.DepthAllowanceMm],
  };
  if (state.exact === undefined) return { ...state, texts };
  const exact = { ...state.exact };
  delete exact[keys.DiameterAllowanceMm];
  delete exact[keys.DepthAllowanceMm];
  return { ...state, texts, exact };
}

/** Whether the fit allowances differ from how they start. */
export function magnetAllowancesChanged(kind: ShapeKind, texts: ParameterTexts): boolean {
  const keys = sectionKeys[kind]?.magnet;
  if (keys === undefined) return false;
  const initial = initialParameterTexts();
  return [keys.DiameterAllowanceMm, keys.DepthAllowanceMm].some((key) => texts[key] !== initial[key]);
}

/** The steps of the plate's fields: its thickness by 0,2 mm, its margin by 1 mm. */
export const PLATE_THICKNESS_INCREMENT_MM = 0.2;
export const PLATE_MARGIN_INCREMENT_MM = 1;

/** A plane given by its distance from an axis or a centre: within that distance's limit, and only then a connector's checks. */
function offsetChecks(
  keys: SectionKeys,
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Extract<Section, { type: 'vertical' | 'horizontal' }>,
  limit: number,
  radius: number,
  edits: ConnectorEdits | undefined,
): SectionCheck {
  const ranges: SectionRanges = { [keys.offset]: { min: -limit, max: limit } };
  if (Math.abs(sectionOffsetMm(section.offsetPercent, radius)) > sectionOffsetMm(limit, radius) + CONSTRAINT_ROUNDOFF_MM) {
    const shown = percentRange({ min: -limit, max: limit }, 1);
    const allowed = `Допустимі значення — від ${formatDecimal(shown.min)} % до ${formatDecimal(shown.max)} %: `;
    return { errors: { [keys.offset]: `${allowed}обидві частини мають лишатися придатними до друку.` }, ranges };
  }
  const connector = connectorChecks(keys, shape, longestDimensionMm, section, edits);
  return connector === undefined ? { errors: {}, ranges } : { ...connector, ranges: { ...ranges, ...connector.ranges } };
}

/**
 * The angles a plane through the apex may take in this direction, and why the current one or the direction itself does
 * not split the cone. A connector is not checked on a plane that has no usable section. Nothing is moved to make it fit.
 */
function apexChecks(
  keys: SectionKeys,
  shape: ConeShape,
  longestDimensionMm: number,
  section: Extract<Section, { type: 'oblique-apex' }>,
  edits: ConnectorEdits | undefined,
): SectionCheck {
  const scale = { longestDimensionMm };
  const bounds = coneApexAngleBounds(shape, scale, section.directionDeg);
  const ranges: SectionRanges = { [coneApexKeys.inclination]: bounds };
  if (bounds === null) {
    return {
      errors: {
        [coneApexKeys.direction]:
          'За цього напряму площина через вершину не ділить конус на дві придатні частини: вершина зміщена надто далеко ' +
          'від основи в протилежний бік. Змініть напрям нахилу або зменште нахил конуса.',
      },
      ranges,
    };
  }
  const chord = coneApexChord(shape, scale, section);
  if (!isApexChordUsable(chord)) {
    const shown = planeAngleRange(bounds, 1);
    const allowed = `Допустимі значення за цього напряму — від ${formatDecimal(shown.min)}° до ${formatDecimal(shown.max)}°.`;
    const reason = apexChordCrossesBase(chord)
      ? 'За цього кута одна з частин була б надто тонкою.'
      : 'За цього кута площина лише торкається конуса й не ділить його.';
    return { errors: { [coneApexKeys.inclination]: `${reason} ${allowed}` }, ranges };
  }
  const connector = connectorChecks(keys, shape, longestDimensionMm, section, edits);
  return connector === undefined ? { errors: {}, ranges } : { ...connector, ranges: { ...ranges, ...connector.ranges } };
}

/**
 * The first valid plane through this cone's apex: rising along the lean, which is +X for every cone and the same default
 * for a right one, at the multiple of the step nearest to the middle of the allowed angles. Undefined while the cone is
 * not valid yet, and for a state that has its plane already; a cone too small for any plane keeps the default.
 */
export function startApexSection(state: ParameterState, values: ParameterValues): ParameterState | undefined {
  const { coneSection, coneObliqueThrough, coneApexStarted } = state.choices;
  if (coneSection !== 'oblique' || coneObliqueThrough !== 'apex' || coneApexStarted) return undefined;
  const { printSizeMm, coneHeightRatio, coneOffsetRatio } = values;
  if (printSizeMm === undefined || coneHeightRatio === undefined || coneOffsetRatio === undefined) return undefined;
  const directionDeg = DEFAULT_OBLIQUE_SECTION.directionDeg;
  const shape = { kind: 'cone', heightRatio: coneHeightRatio, offsetRatio: coneOffsetRatio } as const;
  const bounds = coneApexAngleBounds(shape, { longestDimensionMm: printSizeMm }, directionDeg);
  const choices = { ...state.choices, coneApexStarted: true };
  if (bounds === null) return { ...state, choices };
  const range = planeAngleRange(bounds, APEX_START_INCREMENT_DEG);
  const texts = {
    ...state.texts,
    [coneApexKeys.inclination]: formatSteppedDecimal(snapDecimal((range.min + range.max) / 2, range)),
    [coneApexKeys.direction]: formatDecimal(directionDeg),
  };
  return { ...state, texts, choices };
}

const APEX_START_INCREMENT_DEG = 5;

/**
 * The connector's feasible ranges and its problems, explained at the fields that can repair them, from the same checks
 * the engine applies before it builds anything. A field outside its range names what fails and the values it allows
 * with the other settings as they are; a problem that no connector setting repairs, such as too little material under
 * a plug, is explained at the cut's own field. All of it holds for the dimensions a round connector actually gets, see
 * `resolveRound`.
 */
function jointChecks(
  keys: SectionKeys,
  shape: SectionedShape,
  longestDimensionMm: number,
  stated: Section,
  edits: ConnectorEdits | undefined,
): SectionCheck | undefined {
  if (stated.connector?.type === 'magnet') return magnetChecks(shape, longestDimensionMm, stated, stated.connector);
  const resolved = resolveRound(keys, shape, longestDimensionMm, stated, edits);
  if (resolved?.status.unavailable !== undefined) return { errors: {}, ranges: {}, resolved };
  const section = resolved?.section ?? stated;
  const { connector } = section;
  if (connector === undefined || connector.type === 'magnet') return undefined;
  const feasibility = cachedFeasibility(shape, longestDimensionMm, section);
  if (feasibility === undefined) return undefined;
  const { dovetail, round } = keys;
  const plated = 'plate' in section && section.plate !== undefined;
  // Beside a plate on another cut the parts keep their numbers, which the cut's own words give.
  const wording: CutWording =
    shape.kind === 'cone' && section.type === 'parallel-to-bases' ? (plated ? 'cone-plate' : 'cone') : section.type;
  const fields: [ParameterKey, string][] =
    connector.type === 'twist'
      ? [
          ['cylinderTwistSizeMm', 'size'],
          ['cylinderTwistClearanceMm', 'holeClearance'],
          ['cylinderTwistAxialMm', 'axialClearance'],
        ]
      : connector.type === 'dovetail'
        ? [
            [dovetail.size, 'height'],
            [dovetail.length, 'length'],
            [dovetail.clearance, 'clearance'],
          ]
        : [
            [round.diameter, 'diameter'],
            [round.depth, 'insertion'],
            ...(connector.count === 2 ? ([[round.spacing, 'spacing']] as [ParameterKey, string][]) : []),
            ...((connector.type === 'plug'
              ? [[round.plugClearance, 'upperClearance']]
              : [
                  [round.dowelLowerClearance, 'lowerClearance'],
                  [round.dowelUpperClearance, 'upperClearance'],
                ]) as [ParameterKey, string][]),
          ];
  type AnyIssue = DovetailIssue | RoundConnectorIssue | TwistIssue;
  const explain = (issue: AnyIssue) =>
    connector.type === 'dovetail'
      ? dovetailIssueMessage(issue as DovetailIssue, wording)
      : connector.type === 'twist'
        ? twistIssueMessage(issue as TwistIssue)
        : roundConnectorIssueMessage(
            issue as RoundConnectorIssue,
            connector.type,
            connector.count,
            wording,
            connector.profile,
            plated,
          );
  const parameters = feasibility.parameters as Readonly<Record<string, ParameterFeasibility<AnyIssue>>>;
  const errors: ParameterErrors = {};
  const ranges: SectionRanges = {};
  for (const [key, parameter] of fields) {
    const { bounds, issues } = parameters[parameter] as ParameterFeasibility<AnyIssue>;
    // The engine solves for the insertion e into one part; the field shows a dowel's whole length 2e.
    const shown = key === round.depth && connector.type === 'dowel' ? 2 : 1;
    ranges[key] = hasFeasibleValues(bounds) ? { min: bounds.min * shown, max: bounds.max * shown } : null;
    if (issues.length > 0) errors[key] = [...issues.map(explain), rangeSentence(bounds, shown)].join(' ');
  }
  if (feasibility.unattributed.length > 0) {
    const planar = 'position' in keys ? (keys as PlanarSectionKeys) : undefined;
    const cutField = {
      'parallel-to-bases': planar?.position ?? keys.offset,
      vertical: keys.offset,
      horizontal: keys.offset,
      oblique: planar?.oblique.inclination ?? keys.offset,
      'oblique-apex': coneApexKeys.inclination,
    };
    errors[cutField[section.type]] = feasibility.unattributed.map(explain).join(' ');
  }
  return { errors, ranges, resolved };
}

/** The values a connector field allows now, in the millimetres it shows, rounded as its slider shows them. */
function rangeSentence(bounds: ParameterBounds, shown: number): string {
  const [min, max] = [bounds.min * shown, bounds.max * shown];
  if (hasFeasibleValues(bounds)) {
    const range = physicalRange({ min, max }, 1);
    return range === undefined
      ? ''
      : `Зараз допустимо від ${formatMillimetres(range.min)} мм до ${formatMillimetres(range.max)} мм.`;
  }
  if (bounds.blocked) return 'Зараз жодне значення цього поля не підходить: змініть інші параметри.';
  return (
    `Зараз жодне значення не підходить: потрібно щонайменше ${formatMillimetres(Math.ceil(min * 1000) / 1000)} мм, ` +
    `але не більше ${formatMillimetres(Math.floor(max * 1000) / 1000)} мм.`
  );
}

/**
 * Which words a message uses: a cone's cut parallel to the base is limited by the narrowing above it, hence its own, and
 * with a section plate also by the plate's thickness, which moves each part's face away from the cut.
 */
export type CutWording = SectionType | 'cone' | 'cone-plate';

const BALL_REPAIR = 'наблизьте переріз до центра кулі';

/** A plane through the apex reads like any oblique one, but for the position it does not have; a plate's cut like a cone's. */
const wordingOf = (cut: CutWording): Exclude<CutWording, 'oblique-apex' | 'cone-plate'> =>
  cut === 'oblique-apex' ? 'oblique' : cut === 'cone-plate' ? 'cone' : cut;

/** A part as the messages name it: by its place in a parallel cut, by its number in the others, where it has no place. */
function partInMessage(part: 'lower' | 'upper', cut: CutWording): string {
  if (cut === 'vertical' || cut === 'oblique' || cut === 'oblique-apex') return part === 'lower' ? 'у частині 1' : 'у частині 2';
  return part === 'lower' ? 'у нижній частині' : 'у верхній частині';
}

const changePlane = (cut: CutWording) =>
  cut === 'oblique-apex' ? 'змініть кут чи напрям площини' : 'змініть положення чи кут площини';

/** What falls short, by how much, and what to change, for plugs and dowels; in Ukrainian for the interface. */
export function roundConnectorIssueMessage(
  issue: RoundConnectorIssue,
  type: 'plug' | 'dowel',
  count: 1 | 2 = 1,
  cut: CutWording = 'parallel-to-bases',
  profile: ConnectorProfile = 'circle',
  plated: boolean = cut === 'cone-plate',
): string {
  const shortfall = `${millimetres(issue.valueMm)}, потрібно щонайменше ${millimetres(issue.minimumMm)}`;
  const circular = profile === 'circle';
  const pin = type === 'plug' ? 'виступу' : 'штифта';
  const diameter = `${circular ? 'діаметр' : 'розмір'} ${pin}`;
  // A cone's cut parallel to its base, beside a plate, narrows above it; any plate moves the parts' faces away from the cut.
  const conePlated = cut === 'cone-plate';
  const length = plated
    ? type === 'plug'
      ? 'заглиблення виступу'
      : 'довжину штифта в частинах'
    : type === 'plug'
      ? 'висоту виступу'
      : 'довжину штифта';
  // Beside a plate each part's face lies half its thickness away from the cut, where the cone is narrower above.
  const thinnerPlate = conePlated ? ' або зменште товщину пластини' : '';
  switch (issue.code) {
    case 'pin-too-thin':
      return circular
        ? `Найменший ${diameter} — ${shortfall}. Збільште ${diameter}.`
        : `Найвужче місце ${pin} — ${shortfall}. Збільште ${diameter}.`;
    case 'engagement-short':
      return (
        `Після фасок${type === 'dowel' ? ' й осьового зміщення' : ''} пряма ділянка в отворі — ${shortfall}. ` +
        `Збільште ${length} або зменште ${diameter}.`
      );
    case 'keying-lost':
      return (
        `Більший ${type === 'plug' ? 'виступ' : 'штифт'} ширший за менший отвір на ${shortfall}, інакше частини можна ` +
        `з’єднати, повернувши на 180°. Зменште збільшення ${circular ? 'діаметра ' : ''}отворів або збільште ${diameter}.`
      );
    case 'hole-wall-thin':
      return (
        `Стінка біля отвору ${partInMessage(issue.part, cut)} — ${shortfall}. ` +
        `Зменште ${diameter}${count === 2 ? ' або відстань від центра до осей' : ''}` +
        `${cut === 'cone' || conePlated ? ' чи опустіть переріз' : cut === 'horizontal' ? ` чи ${BALL_REPAIR}` : ''}` +
        `${issue.part === 'upper' ? thinnerPlate : ''}.`
      );
    case 'holes-too-close':
      return `Між отворами ${partInMessage(issue.part, cut)} лишається ${shortfall}. Збільште відстань від центра до осей або зменште ${diameter}.`;
    case 'hole-bottom-thin':
      if (cut === 'horizontal') {
        return (
          `Біля дна отвору ${partInMessage(issue.part, cut)} куля звужується, і стінка лишається ${shortfall}. ` +
          `Зменште ${length} чи ${diameter} або ${BALL_REPAIR}.`
        );
      }
      if (cut === 'cone' || conePlated) {
        return issue.part === 'upper'
          ? `Біля дна отвору ${partInMessage(issue.part, cut)} конус звужується, і стінка лишається ${shortfall}. ` +
              `Зменште ${length} чи ${diameter}${conePlated ? ',' : ' або'} опустіть переріз${thinnerPlate}.`
          : `Під дном отвору ${partInMessage(issue.part, cut)} лишається ${shortfall}. Зменште ${length}` +
              `${conePlated ? ',' : ' або'} підніміть переріз${thinnerPlate}.`;
      }
      return (
        `Під дном отвору ${partInMessage(issue.part, cut)} лишається ${shortfall}. ` +
        {
          vertical: `Зменште ${length}, ${diameter} або зміщення від осі`,
          oblique: `Зменште ${length} чи ${diameter} або ${changePlane(cut)}`,
          'parallel-to-bases': `Зменште ${length} або ${issue.part === 'upper' ? 'опустіть' : 'підніміть'} переріз`,
          cone: `Зменште ${length} або ${issue.part === 'upper' ? 'опустіть' : 'підніміть'} переріз`,
          horizontal: `Зменште ${length} або ${BALL_REPAIR}`,
        }[wordingOf(cut)] +
        `${plated && !conePlated ? ', або зменште товщину пластини' : ''}.`
      );
    case 'base-thin':
      return {
        vertical: `За виступом у частині 1 лишається ${shortfall}. Зменште ${diameter} або зміщення від осі.`,
        oblique: `За виступом у частині 1 лишається ${shortfall}. Зменште ${diameter} або ${changePlane(cut)}.`,
        'parallel-to-bases': `Під виступом лишається ${shortfall} нижньої частини. Підніміть переріз або збільште найбільший габарит.`,
        cone:
          `Під виступом лишається ${shortfall} нижньої частини. Підніміть переріз` +
          `${conePlated ? ', зменште товщину пластини' : ''} або збільште найбільший габарит.`,
        horizontal: `Під виступом лишається ${shortfall} нижньої частини. Зменште ${diameter} або ${BALL_REPAIR}.`,
      }[wordingOf(cut)];
  }
}

/** What falls short in a twist connector, by how much, and what to change; in Ukrainian for the interface. */
export function twistIssueMessage(issue: TwistIssue): string {
  const shortfall = `${millimetres(issue.valueMm)}, потрібно щонайменше ${millimetres(issue.minimumMm)}`;
  switch (issue.code) {
    case 'lug-too-narrow':
      return `Вужчі вушка мають ширину ${shortfall}. Збільште розмір кріплення.`;
    case 'keying-lost':
      return `Ширше вушко ширше за вузький вхід лише на ${shortfall}, тож частини можна з’єднати не в тому положенні. Зменште зазор або збільште розмір.`;
    case 'bearing-short':
      return `Вушко заходить за край гнізда на ${shortfall}. Збільште розмір кріплення або зменште зазор.`;
    case 'engagement-short':
      return `Вушко в зібраному положенні відступає від свого входу лише на ${shortfall}. Збільште розмір або зменште зазор.`;
    case 'neck-too-thin':
      return `Шийка має діаметр ${shortfall}. Збільште розмір кріплення.`;
    case 'ledge-thin':
      return `Виступ під вушками — ${shortfall}. Зменште осьовий зазор.`;
    case 'rib-thin':
      return `Між каналами гнізда лишається ${shortfall}. Зменште зазор або збільште розмір.`;
    case 'recess-wall-thin':
      return `Стінка навколо гнізда — ${shortfall}. Зменште розмір кріплення.`;
    case 'recess-roof-thin':
      return `Над гніздом лишається ${shortfall}. Зменште розмір кріплення або опустіть переріз.`;
    case 'base-thin':
      return `Під кріпленням лишається ${shortfall} нижньої частини. Підніміть переріз або збільште найбільший габарит.`;
  }
}

/** A measured value, rounded down to hundredths so that it never reads as more than there is. */
const millimetres = (value: number) => `${formatDecimal(Math.max(0, Math.floor(value * 100) / 100))} мм`;

/**
 * A groove's problem beside a section plate, which concerns one part: the plate carries both tongues, and each part's face
 * lies half the plate's thickness from the cut, so a thinner plate leaves each part more material behind its groove.
 */
function plateDovetailIssueMessage(
  issue: DovetailIssue & { readonly part: 'lower' | 'upper' },
  shortfall: string,
  cut: CutWording,
): string {
  const where = partInMessage(issue.part, cut);
  if (cut === 'horizontal') {
    const what = { 'groove-wall-thin': 'Стінка біля паза', 'stop-thin': 'За упором паза', 'backing-thin': 'За пазом' }[
      issue.code as 'groove-wall-thin'
    ];
    const verb = issue.code === 'groove-wall-thin' ? '—' : 'лишається';
    return `${what ?? 'Паз'} ${where} ${verb} ${shortfall}. Зменште висоту чи довжину виступу, товщину пластини або ${BALL_REPAIR}.`;
  }
  if (cut !== 'cone-plate') {
    const what = { 'groove-wall-thin': 'Стінка біля паза', 'stop-thin': 'За упором паза', 'backing-thin': 'За пазом' }[
      issue.code as 'groove-wall-thin'
    ];
    const verb = issue.code === 'groove-wall-thin' ? '—' : 'лишається';
    const plane =
      cut === 'parallel-to-bases' ? 'пересуньте переріз' : cut === 'vertical' ? 'зменште зміщення від осі' : changePlane(cut);
    return `${what ?? 'Паз'} ${where} ${verb} ${shortfall}. Зменште висоту чи довжину виступу, товщину пластини або ${plane}.`;
  }
  const towards = issue.part === 'upper' ? ', опустіть переріз або зменште товщину пластини' : ' або підніміть переріз';
  switch (issue.code) {
    case 'groove-wall-thin':
      return `Стінка біля паза ${where} — ${shortfall}. Зменште довжину чи висоту виступу або опустіть переріз.`;
    case 'stop-thin':
      return `За упором паза ${where} лишається ${shortfall}. Зменште довжину виступу чи зазор або опустіть переріз.`;
    case 'backing-thin':
      return `За пазом ${where} лишається ${shortfall}. Зменште висоту виступу${towards}.`;
    default:
      return `Паз ${where}: ${shortfall}. Зменште розміри виступу.`;
  }
}

/** What falls short, by how much, and what to change; in Ukrainian for the interface. */
export function dovetailIssueMessage(issue: DovetailIssue, cut: CutWording = 'parallel-to-bases'): string {
  const shortfall = `${millimetres(issue.valueMm)}, потрібно щонайменше ${millimetres(issue.minimumMm)}`;
  if (issue.part !== undefined) return plateDovetailIssueMessage({ ...issue, part: issue.part }, shortfall, cut);
  switch (issue.code) {
    case 'tongue-too-low':
      return `Виступ заввишки ${shortfall}. Збільште висоту виступу.`;
    case 'neck-too-narrow':
      return `Ширина виступу біля основи — ${shortfall}. Збільште висоту виступу, з якою вона пов’язана.`;
    case 'undercut-lost':
      return `Зазор лишає утримувальний скіс ${shortfall} з кожного боку. Зменште зазор або збільште висоту виступу.`;
    case 'tongue-too-short':
      return `Пряма ділянка виступу після фаски — ${shortfall}. Збільште довжину виступу.`;
    case 'groove-wall-thin':
      return {
        vertical: `Стінка біля паза — ${shortfall}. Зменште висоту або довжину виступу чи зміщення від осі.`,
        oblique: `Стінка біля паза — ${shortfall}. Зменште висоту чи довжину виступу або ${changePlane(cut)}.`,
        'parallel-to-bases': `Стінка біля закритого кінця паза — ${shortfall}. Зменште довжину або висоту виступу.`,
        cone: `Стінка біля паза — ${shortfall}. Зменште довжину чи висоту виступу або опустіть переріз.`,
        horizontal: `Стінка біля паза — ${shortfall}. Зменште довжину чи висоту виступу або ${BALL_REPAIR}.`,
      }[wordingOf(cut)];
    case 'stop-thin':
      if (cut === 'horizontal')
        return `За упором паза лишається ${shortfall}. Зменште довжину виступу чи зазор або ${BALL_REPAIR}.`;
      return cut === 'cone'
        ? `За упором паза лишається ${shortfall}. Зменште довжину виступу чи зазор або опустіть переріз.`
        : `Під нижнім упором паза лишається ${shortfall}. Зменште довжину виступу або зазор.`;
    case 'backing-thin':
      if (cut === 'horizontal')
        return `Над пазом лишається ${shortfall} верхньої частини. Зменште висоту виступу або ${BALL_REPAIR}.`;
      if (cut === 'vertical') return `За пазом у частині 2 лишається ${shortfall}. Зменште висоту виступу або зміщення від осі.`;
      if (cut === 'oblique' || cut === 'oblique-apex') {
        return `За пазом у частині 2 лишається ${shortfall}. Зменште висоту чи довжину виступу або ${changePlane(cut)}.`;
      }
      return `Над пазом лишається ${shortfall} верхньої частини. Опустіть переріз або зменште висоту виступу.`;
    case 'base-thin':
      return {
        vertical: `За виступом у частині 1 лишається ${shortfall}. Зменште висоту виступу або зміщення від осі.`,
        oblique: `За виступом у частині 1 лишається ${shortfall}. Зменште висоту чи довжину виступу або ${changePlane(cut)}.`,
        'parallel-to-bases': `Під виступом лишається ${shortfall} нижньої частини. Підніміть переріз або збільште найбільший габарит.`,
        cone: `Під виступом лишається ${shortfall} нижньої частини. Підніміть переріз або збільште найбільший габарит.`,
        horizontal: `Під виступом лишається ${shortfall} нижньої частини. Зменште висоту чи довжину виступу або ${BALL_REPAIR}.`,
      }[wordingOf(cut)];
  }
}

type SectionKeys = {
  readonly choice: 'cylinderSection' | 'coneSection' | 'ballSection';
  readonly offset: 'cylinderSectionOffsetPercent' | 'coneSectionOffsetPercent' | 'ballSectionOffsetPercent';
  readonly separated: ToggleKey;
  readonly connector: 'cylinderConnector' | 'coneConnector' | 'ballConnector';
  readonly dovetailEntrance: 'cylinderDovetailEntrance' | 'coneDovetailEntrance' | 'ballDovetailEntrance';
  readonly dovetail: {
    readonly size: 'cylinderDovetailSize' | 'coneDovetailSize' | 'ballDovetailSize';
    readonly length: 'cylinderDovetailLengthPercent' | 'coneDovetailLengthPercent' | 'ballDovetailLengthPercent';
    readonly clearance: 'cylinderDovetailClearanceMm' | 'coneDovetailClearanceMm' | 'ballDovetailClearanceMm';
  };
  /** Plugs and dowels share the count, profile, spacing and multipliers; each keeps its own clearances. */
  readonly round: {
    readonly count: 'cylinderRoundCount' | 'coneRoundCount' | 'ballRoundCount';
    readonly profile: 'cylinderRoundProfile' | 'coneRoundProfile' | 'ballRoundProfile';
    readonly spacing: 'cylinderRoundSpacingPercent' | 'coneRoundSpacingPercent' | 'ballRoundSpacingPercent';
    readonly diameter: 'cylinderRoundDiameter' | 'coneRoundDiameter' | 'ballRoundDiameter';
    readonly depth: 'cylinderRoundDepth' | 'coneRoundDepth' | 'ballRoundDepth';
    readonly plugClearance: 'cylinderPlugClearanceMm' | 'conePlugClearanceMm' | 'ballPlugClearanceMm';
    readonly dowelLowerClearance: 'cylinderDowelLowerClearanceMm' | 'coneDowelLowerClearanceMm' | 'ballDowelLowerClearanceMm';
    readonly dowelUpperClearance: 'cylinderDowelUpperClearanceMm' | 'coneDowelUpperClearanceMm' | 'ballDowelUpperClearanceMm';
  };
  readonly twist?: typeof TWIST_KEYS;
  readonly magnet: MagnetKeys;
  /** The section plate of a solid that offers one, on any of its cuts: the switch, the thickness and the margin. */
  readonly plate?: {
    readonly toggle: 'cylinderPlate' | 'conePlate' | 'ballPlate';
    readonly thickness: 'cylinderPlateThicknessMm' | 'conePlateThicknessMm' | 'ballPlateThicknessMm';
    readonly margin: 'cylinderPlateMarginMm' | 'conePlateMarginMm' | 'ballPlateMarginMm';
  };
};

/** The further fields of the solids with an axis: a plane parallel to their base and a plane through a point on the axis. */
export type PlanarSectionKeys = SectionKeys & {
  readonly position: 'cylinderSectionPercent' | 'coneSectionPercent';
  readonly oblique: {
    readonly position: 'cylinderObliquePositionPercent' | 'coneObliquePositionPercent';
    readonly inclination: 'cylinderObliqueInclinationDeg' | 'coneObliqueInclinationDeg';
    readonly direction: 'cylinderObliqueDirectionDeg' | 'coneObliqueDirectionDeg';
  };
};

/** The fields of the cuts that a ball does not offer, which only a cylinder's or a cone's sections reach. */
function planarKeysOf(keys: SectionKeys): PlanarSectionKeys {
  if (!('position' in keys)) throw new Error('This solid offers no plane with a position along an axis.');
  return keys as PlanarSectionKeys;
}

/** The scale of the default cylinder at the default size, for messages before any valid one exists. */
const INITIAL_CONNECTOR_SCALE = cylinderConnectorScale({
  printSizeMm: DEFAULT_LONGEST_DIMENSION_MM,
  cylinderHeightRatio: defaultModelSpecs.cylinder.shape.heightRatio,
  cylinderOffsetRatio: defaultModelSpecs.cylinder.shape.offsetRatio,
}) as ConnectorScale;

/** The default of each connector setting shown in millimetres, in its stored units. */
export const scaledConnectorDefaults: Readonly<Record<ScaledConnectorKey, number>> = {
  cylinderDovetailSize: DEFAULT_DOVETAIL.sizeFactor,
  cylinderDovetailLengthPercent: DEFAULT_DOVETAIL.lengthPercent,
  cylinderRoundDiameter: DEFAULT_ROUND_CONNECTOR.diameterFactor,
  cylinderRoundDepth: DEFAULT_ROUND_CONNECTOR.depthFactor,
  cylinderRoundSpacingPercent: DEFAULT_ROUND_CONNECTOR.spacingPercent,
  cylinderTwistSizeMm: TWIST_PLACEHOLDER_SIZE_MM,
  ballDovetailSize: DEFAULT_DOVETAIL.sizeFactor,
  ballDovetailLengthPercent: DEFAULT_DOVETAIL.lengthPercent,
  ballRoundDiameter: DEFAULT_ROUND_CONNECTOR.diameterFactor,
  ballRoundDepth: DEFAULT_ROUND_CONNECTOR.depthFactor,
  ballRoundSpacingPercent: DEFAULT_ROUND_CONNECTOR.spacingPercent,
  coneDovetailSize: DEFAULT_DOVETAIL.sizeFactor,
  coneDovetailLengthPercent: DEFAULT_DOVETAIL.lengthPercent,
  coneRoundDiameter: DEFAULT_ROUND_CONNECTOR.diameterFactor,
  coneRoundDepth: DEFAULT_ROUND_CONNECTOR.depthFactor,
  coneRoundSpacingPercent: DEFAULT_ROUND_CONNECTOR.spacingPercent,
};

export const isScaledConnectorKey = (key: ParameterKey): key is ScaledConnectorKey => Object.hasOwn(scaledConnectorDefaults, key);

/** The error of an empty or malformed connector setting shown in millimetres, with a millimetre example. */
function scaledError(key: ScaledConnectorKey, text: string, unit: number): string | undefined {
  const read = readNumber(text, formatPhysical(scaledConnectorDefaults[key], unit));
  return 'error' in read ? read.error : undefined;
}

/** The fields of a plane through a cone's apex, kept apart from those of a plane through a point on its axis. */
export const coneApexKeys = { inclination: 'coneApexInclinationDeg', direction: 'coneApexDirectionDeg' } as const;

/** A cylinder's twist connector fields, in the panel's order; no other solid offers one yet. */
export const TWIST_KEYS = [
  'cylinderTwistSizeMm',
  'cylinderTwistClearanceMm',
  'cylinderTwistAxialMm',
] as const satisfies readonly ParameterKey[];

/** The fields of the plane section and its connector, for the shapes that offer one. */
export const sectionKeys: Readonly<Partial<Record<ShapeKind, SectionKeys | PlanarSectionKeys>>> = {
  ball: {
    choice: 'ballSection',
    offset: 'ballSectionOffsetPercent',
    separated: 'ballPartsSeparated',
    plate: { toggle: 'ballPlate', thickness: 'ballPlateThicknessMm', margin: 'ballPlateMarginMm' },
    magnet: magnetKeysOf('ball'),
    connector: 'ballConnector',
    dovetailEntrance: 'ballDovetailEntrance',
    dovetail: {
      size: 'ballDovetailSize',
      length: 'ballDovetailLengthPercent',
      clearance: 'ballDovetailClearanceMm',
    },
    round: {
      count: 'ballRoundCount',
      profile: 'ballRoundProfile',
      spacing: 'ballRoundSpacingPercent',
      diameter: 'ballRoundDiameter',
      depth: 'ballRoundDepth',
      plugClearance: 'ballPlugClearanceMm',
      dowelLowerClearance: 'ballDowelLowerClearanceMm',
      dowelUpperClearance: 'ballDowelUpperClearanceMm',
    },
  },
  cylinder: {
    choice: 'cylinderSection',
    position: 'cylinderSectionPercent',
    offset: 'cylinderSectionOffsetPercent',
    oblique: {
      position: 'cylinderObliquePositionPercent',
      inclination: 'cylinderObliqueInclinationDeg',
      direction: 'cylinderObliqueDirectionDeg',
    },
    separated: 'cylinderPartsSeparated',
    plate: { toggle: 'cylinderPlate', thickness: 'cylinderPlateThicknessMm', margin: 'cylinderPlateMarginMm' },
    connector: 'cylinderConnector',
    dovetailEntrance: 'cylinderDovetailEntrance',
    twist: TWIST_KEYS,
    magnet: magnetKeysOf('cylinder'),
    dovetail: {
      size: 'cylinderDovetailSize',
      length: 'cylinderDovetailLengthPercent',
      clearance: 'cylinderDovetailClearanceMm',
    },
    round: {
      count: 'cylinderRoundCount',
      profile: 'cylinderRoundProfile',
      spacing: 'cylinderRoundSpacingPercent',
      diameter: 'cylinderRoundDiameter',
      depth: 'cylinderRoundDepth',
      plugClearance: 'cylinderPlugClearanceMm',
      dowelLowerClearance: 'cylinderDowelLowerClearanceMm',
      dowelUpperClearance: 'cylinderDowelUpperClearanceMm',
    },
  },
  cone: {
    choice: 'coneSection',
    position: 'coneSectionPercent',
    offset: 'coneSectionOffsetPercent',
    oblique: {
      position: 'coneObliquePositionPercent',
      inclination: 'coneObliqueInclinationDeg',
      direction: 'coneObliqueDirectionDeg',
    },
    separated: 'conePartsSeparated',
    plate: { toggle: 'conePlate', thickness: 'conePlateThicknessMm', margin: 'conePlateMarginMm' },
    magnet: magnetKeysOf('cone'),
    connector: 'coneConnector',
    dovetailEntrance: 'coneDovetailEntrance',
    dovetail: {
      size: 'coneDovetailSize',
      length: 'coneDovetailLengthPercent',
      clearance: 'coneDovetailClearanceMm',
    },
    round: {
      count: 'coneRoundCount',
      profile: 'coneRoundProfile',
      spacing: 'coneRoundSpacingPercent',
      diameter: 'coneRoundDiameter',
      depth: 'coneRoundDepth',
      plugClearance: 'conePlugClearanceMm',
      dowelLowerClearance: 'coneDowelLowerClearanceMm',
      dowelUpperClearance: 'coneDowelUpperClearanceMm',
    },
  },
};

/** Every connector field of the section. */
const connectorTextKeys = ({ dovetail, round, twist, magnet }: SectionKeys): ParameterKey[] => [
  ...Object.values(magnet),
  ...Object.values(dovetail),
  round.spacing,
  round.diameter,
  round.depth,
  round.plugClearance,
  round.dowelLowerClearance,
  round.dowelUpperClearance,
  ...(twist ?? []),
];

/**
 * The connector fields that shape the solid with this connector and count, in the panel's order: a pair adds its
 * spacing, and plugs and dowels each read their own diametral clearances.
 */
export function activeConnectorKeys(keys: SectionKeys, connector: ConnectorType | undefined, count: 1 | 2): ParameterKey[] {
  const { round } = keys;
  switch (connector) {
    case undefined:
      return [];
    case 'dovetail':
      return Object.values(keys.dovetail);
    case 'twist':
      return [...(keys.twist ?? [])];
    case 'magnet':
      return Object.values(keys.magnet);
    case 'plug':
    case 'dowel':
      return [
        ...(count === 2 ? [round.spacing] : []),
        round.diameter,
        round.depth,
        ...(connector === 'plug' ? [round.plugClearance] : [round.dowelLowerClearance, round.dowelUpperClearance]),
      ];
  }
}

/** The connector chosen for the shape's active section; undefined without a section or a connector. */
export function activeConnector(kind: ShapeKind, choices: ParameterChoices): ConnectorType | undefined {
  const keys = sectionKeys[kind];
  if (keys === undefined || activeSection(kind, choices) === undefined) return undefined;
  const choice = choices[keys.connector];
  return choice === 'none' ? undefined : choice;
}

/** The section chosen for the shape; undefined when it offers none or none is chosen. */
export function activeSection(kind: ShapeKind, choices: ParameterChoices): SectionType | undefined {
  const keys = sectionKeys[kind];
  const choice = keys === undefined ? 'none' : choices[keys.choice];
  if (choice === 'none') return undefined;
  return kind === 'cone' && choice === 'oblique' && choices.coneObliqueThrough === 'apex' ? 'oblique-apex' : choice;
}

/**
 * Whether the preview shows the parts of a section apart. This is the switch alone, whatever section is chosen now: the
 * shown model decides by having a separated preview or not, so that a replacement still being generated never changes
 * the placement of the model on screen, and the new parts arrive with their own.
 */
export function partsSeparated(kind: ShapeKind, choices: ParameterChoices): boolean {
  const keys = sectionKeys[kind];
  return keys !== undefined && choices[keys.separated];
}

/**
 * The section of the specification: 'none' without one; undefined while its position or a connector field is not
 * valid. The fields are read only while their section and connector are chosen, so that a hidden draft never blocks
 * the whole solid.
 */
function resolveSection(
  kind: ShapeKind,
  texts: ParameterTexts,
  choices: ParameterChoices,
  exact: ParameterExact | undefined,
  scale: ConnectorScale,
  shape: ShapeInput | undefined,
): { values: ParameterValues; errors: ParameterErrors; section: Section | 'none' | undefined } {
  const keys = sectionKeys[kind];
  const type = activeSection(kind, choices);
  if (keys === undefined || type === undefined) return { values: {}, errors: {}, section: 'none' };
  const connectorType = activeConnector(kind, choices);
  const count = choices[keys.round.count];
  // A twist connector where it does not work reads no fields of its own, whose hidden drafts then block nothing.
  const inert = connectorType === 'twist' && !twistFits(kind, choices, shape);
  const fields = (inert ? [] : activeConnectorKeys(keys, connectorType, count)) as IndependentKey[];
  // A plane parallel to the bases has a position along the height, a vertical one a distance from the axis, an oblique
  // one a point on the axis and two angles, a plane through an apex those angles alone.
  const planar = 'position' in keys ? (keys as PlanarSectionKeys) : undefined;
  const plate = keys.plate !== undefined && choices[keys.plate.toggle] ? keys.plate : undefined;
  const plateFields: IndependentKey[] = plate === undefined ? [] : [plate.thickness, plate.margin];
  const cutFields: Readonly<Record<SectionType, readonly IndependentKey[]>> = {
    'parallel-to-bases': planar === undefined ? [] : [planar.position, ...plateFields],
    vertical: [keys.offset, ...plateFields],
    horizontal: [keys.offset, ...plateFields],
    oblique: planar === undefined ? [] : [...Object.values(planar.oblique), ...plateFields],
    'oblique-apex': [...Object.values(coneApexKeys), ...plateFields],
  };
  const cutKeys = cutFields[type];
  const { values, errors } = validateFields([...cutKeys, ...fields], texts, exact);
  // The fields show millimetres: their errors name millimetres too.
  const units = connectorUnits(scale, connectorType === 'dowel' ? 'dowel' : 'plug', type);
  for (const key of fields) {
    if (errors[key] !== undefined && isScaledConnectorKey(key)) {
      errors[key] = scaledError(key, texts[key], units[key]) ?? errors[key];
    }
  }
  // The position cannot change a plane that contains the whole axis and its field is disabled, so an invalid draft of it
  // blocks nothing; it stays as typed for when the plane no longer does.
  if (type === 'oblique' && planar !== undefined && (shape?.kind === 'cylinder' || shape?.kind === 'cone')) {
    const { inclination, direction, position } = planar.oblique;
    const [inclinationDeg, directionDeg] = [values[inclination], values[direction]];
    if (
      inclinationDeg !== undefined &&
      directionDeg !== undefined &&
      obliquePlaneContainsAxis(shape as RoundShape, inclinationDeg, directionDeg)
    ) {
      delete errors[position];
      values[position] ??= DEFAULT_OBLIQUE_SECTION.positionPercent;
    }
  }
  if ([...cutKeys, ...fields].some((key) => values[key] === undefined)) return { values, errors, section: undefined };
  const read = (key: ParameterKey) => values[key] as number;
  const { dovetail, round } = keys;
  const shared = {
    count,
    profile: choices[round.profile],
    diameterFactor: read(round.diameter),
    depthFactor: read(round.depth),
    ...(count === 2 ? { spacingPercent: read(round.spacing) } : {}),
  };
  const connector = inert
    ? undefined
    : connectorType === 'twist'
      ? {
          type: connectorType,
          sizeMm: read('cylinderTwistSizeMm'),
          holeClearanceMm: read('cylinderTwistClearanceMm'),
          axialClearanceMm: read('cylinderTwistAxialMm'),
        }
      : connectorType === 'magnet'
        ? magnetConnectorOf(keys.magnet, read)
        : connectorType === 'dovetail'
          ? {
              type: connectorType,
              sizeFactor: read(dovetail.size),
              lengthPercent: read(dovetail.length),
              clearanceMm: read(dovetail.clearance),
              entrance: choices[keys.dovetailEntrance],
            }
          : connectorType === 'plug'
            ? { type: connectorType, ...shared, holeClearanceMm: read(round.plugClearance) }
            : connectorType === 'dowel'
              ? {
                  type: connectorType,
                  ...shared,
                  lowerClearanceMm: read(round.dowelLowerClearance),
                  upperClearanceMm: read(round.dowelUpperClearance),
                }
              : undefined;
  const joining = {
    ...(plate === undefined ? {} : { plate: { thicknessMm: read(plate.thickness), marginMm: read(plate.margin) } }),
    ...(connector === undefined ? {} : { connector }),
  };
  const sectionOf = (): Section => {
    switch (type) {
      case 'vertical':
      case 'horizontal':
        return { type, offsetPercent: read(keys.offset), ...joining };
      case 'parallel-to-bases':
        return { type, positionPercent: read(planarKeysOf(keys).position), ...joining };
      case 'oblique': {
        const { position, inclination, direction } = planarKeysOf(keys).oblique;
        return {
          type,
          positionPercent: read(position),
          inclinationDeg: read(inclination),
          // 360° and 0° are one direction, hence one model: the field keeps showing what was chosen, its slider stays put.
          directionDeg: read(direction) % OBLIQUE_DIRECTION_LIMITS.max,
          ...joining,
        };
      }
      case 'oblique-apex':
        return {
          type,
          inclinationDeg: read(coneApexKeys.inclination),
          directionDeg: read(coneApexKeys.direction) % OBLIQUE_DIRECTION_LIMITS.max,
          ...joining,
        };
    }
  };
  return { values, errors, section: sectionOf() };
}

const valid = (values: ParameterValues, shape: ShapeInput): ShapeResolution => ({ values, errors: {}, shape });

/** The solid's own fields, its height among them, completed with the offsets of its tilt input mode. */
function validateWithTilt(
  solid: TiltSolid,
  keys: readonly IndependentKey[],
  texts: ParameterTexts,
  options: ParameterOptions,
): TiltResolution {
  const own = validateFields(keys, texts, options.exact);
  const tilt = resolveTilt(solid, texts, options, own.values[tiltKeys[solid].height]);
  return { values: { ...own.values, ...tilt.values }, errors: { ...own.errors, ...tilt.errors }, offsets: tilt.offsets };
}

function resolveShape(
  kind: ShapeKind,
  texts: ParameterTexts,
  choices: ParameterChoices,
  options: ParameterOptions,
): ShapeResolution {
  switch (kind) {
    case 'cube':
    case 'tetrahedron':
    case 'octahedron':
    case 'icosahedron':
    case 'dodecahedron':
    case 'ball':
      return valid({}, { kind });
    case 'cuboid': {
      const { values, errors } = validateFields(['cuboidWidthRatio', 'cuboidHeightRatio'], texts);
      const { cuboidWidthRatio: widthRatio, cuboidHeightRatio: heightRatio } = values;
      if (widthRatio === undefined || heightRatio === undefined) return { values, errors, shape: undefined };
      return valid(values, { kind, widthRatio, heightRatio });
    }
    case 'parallelepiped': {
      const { values, errors, offsets } = validateWithTilt(
        'parallelepiped',
        ['parallelepipedBaseSideRatio', 'parallelepipedHeightRatio', 'parallelepipedBaseAngleDeg'],
        texts,
        options,
      );
      const {
        parallelepipedBaseSideRatio: baseSideRatio,
        parallelepipedHeightRatio: heightRatio,
        parallelepipedBaseAngleDeg: baseAngleDeg,
      } = values;
      if (baseSideRatio === undefined || heightRatio === undefined || baseAngleDeg === undefined || offsets === undefined)
        return { values, errors, shape: undefined };
      const [offsetXRatio, offsetYRatio] = offsets;
      return valid(values, { kind, baseSideRatio, heightRatio, baseAngleDeg, offsetXRatio, offsetYRatio });
    }
    case 'prism':
      return resolveBasedSolid('prism', texts, choices.prismBaseType, choices.prismBaseSides, options);
    case 'pyramid':
      return resolveBasedSolid('pyramid', texts, choices.pyramidBaseType, choices.pyramidBaseSides, options);
    case 'cylinder':
    case 'cone': {
      const heightKey = kind === 'cylinder' ? 'cylinderHeightRatio' : 'coneHeightRatio';
      const { values, errors, offsets } = validateWithTilt(kind, [heightKey], texts, options);
      const heightRatio = values[heightKey];
      if (heightRatio === undefined || offsets === undefined) return { values, errors, shape: undefined };
      const [offsetRatio] = offsets;
      return valid(values, { kind, heightRatio, offsetRatio });
    }
  }
}

/** The field keys of each configurable base type, per solid family. */
type BaseFieldKeys = {
  readonly triangle: readonly [side: IndependentKey, angle: IndependentKey];
  readonly parallelogram?: readonly [side: IndependentKey, angle: IndependentKey];
  readonly trapezoid: readonly [side: IndependentKey, height: IndependentKey, shift: IndependentKey];
};

const prismBaseKeys: BaseFieldKeys = {
  triangle: ['prismTriangleSideRatio', 'prismTriangleAngleDeg'],
  trapezoid: ['prismTrapezoidSideRatio', 'prismTrapezoidHeightRatio', 'prismTrapezoidShiftRatio'],
};

const pyramidBaseKeys: BaseFieldKeys = {
  triangle: ['pyramidTriangleSideRatio', 'pyramidTriangleAngleDeg'],
  parallelogram: ['pyramidParallelogramSideRatio', 'pyramidParallelogramAngleDeg'],
  trapezoid: ['pyramidTrapezoidSideRatio', 'pyramidTrapezoidHeightRatio', 'pyramidTrapezoidShiftRatio'],
};

const baseKeysOf = (baseType: PyramidBaseType, keys: BaseFieldKeys): readonly IndependentKey[] =>
  baseType === 'regular' ? [] : (keys[baseType] ?? []);

/** The selected base's specification fields from the validated values, or undefined while any of them is invalid. */
function baseFields(baseType: PyramidBaseType, keys: BaseFieldKeys, values: ParameterValues, baseSides: PrismBaseSides) {
  switch (baseType) {
    case 'regular':
      return { baseType, baseSides } as const;
    case 'triangle':
    case 'parallelogram': {
      const [baseSideRatio, baseAngleDeg] = baseKeysOf(baseType, keys).map((key) => values[key]);
      if (baseSideRatio === undefined || baseAngleDeg === undefined) return undefined;
      return { baseType, baseSideRatio, baseAngleDeg } as const;
    }
    case 'trapezoid': {
      const [parallelSideRatio, baseHeightRatio, baseShiftRatio] = keys.trapezoid.map((key) => values[key]);
      if (parallelSideRatio === undefined || baseHeightRatio === undefined || baseShiftRatio === undefined) return undefined;
      return { baseType, parallelSideRatio, baseHeightRatio, baseShiftRatio } as const;
    }
  }
}

/**
 * A prism or pyramid: its height and the position of its upper base or apex are shared by every base type; only the
 * selected base's own fields are read.
 */
function resolveBasedSolid(
  kind: 'prism' | 'pyramid',
  texts: ParameterTexts,
  baseType: PyramidBaseType,
  baseSides: PrismBaseSides,
  options: ParameterOptions,
): ShapeResolution {
  const keys = kind === 'prism' ? prismBaseKeys : pyramidBaseKeys;
  const heightKey = kind === 'prism' ? 'prismHeightRatio' : 'pyramidHeightRatio';
  const { values, errors, offsets } = validateWithTilt(kind, [heightKey, ...baseKeysOf(baseType, keys)], texts, options);
  const heightRatio = values[heightKey];
  const base = baseFields(baseType, keys, values, baseSides);
  if (heightRatio === undefined || offsets === undefined || base === undefined) {
    return { values, errors, shape: undefined };
  }
  const [x, y] = offsets;
  const position = kind === 'prism' ? { offsetXRatio: x, offsetYRatio: y } : { apexXRatio: x, apexYRatio: y };
  // The schema checks the combination: a prism never receives the parallelogram base, which it does not offer.
  return valid(values, { kind, heightRatio, ...position, ...base } as ShapeInput);
}

export type TrapezoidAlignment = 'left' | 'centre' | 'right';

/**
 * The shift δ/a that centres side b over side a, or puts their left or right ends flush: P3 above P0 needs
 * δ = (b − a)/2, P2 above P1 needs δ = (a − b)/2. Computed on the decimal values, so that the text it sets is exact.
 * A one-time setter: later edits of b do not keep the alignment.
 */
export function alignedTrapezoidShift(sideRatio: number, alignment: TrapezoidAlignment): number {
  if (alignment === 'centre') return 0;
  return alignment === 'left' ? halfSumDecimal(sideRatio, -1) : halfSumDecimal(1, -sideRatio);
}

/**
 * Every field and choice a shape owns, including those of its inactive base variants. Resetting a shape restores
 * exactly these, so the values of other shapes stay as they are; the shared print size belongs to no shape and is
 * never reset.
 */
export const shapeParameterKeys: Readonly<
  Record<ShapeKind, { readonly texts: readonly ParameterKey[]; readonly choices: readonly (keyof ParameterChoices)[] }>
> = {
  cube: { texts: [], choices: [] },
  cuboid: { texts: ['cuboidWidthRatio', 'cuboidHeightRatio'], choices: [] },
  parallelepiped: {
    texts: [
      'parallelepipedBaseSideRatio',
      'parallelepipedHeightRatio',
      'parallelepipedBaseAngleDeg',
      'parallelepipedOffsetXRatio',
      'parallelepipedOffsetYRatio',
      'parallelepipedInclinationDeg',
      'parallelepipedDirectionDeg',
    ],
    choices: [],
  },
  prism: {
    texts: [
      'prismHeightRatio',
      'prismOffsetXRatio',
      'prismOffsetYRatio',
      'prismInclinationDeg',
      'prismDirectionDeg',
      ...prismBaseKeys.triangle,
      ...prismBaseKeys.trapezoid,
    ],
    choices: ['prismBaseType', 'prismBaseSides'],
  },
  pyramid: {
    texts: [
      'pyramidHeightRatio',
      'pyramidApexXRatio',
      'pyramidApexYRatio',
      'pyramidInclinationDeg',
      'pyramidDirectionDeg',
      ...pyramidBaseKeys.triangle,
      ...(pyramidBaseKeys.parallelogram ?? []),
      ...pyramidBaseKeys.trapezoid,
    ],
    choices: ['pyramidBaseType', 'pyramidBaseSides'],
  },
  tetrahedron: { texts: [], choices: [] },
  octahedron: { texts: [], choices: [] },
  icosahedron: { texts: [], choices: [] },
  dodecahedron: { texts: [], choices: [] },
  cylinder: {
    texts: [
      'cylinderHeightRatio',
      'cylinderOffsetRatio',
      'cylinderInclinationDeg',
      'cylinderSectionPercent',
      'cylinderSectionOffsetPercent',
      'cylinderObliquePositionPercent',
      'cylinderObliqueInclinationDeg',
      'cylinderObliqueDirectionDeg',
      'cylinderPlateThicknessMm',
      'cylinderPlateMarginMm',
      'cylinderDovetailSize',
      'cylinderDovetailLengthPercent',
      'cylinderDovetailClearanceMm',
      'cylinderRoundSpacingPercent',
      'cylinderRoundDiameter',
      'cylinderRoundDepth',
      'cylinderPlugClearanceMm',
      'cylinderDowelLowerClearanceMm',
      'cylinderDowelUpperClearanceMm',
      ...TWIST_KEYS,
      ...Object.values(magnetKeysOf('cylinder')),
    ],
    choices: [
      'cylinderSection',
      'cylinderPartsSeparated',
      'cylinderPlate',
      'cylinderConnector',
      'cylinderDovetailEntrance',
      'cylinderRoundCount',
      'cylinderRoundProfile',
    ],
  },
  cone: {
    texts: [
      'coneHeightRatio',
      'coneOffsetRatio',
      'coneInclinationDeg',
      'coneSectionPercent',
      'conePlateThicknessMm',
      'conePlateMarginMm',
      'coneSectionOffsetPercent',
      'coneObliquePositionPercent',
      'coneObliqueInclinationDeg',
      'coneObliqueDirectionDeg',
      'coneApexInclinationDeg',
      'coneApexDirectionDeg',
      'coneDovetailSize',
      'coneDovetailLengthPercent',
      'coneDovetailClearanceMm',
      'coneRoundSpacingPercent',
      'coneRoundDiameter',
      'coneRoundDepth',
      'conePlugClearanceMm',
      'coneDowelLowerClearanceMm',
      'coneDowelUpperClearanceMm',
      ...Object.values(magnetKeysOf('cone')),
    ],
    choices: [
      'coneSection',
      'coneObliqueThrough',
      'coneApexStarted',
      'conePartsSeparated',
      'conePlate',
      'coneConnector',
      'coneDovetailEntrance',
      'coneRoundCount',
      'coneRoundProfile',
    ],
  },
  ball: {
    texts: [
      'ballSectionOffsetPercent',
      'ballPlateThicknessMm',
      'ballPlateMarginMm',
      'ballDovetailSize',
      'ballDovetailLengthPercent',
      'ballDovetailClearanceMm',
      'ballRoundSpacingPercent',
      'ballRoundDiameter',
      'ballRoundDepth',
      'ballPlugClearanceMm',
      'ballDowelLowerClearanceMm',
      'ballDowelUpperClearanceMm',
      ...Object.values(magnetKeysOf('ball')),
    ],
    choices: [
      'ballSection',
      'ballPartsSeparated',
      'ballPlate',
      'ballConnector',
      'ballDovetailEntrance',
      'ballRoundCount',
      'ballRoundProfile',
    ],
  },
};

export type ParameterState = {
  readonly texts: ParameterTexts;
  readonly choices: ParameterChoices;
  readonly exact?: ParameterExact | undefined;
  readonly tiltModes?: TiltModes | undefined;
  readonly connectorEdits?: ConnectorEdits | undefined;
};

/**
 * What happens before a field of a round connector is edited by hand: what the fields show becomes what is stored, so that
 * no other value jumps, and the current context becomes the one those values count in as they are. Nothing happens while no
 * connector fits, whose dimensions there are none to keep: a new clearance then still gets dimensions from the section.
 */
export function commitConnectorEdit(kind: ShapeKind, state: ParameterState, request: ModelRequest | undefined): ParameterState {
  const keys = sectionKeys[kind];
  const status = request?.connectorStatus;
  const type = activeConnector(kind, state.choices);
  const fitted = type === 'plug' || type === 'dowel' || type === 'twist';
  if (keys === undefined || !fitted || status?.unavailable !== undefined) return state;
  const current = state.connectorEdits?.[kind];
  // While the plane or another value is not valid there is no context yet: an empty one matches none later.
  if (status === undefined)
    return current === undefined ? { ...state, connectorEdits: { ...state.connectorEdits, [kind]: '' } } : state;
  if (current === status.context) return state;
  const texts = { ...state.texts };
  const generated: readonly ParameterKey[] =
    type === 'twist' ? ['cylinderTwistSizeMm'] : [keys.round.diameter, keys.round.depth, keys.round.spacing];
  for (const key of generated) {
    const value = request?.values[key];
    if (value !== undefined) texts[key] = formatSteppedDecimal(value);
  }
  return { ...state, texts, connectorEdits: { ...state.connectorEdits, [kind]: status.context } };
}

/**
 * The state after "Скинути параметри фігури": the shape's own fields and choices, also of its inactive base variants,
 * of both tilt modes and of its section, return to their initial values, drafts included: no section, at 50 %, with
 * the parts apart and without a connector, whose settings return to their defaults; a round connector's dimensions then
 * follow from its section again. The print size, every other shape and the tilt input mode keep theirs, so a reset in the
 * angle mode shows 90°.
 */
export function resetShapeParameters(kind: ShapeKind, state: ParameterState): ParameterState {
  const [initialTexts, initialChoices] = [initialParameterTexts(), initialParameterChoices()];
  const { texts: keys, choices: choiceKeys } = shapeParameterKeys[kind];
  const texts = { ...state.texts };
  for (const key of keys) texts[key] = initialTexts[key];
  const choices: ParameterChoices = { ...state.choices };
  for (const key of choiceKeys) Object.assign(choices, { [key]: initialChoices[key] });
  const { [kind]: _edited, ...otherEdits } = state.connectorEdits ?? {};
  const edits = state.connectorEdits === undefined ? {} : { connectorEdits: otherEdits };
  if (state.exact === undefined) return { ...state, texts, choices, ...edits };
  const exact = { ...state.exact };
  for (const key of keys) delete exact[key];
  return { ...state, texts, choices, exact, ...edits };
}

const isTiltSolid = (kind: ShapeKind): kind is TiltSolid => Object.hasOwn(tiltKeys, kind);

/**
 * Tilt fields whose text does not shape the solid at the moment: those of the other input mode, and a valid direction
 * in the angle mode, which displaces nothing at 90° and otherwise comes with an inclination other than 90°.
 */
function inactiveTiltKeys(kind: ShapeKind, { texts, exact, tiltModes = initialTiltModes() }: ParameterState): ParameterKey[] {
  if (!isTiltSolid(kind)) return [];
  const { offsets, inclination, direction } = tiltKeys[kind];
  if (tiltModes[kind] === 'offset') return direction === undefined ? [inclination] : [inclination, direction];
  const validDirection =
    direction !== undefined && 'value' in validateDirection(texts[direction], exactValueOf(direction, texts, exact));
  return validDirection ? [...offsets, direction] : [...offsets];
}

/** The fields of a section or connector that is not chosen: they shape nothing until it is. */
function inactiveSectionKeys(kind: ShapeKind, choices: ParameterChoices): (keyof ParameterChoices | ParameterKey)[] {
  const keys = sectionKeys[kind];
  if (keys === undefined) return [];
  const connector = activeConnector(kind, choices);
  const activeFields = new Set(activeConnectorKeys(keys, connector, choices[keys.round.count]));
  const connectorFields: (keyof ParameterChoices | ParameterKey)[] = connectorTextKeys(keys).filter(
    (key) => !activeFields.has(key),
  );
  if (connector !== 'plug' && connector !== 'dowel') connectorFields.push(keys.round.count, keys.round.profile);
  if (connector !== 'dovetail') connectorFields.push(keys.dovetailEntrance);
  const section = activeSection(kind, choices);
  const planar = 'position' in keys ? (keys as PlanarSectionKeys) : undefined;
  const obliqueFields = planar === undefined ? [] : Object.values(planar.oblique);
  const apexFields = Object.values(coneApexKeys);
  const plate = keys.plate;
  const plateFields =
    plate === undefined ? [] : [plate.toggle, ...(choices[plate.toggle] ? [plate.thickness, plate.margin] : [])];
  const cutFields: Readonly<Record<SectionType, readonly (keyof ParameterChoices | ParameterKey)[]>> = {
    'parallel-to-bases': planar === undefined ? [] : [planar.position, ...plateFields],
    vertical: [keys.offset, ...plateFields],
    horizontal: [keys.offset, ...plateFields],
    oblique: [...obliqueFields, 'coneObliqueThrough', ...plateFields],
    'oblique-apex': [...apexFields, 'coneObliqueThrough', ...plateFields],
  };
  const active = new Set<string>(section === undefined ? [] : cutFields[section]);
  const allPlateFields = plate === undefined ? [] : [plate.toggle, plate.thickness, plate.margin];
  const cuts = [...new Set([...Object.values(cutFields).flat(), ...allPlateFields])].filter((key) => !active.has(key));
  // Whether the first plane through the apex was set up is no setting, and starts over with the section.
  const always: (keyof ParameterChoices)[] = ['coneApexStarted'];
  return [...always, ...cuts, ...connectorFields, ...(section === undefined ? ([keys.separated, keys.connector] as const) : [])];
}

/**
 * Whether a reset would change the solid or its preview: one of the shape's own texts, an invalid draft included, or
 * choices differs from its initial value. The print size does not count, and neither do switching the tilt input mode
 * alone and the fields of a section that is not chosen.
 */
export function canResetShapeParameters(kind: ShapeKind, state: ParameterState): boolean {
  const reset = resetShapeParameters(kind, state);
  const inactive = new Set<string>([...inactiveTiltKeys(kind, state), ...inactiveSectionKeys(kind, state.choices)]);
  const connector = activeConnector(kind, state.choices);
  const fitted = connector === 'plug' || connector === 'dowel' || connector === 'twist';
  const editedConnector = fitted && state.connectorEdits?.[kind] !== undefined;
  return (
    editedConnector ||
    shapeParameterKeys[kind].texts.some((key) => !inactive.has(key) && reset.texts[key] !== state.texts[key]) ||
    shapeParameterKeys[kind].choices.some((key) => !inactive.has(key) && reset.choices[key] !== state.choices[key])
  );
}

/**
 * Whether the displacement can be shown in the other mode: its offsets are valid (in the angle mode, computed) and,
 * unless they are zero, so is the height that turns them into an inclination.
 */
export function canSwitchTiltMode(solid: TiltSolid, values: ParameterValues): boolean {
  const { offsets, height } = tiltKeys[solid];
  const current = offsets.map((key) => values[key]);
  if (current.some((offset) => offset === undefined)) return false;
  return values[height] !== undefined || current.every((offset) => offset === 0);
}

/**
 * Switches a solid's tilt input mode without changing the solid. The fields of the new mode are set from the current
 * full-precision offsets, with their exact values kept behind the rounded texts. Without a displacement the direction is
 * undefined: a valid one is retained for the next edit, otherwise it starts at 0°. Undefined when the current input is
 * not valid; see `canSwitchTiltMode`.
 */
export function switchTiltMode(solid: TiltSolid, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  if (!canSwitchTiltMode(solid, values)) return undefined;
  const keys = tiltKeys[solid];
  const offsets = keys.offsets.map((key) => values[key] ?? 0);
  const modes = state.tiltModes ?? initialTiltModes();
  const texts = { ...state.texts };
  const exact = { ...state.exact };
  const show = (key: ParameterKey, value: number) => {
    texts[key] = formatDecimal(value);
    exact[key] = value;
  };
  if (modes[solid] === 'angle') {
    keys.offsets.forEach((key, index) => {
      show(key, offsets[index] ?? 0);
    });
    return { ...state, texts, exact, tiltModes: { ...modes, [solid]: 'offset' } };
  }
  const angles = anglesFromOffsets(values[keys.height], offsets);
  if (angles === undefined) return undefined;
  show(keys.inclination, angles.inclinationDeg);
  if (keys.direction !== undefined) {
    if (angles.directionDeg !== undefined) show(keys.direction, angles.directionDeg);
    else if ('error' in validateDirection(texts[keys.direction], exactValueOf(keys.direction, texts, exact))) {
      texts[keys.direction] = INITIAL_DIRECTION_TEXT;
      delete exact[keys.direction];
    }
  }
  return { ...state, texts, exact, tiltModes: { ...modes, [solid]: 'angle' } };
}
