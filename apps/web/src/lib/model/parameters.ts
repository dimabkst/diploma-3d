import {
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  baseAngleSchema,
  baseShiftSchema,
  DEFAULT_TRAPEZOID_BASE,
  DEFAULT_TRIANGLE_BASE,
  defaultModelSpecs,
  type ModelSpec,
  type ModelSpecInput,
  modelSpecSchema,
  OFFSET_LIMITS,
  offsetRatioSchema,
  type PhysicalScale,
  type PrismBaseSides,
  type PrismBaseType,
  type PyramidBaseSides,
  RATIO_LIMITS,
  ratioSchema,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, halfSumDecimal, parseDecimal } from '../decimal.ts';

/** Numeric fields, kept per shape so that switching shapes never carries a value into a different meaning. */
export type ParameterKey =
  | 'cuboidWidthRatio'
  | 'cuboidHeightRatio'
  | 'parallelepipedBaseSideRatio'
  | 'parallelepipedHeightRatio'
  | 'parallelepipedBaseAngleDeg'
  | 'parallelepipedOffsetXRatio'
  | 'parallelepipedOffsetYRatio'
  | 'prismHeightRatio'
  | 'prismOffsetXRatio'
  | 'prismOffsetYRatio'
  | 'prismTriangleSideRatio'
  | 'prismTriangleAngleDeg'
  | 'prismTrapezoidSideRatio'
  | 'prismTrapezoidHeightRatio'
  | 'prismTrapezoidShiftRatio'
  | 'pyramidHeightRatio'
  | 'cylinderHeightRatio'
  | 'coneHeightRatio';

/** Raw field text, kept separately from parsed values so that empty and partially typed input stays editable. */
export type ParameterTexts = Record<ParameterKey, string>;

/** Parameters picked from fixed options. */
export type ParameterChoices = {
  prismBaseType: PrismBaseType;
  prismBaseSides: PrismBaseSides;
  pyramidBaseSides: PyramidBaseSides;
};

export type ChoiceKey = keyof ParameterChoices;

export type ParameterErrors = Partial<Record<ParameterKey, string>>;

/** Validated field values; the same numbers drive the controls and, when every field is valid, the specification. */
export type ParameterValues = Partial<Record<ParameterKey, number>>;

export type ModelRequest = {
  readonly scale: PhysicalScale;
  readonly values: ParameterValues;
  readonly errors: ParameterErrors;
} & ({ readonly spec: ModelSpec; readonly key: string } | { readonly spec: undefined; readonly key: undefined });

export const initialParameterTexts = (): ParameterTexts => ({
  cuboidWidthRatio: formatDecimal(defaultModelSpecs.cuboid.shape.widthRatio),
  cuboidHeightRatio: formatDecimal(defaultModelSpecs.cuboid.shape.heightRatio),
  parallelepipedBaseSideRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.baseSideRatio),
  parallelepipedHeightRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.heightRatio),
  parallelepipedBaseAngleDeg: formatDecimal(defaultModelSpecs.parallelepiped.shape.baseAngleDeg),
  parallelepipedOffsetXRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.offsetXRatio),
  parallelepipedOffsetYRatio: formatDecimal(defaultModelSpecs.parallelepiped.shape.offsetYRatio),
  prismHeightRatio: formatDecimal(defaultModelSpecs.prism.shape.heightRatio),
  prismOffsetXRatio: formatDecimal(defaultModelSpecs.prism.shape.offsetXRatio),
  prismOffsetYRatio: formatDecimal(defaultModelSpecs.prism.shape.offsetYRatio),
  prismTriangleSideRatio: formatDecimal(DEFAULT_TRIANGLE_BASE.baseSideRatio),
  prismTriangleAngleDeg: formatDecimal(DEFAULT_TRIANGLE_BASE.baseAngleDeg),
  prismTrapezoidSideRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.parallelSideRatio),
  prismTrapezoidHeightRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.baseHeightRatio),
  prismTrapezoidShiftRatio: formatDecimal(DEFAULT_TRAPEZOID_BASE.baseShiftRatio),
  pyramidHeightRatio: formatDecimal(defaultModelSpecs.pyramid.shape.heightRatio),
  cylinderHeightRatio: formatDecimal(defaultModelSpecs.cylinder.shape.heightRatio),
  coneHeightRatio: formatDecimal(defaultModelSpecs.cone.shape.heightRatio),
});

export const initialParameterChoices = (): ParameterChoices => ({
  prismBaseType: defaultModelSpecs.prism.shape.baseType,
  prismBaseSides: defaultModelSpecs.prism.shape.baseSides,
  pyramidBaseSides: defaultModelSpecs.pyramid.shape.baseSides,
});

type Validation = { value: number } | { error: string };

/** Parses the text and checks it against the schema; the limits, example and unit only phrase the errors. */
function validateNumber(
  text: string,
  schema: { safeParse(value: number): { success: boolean } },
  limits: { readonly min: number; readonly max: number },
  example: string,
  unit = '',
): Validation {
  if (text.trim() === '') return { error: 'Введіть значення.' };
  const value = parseDecimal(text);
  if (value === undefined) return { error: `Введіть число, наприклад ${example}.` };
  if (!schema.safeParse(value).success) {
    return { error: `Допустимі значення — від ${formatDecimal(limits.min)}${unit} до ${formatDecimal(limits.max)}${unit}.` };
  }
  return { value };
}

export const validateRatio = (text: string): Validation => validateNumber(text, ratioSchema, RATIO_LIMITS, '1,5');

export const validateAngle = (text: string): Validation => validateNumber(text, baseAngleSchema, BASE_ANGLE_LIMITS, '60', '°');

export const validateOffset = (text: string): Validation => validateNumber(text, offsetRatioSchema, OFFSET_LIMITS, '-0,5');

export const validateShift = (text: string): Validation => validateNumber(text, baseShiftSchema, BASE_SHIFT_LIMITS, '-0,5');

const validators: Readonly<Record<ParameterKey, (text: string) => Validation>> = {
  cuboidWidthRatio: validateRatio,
  cuboidHeightRatio: validateRatio,
  parallelepipedBaseSideRatio: validateRatio,
  parallelepipedHeightRatio: validateRatio,
  parallelepipedBaseAngleDeg: validateAngle,
  parallelepipedOffsetXRatio: validateOffset,
  parallelepipedOffsetYRatio: validateOffset,
  prismHeightRatio: validateRatio,
  prismOffsetXRatio: validateOffset,
  prismOffsetYRatio: validateOffset,
  prismTriangleSideRatio: validateRatio,
  prismTriangleAngleDeg: validateAngle,
  prismTrapezoidSideRatio: validateRatio,
  prismTrapezoidHeightRatio: validateRatio,
  prismTrapezoidShiftRatio: validateShift,
  pyramidHeightRatio: validateRatio,
  cylinderHeightRatio: validateRatio,
  coneHeightRatio: validateRatio,
};

function validateFields(
  keys: readonly ParameterKey[],
  texts: ParameterTexts,
): { values: ParameterValues; errors: ParameterErrors } {
  const values: ParameterValues = {};
  const errors: ParameterErrors = {};
  for (const key of keys) {
    const result = validators[key](texts[key]);
    if ('error' in result) errors[key] = result.error;
    else values[key] = result.value;
  }
  return { values, errors };
}

/**
 * Turns the selected shape, field texts and choices into a validated specification, or field errors when it is not
 * valid. Only the fields of the selected shape are read.
 */
export function resolveModelRequest(kind: ShapeKind, texts: ParameterTexts, choices: ParameterChoices): ModelRequest {
  const { scale } = defaultModelSpecs[kind];
  switch (kind) {
    case 'cube':
    case 'tetrahedron':
    case 'ball':
      return withKey({ shape: { kind }, scale }, {});
    case 'cuboid': {
      const { values, errors } = validateFields(['cuboidWidthRatio', 'cuboidHeightRatio'], texts);
      const { cuboidWidthRatio: widthRatio, cuboidHeightRatio: heightRatio } = values;
      if (widthRatio === undefined || heightRatio === undefined)
        return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, widthRatio, heightRatio }, scale }, values);
    }
    case 'parallelepiped': {
      const { values, errors } = validateFields(
        [
          'parallelepipedBaseSideRatio',
          'parallelepipedHeightRatio',
          'parallelepipedBaseAngleDeg',
          'parallelepipedOffsetXRatio',
          'parallelepipedOffsetYRatio',
        ],
        texts,
      );
      const {
        parallelepipedBaseSideRatio: baseSideRatio,
        parallelepipedHeightRatio: heightRatio,
        parallelepipedBaseAngleDeg: baseAngleDeg,
        parallelepipedOffsetXRatio: offsetXRatio,
        parallelepipedOffsetYRatio: offsetYRatio,
      } = values;
      if (
        baseSideRatio === undefined ||
        heightRatio === undefined ||
        baseAngleDeg === undefined ||
        offsetXRatio === undefined ||
        offsetYRatio === undefined
      )
        return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, baseSideRatio, heightRatio, baseAngleDeg, offsetXRatio, offsetYRatio }, scale }, values);
    }
    case 'prism':
      return resolvePrismRequest(texts, choices);
    case 'pyramid': {
      const { values, errors } = validateFields(['pyramidHeightRatio'], texts);
      const { pyramidHeightRatio: heightRatio } = values;
      if (heightRatio === undefined) return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, baseSides: choices.pyramidBaseSides, heightRatio }, scale }, values);
    }
    case 'cylinder':
    case 'cone': {
      const key = kind === 'cylinder' ? 'cylinderHeightRatio' : 'coneHeightRatio';
      const { values, errors } = validateFields([key], texts);
      const heightRatio = values[key];
      if (heightRatio === undefined) return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, heightRatio }, scale }, values);
    }
  }
}

/** The prism: its height and displacement are shared by every base type; only the selected base's fields are read. */
function resolvePrismRequest(texts: ParameterTexts, choices: ParameterChoices): ModelRequest {
  const kind = 'prism';
  const { scale } = defaultModelSpecs.prism;
  const baseKeys = {
    regular: [],
    triangle: ['prismTriangleSideRatio', 'prismTriangleAngleDeg'],
    trapezoid: ['prismTrapezoidSideRatio', 'prismTrapezoidHeightRatio', 'prismTrapezoidShiftRatio'],
  } as const satisfies Record<PrismBaseType, readonly ParameterKey[]>;
  const { values, errors } = validateFields(
    ['prismHeightRatio', 'prismOffsetXRatio', 'prismOffsetYRatio', ...baseKeys[choices.prismBaseType]],
    texts,
  );
  const { prismHeightRatio: heightRatio, prismOffsetXRatio: offsetXRatio, prismOffsetYRatio: offsetYRatio } = values;
  const invalid = { scale, values, errors, spec: undefined, key: undefined } as const;
  if (heightRatio === undefined || offsetXRatio === undefined || offsetYRatio === undefined) return invalid;
  const shared = { kind, heightRatio, offsetXRatio, offsetYRatio } as const;
  switch (choices.prismBaseType) {
    case 'regular':
      return withKey({ shape: { ...shared, baseType: 'regular', baseSides: choices.prismBaseSides }, scale }, values);
    case 'triangle': {
      const { prismTriangleSideRatio: baseSideRatio, prismTriangleAngleDeg: baseAngleDeg } = values;
      if (baseSideRatio === undefined || baseAngleDeg === undefined) return invalid;
      return withKey({ shape: { ...shared, baseType: 'triangle', baseSideRatio, baseAngleDeg }, scale }, values);
    }
    case 'trapezoid': {
      const {
        prismTrapezoidSideRatio: parallelSideRatio,
        prismTrapezoidHeightRatio: baseHeightRatio,
        prismTrapezoidShiftRatio: baseShiftRatio,
      } = values;
      if (parallelSideRatio === undefined || baseHeightRatio === undefined || baseShiftRatio === undefined) return invalid;
      const base = { baseType: 'trapezoid', parallelSideRatio, baseHeightRatio, baseShiftRatio } as const;
      return withKey({ shape: { ...shared, ...base }, scale }, values);
    }
  }
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

function withKey(candidate: ModelSpecInput, values: ParameterValues): ModelRequest {
  const spec = modelSpecSchema.parse(candidate);
  return { scale: spec.scale, values, errors: {}, spec, key: JSON.stringify(spec) };
}
