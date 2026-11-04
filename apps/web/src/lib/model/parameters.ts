import {
  APEX_LIMITS,
  apexRatioSchema,
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  baseAngleSchema,
  baseShiftSchema,
  DEFAULT_LONGEST_DIMENSION_MM,
  DEFAULT_PARALLELOGRAM_BASE,
  DEFAULT_TRAPEZOID_BASE,
  DEFAULT_TRIANGLE_BASE,
  defaultModelSpecs,
  longestDimensionSchema,
  MAX_LONGEST_DIMENSION_MM,
  MIN_LONGEST_DIMENSION_MM,
  type ModelSpec,
  type ModelSpecInput,
  modelSpecSchema,
  OFFSET_LIMITS,
  offsetRatioSchema,
  type PrismBaseSides,
  type PrismBaseType,
  type PyramidBaseSides,
  type PyramidBaseType,
  RATIO_LIMITS,
  ROUND_OFFSET_LIMITS,
  ratioSchema,
  roundOffsetSchema,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, halfSumDecimal, parseDecimal } from '../decimal.ts';
import {
  anglesFromOffsets,
  DIRECTION_LIMITS,
  type InclinationKey,
  inclinationRange,
  initialTiltModes,
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
  | 'coneHeightRatio'
  | 'coneOffsetRatio'
  | 'coneInclinationDeg';

/** Raw field text, kept separately from parsed values so that empty and partially typed input stays editable. */
export type ParameterTexts = Record<ParameterKey, string>;

/** Parameters picked from fixed options. */
export type ParameterChoices = {
  prismBaseType: PrismBaseType;
  prismBaseSides: PrismBaseSides;
  pyramidBaseType: PyramidBaseType;
  pyramidBaseSides: PyramidBaseSides;
};

export type ChoiceKey = keyof ParameterChoices;

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
};

export type ModelRequest = {
  readonly values: ParameterValues;
  readonly errors: ParameterErrors;
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
});

export const initialParameterChoices = (): ParameterChoices => ({
  prismBaseType: defaultModelSpecs.prism.shape.baseType,
  prismBaseSides: defaultModelSpecs.prism.shape.baseSides,
  pyramidBaseType: defaultModelSpecs.pyramid.shape.baseType,
  pyramidBaseSides: defaultModelSpecs.pyramid.shape.baseSides,
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
  if (!schema.safeParse(read.value).success) {
    return { error: `Допустимі значення — від ${formatDecimal(limits.min)}${unit} до ${formatDecimal(limits.max)}${unit}.` };
  }
  return read;
}

/** The number in the text, or the exact value behind it, without any range check. */
function readNumber(text: string, example: string, exact?: number): Validation {
  if (exact !== undefined) return { value: exact };
  if (text.trim() === '') return { error: 'Введіть значення.' };
  const value = parseDecimal(text);
  return value === undefined ? { error: `Введіть число, наприклад ${example}.` } : { value };
}

/** An inclusive range in the shape of a schema, for limits that have no schema of their own. */
const inclusiveRange = (limits: { readonly min: number; readonly max: number }) => ({
  safeParse: (value: number) => ({ success: value >= limits.min && value <= limits.max }),
});

export const validateRatio = (text: string, exact?: number): Validation =>
  validateNumber(text, ratioSchema, RATIO_LIMITS, '1,5', '', exact);

export const validateAngle = (text: string, exact?: number): Validation =>
  validateNumber(text, baseAngleSchema, BASE_ANGLE_LIMITS, '60', '°', exact);

export const validateOffset = (text: string, exact?: number): Validation =>
  validateNumber(text, offsetRatioSchema, OFFSET_LIMITS, '-0,5', '', exact);

export const validateShift = (text: string, exact?: number): Validation =>
  validateNumber(text, baseShiftSchema, BASE_SHIFT_LIMITS, '-0,5', '', exact);

export const validateApex = (text: string, exact?: number): Validation =>
  validateNumber(text, apexRatioSchema, APEX_LIMITS, '-0,5', '', exact);

export const validateRoundOffset = (text: string, exact?: number): Validation =>
  validateNumber(text, roundOffsetSchema, ROUND_OFFSET_LIMITS, '0,5', '', exact);

/** The direction of a displacement, counterclockwise from +X as seen from above; 360° is the same as 0°. */
export const validateDirection = (text: string, exact?: number): Validation =>
  validateNumber(text, inclusiveRange(DIRECTION_LIMITS), DIRECTION_LIMITS, '90', '°', exact);

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
  cylinderHeightRatio: validateRatio,
  cylinderOffsetRatio: validateRoundOffset,
  coneHeightRatio: validateRatio,
  coneOffsetRatio: validateRoundOffset,
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

/**
 * The offsets of a solid in its tilt input mode. In the offset mode they are the fields themselves. In the angle mode
 * they follow from the height, the inclination and the direction, so a new height keeps the angles; the computed
 * offsets are also reported among the values, where the group status and a switch back to offsets read them. An
 * inclination whose offsets would leave their limits is reported with the range allowed at this height and direction.
 */
function resolveTilt(
  solid: TiltSolid,
  texts: ParameterTexts,
  { exact, tiltModes = initialTiltModes() }: ParameterOptions,
  height: number | undefined,
): TiltResolution {
  const keys = tiltKeys[solid];
  if (tiltModes[solid] === 'offset') {
    const { values, errors } = validateFields(keys.offsets, texts, exact);
    const offsets = keys.offsets.map((key) => values[key]);
    return { values, errors, offsets: offsets.every((offset) => offset !== undefined) ? offsets : undefined };
  }
  const { values, errors } = validateFields(keys.direction === undefined ? [] : [keys.direction], texts, exact);
  // Circular bases keep their displacement along +X.
  const direction = keys.direction === undefined ? DIRECTION_LIMITS.min : values[keys.direction];
  const inclination = readNumber(texts[keys.inclination], '45', exactValueOf(keys.inclination, texts, exact));
  if ('error' in inclination) return { values, errors: { ...errors, [keys.inclination]: inclination.error }, offsets: undefined };
  const range = inclinationRange(keys.bounds, height, direction);
  const outOfRange: TiltResolution = {
    values,
    errors: {
      ...errors,
      [keys.inclination]:
        `Допустимі значення за цієї висоти${keys.direction === undefined ? '' : ' й напряму'} — ` +
        `від ${formatDecimal(range.min)}° до ${formatDecimal(range.max)}°.`,
    },
    offsets: undefined,
  };
  if (!(inclination.value > 0 && inclination.value <= RIGHT_INCLINATION_DEG)) return outOfRange;
  // 90° needs no height: the displacement is zero whatever it is.
  const known = direction !== undefined && (height !== undefined || inclination.value === RIGHT_INCLINATION_DEG);
  if (!known) return { values: { ...values, [keys.inclination]: inclination.value }, errors, offsets: undefined };
  const offsets = offsetsFromAngles(keys.bounds, height ?? RATIO_LIMITS.min, inclination.value, direction);
  if (offsets === undefined) return outOfRange;
  const computed: ParameterValues = { [keys.inclination]: inclination.value };
  keys.offsets.forEach((key, index) => {
    computed[key] = offsets[index] ?? 0;
  });
  return { values: { ...values, ...computed }, errors, offsets };
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
  const values = { ...resolved.values };
  const errors = { ...resolved.errors };
  const size = validatePrintSize(texts.printSizeMm);
  if ('error' in size) errors.printSizeMm = size.error;
  else values.printSizeMm = size.value;
  if (resolved.shape === undefined || 'error' in size) return { values, errors, spec: undefined, key: undefined };
  const spec = modelSpecSchema.parse({ shape: resolved.shape, scale: { longestDimensionMm: size.value } });
  return { values, errors, spec, key: JSON.stringify(spec) };
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
  Record<ShapeKind, { readonly texts: readonly ParameterKey[]; readonly choices: readonly ChoiceKey[] }>
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
  cylinder: { texts: ['cylinderHeightRatio', 'cylinderOffsetRatio', 'cylinderInclinationDeg'], choices: [] },
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
 * The state after "Скинути параметри фігури": the shape's own fields and choices, also of its inactive base variants
 * and of both tilt modes, return to their initial values, drafts included. The print size, every other shape and the
 * tilt input mode keep theirs, so a reset in the angle mode shows 90°.
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

/**
 * Whether a reset would change the solid: one of the shape's own texts, an invalid draft included, or choices differs
 * from its initial value. The print size does not count, and neither does switching the tilt input mode alone.
 */
export function canResetShapeParameters(kind: ShapeKind, state: ParameterState): boolean {
  const reset = resetShapeParameters(kind, state);
  const inactive = new Set(inactiveTiltKeys(kind, state));
  return (
    shapeParameterKeys[kind].texts.some((key) => !inactive.has(key) && reset.texts[key] !== state.texts[key]) ||
    shapeParameterKeys[kind].choices.some((key) => reset.choices[key] !== state.choices[key])
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
