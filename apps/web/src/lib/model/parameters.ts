import {
  apexChordCrossesBase,
  atLinkedPlane,
  atSecondPlane,
  axialApexAngles,
  axisParallelOffsetLimitPercent,
  type BoxLikeShape,
  type BoxPointRange,
  ballOffsetLimitPercent,
  ballRadiusMm,
  ballSliceMinimumMm,
  boxApexPointRange,
  boxApexPositionBounds,
  boxFaceParallelPercent,
  boxLineAngleBounds,
  boxPartMinimumMm,
  boxPlane,
  boxPlanePercents,
  boxPointRange,
  boxSplitReach,
  boxVertices,
  CONNECTOR_MIN_WALL_MM,
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
  isRoundPairSpec,
  type LinkedField,
  type LinkedPart,
  linkedAlternativeUsable,
  linkedCylinder,
  linkedFieldScale,
  linkedMargin,
  linkedStart,
  linkedThinnest,
  type MagnetIssue,
  type MagnetPlan,
  type ModelSettingsInput,
  normalizeRoundConnector,
  normalizeTwist,
  obliquePlaneContainsAxis,
  obliqueSplitReach,
  type PairedCut,
  type ParameterBounds,
  type ParameterFeasibility,
  type PlateCut,
  type PlatedShape,
  pairedSplitReach,
  planMagnets,
  plateSection,
  plateThicknessRange,
  ROUND_CONNECTOR_PROPORTIONS,
  ROUND_PAIR_TYPES,
  type RoundConnectorIssue,
  type RoundConnectorOutcome,
  type RoundShape,
  roundConnectorFeasibility,
  roundDimensionsMm,
  roundPlanePercent,
  type SectionedShape,
  satisfies,
  sectionOffsetMm,
  sectionOffsetPercent,
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
  BALL_OFFSET_LIMITS,
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  BOX_SECTION_TYPES,
  type BoxSectionSpec,
  type BoxSegment,
  type BoxVertex,
  baseAngleSchema,
  baseShiftSchema,
  type ConeShape,
  type ConnectorProfile,
  type ConnectorType,
  type CylinderShape,
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
  PYRAMID_APEX,
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
  sharedGeneratrixSectionSchema,
  TILT_OFFSET_LIMITS,
  TWIST_AXIAL_CLEARANCE_LIMITS,
  TWIST_CLEARANCE_LIMITS,
  type TwistConnector,
} from '@diploma-3d/schema';
import { formatDecimal, formatSteppedDecimal, halfSumDecimal, parseDecimal, type StepRange, snapDecimal } from '../decimal.ts';
import {
  BOX_CHOICE_FIELDS,
  BOX_NUMBER_FIELDS,
  BOX_SOLIDS,
  type BoxChoices,
  type BoxKeysOf,
  type BoxNumberKey,
  type BoxSolid,
  boxContextFrom,
  boxContextOf,
  boxKeysOf,
  boxModeKeys,
  boxSectionOf,
  faceSelection,
  initialBoxChoices,
  isBoxSolid,
  normalSelection,
  pairOf,
  pairSelection,
  segmentKey,
  segmentName,
  throughLineSelection,
  traceSelection,
} from './box.ts';
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

/** The fields of planes through a shared generatrix as the schema defaults them: a right cylinder's generatrices 120° apart. */
const LINKED_DEFAULTS = sharedGeneratrixSectionSchema.parse({ type: 'shared-generatrix' });

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
  | 'cylinderAxisOffsetPercent'
  | 'cylinderAxisDirectionDeg'
  | 'cylinderLinkedGeneratrixDeg'
  | 'cylinderLinkedFirstPlaneDeg'
  | 'cylinderLinkedDihedralDeg'
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
  | 'ballSectionSecondOffsetPercent'
  | 'cylinderSectionSecondPercent'
  | 'coneSectionSecondPercent'
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
  | BoxNumberKey
  | MagnetKey;

/** The solids whose cuts offer magnet pockets, each with its own settings, as every connector has. */
type MagnetSolid = 'cylinder' | 'cone' | 'ball' | BoxSolid;

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
export type SectionChoice = 'none' | SectionType;

/** What a cone's oblique plane passes through. */

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
  /** Through a shared generatrix: whether the second plane turns from the first the other way about it. */
  cylinderLinkedOtherSide: boolean;
  /** Through a shared generatrix: whether a third plane passes through the other two generatrices. */
  cylinderLinkedThird: boolean;
  /** Whether the planes through a shared generatrix have their first values yet, which depend on the cylinder when chosen. */
  cylinderLinkedStarted: boolean;
  coneSection: SectionChoice;
  coneConnector: ConnectorChoice;
  coneDovetailEntrance: DovetailEntrance;
  coneRoundCount: 1 | 2;
  coneRoundProfile: ConnectorProfile;
  conePartsSeparated: boolean;
  /** Whether a cut parallel to the base removes a section plate, printed as a third object between the parts. */
  conePlate: boolean;
  /** Whether a plane through the apex has its first valid angle yet, which depends on the cone when it is first chosen. */
  coneApexStarted: boolean;
  /** Whether a plane through the apex is held to the cone's axis, its angle following from the cone and the direction. */
  coneApexAxial: boolean;
  ballSection: SectionChoice;
  ballConnector: ConnectorChoice;
  ballDovetailEntrance: DovetailEntrance;
  ballRoundCount: 1 | 2;
  ballRoundProfile: ConnectorProfile;
  ballPartsSeparated: boolean;
  ballPlate: boolean;
  /** Whether the ball takes a second plane parallel to the first, which "Додати паралельний переріз" turns on. */
  ballSecondCut: boolean;
  /** Whether a cylinder's or a cone's cut takes a second plane parallel to the first. */
  cylinderSecondCut: boolean;
  coneSecondCut: boolean;
} & BoxChoices;

/** The switches among the choices. */
export type ToggleKey =
  | 'cylinderPartsSeparated'
  | 'cylinderPlate'
  | 'cylinderLinkedOtherSide'
  | 'cylinderLinkedThird'
  | 'conePartsSeparated'
  | 'conePlate'
  | 'coneApexAxial'
  | 'ballPartsSeparated'
  | 'ballPlate'
  | `${BoxSolid}PartsSeparated`;

/** The choices picked from options. */
export type ChoiceKey = Exclude<
  keyof ParameterChoices,
  | ToggleKey
  | 'coneApexStarted'
  | 'cylinderLinkedStarted'
  | 'ballSecondCut'
  | 'cylinderSecondCut'
  | 'coneSecondCut'
  | `${BoxSolid}${'SecondCut' | 'LineAngleFor' | 'PointFor' | 'TraceThrough' | 'TraceThroughText' | 'TraceFor' | 'NormalFrom'}`
>;

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
  /** The field the user changed last, where a problem that several fields could cause is said. */
  readonly edited?: ParameterKey | undefined;
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
  cylinderAxisOffsetPercent: formatDecimal(DEFAULT_SECTION_OFFSET_PERCENT),
  cylinderAxisDirectionDeg: formatDecimal(AXIS_PARALLEL_DEFAULT_DIRECTION_DEG),
  cylinderLinkedGeneratrixDeg: formatDecimal(LINKED_DEFAULTS.generatrixDeg),
  cylinderLinkedFirstPlaneDeg: formatDecimal(LINKED_DEFAULTS.firstPlaneDeg),
  cylinderLinkedDihedralDeg: formatDecimal(LINKED_DEFAULTS.dihedralDeg),
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
  ballSectionSecondOffsetPercent: formatDecimal(SECOND_CUT_PLACEHOLDER_PERCENT),
  cylinderSectionSecondPercent: formatDecimal(SECOND_CUT_PLACEHOLDER_PERCENT),
  coneSectionSecondPercent: formatDecimal(SECOND_CUT_PLACEHOLDER_PERCENT),
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
  ...(Object.fromEntries(
    BOX_SOLIDS.flatMap((solid) => [...Object.entries(boxTexts(solid)), ...Object.entries(magnetTexts(solid))]),
  ) as Record<BoxNumberKey | MagnetKey, string>),
});

/** A box solid's fields as they start: its planes through the middle, a plane through an edge at 45°, the default connectors. */
const boxTexts = (solid: BoxSolid): Record<BoxNumberKey, string> => {
  const initial: Record<(typeof BOX_NUMBER_FIELDS)[number], number> = {
    SectionPercent: DEFAULT_SECTION_POSITION_PERCENT,
    SectionSecondPercent: BOX_SECOND_CUT_PLACEHOLDER_PERCENT,
    TraceAngleDeg: 0,
    LineAngleDeg: BOX_LINE_ANGLE_PLACEHOLDER_DEG,
    PointPercent: 50,
    TracePointPercent: 50,
    PlaneInclinationDeg: DEFAULT_OBLIQUE_SECTION.inclinationDeg,
    PlaneDirectionDeg: DEFAULT_OBLIQUE_SECTION.directionDeg,
    DovetailSize: DEFAULT_DOVETAIL.sizeFactor,
    DovetailLengthPercent: DEFAULT_DOVETAIL.lengthPercent,
    DovetailClearanceMm: DEFAULT_DOVETAIL.clearanceMm,
    RoundSpacingPercent: DEFAULT_ROUND_CONNECTOR.spacingPercent,
    RoundDiameter: DEFAULT_ROUND_CONNECTOR.diameterFactor,
    RoundDepth: DEFAULT_ROUND_CONNECTOR.depthFactor,
    PlugClearanceMm: DEFAULT_PLUG_CLEARANCE_MM,
    DowelLowerClearanceMm: DEFAULT_DOWEL_CLEARANCES_MM.lower,
    DowelUpperClearanceMm: DEFAULT_DOWEL_CLEARANCES_MM.upper,
  };
  return Object.fromEntries(
    Object.entries(initial).map(([field, value]) => [`${solid}${field}`, formatDecimal(value)]),
  ) as Record<BoxNumberKey, string>;
};

/** The second plane's text before it is first added, which only the hidden field holds. */
const BOX_SECOND_CUT_PLACEHOLDER_PERCENT = 75;

/** A plane through a line's angle before the solid is known; see `startLineAngle` for the one it starts with. */
const BOX_LINE_ANGLE_PLACEHOLDER_DEG = 45;

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
  cylinderLinkedOtherSide: LINKED_DEFAULTS.otherSide,
  cylinderLinkedThird: LINKED_DEFAULTS.third,
  cylinderLinkedStarted: false,
  coneSection: 'none',
  coneConnector: 'none',
  coneDovetailEntrance: 'standard',
  coneRoundCount: DEFAULT_ROUND_CONNECTOR.count,
  coneRoundProfile: DEFAULT_CONNECTOR_PROFILE,
  conePartsSeparated: true,
  conePlate: false,
  coneApexStarted: false,
  coneApexAxial: false,
  ballSection: 'none',
  ballConnector: 'none',
  ballDovetailEntrance: 'standard',
  ballRoundCount: DEFAULT_ROUND_CONNECTOR.count,
  ballRoundProfile: DEFAULT_CONNECTOR_PROFILE,
  ballPartsSeparated: true,
  ballPlate: false,
  ballSecondCut: false,
  cylinderSecondCut: false,
  coneSecondCut: false,
  ...initialBoxChoices(),
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

/**
 * The first plane's turn from the axial plane through the shared generatrix: within a half turn either way here; the cylinder
 * narrows it to the planes that cut it, see `sectionChecks`.
 */
export const validateLinkedFirstPlane = (text: string, exact?: number): Validation => {
  const read = readNumber(text, '-30', exact);
  if ('error' in read) return read;
  return Math.abs(read.value) < 180 ? read : { error: 'Кут має бути більшим за −180° і меншим за 180°.' };
};

/** The smaller dihedral angle between the planes through the shared generatrix, in (0°, 90°]. */
export const validateLinkedDihedral = (text: string, exact?: number): Validation => {
  const read = readNumber(text, '60', exact);
  if ('error' in read) return read;
  return read.value > 0 && read.value <= 90 ? read : { error: 'Кут має бути більшим за 0° і не більшим за 90°.' };
};

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

/** An angle within inclusive limits, for the planes of a box. */
const angleWithin = (limits: { readonly min: number; readonly max: number }, example: string) => (text: string, exact?: number) =>
  validateNumber(text, inclusiveRange(limits), limits, example, '°', exact);

/** A plane through a face's line turns from the face, 0°, towards it again, 180°: both of which are the face's own plane. */
export const validateLineAngle = (text: string, exact?: number): Validation => {
  const read = readNumber(text, '45', exact);
  if ('error' in read) return read;
  return read.value > 0 && read.value < 180 ? read : { error: 'Кут має бути більшим за 0° і меншим за 180°.' };
};

/** Each box solid's own validators, by field. */
const boxValidators = (solid: BoxSolid): Record<BoxNumberKey, (text: string, exact?: number) => Validation> => {
  const byField: Record<(typeof BOX_NUMBER_FIELDS)[number], (text: string, exact?: number) => Validation> = {
    SectionPercent: validateSectionPosition,
    SectionSecondPercent: validateSectionPosition,
    TraceAngleDeg: angleWithin({ min: 0, max: 180 }, '30'),
    LineAngleDeg: validateLineAngle,
    PointPercent: (text, exact) =>
      validateNumber(text, inclusiveRange({ min: 0, max: 100 }), { min: 0, max: 100 }, '50', ' %', exact),
    TracePointPercent: (text, exact) =>
      validateNumber(text, inclusiveRange({ min: 0, max: 100 }), { min: 0, max: 100 }, '50', ' %', exact),
    PlaneInclinationDeg: angleWithin({ min: 0, max: 90 }, '45'),
    PlaneDirectionDeg: validateObliqueDirection,
    DovetailSize: validateConnectorDimension,
    DovetailLengthPercent: validateConnectorDimension,
    DovetailClearanceMm: validateDovetailClearance,
    RoundSpacingPercent: validateConnectorDimension,
    RoundDiameter: validateConnectorDimension,
    RoundDepth: validateConnectorDimension,
    PlugClearanceMm: validateDiametralClearance,
    DowelLowerClearanceMm: validateDiametralClearance,
    DowelUpperClearanceMm: validateDiametralClearance,
  };
  return Object.fromEntries(Object.entries(byField).map(([field, validate]) => [`${solid}${field}`, validate])) as Record<
    BoxNumberKey,
    (text: string, exact?: number) => Validation
  >;
};

const validators = {
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
  cylinderAxisOffsetPercent: validateSectionOffset,
  cylinderAxisDirectionDeg: validateObliqueDirection,
  cylinderLinkedGeneratrixDeg: validateObliqueDirection,
  cylinderLinkedFirstPlaneDeg: validateLinkedFirstPlane,
  cylinderLinkedDihedralDeg: validateLinkedDihedral,
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
  ballSectionSecondOffsetPercent: validateSectionOffset,
  cylinderSectionSecondPercent: validateSectionPosition,
  coneSectionSecondPercent: validateSectionPosition,
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
  ...Object.fromEntries(
    BOX_SOLIDS.flatMap((solid) => [...Object.entries(boxValidators(solid)), ...Object.entries(magnetValidators(solid))]),
  ),
} as Readonly<Record<IndependentKey, (text: string, exact?: number) => Validation>>;

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
      choices,
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
      : sectionChecks(kind, resolved.shape, size.value, section.section, options.connectorEdits, options.edited);
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

/** Whether a section plate is chosen for the shape's active cut; two parallel planes take none. */
export function plateChosen(kind: ShapeKind, choices: ParameterChoices): boolean {
  const keys = sectionKeys[kind];
  const plate = keys?.plate;
  const section = activeSection(kind, choices);
  return (
    plate !== undefined &&
    choices[plate.toggle] &&
    section !== undefined &&
    section !== 'shared-generatrix' &&
    !secondCutChosen(kind, choices)
  );
}

/** Whether the shape's active cut has a second parallel plane. */
export function secondCutChosen(kind: ShapeKind, choices: ParameterChoices): boolean {
  const second = sectionKeys[kind]?.secondCut;
  const section = activeSection(kind, choices);
  return (
    second !== undefined &&
    choices[second.toggle] &&
    (section === 'horizontal' ||
      (section !== undefined && isBoxSolid(kind)) ||
      (section !== undefined && (ROUND_PAIR_TYPES as readonly string[]).includes(section)))
  );
}

/** The second plane's text before it is first added, which only the hidden field holds. */
const SECOND_CUT_PLACEHOLDER_PERCENT = 40;

/**
 * The state with a second plane parallel to the first: the first plane keeps its position, and the second starts halfway
 * between it and the farther end of the positions a plane may take, on the other side, so that the two are well apart; a first
 * plane at the centre gets the second above it. Until the first plane is valid, it counts as through the centre.
 */
export function addSecondCut(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState {
  const keys = sectionKeys[kind];
  const second = keys?.secondCut;
  if (keys === undefined || second === undefined) return state;
  if (isBoxSolid(kind) || kind === 'cylinder' || kind === 'cone') {
    // Positions run from 10 % to 90 % of the solid's extent along the planes' normal; the first plane is where it is.
    const first = (isBoxSolid(kind) ? boxFirstPercent(kind, state.choices, values) : roundFirstPercent(kind, state)) ?? 50;
    const { min, max } = SECTION_POSITION_LIMITS;
    const start = (first + (first <= (min + max) / 2 ? max : min)) / 2;
    return {
      ...state,
      texts: { ...state.texts, [second.offset]: formatDecimal(Math.round(start * 10) / 10) },
      choices: { ...state.choices, [second.toggle]: true },
    };
  }
  const limit =
    values.printSizeMm === undefined
      ? BALL_OFFSET_LIMITS.max
      : ballOffsetLimitPercent({ longestDimensionMm: values.printSizeMm });
  const first = values[keys.offset] ?? 0;
  const start = (first + (first <= 0 ? limit : -limit)) / 2;
  return {
    ...state,
    texts: { ...state.texts, [second.offset]: formatDecimal(Math.round(start * 10) / 10) },
    choices: { ...state.choices, [second.toggle]: true },
  };
}

/** The state with the single plane again, the first one as it is. */
export function removeSecondCut(kind: ShapeKind, state: ParameterState): ParameterState {
  const second = sectionKeys[kind]?.secondCut;
  if (second === undefined) return state;
  return { ...state, choices: { ...state.choices, [second.toggle]: false } };
}

/**
 * Where a cylinder's or a cone's first plane lies across the solid, in percent of its extent along the normal: the plane its
 * construction makes, alone; undefined while the solid or the plane is not valid.
 */
function roundFirstPercent(kind: 'cylinder' | 'cone', state: ParameterState): number | undefined {
  const second = sectionKeys[kind]?.secondCut;
  if (second === undefined) return undefined;
  const { spec } = resolveModelRequest(kind, state.texts, { ...state.choices, [second.toggle]: false }, { exact: state.exact });
  const section = spec?.section;
  if (spec === undefined || section === undefined || !(ROUND_PAIR_TYPES as readonly string[]).includes(section.type)) {
    return undefined;
  }
  const { connector: _connector, plate: _plate, ...plain } = section as Section & { readonly plate?: unknown };
  try {
    return roundPlanePercent(spec.shape as RoundShape, spec.scale, cutOfSection(plain as Section) as PairedCut['first']);
  } catch {
    return undefined;
  }
}

/**
 * Where a box's first plane lies across the solid, in percent of its extent along the normal: its own position, or for a plane
 * through a line, where that line puts it; undefined while the solid or the plane is not valid.
 */
function boxFirstPercent(kind: BoxSolid, choices: ParameterChoices, values: ParameterValues): number | undefined {
  const keys = boxKeysOf(kind);
  const type = activeSection(kind, choices);
  if (type === undefined || !isBoxSectionType(type)) return undefined;
  if (type === 'face-parallel' || type === 'longitudinal' || type === 'inclined') return values[keys.SectionPercent];
  const context = boxContextFrom(kind, values, choices);
  const { shape } = context;
  const fields = boxModeKeys(keys, type, choices, context);
  if (shape === undefined || values.printSizeMm === undefined || fields.some((key) => values[key] === undefined))
    return undefined;
  const spec = boxSectionOf(keys, type, choices, (key) => values[key] as number, false, context);
  try {
    return boxPlanePercents(boxVertices(shape as BoxLikeShape, { longestDimensionMm: values.printSizeMm }), spec).first;
  } catch {
    return undefined;
  }
}

/** Whether a section is one of a cube's or parallelepiped's modes. */
export const isBoxSectionType = (type: SectionType): type is BoxSectionSpec['type'] =>
  (BOX_SECTION_TYPES as readonly string[]).includes(type);

/** The state with the longitudinal plane through its trace's line again, after its position was moved off it. */
export function traceThrough(kind: ShapeKind, state: ParameterState): ParameterState {
  if (!isBoxSolid(kind)) return state;
  const keys = boxKeysOf(kind);
  return { ...state, choices: { ...state.choices, [keys.TraceThrough]: true, [keys.TraceThroughText]: '' } };
}

/**
 * A longitudinal plane along a line of the base passes through that line when the line is chosen, and keeps passing through it
 * whatever the solid becomes, its position field showing where that puts the plane, until the field is edited: the plane then
 * stays parallel to the line only, at the position typed. Undefined when nothing changes.
 */
export function followTrace(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  if (!isBoxSolid(kind)) return undefined;
  const keys = boxKeysOf(kind);
  const { choices, texts } = state;
  if (activeSection(kind, choices) !== 'longitudinal') return undefined;
  const context = boxContextFrom(kind, values, choices);
  const { kind: trace, segment, vertex } = traceSelection(keys, choices, context);
  if (trace === 'angle') return undefined;
  const marker = `${trace}:${segment === undefined ? '' : segmentKey(segment)}:${vertex ?? ''}`;
  if (choices[keys.TraceFor] !== marker) {
    return { ...state, choices: { ...choices, [keys.TraceFor]: marker, [keys.TraceThrough]: true, [keys.TraceThroughText]: '' } };
  }
  if (!choices[keys.TraceThrough]) return undefined;
  const shown = choices[keys.TraceThroughText];
  if (shown !== '' && texts[keys.SectionPercent] !== shown) {
    return { ...state, choices: { ...choices, [keys.TraceThrough]: false, [keys.TraceThroughText]: '' } };
  }
  const { shape } = context;
  if (shape === undefined || values.printSizeMm === undefined) return undefined;
  const spec = boxSectionOf(keys, 'longitudinal', choices, () => 50, false, context);
  let percent: number;
  try {
    percent = boxPlanePercents(boxVertices(shape, { longestDimensionMm: values.printSizeMm }), spec).first;
  } catch {
    return undefined;
  }
  const text = formatDecimal(Math.round(percent * 100) / 100);
  if (text === texts[keys.SectionPercent] && text === shown) return undefined;
  const exact = { ...state.exact };
  delete exact[keys.SectionPercent];
  return {
    ...state,
    texts: { ...texts, [keys.SectionPercent]: text },
    choices: { ...choices, [keys.TraceThroughText]: text },
    exact,
  };
}

/** The state with an inclined plane perpendicular to the lateral edges, n = a/|a|, at its position. */
export function normalAlongLateral(kind: ShapeKind, state: ParameterState): ParameterState {
  if (!isBoxSolid(kind)) return state;
  return { ...state, choices: { ...state.choices, [boxKeysOf(kind).NormalAlong]: 'A-A1' } };
}

/** The state with an inclined plane given by its angles again; `followNormal` sets them to the plane it was. */
export function normalAlongManual(kind: ShapeKind, state: ParameterState): ParameterState {
  if (!isBoxSolid(kind)) return state;
  const keys = boxKeysOf(kind);
  return { ...state, choices: { ...state.choices, [keys.NormalAlong]: 'none', [keys.ParallelEdges]: 'none' } };
}

// A normal this close to vertical makes the plane horizontal, whose direction of rise does not exist.
const VERTICAL_NORMAL_ROUNDOFF = 1e-12;

/**
 * An inclined plane perpendicular to a segment, or parallel to a pair of opposite edges, that is given by its angles again stays
 * the very plane it was, both planes of a second cut with it: its angles are read off its current normal n, from `obliqueAxes`, n = (−sin α cos φ, −sin α sin φ, cos α)
 * with n turned upwards, so that α = arccos n_z ≤ 90° and φ = atan2(−n_y, −n_x); the positions are kept along n, or measured
 * from the other side, 100 − p, where n had to turn, as the extent along −n is the same one reversed. A horizontal plane, α = 0,
 * rises in no direction: the direction field keeps its value, which does not change the plane. The angles' full values are kept
 * behind their rounded texts. While the plane is perpendicular to a segment, that segment is remembered for this; it follows the
 * solid as before. Only for the inclined mode, whose position field the other modes share. Undefined when nothing changes,
 * or while the plane is not valid yet.
 */
export function followNormal(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  if (!isBoxSolid(kind)) return undefined;
  const keys = boxKeysOf(kind);
  const { choices } = state;
  if (activeSection(kind, choices) !== 'inclined') return undefined;
  const context = boxContextFrom(kind, values, choices);
  const pair = pairSelection(keys, choices, context);
  const along = pair === 'none' ? normalSelection(keys, choices, context) : pair;
  const from = choices[keys.NormalFrom];
  if (along !== 'none') return from === along ? undefined : { ...state, choices: { ...choices, [keys.NormalFrom]: along } };
  if (from === '') return undefined;
  const { shape } = context;
  const position = values[keys.SectionPercent];
  if (shape === undefined || values.printSizeMm === undefined || position === undefined) return undefined;
  const constraint = from.includes('|')
    ? { [keys.NormalAlong]: 'none', [keys.ParallelEdges]: from }
    : { [keys.NormalAlong]: from, [keys.ParallelEdges]: 'none' };
  const spec = boxSectionOf(
    keys,
    'inclined',
    { ...choices, ...constraint } as ParameterChoices,
    (key) => values[key] as number,
    false,
    context,
  );
  let normal: readonly [number, number, number];
  try {
    normal = boxPlane(boxVertices(shape, { longestDimensionMm: values.printSizeMm }), spec).normal;
  } catch {
    return undefined;
  }
  const flip = normal[2] < 0;
  const [x, y, z] = flip ? normal.map((value) => -value) : normal;
  const texts = { ...state.texts };
  const exact = { ...state.exact };
  const show = (key: BoxNumberKey, value: number) => {
    texts[key] = formatDecimal(value);
    exact[key] = value;
  };
  show(keys.PlaneInclinationDeg, (Math.acos(Math.min(Math.max(z as number, -1), 1)) * 180) / Math.PI);
  if (Math.hypot(x as number, y as number) > VERTICAL_NORMAL_ROUNDOFF) {
    show(keys.PlaneDirectionDeg, ((((Math.atan2(-(y as number), -(x as number)) * 180) / Math.PI) % 360) + 360) % 360);
  }
  if (flip) {
    show(keys.SectionPercent, 100 - position);
    const second = values[keys.SectionSecondPercent];
    if (second !== undefined) show(keys.SectionSecondPercent, 100 - second);
  }
  return { ...state, texts, exact, choices: { ...choices, [keys.NormalFrom]: '' } };
}

/**
 * The position of a plane parallel to a pair of opposite edges through H, the foot of the pyramid's height, d = n·H: for the
 * fields, in percent of the extent along the plane's normal; undefined while the plane is not valid.
 */
export function heightFootPercent(kind: ShapeKind, choices: ParameterChoices, values: ParameterValues): number | undefined {
  if (!isBoxSolid(kind) || activeSection(kind, choices) !== 'inclined') return undefined;
  const keys = boxKeysOf(kind);
  const context = boxContextFrom(kind, values, choices);
  const pair = pairSelection(keys, choices, context);
  if (pair === 'none' || context.shape === undefined || values.printSizeMm === undefined) return undefined;
  const vertices = boxVertices(context.shape, { longestDimensionMm: values.printSizeMm });
  const plane = boxPlane(vertices, {
    type: 'inclined',
    inclinationDeg: 0,
    directionDeg: 0,
    parallelTo: pairOf(pair),
    positionPercent: 50,
  });
  const [x, y] = vertices[PYRAMID_APEX];
  const foot = plane.normal[0] * x + plane.normal[1] * y;
  return (100 * (foot - plane.extent.min)) / (plane.extent.max - plane.extent.min);
}

/** The state with the plane parallel to the pair of opposite edges through the foot of the pyramid's height, see above. */
export function throughHeightFoot(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState {
  const percent = heightFootPercent(kind, state.choices, values);
  if (percent === undefined || !isBoxSolid(kind)) return state;
  const key = boxKeysOf(kind).SectionPercent;
  return { ...state, texts: { ...state.texts, [key]: formatDecimal(percent) }, exact: { ...state.exact, [key]: percent } };
}

/** The state with the point of a plane through a pyramid's lateral edge at the middle of its base edge. */
export function tracePointAtMidpoint(kind: ShapeKind, state: ParameterState): ParameterState {
  if (!isBoxSolid(kind)) return state;
  const keys = boxKeysOf(kind);
  const exact = { ...state.exact };
  delete exact[keys.TracePointPercent];
  return { ...state, texts: { ...state.texts, [keys.TracePointPercent]: '50' }, exact };
}

/**
 * A point of a base edge for a plane through a pyramid's lateral edge, on a newly chosen edge, stays where it is when it gives a
 * usable plane there, and otherwise moves to the edge's midpoint or the middle of its usable positions, as `startPoint` does.
 */
export function startTracePoint(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  if (!isBoxSolid(kind)) return undefined;
  const keys = boxKeysOf(kind);
  const { choices } = state;
  if (activeSection(kind, choices) !== 'through-apex') return undefined;
  const context = boxContextFrom(kind, values, choices);
  const { kind: trace, vertex, segment } = traceSelection(keys, choices, context);
  if (trace !== 'edge-point' || vertex === undefined || segment === undefined) return undefined;
  const marker = `apex:${vertex}:${segmentKey(segment)}`;
  if (choices[keys.PointFor] === marker) return undefined;
  const { shape } = context;
  if (shape === undefined || values.printSizeMm === undefined) return undefined;
  const range = boxApexPointRange(shape, { longestDimensionMm: values.printSizeMm }, vertex, segment);
  const next = { ...state, choices: { ...choices, [keys.PointFor]: marker } };
  if (range === null) return next;
  const allowed = pointInterval(range);
  const current = values[keys.TracePointPercent];
  const within = (percent: number) =>
    percent >= allowed.min - CONSTRAINT_ROUNDOFF_MM && percent <= allowed.max + CONSTRAINT_ROUNDOFF_MM;
  if (current !== undefined && within(current)) return next;
  const grid = planeAngleRange(allowed, POINT_PERCENT_INCREMENT);
  const start = within(50) ? 50 : snapDecimal((grid.min + grid.max) / 2, grid);
  const exact = { ...state.exact };
  delete exact[keys.TracePointPercent];
  return { ...next, texts: { ...state.texts, [keys.TracePointPercent]: formatSteppedDecimal(start) }, exact };
}

/** The state with the point of a plane through a line at the middle of its edge. */
export function pointAtMidpoint(kind: ShapeKind, state: ParameterState): ParameterState {
  if (!isBoxSolid(kind)) return state;
  const keys = boxKeysOf(kind);
  const exact = { ...state.exact };
  delete exact[keys.PointPercent];
  return { ...state, texts: { ...state.texts, [keys.PointPercent]: '50' }, exact };
}

/**
 * Whether the box's current valid plane is horizontal, so that its parts are the lower and the upper one, as the engine names
 * them; any other plane numbers them. False while the solid or the plane is not valid.
 */
export function boxCutHorizontal(kind: ShapeKind, choices: ParameterChoices, values: ParameterValues): boolean {
  if (!isBoxSolid(kind)) return false;
  const keys = boxKeysOf(kind);
  const type = activeSection(kind, choices);
  const context = boxContextFrom(kind, values, choices);
  const { shape } = context;
  if (type === undefined || !isBoxSectionType(type) || shape === undefined || values.printSizeMm === undefined) return false;
  if (boxModeKeys(keys, type, choices, context).some((key) => values[key] === undefined)) return false;
  const spec = boxSectionOf(keys, type, choices, (key) => values[key] as number, false, context);
  return boxPlaneHorizontal(shape as BoxLikeShape, values.printSizeMm, spec as Section);
}

/**
 * A plane parallel to a face is chosen by one face of each group of parallel faces, see `boxFaceOrientations`; one given by
 * another face of its group, as an earlier choice may be, becomes the same plane measured from its representative: both planes'
 * positions are read through the planes themselves, see `boxFaceParallelPercent`, so that neither moves. A position that is not
 * a valid number yet stays as typed. Undefined when the face is a representative, the solid is not valid, or the mode is
 * another one, whose positions share the field.
 */
function representFace(kind: BoxSolid, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  const keys = boxKeysOf(kind);
  const face = state.choices[keys.Face];
  if (activeSection(kind, state.choices) !== 'face-parallel') return undefined;
  const { shape, orientations } = boxContextFrom(kind, values, state.choices);
  const representative = orientations?.[face];
  if (shape === undefined || representative === undefined || representative === face || values.printSizeMm === undefined) {
    return undefined;
  }
  const scale = { longestDimensionMm: values.printSizeMm };
  const texts = { ...state.texts };
  const exact = { ...state.exact };
  for (const key of [keys.SectionPercent, keys.SectionSecondPercent]) {
    const percent = values[key];
    if (percent === undefined) continue;
    const converted = boxFaceParallelPercent(shape, scale, face, percent, representative);
    texts[key] = formatDecimal(Math.round(converted * 1e9) / 1e9);
    delete exact[key];
  }
  return { ...state, texts, exact, choices: { ...state.choices, [keys.Face]: representative } };
}

/**
 * An inclined plane is perpendicular to a segment or parallel to a pair of opposite edges, not both: of two chosen at once, the
 * one just chosen, unlike the constraint remembered in NormalFrom, stays, and the other is cleared; one the solid does not have
 * is cleared too, see `normalSelection` and `pairSelection`.
 */
function constraintSettled(keys: BoxKeysOf, choices: ParameterChoices, context: ReturnType<typeof boxContextFrom>) {
  const along = normalSelection(keys, choices, context);
  const pair = pairSelection(keys, choices, context);
  if (along !== 'none' && pair !== 'none') {
    return choices[keys.NormalFrom] === pair
      ? { [keys.NormalAlong]: along, [keys.ParallelEdges]: 'none' as const }
      : { [keys.NormalAlong]: 'none' as const, [keys.ParallelEdges]: pair };
  }
  return { [keys.NormalAlong]: along, [keys.ParallelEdges]: pair };
}

/**
 * The choices of a box's planes that the fields offer, for the solid's current base, all replaced together before any model is
 * made of them; undefined when they are all offered. A face, a line, a vertex or a segment that the solid no longer has, as when
 * a prism's base changes, gives way as the fields' own lists do, see `faceSelection`, `traceSelection` and
 * `throughLineSelection`; a plane perpendicular to a segment the solid lacks is given by its angles again, and one perpendicular
 * to any lateral edge is perpendicular to the lateral edges, as all of them are parallel.
 */
export function settleBoxChoices(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  if (!isBoxSolid(kind)) return undefined;
  const keys = boxKeysOf(kind);
  const opposite = representFace(kind, state, values);
  if (opposite !== undefined) return opposite;
  const { choices } = state;
  const context = boxContextFrom(kind, values, choices);
  const lines = throughLineSelection(keys, choices, context);
  const trace = traceSelection(keys, choices, context);
  const settled = {
    [keys.Face]: faceSelection(keys, choices, context).face,
    [keys.LineFace]: lines.face,
    [keys.Line]: segmentKey(lines.line),
    [keys.LineMethod]: lines.method,
    [keys.PointEdge]: segmentKey(lines.pointEdge),
    [keys.Trace]: trace.kind,
    ...(trace.segment === undefined ? {} : { [keys.TraceSegment]: segmentKey(trace.segment) }),
    ...(trace.vertex === undefined ? {} : { [keys.TraceVertex]: trace.vertex }),
    ...constraintSettled(keys, choices, context),
  };
  if (Object.entries(settled).every(([key, value]) => choices[key as keyof typeof choices] === value)) return undefined;
  return { ...state, choices: { ...choices, ...settled } };
}

const LINE_ANGLE_INCREMENT_DEG = 5;
const POINT_PERCENT_INCREMENT = 5;

/**
 * A plane through a line by its angle starts in the middle of the angles that leave both parts usable for this solid, on the
 * step's grid: 45° for a cube's edge, through the opposite edge. Once per line; afterwards the angle is the user's, and a new
 * solid keeps it. Undefined when nothing changes.
 */
export function startLineAngle(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  if (!isBoxSolid(kind)) return undefined;
  const keys = boxKeysOf(kind);
  const { choices } = state;
  if (activeSection(kind, choices) !== 'through-line') return undefined;
  const context = boxContextFrom(kind, values, choices);
  const { shape } = context;
  const { face, line, method } = throughLineSelection(keys, choices, context);
  if (method !== 'angle') return undefined;
  const marker = `${face}:${segmentKey(line)}`;
  if (choices[keys.LineAngleFor] === marker) return undefined;
  if (shape === undefined || values.printSizeMm === undefined) return undefined;
  const bounds = boxLineAngleBounds(shape, { longestDimensionMm: values.printSizeMm }, face, line);
  const next = { ...state, choices: { ...choices, [keys.LineAngleFor]: marker } };
  if (bounds === null) return next;
  const range = planeAngleRange(bounds, LINE_ANGLE_INCREMENT_DEG);
  const exact = { ...state.exact };
  delete exact[keys.LineAngleDeg];
  return {
    ...next,
    texts: { ...state.texts, [keys.LineAngleDeg]: formatSteppedDecimal(snapDecimal((range.min + range.max) / 2, range)) },
    exact,
  };
}

/**
 * The positions a point's field allows: the usable ones, see `boxPointRange`, with an open end, where the point would lie on
 * the line, moved in by one step of the field, so that the field shows no value it would refuse.
 */
const pointInterval = (range: BoxPointRange): Interval => ({
  min: range.minOpen ? range.min + POINT_PERCENT_INCREMENT : range.min,
  max: range.maxOpen ? range.max - POINT_PERCENT_INCREMENT : range.max,
});

/**
 * A point on a newly chosen edge, or on an edge that a new line or face leaves, stays where it is when it gives a usable plane
 * there, and otherwise moves to the edge's midpoint, or where that is not usable either to the middle of the usable positions,
 * on the field's grid. Once per line and edge; afterwards the position is the user's. Undefined when nothing changes.
 */
export function startPoint(kind: ShapeKind, state: ParameterState, values: ParameterValues): ParameterState | undefined {
  if (!isBoxSolid(kind)) return undefined;
  const keys = boxKeysOf(kind);
  const { choices } = state;
  if (activeSection(kind, choices) !== 'through-line') return undefined;
  const context = boxContextFrom(kind, values, choices);
  const { shape } = context;
  const { face, line, method, pointEdge } = throughLineSelection(keys, choices, context);
  if (method !== 'point') return undefined;
  const marker = `${face}:${segmentKey(line)}:${segmentKey(pointEdge)}`;
  if (choices[keys.PointFor] === marker) return undefined;
  if (shape === undefined || values.printSizeMm === undefined) return undefined;
  const range = boxPointRange(shape, { longestDimensionMm: values.printSizeMm }, face, line, pointEdge);
  const next = { ...state, choices: { ...choices, [keys.PointFor]: marker } };
  if (range === null) return next;
  const allowed = pointInterval(range);
  const current = values[keys.PointPercent];
  const within = (percent: number) =>
    percent >= allowed.min - CONSTRAINT_ROUNDOFF_MM && percent <= allowed.max + CONSTRAINT_ROUNDOFF_MM;
  if (current !== undefined && within(current)) return next;
  const grid = planeAngleRange(allowed, POINT_PERCENT_INCREMENT);
  const start = within(50) ? 50 : snapDecimal((grid.min + grid.max) / 2, grid);
  const exact = { ...state.exact };
  delete exact[keys.PointPercent];
  return { ...next, texts: { ...state.texts, [keys.PointPercent]: formatSteppedDecimal(start) }, exact };
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
  if (
    kind !== 'cylinder' ||
    activeSection(kind, choices) !== 'parallel-to-bases' ||
    plateChosen(kind, choices) ||
    secondCutChosen(kind, choices)
  ) {
    return false;
  }
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
    'middle-thin': `у середній частині між отворами обох перерізів лишається ${shortfall}`,
    'base-thin': `за виступом лишається ${shortfall}`,
    'keying-lost': `більший ${pin} ширший за менший отвір лише на ${shortfall}`,
  };
  const reason = issue === undefined ? undefined : what[issue.code];
  return (
    `Кріплення не вміщується${reason === undefined ? '' : `: ${reason}`}. Змініть переріз або розмір моделі, спробуйте інший профіль ` +
    'чи кількість або оберіть «Без кріплення». Доти завантаження вимкнено.'
  );
}

/** What a round connector's fit depends on but its own dimensions, as `ConnectorStatus.context` records it. */
const roundContext = (shape: SectionedShape, longestDimensionMm: number, section: Section, connector: RoundConnector) =>
  JSON.stringify([shape, longestDimensionMm, cutOfSection(section), connector.type, connector.profile, connector.count]);

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
  const context = roundContext(shape, longestDimensionMm, section, connector);
  const edited = edits[shape.kind];
  const { type } = connector;
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
  edited?: ParameterKey,
): SectionCheck | undefined {
  const keys = sectionKeys[kind];
  if (keys?.box !== undefined && isBoxSolid(shape.kind) && isBoxSectionType(section.type)) {
    return boxChecks(keys, shape as BoxLikeShape, longestDimensionMm, section as BoxSection, edits);
  }
  if (keys === undefined || (shape.kind !== 'cylinder' && shape.kind !== 'cone' && shape.kind !== 'ball')) return undefined;
  if (isRoundPairSpec(section) && (shape.kind === 'cylinder' || shape.kind === 'cone')) {
    return roundPairChecks(kind, keys, shape as RoundShape, longestDimensionMm, section, edits);
  }
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
  if (section.type === 'axis-parallel')
    return axisParallelChecks(keys, solid as CylinderShape, longestDimensionMm, section, edits);
  if (section.type === 'shared-generatrix') {
    return linkedChecks(keys, solid as CylinderShape, longestDimensionMm, section, edits, edited);
  }
  if (section.type !== 'vertical') return undefined;
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

/**
 * A cylinder's or a cone's two parallel planes: the first by its own cut's rules, as alone; then the second within the solid and
 * far enough from the first for usable parts, see `pairedSplitReach`; then the connector at each plane, which sees the other, as
 * for a ball's or a box's two planes. Nothing is moved to make anything fit.
 */
function roundPairChecks(
  kind: ShapeKind,
  keys: SectionKeys,
  shape: RoundShape,
  longestDimensionMm: number,
  section: Section & { readonly secondPositionPercent: number },
  edits: ConnectorEdits | undefined,
): SectionCheck {
  const { secondPositionPercent: _second, connector: _connector, ...plain } = section;
  const first = sectionChecks(kind, shape, longestDimensionMm, plain as Section, edits);
  if (first !== undefined && Object.keys(first.errors).length > 0) return first;
  const secondKey = keys.secondCut?.offset;
  const ranges: SectionRanges = {
    ...first?.ranges,
    ...(secondKey === undefined ? {} : { [secondKey]: SECTION_POSITION_LIMITS }),
  };
  const reach = pairedSplitReach(shape, { longestDimensionMm }, cutOfSection(section) as PairedCut);
  if (!satisfies(reach) && secondKey !== undefined) {
    return {
      errors: {
        [secondKey]:
          `Одна з частин біля другого перерізу була б завтовшки лише ${millimetres(reach.valueMm)}, потрібно щонайменше ` +
          `${formatMillimetres(reach.minimumMm)} мм. Відсуньте другий переріз від першого й від краю фігури або збільште модель.`,
      },
      ranges,
    };
  }
  return pairedConnectorChecks(keys, shape, longestDimensionMm, section, edits, ranges);
}

/** A cube's or parallelepiped's section with its connector, as the specification has it. */
type BoxSection = Extract<Section, { type: BoxSectionSpec['type'] }>;

/** The field that moves a box's plane: its position, or for a plane through a line its angle or its point. */
/**
 * The field that moves a box's plane: its position, for a plane through a line its angle or its point, for one through a
 * pyramid's apex its trace's position or point; a plane through the apex and a line of the base has no field of its own, and
 * only the model's size can make it fit.
 */
const boxPlaneField = (box: BoxKeysOf, section: BoxSection): ParameterKey => {
  switch (section.type) {
    case 'through-line':
      return section.method === 'angle' ? box.LineAngleDeg : box.PointPercent;
    case 'through-apex':
      return section.trace === 'angle'
        ? box.SectionPercent
        : section.trace === 'edge-point'
          ? box.TracePointPercent
          : 'printSizeMm';
    default:
      return box.SectionPercent;
  }
};

/**
 * A cube's or parallelepiped's plane: an angle about a line within those that leave both parts usable, a point off the line,
 * positions within the solid's extent that leave both parts at least their minimum along the normal, see `boxPartMinimumMm`,
 * and a second plane far enough from the first for a usable middle part; then the connector at each plane. The positions'
 * ranges follow from the solid's extent along the normal. Nothing is moved to make anything fit.
 */
function boxChecks(
  keys: SectionKeys,
  shape: BoxLikeShape,
  longestDimensionMm: number,
  section: BoxSection,
  edits: ConnectorEdits | undefined,
): SectionCheck {
  const box = keys.box as BoxKeysOf;
  const scale = { longestDimensionMm };
  const { connector: _connector, ...spec } = section;
  const ranges: SectionRanges = {};
  const field = boxPlaneField(box, section);
  if (section.type === 'through-line' && section.method === 'angle') {
    const bounds = boxLineAngleBounds(shape, scale, section.face, section.line);
    ranges[box.LineAngleDeg] = bounds;
    const name = segmentName(section.line);
    if (bounds === null) {
      return {
        errors: {
          [field]: `За жодного кута площина через ${name} не лишає обом частинам придатної товщини. Виберіть іншу пряму або збільште модель.`,
        },
        ranges,
      };
    }
    const angle = section.angleDeg as number;
    if (angle < bounds.min - CONSTRAINT_ROUNDOFF_MM || angle > bounds.max + CONSTRAINT_ROUNDOFF_MM) {
      const shown = planeAngleRange(bounds, 1);
      return {
        errors: {
          [field]:
            `За цього кута одна з частин була б надто тонкою. Для прямої ${name} допустимо від ${formatDecimal(shown.min)}° ` +
            `до ${formatDecimal(shown.max)}°.`,
        },
        ranges,
      };
    }
  }
  if (section.type === 'through-apex' && section.trace === 'angle') {
    // The trace's position across the base, which keeps the plane through the apex: its own range, not the extent along n.
    const bounds = boxApexPositionBounds(shape, scale, section.traceAngleDeg);
    ranges[box.SectionPercent] = bounds;
    const percent = section.positionPercent;
    if (bounds === null || percent < bounds.min - CONSTRAINT_ROUNDOFF_MM || percent > bounds.max + CONSTRAINT_ROUNDOFF_MM) {
      return {
        errors: {
          [field]:
            bounds === null
              ? 'За жодного положення сліду площина через вершину не лишає обом частинам придатної товщини: збільште модель.'
              : `За цього положення сліду одна з частин була б надто тонкою. Допустимо від ${formatDecimal(Math.ceil(bounds.min * 10) / 10)} % ` +
                `до ${formatDecimal(Math.floor(bounds.max * 10) / 10)} %.`,
        },
        ranges,
      };
    }
  }
  if (section.type === 'through-apex' && section.trace === 'edge-point') {
    const vertex = section.traceVertex as BoxVertex;
    const edge = section.traceSegment as BoxSegment;
    const range = boxApexPointRange(shape, scale, vertex, edge);
    const interval = range === null ? null : pointInterval(range);
    ranges[box.TracePointPercent] = interval;
    const percent = section.tracePointPercent as number;
    const lateral = segmentName([PYRAMID_APEX, vertex]);
    if (range === null || interval === null) {
      return {
        errors: {
          [field]: `Жодна точка ребра ${segmentName(edge)} не дає з ${lateral} площини, що лишає обом частинам придатну товщину. Збільште модель.`,
        },
        ranges,
      };
    }
    if (percent < interval.min - CONSTRAINT_ROUNDOFF_MM || percent > interval.max + CONSTRAINT_ROUNDOFF_MM) {
      const end =
        (range.minOpen && percent <= range.min + CONSTRAINT_ROUNDOFF_MM) ||
        (range.maxOpen && percent >= range.max - CONSTRAINT_ROUNDOFF_MM);
      return {
        errors: {
          [field]: end
            ? `Ця точка лежить на прямій ${lateral} або дає грань піраміди, тож перерізу немає. Пересуньте точку.`
            : `За цього положення точки одна з частин була б надто тонкою. На ребрі ${segmentName(edge)} допустимо від ` +
              `${formatDecimal(Math.ceil(interval.min * 10) / 10)} % до ${formatDecimal(Math.floor(interval.max * 10) / 10)} %.`,
        },
        ranges,
      };
    }
  }
  const collinear = (point: BoxSegment | undefined) =>
    `Точка${point === undefined ? '' : ` на ребрі ${segmentName(point)}`} лежить на прямій ${section.type === 'through-line' ? segmentName(section.line) : ''}, ` +
    'тож площину не визначено. Пересуньте точку або виберіть інше ребро.';
  if (section.type === 'through-line' && section.method === 'point') {
    const edge = section.pointEdge as BoxSegment;
    const range = boxPointRange(shape, scale, section.face, section.line, edge);
    const interval = range === null ? null : pointInterval(range);
    ranges[box.PointPercent] = interval;
    const name = segmentName(edge);
    if (range === null || interval === null) {
      return {
        errors: {
          [field]: `Жодна точка ребра ${name} не лишає обом частинам придатної товщини. Виберіть інше ребро або збільште модель.`,
        },
        ranges,
      };
    }
    const percent = section.pointPercent as number;
    if (percent < interval.min - CONSTRAINT_ROUNDOFF_MM || percent > interval.max + CONSTRAINT_ROUNDOFF_MM) {
      const onLine =
        (range.minOpen && percent <= range.min + CONSTRAINT_ROUNDOFF_MM) ||
        (range.maxOpen && percent >= range.max - CONSTRAINT_ROUNDOFF_MM);
      return {
        errors: {
          [field]: onLine
            ? collinear(edge)
            : `За цього положення точки одна з частин була б надто тонкою. На ребрі ${name} допустимо від ` +
              `${formatDecimal(Math.ceil(interval.min * 10) / 10)} % до ${formatDecimal(Math.floor(interval.max * 10) / 10)} %.`,
        },
        ranges,
      };
    }
  }
  const vertices = boxVertices(shape, scale);
  let plane: ReturnType<typeof boxPlane>;
  try {
    plane = boxPlane(vertices, spec as BoxSectionSpec);
  } catch {
    return {
      errors: { [field]: collinear(section.type === 'through-line' ? section.pointEdge : undefined) },
      ranges,
    };
  }
  const span = plane.extent.max - plane.extent.min;
  const least = boxPartMinimumMm(plane.extent);
  const edge = Math.max(SECTION_POSITION_LIMITS.min, (100 * least) / span);
  const allowed = edge <= 50 ? { min: edge, max: 100 - edge } : null;
  // A plane through a line or through the apex is placed by its own fields; the others by their position along n.
  if (section.type !== 'through-line' && section.type !== 'through-apex') ranges[box.SectionPercent] = allowed;
  const allowedText = (shown: Interval | null) =>
    shown === null
      ? 'Модель замала для двох придатних частин уздовж цього напряму: збільште її.'
      : `Допустимі значення — від ${formatDecimal(Math.ceil(shown.min * 10) / 10)} % до ${formatDecimal(Math.floor(shown.max * 10) / 10)} %: ` +
        'усі частини мають лишатися придатними до друку.';
  const reach = boxSplitReach(shape, scale, { box: spec as BoxSectionSpec });
  if (!satisfies(reach)) {
    return {
      errors: {
        [field]:
          section.type === 'through-line' || section.type === 'through-apex'
            ? `Тонша частина сягає від площини лише ${millimetres(reach.valueMm)}, потрібно щонайменше ` +
              `${millimetres(reach.minimumMm)}. Змініть побудову або збільште модель.`
            : allowedText(allowed),
      },
      ranges,
    };
  }
  const second = section.secondPositionPercent;
  if (second === undefined || keys.secondCut === undefined) {
    const connector = connectorChecks(keys, shape, longestDimensionMm, section, edits);
    return connector === undefined ? { errors: {}, ranges } : { ...connector, ranges: { ...ranges, ...connector.ranges } };
  }
  const secondKey = keys.secondCut.offset;
  const allRanges: SectionRanges = { ...ranges, [secondKey]: allowed };
  if (allowed === null || second < allowed.min - CONSTRAINT_ROUNDOFF_MM || second > allowed.max + CONSTRAINT_ROUNDOFF_MM) {
    return { errors: { [secondKey]: allowedText(allowed) }, ranges: allRanges };
  }
  const first = boxPlanePercents(vertices, spec as BoxSectionSpec).first;
  const thickness = (Math.abs(second - first) / 100) * span;
  if (thickness < least - CONSTRAINT_ROUNDOFF_MM) {
    return {
      errors: {
        [secondKey]:
          `Перерізи надто близько: середня частина має завтовшки ${millimetres(thickness)}, а потрібно щонайменше ` +
          `${formatMillimetres(least)} мм (${formatDecimal(Math.ceil(((100 * least) / span) * 10) / 10)} % між перерізами). ` +
          'Розсуньте перерізи або збільште модель.',
      },
      ranges: allRanges,
    };
  }
  return pairedConnectorChecks(keys, shape, longestDimensionMm, section, edits, allRanges);
}

const HORIZONTAL_NORMAL_ROUNDOFF = 1e-9;

/** Whether a box's plane is horizontal, so that its parts are the lower and the upper one rather than numbered. */
function boxPlaneHorizontal(shape: SectionedShape, longestDimensionMm: number, section: Section): boolean {
  if (!isBoxSectionType(section.type) || !isBoxSolid(shape.kind)) return false;
  try {
    const { connector: _connector, ...spec } = section as BoxSection;
    const plane = boxPlane(boxVertices(shape as BoxLikeShape, { longestDimensionMm }), spec as BoxSectionSpec);
    // The engine's own test, which names the parts below and above such a plane the lower and the upper one.
    return Math.abs(plane.normal[2]) > 1 - HORIZONTAL_NORMAL_ROUNDOFF;
  } catch {
    return false;
  }
}

/** The words of a cut's messages: a box's horizontal plane reads like a cut parallel to the bases, any other like an oblique one. */
function cutWordingOf(shape: SectionedShape, longestDimensionMm: number, section: Section): CutWording {
  if (!isBoxSectionType(section.type)) return section.type;
  return boxPlaneHorizontal(shape, longestDimensionMm, section) ? 'parallel-to-bases' : 'oblique';
}

/** The direction a new plane parallel to the axis moves along: +Y, across the lean, as a vertical cut's. */
const AXIS_PARALLEL_DEFAULT_DIRECTION_DEG = 90;

/**
 * A plane parallel to a cylinder's axis: its base-plane line within the distance from the axis that leaves both parts usable
 * along the plane's normal, from the engine's limit for its direction, then the connector's checks. Nothing is moved.
 */
function axisParallelChecks(
  keys: SectionKeys,
  shape: CylinderShape,
  longestDimensionMm: number,
  section: Extract<Section, { type: 'axis-parallel' }>,
  edits: ConnectorEdits | undefined,
): SectionCheck {
  const offsetKey = planarKeysOf(keys).axisParallel?.offset ?? keys.offset;
  const limit = axisParallelOffsetLimitPercent(shape, { longestDimensionMm }, section.directionDeg);
  const ranges: SectionRanges = { [offsetKey]: { min: -limit, max: limit } };
  if (Math.abs(section.offsetPercent) > limit + CONSTRAINT_ROUNDOFF_MM) {
    const shown = percentRange({ min: -limit, max: limit }, 1);
    return {
      errors: {
        [offsetKey]:
          `За цього напряму допустимо від ${formatDecimal(shown.min)} % до ${formatDecimal(shown.max)} %: ` +
          'обидві частини мають лишатися придатними до друку.',
      },
      ranges,
    };
  }
  const connector = connectorChecks(keys, shape, longestDimensionMm, section, edits);
  return connector === undefined ? { errors: {}, ranges } : { ...connector, ranges: { ...ranges, ...connector.ranges } };
}

/** The state with the plane parallel to the axis moved onto the axis, an axial section; its direction stays. */
export function axialAxisParallel(kind: ShapeKind, state: ParameterState): ParameterState {
  const keys = sectionKeys[kind];
  const axis = keys === undefined || !('position' in keys) ? undefined : (keys as PlanarSectionKeys).axisParallel;
  if (axis === undefined) return state;
  const exact = { ...state.exact };
  delete exact[axis.offset];
  return { ...state, texts: { ...state.texts, [axis.offset]: '0' }, exact };
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
  const range = plateThicknessRange(
    shape as PlatedShape,
    { longestDimensionMm },
    plane as Exclude<typeof plane, { plate: unknown }>,
  );
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
  const unavailable = magnetIssuesMessage(plan.issues, cutWordingOf(shape, longestDimensionMm, section), connector);
  return {
    errors: {},
    ranges: {},
    resolved: { status: { context: '', corrections: [], unavailable }, values: {}, section: plain as Section },
  };
}

/** The part as the magnet messages name it: below or above a horizontal cut, by its number beside any other. */
const magnetPart = (part: 'lower' | 'upper', cut: CutWording) =>
  cut === 'shared-generatrix'
    ? part === 'lower'
      ? 'середня частина'
      : 'відрізана частина'
    : cut === 'parallel-to-bases' || cut === 'horizontal'
      ? part === 'lower'
        ? 'нижня частина'
        : 'верхня частина'
      : part === 'lower'
        ? 'частина 1'
        : 'частина 2';

/** What keeps the requested magnets from fitting, the part it concerns where known, and what to change; in Ukrainian. */
export function magnetIssuesMessage(issues: readonly MagnetIssue[], cut: CutWording, connector: MagnetConnector): string {
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
    case 'middle-thin':
      return (
        `Середня частина затонка для гнізд з обох боків: між ними лишається ${millimetres(first.valueMm)}, потрібно щонайменше ` +
        `${formatMillimetres(first.minimumMm)} мм. Візьміть тонші магніти, розсуньте перерізи або збільште модель.${ending}`
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
  if (section.type === 'horizontal' && section.secondOffsetPercent !== undefined && keys.secondCut !== undefined) {
    const paired = { ...section, secondOffsetPercent: section.secondOffsetPercent };
    return secondPlaneChecks(keys, keys.secondCut.offset, shape, longestDimensionMm, paired, limit, radius, edits, ranges);
  }
  const connector = connectorChecks(keys, shape, longestDimensionMm, section, edits);
  return connector === undefined ? { errors: {}, ranges } : { ...connector, ranges: { ...ranges, ...connector.ranges } };
}

/** How the messages of each plane's connector say which plane they concern. */
const PLANE_LABELS = ['Біля першого перерізу', 'Біля другого перерізу', 'Біля третього перерізу'] as const;

/**
 * A ball's two parallel planes: the second within the same limits as the first and far enough from it for a usable middle part,
 * then the connector at each plane. Each plane's own checks see the other plane, so that the middle part's connectors from both
 * sides keep their material. Both planes share the connector's settings: their feasible ranges are what both allow, and a round
 * connector fitted to the first plane is fitted to the second as well, and taken back to the first if that changed it. Nothing
 * is moved to make anything fit.
 */
function secondPlaneChecks(
  keys: SectionKeys,
  secondKey: ParameterKey,
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Extract<Section, { type: 'horizontal' }> & { readonly secondOffsetPercent: number },
  limit: number,
  radius: number,
  edits: ConnectorEdits | undefined,
  ranges: SectionRanges,
): SectionCheck {
  const scale = { longestDimensionMm };
  const allRanges: SectionRanges = { ...ranges, [secondKey]: { min: -limit, max: limit } };
  if (Math.abs(section.secondOffsetPercent) > limit + CONSTRAINT_ROUNDOFF_MM) {
    const shown = percentRange({ min: -limit, max: limit }, 1);
    return {
      errors: {
        [secondKey]:
          `Допустимі значення — від ${formatDecimal(shown.min)} % до ${formatDecimal(shown.max)} %: ` +
          'усі частини мають лишатися придатними до друку.',
      },
      ranges: allRanges,
    };
  }
  const thickness = sectionOffsetMm(Math.abs(section.secondOffsetPercent - section.offsetPercent), radius);
  const least = ballSliceMinimumMm(scale);
  if (thickness < least - CONSTRAINT_ROUNDOFF_MM) {
    return {
      errors: {
        [secondKey]:
          `Перерізи надто близько: середня частина має завтовшки ${millimetres(thickness)}, а потрібно щонайменше ` +
          `${formatMillimetres(least)} мм (${formatDecimal(Math.ceil(sectionOffsetPercent(least, radius) * 10) / 10)} % r між ` +
          'перерізами). Розсуньте перерізи або збільште модель.',
      },
      ranges: allRanges,
    };
  }
  return pairedConnectorChecks(keys, shape, longestDimensionMm, section, edits, allRanges);
}

/**
 * The connector at each of two parallel planes, a ball's or a box's: the first plane, and the second seen from it; see
 * `planesConnectorChecks`.
 */
function pairedConnectorChecks(
  keys: SectionKeys,
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Section,
  edits: ConnectorEdits | undefined,
  allRanges: SectionRanges,
): SectionCheck {
  return planesConnectorChecks(keys, shape, longestDimensionMm, section, [atSecondPlane(section)], edits, allRanges);
}

/**
 * The connector at each plane of a section with several, the first being the section itself and the others its views from
 * them: two parallel planes, or the planes through a shared generatrix. Each plane's own checks see the other planes, so that
 * the part between them keeps its material for the connectors from every side. All planes share the connector's settings:
 * their feasible ranges are what all allow, and a round connector fitted to the first plane is fitted to the next as well, and
 * taken back to the earlier ones if that changed it. Nothing is moved to make anything fit.
 */
function planesConnectorChecks(
  keys: SectionKeys,
  shape: SectionedShape,
  longestDimensionMm: number,
  section: Section,
  others: readonly Section[],
  edits: ConnectorEdits | undefined,
  allRanges: SectionRanges,
): SectionCheck {
  const { connector } = section;
  if (connector === undefined) return { errors: {}, ranges: allRanges };
  const first = connectorChecks(keys, shape, longestDimensionMm, section, edits);
  const prefixed = (check: SectionCheck | undefined, label: string): ParameterErrors =>
    Object.fromEntries(Object.entries(check?.errors ?? {}).map(([key, message]) => [key, `${label}: ${message}`]));
  const unavailable = (message: string, corrections: readonly string[] = []): SectionCheck => {
    const { connector: _none, ...plain } = section;
    return {
      errors: {},
      ranges: allRanges,
      resolved: {
        status: { context: first?.resolved?.status.context ?? '', corrections, unavailable: message },
        values: {},
        section: plain as Section,
      },
    };
  };
  if (first?.resolved?.status.unavailable !== undefined) {
    return unavailable(`${PLANE_LABELS[0]}: ${first.resolved.status.unavailable}`);
  }
  const fitted = first?.resolved?.section.connector ?? connector;
  // Each further plane reads the first plane's fit as edited elsewhere, kept wherever it fits; typed values in the context of
  // their last edit stay as typed there too, so that a value out of range is the field's error rather than corrected.
  const typed =
    edits !== undefined &&
    connector.type === fitted.type &&
    (fitted.type === 'plug' || fitted.type === 'dowel') &&
    edits[shape.kind] === roundContext(shape, longestDimensionMm, section, connector as RoundConnector);
  const viewEdits = (current: Section, given: NonNullable<Section['connector']>): ConnectorEdits | undefined => {
    if (edits === undefined || (given.type !== 'plug' && given.type !== 'dowel')) return edits;
    return {
      ...edits,
      [shape.kind]: typed ? roundContext(shape, longestDimensionMm, current, given as RoundConnector) : SECOND_PLANE_EDIT,
    };
  };
  const checks: (SectionCheck | undefined)[] = [first];
  let final = fitted;
  for (const [index, other] of others.entries()) {
    const view = { ...other, connector: final } as Section;
    const check = connectorChecks(keys, shape, longestDimensionMm, view, viewEdits(view, final));
    if (check?.resolved?.status.unavailable !== undefined) {
      return unavailable(`${PLANE_LABELS[index + 1]}: ${check.resolved.status.unavailable}`);
    }
    final = check?.resolved?.section.connector ?? final;
    checks.push(check);
  }
  if (JSON.stringify(final) !== JSON.stringify(fitted)) {
    // A later plane needed less: the earlier ones must take that too, as it is.
    const earlier = [section, ...others.slice(0, -1)];
    const refits = earlier.some((view) => {
      const back = connectorChecks(keys, shape, longestDimensionMm, { ...view, connector: final } as Section, {
        ...edits,
        [shape.kind]: SECOND_PLANE_EDIT,
      });
      return JSON.stringify(back?.resolved?.section.connector ?? final) !== JSON.stringify(final);
    });
    if (refits) {
      return unavailable(
        `Кріплення не вдається підібрати так, щоб воно вміщувалося біля ${others.length === 1 ? 'обох' : 'всіх'} перерізів. ` +
          'Змініть положення перерізів, тип чи розміри кріплення або оберіть «Без кріплення». Доти завантаження вимкнено.',
      );
    }
  }
  const intersect = (a: Interval | null | undefined, b: Interval | null | undefined): Interval | null | undefined => {
    if (a === undefined) return b;
    if (b === undefined) return a;
    if (a === null || b === null) return null;
    const both = { min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) };
    return both.min <= both.max + CONSTRAINT_ROUNDOFF_MM ? both : null;
  };
  const merged: SectionRanges = { ...allRanges };
  const rangeKeys = new Set(checks.flatMap((check) => Object.keys(check?.ranges ?? {}))) as Set<ParameterKey>;
  for (const key of rangeKeys) {
    const all = checks.reduce<Interval | null | undefined>((both, check) => intersect(both, check?.ranges[key]), undefined);
    if (all !== undefined) merged[key] = all;
  }
  const errors: ParameterErrors = {};
  checks.forEach((check, index) => {
    for (const [key, message] of Object.entries(prefixed(check, PLANE_LABELS[index] as string)) as [ParameterKey, string][]) {
      errors[key] = errors[key] === undefined ? message : `${errors[key]} ${message}`;
    }
  });
  const corrections = checks.flatMap((check) => check?.resolved?.status.corrections ?? []);
  const status = checks.find((check) => check?.resolved !== undefined)?.resolved?.status;
  const values = Object.assign({}, ...checks.map((check) => check?.resolved?.values ?? {})) as ParameterValues;
  return {
    errors,
    ranges: merged,
    ...(status === undefined
      ? {}
      : {
          resolved: {
            status: { context: status.context, corrections: [...new Set(corrections)] },
            values,
            section: { ...section, connector: final },
          },
        }),
  };
}

/**
 * A cylinder's planes through a shared generatrix: refused only where they are degenerate, a plane tangent to the cylinder or
 * the planes coincident, from the engine's numerical safeguard; then the connector at each plane. A thin but valid part is
 * built, and the panel warns about it. Nothing is moved to make the planes fit, and the second plane keeps its solution: the
 * problem is said at the control last edited, which is what the user asked to change, and the model shown stays the last valid
 * one. Whether the connectors at different planes keep apart inside the middle part is known only once they are built; the
 * model's error then says so.
 */
function linkedChecks(
  keys: SectionKeys,
  shape: CylinderShape,
  longestDimensionMm: number,
  section: Extract<Section, { type: 'shared-generatrix' }>,
  edits: ConnectorEdits | undefined,
  edited: ParameterKey | undefined,
): SectionCheck {
  const scale = { longestDimensionMm };
  const { type: _type, connector: _connector, ...planes } = section;
  if (linkedMargin(shape, scale, planes) < -CONSTRAINT_ROUNDOFF_MM) {
    const field = (Object.values(LINKED_NUMBER_KEYS) as ParameterKey[]).includes(edited as ParameterKey)
      ? (edited as LinkedNumberKey)
      : LINKED_KEYS.firstPlane;
    return { errors: { [field]: linkedRefusal(field) }, ranges: {} };
  }
  const others = (planes.third ? [1, 2] : [1]).map((index) => atLinkedPlane(section, index));
  return planesConnectorChecks(keys, shape, longestDimensionMm, section, others, edits, {});
}

/** The numeric fields of the section through a shared generatrix, by the engine's names of them. */
const LINKED_NUMBER_KEYS = {
  generatrix: 'cylinderLinkedGeneratrixDeg',
  pair: 'cylinderLinkedFirstPlaneDeg',
  dihedral: 'cylinderLinkedDihedralDeg',
} as const satisfies Record<LinkedField, ParameterKey>;

type LinkedNumberKey = (typeof LINKED_NUMBER_KEYS)[LinkedField];

/** Why the value just set gives no section, at its own field: what is degenerate there, and that nothing else was changed. */
function linkedRefusal(field: LinkedNumberKey): string {
  const kept = ' Інші параметри й положення другої площини не змінено; показано останню правильну побудову.';
  switch (field) {
    case LINKED_NUMBER_KEYS.dihedral:
      return (
        'За цього кута друга площина лише торкається циліндра вздовж твірної або майже збігається з першою, тож не ' +
        `відрізає частини.${kept}`
      );
    case LINKED_NUMBER_KEYS.generatrix:
      return `За цього положення твірної одна з площин лише торкається циліндра й не відрізає частини.${kept}`;
    default:
      return `За цього повороту одна з площин лише торкається циліндра вздовж твірної й не відрізає частини.${kept}`;
  }
}

/** The cylinder and the planes through its shared generatrix from valid values, the second plane's solution as chosen. */
function linkedPlanesOf(values: ParameterValues, choices: ParameterChoices) {
  const { printSizeMm, cylinderHeightRatio, cylinderOffsetRatio } = values;
  const [generatrixDeg, firstPlaneDeg, dihedralDeg] = [
    values[LINKED_KEYS.generatrix],
    values[LINKED_KEYS.firstPlane],
    values[LINKED_KEYS.dihedral],
  ];
  if (
    printSizeMm === undefined ||
    cylinderHeightRatio === undefined ||
    cylinderOffsetRatio === undefined ||
    generatrixDeg === undefined ||
    firstPlaneDeg === undefined ||
    dihedralDeg === undefined
  ) {
    return undefined;
  }
  const shape = { kind: 'cylinder', heightRatio: cylinderHeightRatio, offsetRatio: cylinderOffsetRatio } as const;
  const scale = { longestDimensionMm: printSizeMm };
  const planes = {
    generatrixDeg: generatrixDeg % OBLIQUE_DIRECTION_LIMITS.max,
    firstPlaneDeg,
    dihedralDeg,
    otherSide: choices[LINKED_KEYS.otherSide],
    third: choices[LINKED_KEYS.third],
  };
  return { shape, scale, planes, valid: linkedMargin(shape, scale, planes) >= 0 };
}

/**
 * A field's slider and buttons on its fixed scale: the whole turn of the generatrix, the pair's half turn and the dihedral angle
 * up to 90°, less the ends where a plane is degenerate, rounded inwards to hundredths, and passing over each gap about a
 * degenerate position, its ends rounded outwards, so that every value they reach is a valid section. The scale itself does not
 * move as the other fields change; only its few gaps do. Undefined while a value is not valid or nothing is usable.
 */
export function linkedFieldRange(
  values: ParameterValues,
  choices: ParameterChoices,
  field: LinkedField,
  increment: number,
): StepRange | undefined {
  const linked = linkedPlanesOf(values, choices);
  if (linked === undefined) return undefined;
  const scale = linkedFieldScale(linked.shape, linked.scale, linked.planes, field);
  if (scale === null) return undefined;
  const shown = planeAngleRange(scale, increment);
  // + 0 turns a rounded −0 into 0.
  const [min, max] = [shown.min + 0, shown.max + 0];
  const gaps = scale.gaps.map((gap) => ({
    min: Math.floor(gap.min * 100) / 100,
    max: Math.ceil(gap.max * 100) / 100,
  }));
  return { min, max, increment, ...(gaps.length === 0 ? {} : { gaps }) };
}

/**
 * Whether "Інше положення другої площини" is offered: the other second plane at the same angle from the first, the same way
 * round the shared generatrix the other way, which is another plane below 90° and a valid one. At 90° both are one plane.
 */
export function linkedAlternativeOffered(values: ParameterValues, choices: ParameterChoices): boolean {
  const linked = linkedPlanesOf(values, choices);
  return linked?.valid === true && linkedAlternativeUsable(linked.shape, linked.scale, linked.planes);
}

/** Whether "Перший переріз — осьовий" applies: the pair turned so that the first plane holds the axis is valid, and not so yet. */
export function linkedAxialOffered(values: ParameterValues, choices: ParameterChoices): boolean {
  const linked = linkedPlanesOf(values, choices);
  if (linked === undefined || linked.planes.firstPlaneDeg === 0) return false;
  return linkedMargin(linked.shape, linked.scale, { ...linked.planes, firstPlaneDeg: 0 }) >= 0;
}

/** The thinnest part of a valid section where it is thinner than a printed wall, and how thin, at the export scale. */
export function linkedThinPart(
  values: ParameterValues,
  choices: ParameterChoices,
): { readonly part: LinkedPart; readonly reachMm: number } | undefined {
  const linked = linkedPlanesOf(values, choices);
  if (linked === undefined || !linked.valid) return undefined;
  const thinnest = linkedThinnest(linked.shape, linked.scale, linked.planes);
  return thinnest !== undefined && thinnest.reachMm < CONNECTOR_MIN_WALL_MM ? thinnest : undefined;
}

/**
 * The lower base as the diagram draws it, in units of its radius about its centre, x to the right and y up as seen from above:
 * A, B and C where the shared generatrix and the first and the second plane's other generatrices meet the base, and C' of the
 * other second plane where it is offered. Undefined for a construction that is not valid; the diagram then keeps the last one.
 */
export function linkedDiagram(values: ParameterValues, choices: ParameterChoices): LinkedDiagram | undefined {
  const linked = linkedPlanesOf(values, choices);
  if (linked === undefined || !linked.valid) return undefined;
  const { radius } = roundDimensionsMm(linked.shape, linked.scale);
  const toPoint = ([x, y]: readonly number[]) => ({ x: (x as number) / radius, y: (y as number) / radius });
  const [a, b, c] = linkedCylinder(linked.shape, linked.scale, linked.planes).points.map(toPoint) as [
    LinkedPoint,
    LinkedPoint,
    LinkedPoint,
  ];
  const alternative = linkedAlternativeUsable(linked.shape, linked.scale, linked.planes)
    ? toPoint(linkedCylinder(linked.shape, linked.scale, { ...linked.planes, otherSide: !linked.planes.otherSide }).points[2])
    : undefined;
  return { a, b, c, third: linked.planes.third, ...(alternative === undefined ? {} : { alternative }) };
}

export type LinkedPoint = { readonly x: number; readonly y: number };

export type LinkedDiagram = {
  readonly a: LinkedPoint;
  readonly b: LinkedPoint;
  readonly c: LinkedPoint;
  readonly third: boolean;
  readonly alternative?: LinkedPoint;
};

/** "Інше положення другої площини": the other second plane, chosen explicitly; nothing else changes. */
export function switchLinkedAlternative(state: ParameterState): ParameterState {
  return { ...state, choices: { ...state.choices, [LINKED_KEYS.otherSide]: !state.choices[LINKED_KEYS.otherSide] } };
}

/** "Перший переріз — осьовий": the pair turned so that the first plane holds the axis, the angle between them kept. */
export function linkedAxial(state: ParameterState): ParameterState {
  const exact = { ...state.exact };
  delete exact[LINKED_KEYS.firstPlane];
  return { ...state, texts: { ...state.texts, [LINKED_KEYS.firstPlane]: '0' }, exact };
}

/**
 * The first planes through a shared generatrix of this cylinder: through the generatrices at its angle and 120° and 240° on,
 * with the angles that make those planes on the cylinder as it is, read off them; a right cylinder's are −30° and 60°. Undefined
 * while the cylinder is not valid yet, and for a state that has its planes already. The texts show the angles rounded, the
 * exact values stay behind them.
 */
export function startLinkedSection(state: ParameterState, values: ParameterValues): ParameterState | undefined {
  const { cylinderSection, cylinderLinkedStarted } = state.choices;
  if (cylinderSection !== 'shared-generatrix' || cylinderLinkedStarted) return undefined;
  const { printSizeMm, cylinderHeightRatio, cylinderOffsetRatio } = values;
  if (printSizeMm === undefined || cylinderHeightRatio === undefined || cylinderOffsetRatio === undefined) return undefined;
  const shape = { kind: 'cylinder', heightRatio: cylinderHeightRatio, offsetRatio: cylinderOffsetRatio } as const;
  const generatrixDeg = (values[LINKED_KEYS.generatrix] ?? LINKED_DEFAULTS.generatrixDeg) % OBLIQUE_DIRECTION_LIMITS.max;
  const start = linkedStart(shape, { longestDimensionMm: printSizeMm }, generatrixDeg);
  const texts = { ...state.texts };
  const exact = { ...state.exact };
  for (const [key, value] of [
    [LINKED_KEYS.firstPlane, start.firstPlaneDeg],
    [LINKED_KEYS.dihedral, start.dihedralDeg],
  ] as const) {
    // Without the rounding errors of the computation, such as −30,000000000000004 for −30.
    const clean = Math.round(value * 1e9) / 1e9;
    texts[key] = formatDecimal(clean);
    exact[key] = clean;
  }
  const choices = { ...state.choices, cylinderLinkedStarted: true, [LINKED_KEYS.otherSide]: start.otherSide };
  return { ...state, texts, exact, choices };
}

/** An edit context that matches no plane's: the stored values are then kept where they fit and corrected where they do not. */
const SECOND_PLANE_EDIT = 'second-plane';

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
  const { coneSection, coneApexStarted } = state.choices;
  if (coneSection !== 'oblique-apex' || coneApexStarted) return undefined;
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
    shape.kind === 'cone' && section.type === 'parallel-to-bases'
      ? plated
        ? 'cone-plate'
        : 'cone'
      : cutWordingOf(shape, longestDimensionMm, section);
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
      'axis-parallel': planar?.axisParallel?.offset ?? keys.offset,
      'shared-generatrix': planar?.linked?.dihedral ?? keys.offset,
      'face-parallel': keys.offset,
      longitudinal: keys.offset,
      inclined: keys.offset,
      'through-apex':
        keys.box !== undefined && section.type === 'through-apex' ? boxPlaneField(keys.box, section as BoxSection) : keys.offset,
      'through-line':
        keys.box !== undefined && section.type === 'through-line' ? boxPlaneField(keys.box, section as BoxSection) : keys.offset,
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
const wordingOf = (cut: CutWording): 'vertical' | 'oblique' | 'parallel-to-bases' | 'cone' | 'horizontal' =>
  cut === 'oblique-apex' || isBoxCutWording(cut)
    ? 'oblique'
    : cut === 'cone-plate'
      ? 'cone'
      : cut === 'axis-parallel' || cut === 'shared-generatrix'
        ? 'vertical'
        : cut;

/** A box's own cut type, which its messages read as an oblique cut's; see `cutWordingOf` for its horizontal planes. */
const isBoxCutWording = (cut: CutWording): cut is BoxSectionSpec['type'] =>
  (BOX_SECTION_TYPES as readonly string[]).includes(cut);

/** A part as the messages name it: by its place in a parallel cut, by its number in the others, where it has no place. */
function partInMessage(part: 'lower' | 'upper', cut: CutWording): string {
  if (cut === 'shared-generatrix') return part === 'lower' ? 'у середній частині' : 'у відрізаній частині';
  if (cut === 'vertical' || cut === 'oblique' || cut === 'oblique-apex' || cut === 'axis-parallel' || isBoxCutWording(cut)) {
    return part === 'lower' ? 'у частині 1' : 'у частині 2';
  }
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
    case 'middle-thin':
      return (
        `У середній частині між отворами обох перерізів лишається ${shortfall}. Зменште ${length}, розсуньте перерізи ` +
        'або збільште модель.'
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
    case 'middle-thin':
      return (
        `У середній частині між пазом одного перерізу й виступом другого лишається ${shortfall}. Зменште висоту виступу чи ` +
        'зазор, розсуньте перерізи або збільште модель.'
      );
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

/** The solids with a section, each with its own fields. */
type SectionSolid = 'cylinder' | 'cone' | 'ball' | BoxSolid;

type SectionKeys = {
  readonly choice: `${SectionSolid}Section`;
  /** The first plane's own field: a distance from an axis or a centre, or a box's position across the solid. */
  readonly offset:
    | 'cylinderSectionOffsetPercent'
    | 'coneSectionOffsetPercent'
    | 'ballSectionOffsetPercent'
    | `${BoxSolid}SectionPercent`;
  /** A second plane parallel to the first, of the solids that offer it: whether it is on, and its position. */
  readonly secondCut?: {
    readonly toggle: 'ballSecondCut' | 'cylinderSecondCut' | 'coneSecondCut' | `${BoxSolid}SecondCut`;
    readonly offset:
      | 'ballSectionSecondOffsetPercent'
      | 'cylinderSectionSecondPercent'
      | 'coneSectionSecondPercent'
      | `${BoxSolid}SectionSecondPercent`;
  };
  readonly separated: ToggleKey;
  readonly connector: `${SectionSolid}Connector`;
  readonly dovetailEntrance: `${SectionSolid}DovetailEntrance`;
  readonly dovetail: {
    readonly size: `${SectionSolid}DovetailSize`;
    readonly length: `${SectionSolid}DovetailLengthPercent`;
    readonly clearance: `${SectionSolid}DovetailClearanceMm`;
  };
  /** Plugs and dowels share the count, profile, spacing and multipliers; each keeps its own clearances. */
  readonly round: {
    readonly count: `${SectionSolid}RoundCount`;
    readonly profile: `${SectionSolid}RoundProfile`;
    readonly spacing: `${SectionSolid}RoundSpacingPercent`;
    readonly diameter: `${SectionSolid}RoundDiameter`;
    readonly depth: `${SectionSolid}RoundDepth`;
    readonly plugClearance: `${SectionSolid}PlugClearanceMm`;
    readonly dowelLowerClearance: `${SectionSolid}DowelLowerClearanceMm`;
    readonly dowelUpperClearance: `${SectionSolid}DowelUpperClearanceMm`;
  };
  readonly twist?: typeof TWIST_KEYS;
  readonly magnet: MagnetKeys;
  /** The section plate of a solid that offers one, on any of its cuts: the switch, the thickness and the margin. */
  readonly plate?: {
    readonly toggle: 'cylinderPlate' | 'conePlate' | 'ballPlate';
    readonly thickness: 'cylinderPlateThicknessMm' | 'conePlateThicknessMm' | 'ballPlateThicknessMm';
    readonly margin: 'cylinderPlateMarginMm' | 'conePlateMarginMm' | 'ballPlateMarginMm';
  };
  /** The plane fields of a cube's or parallelepiped's modes. */
  readonly box?: BoxKeysOf;
};

/** A cube's or parallelepiped's section fields, like any other solid's, with its modes' own. */
function boxSectionKeys(solid: BoxSolid): SectionKeys {
  const box = boxKeysOf(solid);
  return {
    choice: box.Section,
    offset: box.SectionPercent,
    secondCut: { toggle: box.SecondCut, offset: box.SectionSecondPercent },
    separated: box.PartsSeparated,
    connector: box.Connector,
    dovetailEntrance: box.DovetailEntrance,
    dovetail: { size: box.DovetailSize, length: box.DovetailLengthPercent, clearance: box.DovetailClearanceMm },
    round: {
      count: box.RoundCount,
      profile: box.RoundProfile,
      spacing: box.RoundSpacingPercent,
      diameter: box.RoundDiameter,
      depth: box.RoundDepth,
      plugClearance: box.PlugClearanceMm,
      dowelLowerClearance: box.DowelLowerClearanceMm,
      dowelUpperClearance: box.DowelUpperClearanceMm,
    },
    magnet: magnetKeysOf(solid),
    box,
  };
}

/** The further fields of the solids with an axis: a plane parallel to their base and a plane through a point on the axis. */
export type PlanarSectionKeys = SectionKeys & {
  readonly position: 'cylinderSectionPercent' | 'coneSectionPercent';
  /** A plane parallel to an oblique cylinder's axis: the base-plane line's offset and the direction it moves along. */
  readonly axisParallel?: { readonly offset: 'cylinderAxisOffsetPercent'; readonly direction: 'cylinderAxisDirectionDeg' };
  /** A cylinder's planes through a shared generatrix. */
  readonly linked?: typeof LINKED_KEYS;
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
  ...(Object.fromEntries(
    BOX_SOLIDS.flatMap((solid) => [
      [`${solid}DovetailSize`, DEFAULT_DOVETAIL.sizeFactor],
      [`${solid}DovetailLengthPercent`, DEFAULT_DOVETAIL.lengthPercent],
      [`${solid}RoundDiameter`, DEFAULT_ROUND_CONNECTOR.diameterFactor],
      [`${solid}RoundDepth`, DEFAULT_ROUND_CONNECTOR.depthFactor],
      [`${solid}RoundSpacingPercent`, DEFAULT_ROUND_CONNECTOR.spacingPercent],
    ]),
  ) as Record<Exclude<ScaledConnectorKey, `${'cylinder' | 'cone' | 'ball'}${string}`>, number>),
};

export const isScaledConnectorKey = (key: ParameterKey): key is ScaledConnectorKey => Object.hasOwn(scaledConnectorDefaults, key);

/** The error of an empty or malformed connector setting shown in millimetres, with a millimetre example. */
function scaledError(key: ScaledConnectorKey, text: string, unit: number): string | undefined {
  const read = readNumber(text, formatPhysical(scaledConnectorDefaults[key], unit));
  return 'error' in read ? read.error : undefined;
}

/** The fields of a cylinder's planes through a shared generatrix, its numbers and its switches. */
export const LINKED_KEYS = {
  generatrix: 'cylinderLinkedGeneratrixDeg',
  firstPlane: 'cylinderLinkedFirstPlaneDeg',
  dihedral: 'cylinderLinkedDihedralDeg',
  otherSide: 'cylinderLinkedOtherSide',
  third: 'cylinderLinkedThird',
} as const;

/** The numeric fields of a cylinder's planes through a shared generatrix, which the page follows to know the one last edited. */
export const LINKED_TEXT_KEYS = [LINKED_KEYS.generatrix, LINKED_KEYS.firstPlane, LINKED_KEYS.dihedral] as const;

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
  cube: boxSectionKeys('cube'),
  cuboid: boxSectionKeys('cuboid'),
  parallelepiped: boxSectionKeys('parallelepiped'),
  prism: boxSectionKeys('prism'),
  pyramid: boxSectionKeys('pyramid'),
  tetrahedron: boxSectionKeys('tetrahedron'),
  ball: {
    choice: 'ballSection',
    offset: 'ballSectionOffsetPercent',
    secondCut: { toggle: 'ballSecondCut', offset: 'ballSectionSecondOffsetPercent' },
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
    axisParallel: { offset: 'cylinderAxisOffsetPercent', direction: 'cylinderAxisDirectionDeg' },
    linked: LINKED_KEYS,
    secondCut: { toggle: 'cylinderSecondCut', offset: 'cylinderSectionSecondPercent' },
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
    secondCut: { toggle: 'coneSecondCut', offset: 'coneSectionSecondPercent' },
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
  return choice === 'none' ? undefined : choice;
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
  const secondCut = secondCutChosen(kind, choices) ? keys.secondCut : undefined;
  const plate = keys.plate !== undefined && plateChosen(kind, choices) ? keys.plate : undefined;
  const plateFields: IndependentKey[] = plate === undefined ? [] : [plate.thickness, plate.margin];
  const boxFields = (mode: BoxSectionSpec['type']): IndependentKey[] =>
    keys.box === undefined
      ? []
      : [
          ...boxModeKeys(keys.box, mode, choices, boxContextOf(kind as BoxSolid, choices, shape)),
          ...(secondCut === undefined ? [] : [secondCut.offset]),
        ];
  const secondFields: IndependentKey[] = secondCut === undefined ? [] : [secondCut.offset];
  const cutFields: Readonly<Record<SectionType, readonly IndependentKey[]>> = {
    'parallel-to-bases': planar === undefined ? [] : [planar.position, ...plateFields, ...secondFields],
    vertical: [keys.offset, ...plateFields, ...secondFields],
    horizontal: [keys.offset, ...secondFields, ...plateFields],
    oblique: planar === undefined ? [] : [...Object.values(planar.oblique), ...plateFields, ...secondFields],
    'oblique-apex': choices.coneApexAxial
      ? [coneApexKeys.direction, ...plateFields, ...secondFields]
      : [...Object.values(coneApexKeys), ...plateFields, ...secondFields],
    'axis-parallel':
      planar?.axisParallel === undefined ? [] : [...Object.values(planar.axisParallel), ...plateFields, ...secondFields],
    'shared-generatrix':
      planar?.linked === undefined ? [] : [planar.linked.generatrix, planar.linked.firstPlane, planar.linked.dihedral],
    'face-parallel': boxFields('face-parallel'),
    longitudinal: boxFields('longitudinal'),
    'through-apex': boxFields('through-apex'),
    'through-line': boxFields('through-line'),
    inclined: boxFields('inclined'),
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
    if (isBoxSectionType(type)) {
      const box = keys.box as BoxKeysOf;
      return {
        ...boxSectionOf(box, type, choices, read, secondCut !== undefined, boxContextOf(kind as BoxSolid, choices, shape)),
        ...joining,
      } as Section;
    }
    switch (type) {
      case 'vertical':
        return { type, offsetPercent: read(keys.offset), ...joining };
      case 'horizontal':
        return {
          type,
          offsetPercent: read(keys.offset),
          ...(secondCut === undefined ? {} : { secondOffsetPercent: read(secondCut.offset) }),
          ...joining,
        };
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
      case 'oblique-apex': {
        const directionDeg = read(coneApexKeys.direction) % OBLIQUE_DIRECTION_LIMITS.max;
        // An axial plane takes its angle from the cone as it is now, so that it holds the axis whatever the cone becomes.
        if (choices.coneApexAxial && shape?.kind === 'cone') {
          return { type, ...axialApexAngles(shape as ConeShape, directionDeg), axial: true, ...joining };
        }
        return { type, inclinationDeg: read(coneApexKeys.inclination), directionDeg, ...joining };
      }
      case 'axis-parallel': {
        const keys = planarKeysOf(sectionKeys[kind] as SectionKeys).axisParallel as NonNullable<
          PlanarSectionKeys['axisParallel']
        >;
        return {
          type,
          offsetPercent: read(keys.offset),
          directionDeg: read(keys.direction) % OBLIQUE_DIRECTION_LIMITS.max,
          ...joining,
        };
      }
      case 'shared-generatrix': {
        const linked = LINKED_KEYS;
        const planes = {
          generatrixDeg: read(linked.generatrix) % OBLIQUE_DIRECTION_LIMITS.max,
          firstPlaneDeg: read(linked.firstPlane),
          dihedralDeg: read(linked.dihedral),
          otherSide: choices[linked.otherSide],
          third: choices[linked.third],
        };
        return { type, ...planes, ...(connector === undefined ? {} : { connector }) };
      }
    }
  };
  // A cylinder's or a cone's second plane: its share of the solid's extent along the planes' normal.
  const built = sectionOf();
  const paired =
    secondCut !== undefined && (ROUND_PAIR_TYPES as readonly string[]).includes(type) && (kind === 'cylinder' || kind === 'cone')
      ? ({ ...built, secondPositionPercent: read(secondCut.offset) } as Section)
      : built;
  return { values, errors, section: paired };
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

/** A box solid's own section and connector texts. */
function boxParameterTexts(solid: BoxSolid): ParameterKey[] {
  const keys = boxKeysOf(solid);
  return [...BOX_NUMBER_FIELDS.map((field) => keys[field]), ...Object.values(magnetKeysOf(solid))];
}

/** A box solid's own section and connector choices. */
function boxParameterChoices(solid: BoxSolid): (keyof ParameterChoices)[] {
  const keys = boxKeysOf(solid);
  return BOX_CHOICE_FIELDS.map((field) => keys[field]);
}

/**
 * Every field and choice a shape owns, including those of its inactive base variants. Resetting a shape restores
 * exactly these, so the values of other shapes stay as they are; the shared print size belongs to no shape and is
 * never reset.
 */
export const shapeParameterKeys: Readonly<
  Record<ShapeKind, { readonly texts: readonly ParameterKey[]; readonly choices: readonly (keyof ParameterChoices)[] }>
> = {
  cube: { texts: boxParameterTexts('cube'), choices: boxParameterChoices('cube') },
  cuboid: {
    texts: ['cuboidWidthRatio', 'cuboidHeightRatio', ...boxParameterTexts('cuboid')],
    choices: boxParameterChoices('cuboid'),
  },
  parallelepiped: {
    texts: [
      'parallelepipedBaseSideRatio',
      'parallelepipedHeightRatio',
      'parallelepipedBaseAngleDeg',
      'parallelepipedOffsetXRatio',
      'parallelepipedOffsetYRatio',
      'parallelepipedInclinationDeg',
      'parallelepipedDirectionDeg',
      ...boxParameterTexts('parallelepiped'),
    ],
    choices: boxParameterChoices('parallelepiped'),
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
      ...boxParameterTexts('prism'),
    ],
    choices: ['prismBaseType', 'prismBaseSides', ...boxParameterChoices('prism')],
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
      ...boxParameterTexts('pyramid'),
    ],
    choices: ['pyramidBaseType', 'pyramidBaseSides', ...boxParameterChoices('pyramid')],
  },
  tetrahedron: { texts: boxParameterTexts('tetrahedron'), choices: boxParameterChoices('tetrahedron') },
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
      'cylinderAxisOffsetPercent',
      'cylinderAxisDirectionDeg',
      'cylinderLinkedGeneratrixDeg',
      'cylinderLinkedFirstPlaneDeg',
      'cylinderLinkedDihedralDeg',
      'cylinderSectionSecondPercent',
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
      'cylinderLinkedStarted',
      'cylinderLinkedOtherSide',
      'cylinderLinkedThird',
      'cylinderSecondCut',
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
      'coneSectionSecondPercent',
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
      'coneApexStarted',
      'coneApexAxial',
      'coneSecondCut',
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
      'ballSectionSecondOffsetPercent',
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
      'ballSecondCut',
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
  const second = keys.secondCut;
  const twoPlanes = second !== undefined && choices[second.toggle];
  // Beside a second plane the plate's switch is off, and its fields with it.
  const plateFields =
    plate === undefined || twoPlanes ? [] : [plate.toggle, ...(choices[plate.toggle] ? [plate.thickness, plate.margin] : [])];
  const secondFields = second === undefined ? [] : [second.toggle, ...(twoPlanes ? [second.offset] : [])];
  const box = keys.box;
  const cutFields: Readonly<Record<SectionType, readonly (keyof ParameterChoices | ParameterKey)[]>> = {
    'parallel-to-bases': planar === undefined ? [] : [planar.position, ...plateFields, ...secondFields],
    vertical: [keys.offset, ...plateFields, ...secondFields],
    horizontal: [keys.offset, ...secondFields, ...plateFields],
    oblique: [...obliqueFields, ...plateFields, ...secondFields],
    'oblique-apex': [
      ...(choices.coneApexAxial ? [coneApexKeys.direction] : apexFields),
      'coneApexAxial',
      ...plateFields,
      ...secondFields,
    ],
    'axis-parallel': [
      ...(planar?.axisParallel === undefined ? [] : Object.values(planar.axisParallel)),
      ...plateFields,
      ...secondFields,
    ],
    'shared-generatrix': planar?.linked === undefined ? [] : Object.values(planar.linked),
    'face-parallel': box === undefined ? [] : [box.Face, box.SectionPercent, ...secondFields],
    longitudinal:
      box === undefined
        ? []
        : [
            box.Trace,
            ...(choices[box.Trace] === 'angle' ? [box.TraceAngleDeg] : [box.TraceSegment, box.TraceVertex]),
            box.SectionPercent,
            ...secondFields,
          ],
    'through-apex':
      box === undefined
        ? []
        : [
            box.Trace,
            ...(choices[box.Trace] === 'angle'
              ? [box.TraceAngleDeg, box.SectionPercent]
              : [box.TraceSegment, box.TraceVertex, ...(choices[box.Trace] === 'edge-point' ? [box.TracePointPercent] : [])]),
            ...secondFields,
          ],
    'through-line':
      box === undefined
        ? []
        : [
            box.LineFace,
            box.Line,
            box.LineMethod,
            ...(choices[box.LineMethod] === 'angle' ? [box.LineAngleDeg] : [box.PointEdge, box.PointPercent]),
            ...secondFields,
          ],
    inclined:
      box === undefined
        ? []
        : [
            box.NormalAlong,
            box.ParallelEdges,
            ...(choices[box.NormalAlong] === 'none' && choices[box.ParallelEdges] === 'none'
              ? [box.PlaneInclinationDeg, box.PlaneDirectionDeg]
              : []),
            box.SectionPercent,
            ...secondFields,
          ],
  };
  const active = new Set<string>(section === undefined ? [] : cutFields[section]);
  const allPlateFields = [
    ...(plate === undefined ? [] : [plate.toggle, plate.thickness, plate.margin]),
    ...(second === undefined ? [] : [second.toggle, second.offset]),
  ];
  const cuts = [...new Set([...Object.values(cutFields).flat(), ...allPlateFields])].filter((key) => !active.has(key));
  // Whether the first plane through the apex was set up is no setting, and starts over with the section.
  const always: (keyof ParameterChoices)[] = [
    'coneApexStarted',
    'cylinderLinkedStarted',
    ...(box === undefined ? [] : [box.LineAngleFor]),
  ];
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
