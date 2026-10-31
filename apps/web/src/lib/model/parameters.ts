import {
  CUBOID_RATIO_LIMITS,
  cuboidRatioSchema,
  defaultModelSpecs,
  type ModelSpec,
  modelSpecSchema,
  type PhysicalScale,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, parseDecimal } from '../decimal.ts';

export type ParameterKey = 'widthRatio' | 'heightRatio';

/** Raw field text, kept separately from parsed values so that empty and partially typed input stays editable. */
export type ParameterTexts = Record<ParameterKey, string>;

export type ParameterErrors = Partial<Record<ParameterKey, string>>;

/** Validated field values; the same numbers drive the controls and, when every field is valid, the specification. */
export type ParameterValues = Partial<Record<ParameterKey, number>>;

export type ModelRequest = {
  readonly scale: PhysicalScale;
  readonly values: ParameterValues;
  readonly errors: ParameterErrors;
} & ({ readonly spec: ModelSpec; readonly key: string } | { readonly spec: undefined; readonly key: undefined });

export const initialParameterTexts = (): ParameterTexts => ({
  widthRatio: formatDecimal(defaultModelSpecs.cuboid.shape.widthRatio),
  heightRatio: formatDecimal(defaultModelSpecs.cuboid.shape.heightRatio),
});

export function validateRatio(text: string): { value: number } | { error: string } {
  if (text.trim() === '') return { error: 'Введіть значення.' };
  const value = parseDecimal(text);
  if (value === undefined) return { error: 'Введіть число, наприклад 1,5.' };
  if (!cuboidRatioSchema.safeParse(value).success) {
    return {
      error: `Допустимі значення — від ${formatDecimal(CUBOID_RATIO_LIMITS.min)} до ${formatDecimal(CUBOID_RATIO_LIMITS.max)}.`,
    };
  }
  return { value };
}

/** Turns the selected shape and field texts into a validated specification, or field errors when it is not valid. */
export function resolveModelRequest(kind: ShapeKind, texts: ParameterTexts): ModelRequest {
  const { scale } = defaultModelSpecs[kind];
  switch (kind) {
    case 'cube':
      return withKey({ shape: { kind }, scale }, {});
    case 'cuboid': {
      const width = validateRatio(texts.widthRatio);
      const height = validateRatio(texts.heightRatio);
      const values: ParameterValues = {};
      const errors: ParameterErrors = {};
      if ('error' in width) errors.widthRatio = width.error;
      else values.widthRatio = width.value;
      if ('error' in height) errors.heightRatio = height.error;
      else values.heightRatio = height.value;
      if ('error' in width || 'error' in height) return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, widthRatio: width.value, heightRatio: height.value }, scale }, values);
    }
  }
}

function withKey(candidate: ModelSpec, values: ParameterValues): ModelRequest {
  const spec = modelSpecSchema.parse(candidate);
  return { scale: spec.scale, values, errors: {}, spec, key: JSON.stringify(spec) };
}
