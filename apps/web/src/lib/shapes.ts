import { type TrapezoidKind, trapezoidKind } from '@diploma-3d/engine';
import {
  APEX_LIMITS,
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  defaultModelSpecs,
  OFFSET_LIMITS,
  PRISM_BASE_SIDES,
  PRISM_BASE_TYPES,
  type PrismBaseSides,
  PYRAMID_BASE_TYPES,
  type PyramidBaseType,
  RATIO_LIMITS,
  ROUND_OFFSET_LIMITS,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, type StepRange } from './decimal.ts';
import type { ChoiceKey, ParameterChoices, ParameterKey } from './model/parameters.ts';

export type ShapeOption = {
  readonly value: ShapeKind;
  readonly label: string;
};

/** Optional help: a short question that reveals the explanation on demand. */
export type Help = {
  readonly label: string;
  readonly text: string;
};

/**
 * A numeric field: "label [value] suffix", e.g. "Ширина b [1,5] × a" for a multiplier or "Кут α [60] °" for an angle,
 * with a slider over `range`.
 */
export type NumericField = {
  readonly type: 'number';
  readonly key: ParameterKey;
  readonly label: string;
  readonly suffix: string;
  readonly range: StepRange;
};

/** A parameter picked from fixed options, such as the base type or the regular polygon. */
export type ChoiceField = {
  readonly type: 'choice';
  readonly key: ChoiceKey;
  readonly label: string;
  readonly options: readonly { readonly value: ParameterChoices[ChoiceKey]; readonly label: string }[];
};

/**
 * A displacement, such as of a prism's upper base or a pyramid's apex: one or two numeric fields with a reset to zero.
 * Whether it is centred follows from the values; nothing else stores it.
 */
export type OffsetGroup = {
  readonly type: 'offset';
  readonly key: string;
  readonly fields: readonly [NumericField, ...NumericField[]];
  readonly resetLabel: string;
  /** The state for all values zero and otherwise, such as "пряма" and "похила". */
  readonly status: { readonly centred: string; readonly moved: string };
};

/**
 * The trapezoid base: the parallel side b, the base height t and the shift δ of side b, with one-time alignment actions
 * for δ and a line naming the special case the values describe.
 */
export type TrapezoidGroup = {
  readonly type: 'trapezoid';
  readonly key: string;
  readonly fields: readonly [side: NumericField, height: NumericField, shift: NumericField];
};

export type ParameterField = NumericField | ChoiceField | OffsetGroup | TrapezoidGroup;

/** A collapsible group of the sidebar, such as "Основа" or "Нахил". */
export type ParameterSection = {
  /** Unique across all shapes, so that each group keeps its own open state. */
  readonly key: string;
  readonly title: string;
  /** Construction controls start open; optional displacements start collapsed. */
  readonly initiallyOpen: boolean;
  readonly fields: readonly ParameterField[];
  readonly help?: Help | undefined;
};

/** The sidebar of a shape: one line for fixed proportions, otherwise the reference length's help and the groups. */
export type ShapePanel =
  | { readonly type: 'fixed'; readonly note: string }
  | { readonly type: 'parameters'; readonly help: Help; readonly sections: readonly ParameterSection[] };

export const shapeOptions: readonly ShapeOption[] = [
  { value: 'cube', label: 'Куб' },
  { value: 'cuboid', label: 'Прямокутний паралелепіпед' },
  { value: 'parallelepiped', label: 'Паралелепіпед' },
  { value: 'prism', label: 'Призма' },
  { value: 'pyramid', label: 'Піраміда' },
  { value: 'tetrahedron', label: 'Правильний тетраедр' },
  { value: 'octahedron', label: 'Октаедр' },
  { value: 'icosahedron', label: 'Ікосаедр' },
  { value: 'dodecahedron', label: 'Додекаедр' },
  { value: 'cylinder', label: 'Циліндр' },
  { value: 'cone', label: 'Конус' },
  { value: 'ball', label: 'Куля' },
];

export const isAvailableShape = (value: string): value is ShapeKind => Object.hasOwn(defaultModelSpecs, value);

export const shapeLabel = (value: string): string => shapeOptions.find((shape) => shape.value === value)?.label ?? '—';

const sizeFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

/** Width × depth × height of the exported model, e.g. "40 × 34,6 × 80 мм". */
export const formatSize = (size: readonly number[] | undefined): string =>
  size === undefined ? '— мм' : `${size.map((value) => sizeFormat.format(value)).join(' × ')} мм`;

type FixedShapeKind = 'cube' | 'tetrahedron' | 'octahedron' | 'icosahedron' | 'dodecahedron' | 'ball';

const fixedNotes: Readonly<Record<FixedShapeKind, string>> = {
  cube: 'Усі ребра рівні, грані — квадрати. Параметрів немає.',
  tetrahedron: 'Усі ребра рівні, грані — рівносторонні трикутники. Параметрів немає.',
  octahedron: '8 граней — рівносторонні трикутники; модель лежить на грані. Параметрів немає.',
  icosahedron: '20 граней — рівносторонні трикутники; модель лежить на грані. Параметрів немає.',
  dodecahedron: '12 граней — правильні п’ятикутники; модель лежить на грані. Параметрів немає.',
  ball: 'Суцільна куля. Параметрів немає.',
};

/** "Що означає × a?": what the reference length is and how the fixed export size rescales everything. */
function referenceHelp(kind: ShapeKind, reference: string, meaning: string): Help {
  const length = formatDecimal(defaultModelSpecs[kind].scale.longestDimensionMm);
  return {
    label: `Що означає × ${reference}?`,
    text:
      `${meaning} Множник задає розмір відносно ${reference}: «2 × ${reference}» — удвічі більше за ${reference}. ` +
      `Міліметри окремо не задаються: модель завжди масштабується так, щоб її найбільший габарит дорівнював ${length} мм, ` +
      `тому зміна множників змінює й саме ${reference}. Поточні габарити показано під переглядом.`,
  };
}

const shiftHelp: Help = {
  label: 'Як працює зміщення?',
  text:
    'Верхня основа зсувається відносно нижньої: X — уздовж сторони a, Y — перпендикулярно до неї. Обидва нулі дають ' +
    'пряме тіло. Висота h — відстань між основами — не змінюється.',
};

const apexHelp: Help = {
  label: 'Як задано вершину?',
  text:
    'Зміщення відлічується від центра мас основи: X — уздовж сторони a, Y — перпендикулярно до неї. Висота h лишається ' +
    'перпендикуляром до основи; вершина може лежати й поза нею.',
};

const roundShiftHelp = (moving: string): Help => ({
  label: 'Як працює зміщення?',
  text: `${moving} зсувається вздовж осі X на задану частку r. Висота h лишається перпендикуляром до основи.`,
});

const triangleHelp: Help = {
  label: 'Як задано трикутник?',
  text: 'Сторонами a і b та кутом α між ними; третя сторона обчислюється автоматично.',
};

const parallelogramHelp: Help = {
  label: 'Як задано паралелограм?',
  text: 'Сторонами a і b та кутом α між ними; протилежні сторони рівні й паралельні.',
};

const trapezoidHelp: Help = {
  label: 'Як задано трапецію?',
  text:
    'a і b — паралельні сторони; висота трапеції t — відстань між ними. Зміщення δ зсуває середину b уздовж X відносно ' +
    'середини a. Якщо b = a, основа — паралелограм, а без зміщення — прямокутник.',
};

const trapezoidKindNames: Readonly<Record<TrapezoidKind, string>> = {
  general: 'трапеція',
  isosceles: 'рівнобічна трапеція',
  right: 'прямокутна трапеція',
  parallelogram: 'паралелограм (b = a)',
  rectangle: 'прямокутник (b = a)',
};

/** The special case of the trapezoid base, such as "рівнобічна трапеція"; undefined while b or δ is not valid. */
export const trapezoidKindName = (sideRatio: number | undefined, shiftRatio: number | undefined): string | undefined =>
  sideRatio === undefined || shiftRatio === undefined ? undefined : trapezoidKindNames[trapezoidKind(sideRatio, shiftRatio)];

// Buttons, arrow keys and the slider move ratios to multiples of 0,25; typed values keep any precision.
const ratioRange: StepRange = { ...RATIO_LIMITS, increment: 0.25 };
// The base angle moves in whole multiples of 5°.
const angleRange: StepRange = { ...BASE_ANGLE_LIMITS, increment: 5 };
const offsetRange: StepRange = { ...OFFSET_LIMITS, increment: 0.25 };
const apexRange: StepRange = { ...APEX_LIMITS, increment: 0.25 };
const shiftRange: StepRange = { ...BASE_SHIFT_LIMITS, increment: 0.25 };
const roundOffsetRange: StepRange = { ...ROUND_OFFSET_LIMITS, increment: 0.25 };

const ratioField = (key: ParameterKey, label: string, reference = 'a'): NumericField => ({
  type: 'number',
  key,
  label,
  suffix: `× ${reference}`,
  range: ratioRange,
});

const twoSidesAndAngle = ([side, angle]: readonly [ParameterKey, ParameterKey]): NumericField[] => [
  ratioField(side, 'Сторона основи b'),
  { type: 'number', key: angle, label: 'Кут α', suffix: '°', range: angleRange },
];

const section = (
  key: string,
  title: string,
  fields: readonly ParameterField[],
  options: { initiallyOpen?: boolean; help?: Help | undefined } = {},
): ParameterSection => ({ key, title, fields, initiallyOpen: options.initiallyOpen ?? true, help: options.help });

/** A displacement of an upper base or apex: optional, so its group starts collapsed. */
const offsetSection = (key: string, title: string, group: Omit<OffsetGroup, 'type' | 'key'>, help: Help): ParameterSection =>
  section(key, title, [{ type: 'offset', key: `${key}-offset`, ...group }], { initiallyOpen: false, help });

const offsetFields = ([x, y]: readonly [ParameterKey, ParameterKey], range: StepRange): OffsetGroup['fields'] => [
  { type: 'number', key: x, label: 'Зміщення X', suffix: '× a', range },
  { type: 'number', key: y, label: 'Зміщення Y', suffix: '× a', range },
];

const baseTypeNames: Readonly<Record<PyramidBaseType, string>> = {
  regular: 'Правильний багатокутник',
  triangle: 'Трикутник',
  parallelogram: 'Паралелограм',
  trapezoid: 'Трапеція',
};

const baseNames: Readonly<Record<PrismBaseSides, string>> = {
  3: 'Рівносторонній трикутник',
  4: 'Квадрат',
  5: 'Правильний п’ятикутник',
  6: 'Правильний шестикутник',
  8: 'Правильний восьмикутник',
};

/** The keys of one solid family's base fields; the parallelogram is offered by pyramids only. */
type BaseFieldKeys = {
  readonly typeKey: 'prismBaseType' | 'pyramidBaseType';
  readonly types: readonly PyramidBaseType[];
  readonly sidesKey: 'prismBaseSides' | 'pyramidBaseSides';
  readonly triangle: readonly [side: ParameterKey, angle: ParameterKey];
  readonly parallelogram?: readonly [side: ParameterKey, angle: ParameterKey];
  readonly trapezoid: { readonly key: string; readonly fields: readonly [ParameterKey, ParameterKey, ParameterKey] };
};

/** "Основа": the base type selector and the selected base's own fields, with help for the non-regular bases. */
function baseSection(kind: 'prism' | 'pyramid', keys: BaseFieldKeys, baseType: PyramidBaseType): ParameterSection {
  const selector: ChoiceField = {
    type: 'choice',
    key: keys.typeKey,
    label: 'Тип основи',
    options: keys.types.map((type) => ({ value: type, label: baseTypeNames[type] })),
  };
  const [side, height, shift] = keys.trapezoid.fields;
  const fields: Record<PyramidBaseType, ParameterField[]> = {
    regular: [
      {
        type: 'choice',
        key: keys.sidesKey,
        label: 'Багатокутник',
        options: PRISM_BASE_SIDES.map((sides) => ({ value: sides, label: baseNames[sides] })),
      },
    ],
    triangle: twoSidesAndAngle(keys.triangle),
    parallelogram: keys.parallelogram === undefined ? [] : twoSidesAndAngle(keys.parallelogram),
    trapezoid: [
      {
        type: 'trapezoid',
        key: keys.trapezoid.key,
        fields: [
          ratioField(side, 'Паралельна сторона b'),
          ratioField(height, 'Висота трапеції t'),
          { type: 'number', key: shift, label: 'Зміщення сторони b', suffix: '× a', range: shiftRange },
        ],
      },
    ],
  };
  const help: Record<PyramidBaseType, Help | undefined> = {
    regular: undefined,
    triangle: triangleHelp,
    parallelogram: parallelogramHelp,
    trapezoid: trapezoidHelp,
  };
  return section(`${kind}-base`, 'Основа', [selector, ...fields[baseType]], { help: help[baseType] });
}

const prismBaseKeys: BaseFieldKeys = {
  typeKey: 'prismBaseType',
  types: PRISM_BASE_TYPES,
  sidesKey: 'prismBaseSides',
  triangle: ['prismTriangleSideRatio', 'prismTriangleAngleDeg'],
  trapezoid: {
    key: 'prismTrapezoid',
    fields: ['prismTrapezoidSideRatio', 'prismTrapezoidHeightRatio', 'prismTrapezoidShiftRatio'],
  },
};

const pyramidBaseKeys: BaseFieldKeys = {
  typeKey: 'pyramidBaseType',
  types: PYRAMID_BASE_TYPES,
  sidesKey: 'pyramidBaseSides',
  triangle: ['pyramidTriangleSideRatio', 'pyramidTriangleAngleDeg'],
  parallelogram: ['pyramidParallelogramSideRatio', 'pyramidParallelogramAngleDeg'],
  trapezoid: {
    key: 'pyramidTrapezoid',
    fields: ['pyramidTrapezoidSideRatio', 'pyramidTrapezoidHeightRatio', 'pyramidTrapezoidShiftRatio'],
  },
};

const sideAMeaning = 'a — сторона основи.';

/** The sidebar of the selected shape; for a prism or pyramid, only the selected base type's fields. */
export function shapePanel(kind: ShapeKind, choices: ParameterChoices): ShapePanel {
  switch (kind) {
    case 'cube':
    case 'tetrahedron':
    case 'octahedron':
    case 'icosahedron':
    case 'dodecahedron':
    case 'ball':
      return { type: 'fixed', note: fixedNotes[kind] };
    case 'cuboid':
      return {
        type: 'parameters',
        help: referenceHelp(kind, 'a', 'a — довжина; ширину b і висоту c задано відносно неї.'),
        sections: [
          section('cuboid-size', 'Розміри', [
            ratioField('cuboidWidthRatio', 'Ширина b'),
            ratioField('cuboidHeightRatio', 'Висота c'),
          ]),
        ],
      };
    case 'parallelepiped':
      return {
        type: 'parameters',
        help: referenceHelp(kind, 'a', sideAMeaning),
        sections: [
          section(
            'parallelepiped-base',
            'Основа',
            twoSidesAndAngle(['parallelepipedBaseSideRatio', 'parallelepipedBaseAngleDeg']),
            {
              help: parallelogramHelp,
            },
          ),
          section('parallelepiped-height', 'Висота', [ratioField('parallelepipedHeightRatio', 'Висота h')]),
          offsetSection(
            'parallelepiped-tilt',
            'Нахил',
            {
              fields: offsetFields(['parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio'], offsetRange),
              resetLabel: 'Прибрати нахил',
              status: { centred: 'прямий', moved: 'похилий' },
            },
            shiftHelp,
          ),
        ],
      };
    case 'prism':
      return {
        type: 'parameters',
        help: referenceHelp(kind, 'a', sideAMeaning),
        sections: [
          baseSection('prism', prismBaseKeys, choices.prismBaseType),
          // "Висота призми h" next to the trapezoid's own height t.
          section('prism-height', 'Висота', [
            ratioField('prismHeightRatio', choices.prismBaseType === 'trapezoid' ? 'Висота призми h' : 'Висота h'),
          ]),
          offsetSection(
            'prism-tilt',
            'Нахил',
            {
              fields: offsetFields(['prismOffsetXRatio', 'prismOffsetYRatio'], offsetRange),
              resetLabel: 'Прибрати нахил',
              status: { centred: 'пряма', moved: 'похила' },
            },
            shiftHelp,
          ),
        ],
      };
    case 'pyramid':
      return {
        type: 'parameters',
        help: referenceHelp(kind, 'a', sideAMeaning),
        sections: [
          baseSection('pyramid', pyramidBaseKeys, choices.pyramidBaseType),
          section('pyramid-height', 'Висота', [ratioField('pyramidHeightRatio', 'Висота піраміди h')]),
          offsetSection(
            'pyramid-apex',
            'Вершина',
            {
              fields: offsetFields(['pyramidApexXRatio', 'pyramidApexYRatio'], apexRange),
              resetLabel: 'Над центром основи',
              status: { centred: 'над центром', moved: 'зміщена' },
            },
            apexHelp,
          ),
        ],
      };
    case 'cylinder':
    case 'cone': {
      const [heightKey, offsetKey] =
        kind === 'cylinder'
          ? (['cylinderHeightRatio', 'cylinderOffsetRatio'] as const)
          : (['coneHeightRatio', 'coneOffsetRatio'] as const);
      const offsetLabel = kind === 'cylinder' ? 'Зміщення верхньої основи' : 'Зміщення вершини';
      return {
        type: 'parameters',
        help: referenceHelp(kind, 'r', 'r — радіус основи.'),
        sections: [
          section(`${kind}-height`, 'Висота', [ratioField(heightKey, 'Висота h', 'r')]),
          offsetSection(
            `${kind}-tilt`,
            'Нахил',
            {
              fields: [{ type: 'number', key: offsetKey, label: offsetLabel, suffix: '× r', range: roundOffsetRange }],
              resetLabel: 'Прибрати нахил',
              status: { centred: 'прямий', moved: 'похилий' },
            },
            roundShiftHelp(kind === 'cylinder' ? 'Центр верхньої основи' : 'Вершина'),
          ),
        ],
      };
    }
  }
}

/** The numeric fields of a section in display order, including those inside groups. */
export function sectionNumberFields(target: ParameterSection): NumericField[] {
  return target.fields.flatMap((field): readonly NumericField[] =>
    field.type === 'number' ? [field] : field.type === 'choice' ? [] : field.fields,
  );
}
