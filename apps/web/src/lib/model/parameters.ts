import {
  CONSTRAINT_ROUNDOFF_MM,
  type ConnectorFeasibility,
  cutOfSection,
  type DovetailIssue,
  dovetailFeasibility,
  hasFeasibleValues,
  type Interval,
  obliquePlaneContainsAxis,
  obliqueSplitReach,
  type ParameterBounds,
  type ParameterFeasibility,
  type RoundConnectorIssue,
  roundConnectorFeasibility,
  roundDimensionsMm,
  satisfies,
  sectionOffsetMm,
  verticalOffsetLimitPercent,
} from '@diploma-3d/engine';
import {
  apexRatioSchema,
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  baseAngleSchema,
  baseShiftSchema,
  type ConnectorType,
  type CylinderShape,
  DEFAULT_DOVETAIL,
  DEFAULT_DOWEL_CLEARANCES_MM,
  DEFAULT_LONGEST_DIMENSION_MM,
  DEFAULT_OBLIQUE_SECTION,
  DEFAULT_PARALLELOGRAM_BASE,
  DEFAULT_PLUG_CLEARANCE_MM,
  DEFAULT_ROUND_CONNECTOR,
  DEFAULT_SECTION_OFFSET_PERCENT,
  DEFAULT_SECTION_POSITION_PERCENT,
  DEFAULT_TRAPEZOID_BASE,
  DEFAULT_TRIANGLE_BASE,
  DIAMETRAL_CLEARANCE_LIMITS,
  DOVETAIL_CLEARANCE_LIMITS,
  defaultModelSpecs,
  dovetailConnectorSchema,
  isWithinMinimumInclination,
  longestDimensionSchema,
  MAX_LONGEST_DIMENSION_MM,
  MIN_INCLINATION_DEG,
  MIN_LONGEST_DIMENSION_MM,
  type ModelSpec,
  type ModelSpecInput,
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
  ratioSchema,
  roundHeightRatioSchema,
  roundOffsetSchema,
  SECTION_POSITION_LIMITS,
  type Section,
  type SectionType,
  type ShapeKind,
  sectionPositionSchema,
  TILT_OFFSET_LIMITS,
} from '@diploma-3d/schema';
import { formatDecimal, halfSumDecimal, parseDecimal } from '../decimal.ts';
import {
  type ConnectorScale,
  connectorUnits,
  cylinderConnectorScale,
  formatMillimetres,
  formatPhysical,
  percentRange,
  physicalRange,
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
  | 'coneHeightRatio'
  | 'coneOffsetRatio'
  | 'coneInclinationDeg';

/** Raw field text, kept separately from parsed values so that empty and partially typed input stays editable. */
export type ParameterTexts = Record<ParameterKey, string>;

/** A plane section of the solid, or none. */
export type SectionChoice = 'none' | SectionType;

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
  /** One round connector at the centre, or a keyed pair; shared by plugs and dowels. */
  cylinderRoundCount: 1 | 2;
  /** Whether the preview moves the parts of the section apart; it changes neither the geometry nor the print file. */
  cylinderPartsSeparated: boolean;
};

/** The switches among the choices. */
export type ToggleKey = 'cylinderPartsSeparated';

/** The choices picked from options. */
export type ChoiceKey = Exclude<keyof ParameterChoices, ToggleKey>;

export type ParameterErrors = Partial<Record<ParameterKey, string>>;

/** Validated field values; the same numbers drive the controls and, when every field is valid, the specification. */
export type ParameterValues = Partial<Record<ParameterKey, number>>;

/**
 * Full-precision values behind texts that were set from a computed number, such as offsets derived from angles. A value
 * applies while its field still shows the text it was formatted to; editing the field replaces it with the typed one.
 * Rounded display texts therefore never feed back into the model.
 */
export type ParameterExact = Partial<Record<ParameterKey, number>>;

/** How the request reads the texts: the exact values behind them and the tilt input mode of each solid. */
export type ParameterOptions = {
  readonly exact?: ParameterExact | undefined;
  readonly tiltModes?: TiltModes | undefined;
  /**
   * The scale that phrases connector errors in millimetres while the current print size or cylinder is not valid;
   * the current one is used whenever it is.
   */
  readonly connectorScale?: ConnectorScale | undefined;
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
} & ({ readonly spec: ModelSpec; readonly key: string } | { readonly spec: undefined; readonly key: undefined });

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
});

export const initialParameterChoices = (): ParameterChoices => ({
  prismBaseType: defaultModelSpecs.prism.shape.baseType,
  prismBaseSides: defaultModelSpecs.prism.shape.baseSides,
  pyramidBaseType: defaultModelSpecs.pyramid.shape.baseType,
  pyramidBaseSides: defaultModelSpecs.pyramid.shape.baseSides,
  // The section is optional; once it is chosen, the parts start apart so that the cut faces show.
  cylinderSection: 'none',
  cylinderConnector: 'none',
  cylinderRoundCount: DEFAULT_ROUND_CONNECTOR.count,
  cylinderPartsSeparated: true,
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

/** A diametral clearance: how much wider a hole is than its pin, in millimetres. */
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
    cylinderConnectorScale(
      { ...resolved.values, printSizeMm: 'value' in size ? size.value : undefined },
      options.connectorScale,
    ) ??
    options.connectorScale ??
    INITIAL_CONNECTOR_SCALE;
  const section = resolveSection(kind, texts, choices, options.exact, scale, resolved.shape);
  const values = { ...resolved.values, ...section.values };
  const errors = { ...resolved.errors, ...section.errors };
  if ('error' in size) errors.printSizeMm = size.error;
  else values.printSizeMm = size.value;
  if (resolved.shape === undefined || section.section === undefined || 'error' in size) {
    return { values, errors, spec: undefined, key: undefined };
  }
  // The cut and the connector are checked before the specification is parsed: their settings have no fixed limits here.
  const checked = section.section === 'none' ? undefined : sectionChecks(kind, resolved.shape, size.value, section.section);
  if (checked !== undefined) {
    for (const [key, message] of Object.entries(checked.errors) as [ParameterKey, string][]) {
      errors[key] = errors[key] === undefined ? message : `${errors[key]} ${message}`;
    }
  }
  const sectionRanges = checked?.ranges;
  if (Object.keys(errors).length > 0) return { values, errors, sectionRanges, spec: undefined, key: undefined };
  const spec = modelSpecSchema.parse({
    shape: resolved.shape,
    scale: { longestDimensionMm: size.value },
    ...(section.section === 'none' ? {} : { section: section.section }),
  });
  return { values, errors, sectionRanges, spec, key: JSON.stringify(spec) };
}

// Feasibility depends only on the solid, the size, the cut and the connector; the panel and the request read it for every
// edit of any field, so recent results are kept.
const FEASIBILITY_CACHE_SIZE = 32;
const feasibilityCache = new Map<
  string,
  ConnectorFeasibility<string, DovetailIssue> | ConnectorFeasibility<string, RoundConnectorIssue>
>();

function cachedFeasibility(shape: CylinderShape, longestDimensionMm: number, section: Section) {
  const { connector } = section;
  if (connector === undefined) return undefined;
  const cut = cutOfSection(section);
  const key = JSON.stringify([shape, longestDimensionMm, cut, connector]);
  const cached = feasibilityCache.get(key);
  if (cached !== undefined) return cached;
  const scale = { longestDimensionMm };
  const result =
    connector.type === 'dovetail'
      ? dovetailFeasibility(shape, scale, cut, connector)
      : roundConnectorFeasibility(shape, scale, cut, connector);
  if (feasibilityCache.size >= FEASIBILITY_CACHE_SIZE) feasibilityCache.delete(feasibilityCache.keys().next().value as string);
  feasibilityCache.set(key, result);
  return result;
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
): { errors: ParameterErrors; ranges: SectionRanges } | undefined {
  const keys = sectionKeys[kind];
  if (keys === undefined || shape.kind !== 'cylinder') return undefined;
  const cylinder = shape as CylinderShape;
  if (section.type === 'parallel-to-bases') return connectorChecks(keys, cylinder, longestDimensionMm, section);
  const scale = { longestDimensionMm };
  if (section.type === 'oblique') {
    const reach = obliqueSplitReach(cylinder, scale, section);
    if (satisfies(reach)) return connectorChecks(keys, cylinder, longestDimensionMm, section);
    const contained = obliquePlaneContainsAxis(cylinder, section.inclinationDeg, section.directionDeg);
    const field = contained ? keys.oblique.inclination : keys.oblique.position;
    return {
      errors: {
        [field]:
          `Тонша частина сягає від площини лише ${millimetres(reach.valueMm)}, потрібно щонайменше ` +
          `${millimetres(reach.minimumMm)}. Змініть положення чи кут площини або збільште найбільший габарит.`,
      },
      ranges: {},
    };
  }
  const limit = verticalOffsetLimitPercent(cylinder, scale);
  const ranges: SectionRanges = { [keys.offset]: { min: -limit, max: limit } };
  const { radius } = roundDimensionsMm(cylinder, scale);
  if (Math.abs(sectionOffsetMm(section.offsetPercent, radius)) > sectionOffsetMm(limit, radius) + CONSTRAINT_ROUNDOFF_MM) {
    const shown = percentRange({ min: -limit, max: limit }, 1);
    const allowed = `Допустимі значення — від ${formatDecimal(shown.min)} % до ${formatDecimal(shown.max)} %: `;
    return { errors: { [keys.offset]: `${allowed}обидві частини мають лишатися придатними до друку.` }, ranges };
  }
  const connector = connectorChecks(keys, cylinder, longestDimensionMm, section);
  return connector === undefined
    ? { errors: {}, ranges }
    : { errors: connector.errors, ranges: { ...ranges, ...connector.ranges } };
}

/**
 * The connector's feasible ranges and its problems, explained at the fields that can repair them, from the same checks
 * the engine applies before it builds anything. A field outside its range names what fails and the values it allows
 * with the other settings as they are; a problem that no connector setting repairs, such as too little material under
 * a plug, is explained at the cut's own field. Nothing is shrunk, moved or rescaled to make the connector fit.
 */
function connectorChecks(
  keys: SectionKeys,
  shape: CylinderShape,
  longestDimensionMm: number,
  section: Section,
): { errors: ParameterErrors; ranges: SectionRanges } | undefined {
  const { connector } = section;
  if (connector === undefined) return undefined;
  const feasibility = cachedFeasibility(shape, longestDimensionMm, section);
  if (feasibility === undefined) return undefined;
  const { dovetail, round } = keys;
  const fields: [ParameterKey, string][] =
    connector.type === 'dovetail'
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
  const explain = (issue: DovetailIssue | RoundConnectorIssue) =>
    connector.type === 'dovetail'
      ? dovetailIssueMessage(issue as DovetailIssue, section.type)
      : roundConnectorIssueMessage(issue as RoundConnectorIssue, connector.type, connector.count, section.type);
  const parameters = feasibility.parameters as Readonly<
    Record<string, ParameterFeasibility<DovetailIssue | RoundConnectorIssue>>
  >;
  const errors: ParameterErrors = {};
  const ranges: SectionRanges = {};
  for (const [key, parameter] of fields) {
    const { bounds, issues } = parameters[parameter] as ParameterFeasibility<DovetailIssue | RoundConnectorIssue>;
    // The engine solves for the insertion e into one part; the field shows a dowel's whole length 2e.
    const shown = key === round.depth && connector.type === 'dowel' ? 2 : 1;
    ranges[key] = hasFeasibleValues(bounds) ? { min: bounds.min * shown, max: bounds.max * shown } : null;
    if (issues.length > 0) errors[key] = [...issues.map(explain), rangeSentence(bounds, shown)].join(' ');
  }
  if (feasibility.unattributed.length > 0) {
    const cutField = { 'parallel-to-bases': keys.position, vertical: keys.offset, oblique: keys.oblique.inclination };
    errors[cutField[section.type]] = feasibility.unattributed.map(explain).join(' ');
  }
  return { errors, ranges };
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

/** A part as the messages name it: by its place in a parallel cut, by its number in the others, where it has no place. */
function partInMessage(part: 'lower' | 'upper', cut: SectionType): string {
  if (cut !== 'parallel-to-bases') return part === 'lower' ? 'у частині 1' : 'у частині 2';
  return part === 'lower' ? 'у нижній частині' : 'у верхній частині';
}

const CHANGE_OBLIQUE_PLANE = 'змініть положення чи кут площини';

/** What falls short, by how much, and what to change, for plugs and dowels; in Ukrainian for the interface. */
export function roundConnectorIssueMessage(
  issue: RoundConnectorIssue,
  type: 'plug' | 'dowel',
  count: 1 | 2 = 1,
  cut: SectionType = 'parallel-to-bases',
): string {
  const shortfall = `${millimetres(issue.valueMm)}, потрібно щонайменше ${millimetres(issue.minimumMm)}`;
  const diameter = type === 'plug' ? 'діаметр виступу' : 'діаметр штифта';
  const length = type === 'plug' ? 'висоту виступу' : 'довжину штифта';
  switch (issue.code) {
    case 'pin-too-thin':
      return `Найменший ${diameter} — ${shortfall}. Збільште ${diameter}.`;
    case 'engagement-short':
      return (
        `Після фасок${type === 'dowel' ? ' й осьового зміщення' : ''} пряма ділянка в отворі — ${shortfall}. ` +
        `Збільште ${length} або зменште ${diameter}.`
      );
    case 'keying-lost':
      return (
        `Більший ${type === 'plug' ? 'виступ' : 'штифт'} ширший за менший отвір на ${shortfall}, інакше частини можна ` +
        `з’єднати, повернувши на 180°. Зменште збільшення діаметра отворів або збільште ${diameter}.`
      );
    case 'hole-wall-thin':
      return (
        `Стінка біля отвору ${partInMessage(issue.part, cut)} — ${shortfall}. ` +
        `Зменште ${diameter}${count === 2 ? ' або відстань від центра до осей' : ''}.`
      );
    case 'holes-too-close':
      return `Між отворами ${partInMessage(issue.part, cut)} лишається ${shortfall}. Збільште відстань від центра до осей або зменште ${diameter}.`;
    case 'hole-bottom-thin':
      return (
        `Під дном отвору ${partInMessage(issue.part, cut)} лишається ${shortfall}. ` +
        {
          vertical: `Зменште ${length}, ${diameter} або зміщення від осі.`,
          oblique: `Зменште ${length} чи ${diameter} або ${CHANGE_OBLIQUE_PLANE}.`,
          'parallel-to-bases': `Зменште ${length} або ${issue.part === 'upper' ? 'опустіть' : 'підніміть'} переріз.`,
        }[cut]
      );
    case 'base-thin':
      return {
        vertical: `За виступом у частині 1 лишається ${shortfall}. Зменште ${diameter} або зміщення від осі.`,
        oblique: `За виступом у частині 1 лишається ${shortfall}. Зменште ${diameter} або ${CHANGE_OBLIQUE_PLANE}.`,
        'parallel-to-bases': `Під виступом лишається ${shortfall} нижньої частини. Підніміть переріз або збільште найбільший габарит.`,
      }[cut];
  }
}

/** A measured value, rounded down to hundredths so that it never reads as more than there is. */
const millimetres = (value: number) => `${formatDecimal(Math.max(0, Math.floor(value * 100) / 100))} мм`;

/** What falls short, by how much, and what to change; in Ukrainian for the interface. */
export function dovetailIssueMessage(issue: DovetailIssue, cut: SectionType = 'parallel-to-bases'): string {
  const shortfall = `${millimetres(issue.valueMm)}, потрібно щонайменше ${millimetres(issue.minimumMm)}`;
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
        oblique: `Стінка біля паза — ${shortfall}. Зменште висоту чи довжину виступу або ${CHANGE_OBLIQUE_PLANE}.`,
        'parallel-to-bases': `Стінка біля закритого кінця паза — ${shortfall}. Зменште довжину або висоту виступу.`,
      }[cut];
    case 'stop-thin':
      return `Під нижнім упором паза лишається ${shortfall}. Зменште довжину виступу або зазор.`;
    case 'backing-thin':
      return `Над пазом лишається ${shortfall} верхньої частини. Опустіть переріз або зменште висоту виступу.`;
    case 'base-thin':
      return {
        vertical: `За виступом у частині 1 лишається ${shortfall}. Зменште висоту виступу або зміщення від осі.`,
        oblique: `За виступом у частині 1 лишається ${shortfall}. Зменште висоту чи довжину виступу або ${CHANGE_OBLIQUE_PLANE}.`,
        'parallel-to-bases': `Під виступом лишається ${shortfall} нижньої частини. Підніміть переріз або збільште найбільший габарит.`,
      }[cut];
  }
}

type SectionKeys = {
  readonly choice: 'cylinderSection';
  readonly position: 'cylinderSectionPercent';
  readonly offset: 'cylinderSectionOffsetPercent';
  readonly oblique: {
    readonly position: 'cylinderObliquePositionPercent';
    readonly inclination: 'cylinderObliqueInclinationDeg';
    readonly direction: 'cylinderObliqueDirectionDeg';
  };
  readonly separated: ToggleKey;
  readonly connector: 'cylinderConnector';
  readonly dovetail: {
    readonly size: 'cylinderDovetailSize';
    readonly length: 'cylinderDovetailLengthPercent';
    readonly clearance: 'cylinderDovetailClearanceMm';
  };
  /** Plugs and dowels share the count, spacing and multipliers; each keeps its own clearances. */
  readonly round: {
    readonly count: 'cylinderRoundCount';
    readonly spacing: 'cylinderRoundSpacingPercent';
    readonly diameter: 'cylinderRoundDiameter';
    readonly depth: 'cylinderRoundDepth';
    readonly plugClearance: 'cylinderPlugClearanceMm';
    readonly dowelLowerClearance: 'cylinderDowelLowerClearanceMm';
    readonly dowelUpperClearance: 'cylinderDowelUpperClearanceMm';
  };
};

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
};

export const isScaledConnectorKey = (key: ParameterKey): key is ScaledConnectorKey => Object.hasOwn(scaledConnectorDefaults, key);

/** The error of an empty or malformed connector setting shown in millimetres, with a millimetre example. */
function scaledError(key: ScaledConnectorKey, text: string, unit: number): string | undefined {
  const read = readNumber(text, formatPhysical(scaledConnectorDefaults[key], unit));
  return 'error' in read ? read.error : undefined;
}

/** The fields of the plane section and its connector, for the shapes that offer one. */
export const sectionKeys: Readonly<Partial<Record<ShapeKind, SectionKeys>>> = {
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
    connector: 'cylinderConnector',
    dovetail: {
      size: 'cylinderDovetailSize',
      length: 'cylinderDovetailLengthPercent',
      clearance: 'cylinderDovetailClearanceMm',
    },
    round: {
      count: 'cylinderRoundCount',
      spacing: 'cylinderRoundSpacingPercent',
      diameter: 'cylinderRoundDiameter',
      depth: 'cylinderRoundDepth',
      plugClearance: 'cylinderPlugClearanceMm',
      dowelLowerClearance: 'cylinderDowelLowerClearanceMm',
      dowelUpperClearance: 'cylinderDowelUpperClearanceMm',
    },
  },
};

/** Every connector field of the section. */
const connectorTextKeys = ({ dovetail, round }: SectionKeys): ParameterKey[] => [
  ...Object.values(dovetail),
  round.spacing,
  round.diameter,
  round.depth,
  round.plugClearance,
  round.dowelLowerClearance,
  round.dowelUpperClearance,
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
  const fields = activeConnectorKeys(keys, connectorType, count) as IndependentKey[];
  // A plane parallel to the bases has a position along the height, a vertical one a distance from the axis, an oblique
  // one a point on the axis and two angles.
  const cutKeys: IndependentKey[] =
    type === 'oblique' ? Object.values(keys.oblique) : [type === 'vertical' ? keys.offset : keys.position];
  const { values, errors } = validateFields([...cutKeys, ...fields], texts, exact);
  // The fields show millimetres: their errors name millimetres too.
  const units = connectorUnits(scale, connectorType === 'dowel' ? 'dowel' : 'plug', type);
  for (const key of fields) {
    if (errors[key] !== undefined && isScaledConnectorKey(key)) {
      errors[key] = scaledError(key, texts[key], units[key]) ?? errors[key];
    }
  }
  const { inclination, direction, position } = keys.oblique;
  const [inclinationDeg, directionDeg] = [values[inclination], values[direction]];
  // The position cannot change a plane that contains the whole axis and its field is disabled, so an invalid draft of it
  // blocks nothing; it stays as typed for when the plane no longer does.
  if (
    type === 'oblique' &&
    shape?.kind === 'cylinder' &&
    inclinationDeg !== undefined &&
    directionDeg !== undefined &&
    obliquePlaneContainsAxis(shape as CylinderShape, inclinationDeg, directionDeg)
  ) {
    delete errors[position];
    values[position] ??= DEFAULT_OBLIQUE_SECTION.positionPercent;
  }
  if ([...cutKeys, ...fields].some((key) => values[key] === undefined)) return { values, errors, section: undefined };
  const read = (key: ParameterKey) => values[key] as number;
  const { dovetail, round } = keys;
  const shared = {
    count,
    diameterFactor: read(round.diameter),
    depthFactor: read(round.depth),
    ...(count === 2 ? { spacingPercent: read(round.spacing) } : {}),
  };
  const connector =
    connectorType === 'dovetail'
      ? {
          type: connectorType,
          sizeFactor: read(dovetail.size),
          lengthPercent: read(dovetail.length),
          clearanceMm: read(dovetail.clearance),
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
  const joining = connector === undefined ? {} : { connector };
  const sectionOf = (): Section => {
    switch (type) {
      case 'vertical':
        return { type, offsetPercent: read(keys.offset), ...joining };
      case 'parallel-to-bases':
        return { type, positionPercent: read(keys.position), ...joining };
      case 'oblique':
        return {
          type,
          positionPercent: read(position),
          inclinationDeg: read(inclination),
          // 360° and 0° are one direction, hence one model: the field keeps showing what was chosen, its slider stays put.
          directionDeg: read(direction) % OBLIQUE_DIRECTION_LIMITS.max,
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
      'cylinderDovetailSize',
      'cylinderDovetailLengthPercent',
      'cylinderDovetailClearanceMm',
      'cylinderRoundSpacingPercent',
      'cylinderRoundDiameter',
      'cylinderRoundDepth',
      'cylinderPlugClearanceMm',
      'cylinderDowelLowerClearanceMm',
      'cylinderDowelUpperClearanceMm',
    ],
    choices: ['cylinderSection', 'cylinderPartsSeparated', 'cylinderConnector', 'cylinderRoundCount'],
  },
  cone: { texts: ['coneHeightRatio', 'coneOffsetRatio', 'coneInclinationDeg'], choices: [] },
  ball: { texts: [], choices: [] },
};

export type ParameterState = {
  readonly texts: ParameterTexts;
  readonly choices: ParameterChoices;
  readonly exact?: ParameterExact | undefined;
  readonly tiltModes?: TiltModes | undefined;
};

/**
 * The state after "Скинути параметри фігури": the shape's own fields and choices, also of its inactive base variants,
 * of both tilt modes and of its section, return to their initial values, drafts included: no section, at 50 %, with
 * the parts apart and without a connector, whose settings return to k = 1, 50 % and 0,2 mm. The print size, every other shape and the tilt input mode keep theirs, so a reset in the angle
 * mode shows 90°.
 */
export function resetShapeParameters(kind: ShapeKind, state: ParameterState): ParameterState {
  const [initialTexts, initialChoices] = [initialParameterTexts(), initialParameterChoices()];
  const { texts: keys, choices: choiceKeys } = shapeParameterKeys[kind];
  const texts = { ...state.texts };
  for (const key of keys) texts[key] = initialTexts[key];
  const choices: ParameterChoices = { ...state.choices };
  for (const key of choiceKeys) Object.assign(choices, { [key]: initialChoices[key] });
  if (state.exact === undefined) return { ...state, texts, choices };
  const exact = { ...state.exact };
  for (const key of keys) delete exact[key];
  return { ...state, texts, choices, exact };
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
  const active = new Set(activeConnectorKeys(keys, connector, choices[keys.round.count]));
  const connectorFields: (keyof ParameterChoices | ParameterKey)[] = connectorTextKeys(keys).filter((key) => !active.has(key));
  if (connector !== 'plug' && connector !== 'dowel') connectorFields.push(keys.round.count);
  const section = activeSection(kind, choices);
  const obliqueFields = Object.values(keys.oblique);
  switch (section) {
    case 'vertical':
      return [keys.position, ...obliqueFields, ...connectorFields];
    case 'oblique':
      return [keys.position, keys.offset, ...connectorFields];
    case 'parallel-to-bases':
      return [keys.offset, ...obliqueFields, ...connectorFields];
    case undefined:
      return [keys.position, keys.offset, ...obliqueFields, keys.separated, keys.connector, ...connectorFields];
  }
}

/**
 * Whether a reset would change the solid or its preview: one of the shape's own texts, an invalid draft included, or
 * choices differs from its initial value. The print size does not count, and neither do switching the tilt input mode
 * alone and the fields of a section that is not chosen.
 */
export function canResetShapeParameters(kind: ShapeKind, state: ParameterState): boolean {
  const reset = resetShapeParameters(kind, state);
  const inactive = new Set<string>([...inactiveTiltKeys(kind, state), ...inactiveSectionKeys(kind, state.choices)]);
  return (
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
