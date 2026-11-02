import {
  defaultModelSpecs,
  type ModelSpec,
  modelSpecSchema,
  type PhysicalScale,
  type PrismBaseSides,
  type PyramidBaseSides,
  RATIO_LIMITS,
  ratioSchema,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, parseDecimal } from '../decimal.ts';

/** Ratio fields, kept per shape so that switching shapes never carries a value into a different meaning. */
export type ParameterKey = 'cuboidWidthRatio' | 'cuboidHeightRatio' | 'prismHeightRatio' | 'pyramidHeightRatio';

/** Raw field text, kept separately from parsed values so that empty and partially typed input stays editable. */
export type ParameterTexts = Record<ParameterKey, string>;

/** Parameters picked from fixed options. */
export type ParameterChoices = { prismBaseSides: PrismBaseSides; pyramidBaseSides: PyramidBaseSides };

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
  prismHeightRatio: formatDecimal(defaultModelSpecs.prism.shape.heightRatio),
  pyramidHeightRatio: formatDecimal(defaultModelSpecs.pyramid.shape.heightRatio),
});

export const initialParameterChoices = (): ParameterChoices => ({
  prismBaseSides: defaultModelSpecs.prism.shape.baseSides,
  pyramidBaseSides: defaultModelSpecs.pyramid.shape.baseSides,
});

export function validateRatio(text: string): { value: number } | { error: string } {
  if (text.trim() === '') return { error: 'Введіть значення.' };
  const value = parseDecimal(text);
  if (value === undefined) return { error: 'Введіть число, наприклад 1,5.' };
  if (!ratioSchema.safeParse(value).success) {
    return { error: `Допустимі значення — від ${formatDecimal(RATIO_LIMITS.min)} до ${formatDecimal(RATIO_LIMITS.max)}.` };
  }
  return { value };
}

function validateRatios(
  keys: readonly ParameterKey[],
  texts: ParameterTexts,
): { values: ParameterValues; errors: ParameterErrors } {
  const values: ParameterValues = {};
  const errors: ParameterErrors = {};
  for (const key of keys) {
    const result = validateRatio(texts[key]);
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
      return withKey({ shape: { kind }, scale }, {});
    case 'cuboid': {
      const { values, errors } = validateRatios(['cuboidWidthRatio', 'cuboidHeightRatio'], texts);
      const { cuboidWidthRatio: widthRatio, cuboidHeightRatio: heightRatio } = values;
      if (widthRatio === undefined || heightRatio === undefined)
        return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, widthRatio, heightRatio }, scale }, values);
    }
    case 'prism': {
      const { values, errors } = validateRatios(['prismHeightRatio'], texts);
      const { prismHeightRatio: heightRatio } = values;
      if (heightRatio === undefined) return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, baseSides: choices.prismBaseSides, heightRatio }, scale }, values);
    }
    case 'pyramid': {
      const { values, errors } = validateRatios(['pyramidHeightRatio'], texts);
      const { pyramidHeightRatio: heightRatio } = values;
      if (heightRatio === undefined) return { scale, values, errors, spec: undefined, key: undefined };
      return withKey({ shape: { kind, baseSides: choices.pyramidBaseSides, heightRatio }, scale }, values);
    }
  }
}

function withKey(candidate: ModelSpec, values: ParameterValues): ModelRequest {
  const spec = modelSpecSchema.parse(candidate);
  return { scale: spec.scale, values, errors: {}, spec, key: JSON.stringify(spec) };
}
