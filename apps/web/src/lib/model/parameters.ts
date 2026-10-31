import {
  CUBOID_RATIO_LIMITS,
  cuboidRatioSchema,
  defaultModelSpecs,
  type ModelSpec,
  modelSpecSchema,
  type ShapeKind,
} from '@diploma-3d/schema';

export type ParameterKey = 'widthRatio' | 'heightRatio';

/** Raw field text, kept separately from parsed values so that empty and partially typed input stays editable. */
export type ParameterTexts = Record<ParameterKey, string>;

export type ParameterErrors = Partial<Record<ParameterKey, string>>;

export type ModelRequest =
  | { readonly spec: ModelSpec; readonly key: string; readonly errors: ParameterErrors }
  | { readonly spec: undefined; readonly key: undefined; readonly errors: ParameterErrors };

const decimalFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 4, useGrouping: false });

export const formatDecimal = (value: number): string => decimalFormat.format(value);

export const initialParameterTexts = (): ParameterTexts => ({
  widthRatio: formatDecimal(defaultModelSpecs.cuboid.shape.widthRatio),
  heightRatio: formatDecimal(defaultModelSpecs.cuboid.shape.heightRatio),
});

// Plain decimals with a comma (Ukrainian) or a point; exponents and fragments such as "-" or "," are not numbers.
const DECIMAL_PATTERN = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

export function parseDecimal(text: string): number | undefined {
  const trimmed = text.trim();
  return DECIMAL_PATTERN.test(trimmed) ? Number(trimmed.replace(',', '.')) : undefined;
}

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
  switch (kind) {
    case 'cube':
      return withKey(defaultModelSpecs.cube, {});
    case 'cuboid': {
      const width = validateRatio(texts.widthRatio);
      const height = validateRatio(texts.heightRatio);
      const errors: ParameterErrors = {};
      if ('error' in width) errors.widthRatio = width.error;
      if ('error' in height) errors.heightRatio = height.error;
      if ('error' in width || 'error' in height) return { spec: undefined, key: undefined, errors };
      const shape = { kind, widthRatio: width.value, heightRatio: height.value };
      return withKey({ shape, scale: defaultModelSpecs.cuboid.scale }, errors);
    }
  }
}

function withKey(candidate: ModelSpec, errors: ParameterErrors): ModelRequest {
  const spec = modelSpecSchema.parse(candidate);
  return { spec, key: JSON.stringify(spec), errors };
}
