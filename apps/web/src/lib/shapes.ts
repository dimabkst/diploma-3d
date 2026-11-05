import { type TrapezoidKind, trapezoidKind } from '@diploma-3d/engine';
import {
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  defaultModelSpecs,
  MAX_LONGEST_DIMENSION_MM,
  MIN_LONGEST_DIMENSION_MM,
  PRISM_BASE_SIDES,
  PRISM_BASE_TYPES,
  type PrismBaseSides,
  PYRAMID_BASE_TYPES,
  type PyramidBaseType,
  RATIO_LIMITS,
  ROUND_HEIGHT_LIMITS,
  SECTION_POSITION_LIMITS,
  type ShapeKind,
} from '@diploma-3d/schema';
import { formatDecimal, type StepRange } from './decimal.ts';
import {
  type ChoiceKey,
  canSwitchTiltMode,
  type ParameterChoices,
  type ParameterKey,
  type ParameterValues,
  type SectionChoice,
  sectionKeys,
  type ToggleKey,
} from './model/parameters.ts';
import {
  DIRECTION_LIMITS,
  inclinationRange,
  initialTiltModes,
  offsetRange,
  RIGHT_INCLINATION_DEG,
  type TiltMode,
  type TiltModes,
  type TiltSolid,
  tiltKeys,
} from './model/tilt.ts';

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
 * with a slider over `range`, the values the field allows.
 */
export type NumericField = {
  readonly type: 'number';
  readonly key: ParameterKey;
  readonly label: string;
  /** The unit after the entry, such as "× a" or "°"; empty when the label names it. */
  readonly suffix: string;
  /** The allowed values, shared by the entry, the slider and the buttons, and the increment of their steps. */
  readonly range: StepRange;
};

/** A parameter picked from fixed options, such as the base type or the regular polygon. */
export type ChoiceField = {
  readonly type: 'choice';
  readonly key: ChoiceKey;
  readonly label: string;
  readonly options: readonly { readonly value: ParameterChoices[ChoiceKey]; readonly label: string }[];
};

/** A switch, such as whether the preview moves the parts of a section apart. */
export type ToggleField = {
  readonly type: 'toggle';
  readonly key: ToggleKey;
  readonly label: string;
};

/**
 * A displacement, such as of a prism's upper base or a pyramid's apex, entered as offsets or as angles, with a reset to
 * zero. Whether it is centred follows from the offsets, which the angle mode also reports; nothing else stores it.
 */
export type TiltGroup = {
  readonly type: 'tilt';
  readonly key: string;
  readonly solid: TiltSolid;
  readonly mode: TiltMode;
  /** "Зміщення" and "Кути", or "Кут" where only the inclination is entered. */
  readonly modeLabels: Readonly<Record<TiltMode, string>>;
  /** Whether the current input converts to the other mode; it does not while a value it needs is invalid. */
  readonly canSwitch: boolean;
  /** The fields of the current mode. */
  readonly fields: readonly [NumericField, ...NumericField[]];
  /** The offsets in either mode, for the centred or moved state. */
  readonly offsetKeys: readonly ParameterKey[];
  /** The texts that remove the displacement in the current mode: zero offsets, or an inclination of 90°. */
  readonly centredTexts: readonly (readonly [ParameterKey, string])[];
  readonly resetLabel: string;
  /** The state for all offsets zero and otherwise, such as "пряма" and "похила". */
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

export type ParameterField = NumericField | ChoiceField | ToggleField | TiltGroup | TrapezoidGroup;

/** A collapsible group of the sidebar, such as "Основа" or "Нахил". */
export type ParameterSection = {
  /** Unique across all shapes, so that each group keeps its own open state. */
  readonly key: string;
  readonly title: string;
  /** Construction controls start open; optional displacements start collapsed. */
  readonly initiallyOpen: boolean;
  readonly fields: readonly ParameterField[];
  readonly help?: Help | undefined;
  /**
   * A short state for the summary, such as the chosen section; highlighted when it departs from the default. Tilt groups
   * derive theirs from the current offsets instead.
   */
  readonly status?: { readonly text: string; readonly highlighted: boolean } | undefined;
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
  cube: 'Усі ребра рівні, грані — квадрати. Пропорції фіксовані.',
  tetrahedron: 'Усі ребра рівні, грані — рівносторонні трикутники. Пропорції фіксовані.',
  octahedron: '8 граней — рівносторонні трикутники; модель лежить на грані. Пропорції фіксовані.',
  icosahedron: '20 граней — рівносторонні трикутники; модель лежить на грані. Пропорції фіксовані.',
  dodecahedron: '12 граней — правильні п’ятикутники; модель лежить на грані. Пропорції фіксовані.',
  ball: 'Суцільна куля. Пропорції фіксовані.',
};

/**
 * The shared print size: the longest of the exported model's width, depth and height. Arrow keys step by 5 mm; any
 * typed value within the limits is kept.
 */
export const printSizeField: NumericField = {
  type: 'number',
  key: 'printSizeMm',
  label: 'Найбільший габарит',
  suffix: 'мм',
  range: { min: MIN_LONGEST_DIMENSION_MM, max: MAX_LONGEST_DIMENSION_MM, increment: 5 },
};

/** "Що означає × a?": what the reference length is and how the print size rescales everything. */
function referenceHelp(reference: string, meaning: string): Help {
  return {
    label: `Що означає × ${reference}?`,
    text:
      `${meaning} Множник задає розмір відносно ${reference}: «2 × ${reference}» — удвічі більше за ${reference}. ` +
      `Міліметри задає поле «${printSizeField.label}»: модель рівномірно масштабується так, щоб її найбільший вимір ` +
      `дорівнював цьому значенню, тому зміна множників змінює й саме ${reference}. Поточні габарити показано під переглядом.`,
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

const directionText =
  'Напрям зміщення відлічується від осі X проти годинникової стрілки, якщо дивитися згори: 0° — уздовж X ' +
  '(сторони a), 90° — уздовж Y. Від повороту камери він не залежить.';

const edgeAngleHelp: Help = {
  label: 'Як задано кути?',
  text:
    'Кут до площини основи — кут між бічним ребром, напрямленим від нижньої основи до верхньої, і площиною основи; ' +
    `90° дає пряме тіло. ${directionText} Висота h не змінюється.`,
};

const apexAngleHelp: Help = {
  label: 'Як задано кути?',
  text:
    'Кут до площини основи — кут між цією площиною і відрізком від центра мас основи до вершини; 90° ставить вершину ' +
    `над центром. ${directionText} Висота h не змінюється.`,
};

const roundAngleHelp = (line: string, right: string, moving: string): Help => ({
  label: 'Як задано кут?',
  text: `Кут до площини основи — кут між цією площиною і ${line}; 90° дає ${right}. ${moving} зсувається вздовж осі X. Висота h не змінюється.`,
});

const roundAngleHelps: Readonly<Record<'cylinder' | 'cone', Help>> = {
  cylinder: roundAngleHelp(
    'відрізком від центра нижньої основи до центра верхньої (йому паралельні твірні)',
    'прямий циліндр',
    'Верхня основа',
  ),
  cone: roundAngleHelp('відрізком від центра основи до вершини', 'прямий конус', 'Вершина'),
};

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

// Buttons, arrow keys and the slider move ratios and offsets to multiples of 0,25; typed values keep any precision.
const RATIO_INCREMENT = 0.25;
const ratioRange: StepRange = { ...RATIO_LIMITS, increment: RATIO_INCREMENT };
const roundHeightRange: StepRange = { ...ROUND_HEIGHT_LIMITS, increment: RATIO_INCREMENT };
// The base angle moves in whole multiples of 5°.
const angleRange: StepRange = { ...BASE_ANGLE_LIMITS, increment: 5 };
const shiftRange: StepRange = { ...BASE_SHIFT_LIMITS, increment: 0.25 };
// The inclination moves in multiples of 5°, the direction in multiples of 15°, through the axes and the diagonals.
const INCLINATION_INCREMENT = 5;
const directionRange: StepRange = { ...DIRECTION_LIMITS, increment: 15 };

const ratioField = (key: ParameterKey, label: string, reference = 'a'): NumericField => ({
  type: 'number',
  key,
  label,
  suffix: `× ${reference}`,
  // h/r spans the ratios' limits applied to the diameter.
  range: reference === 'r' ? roundHeightRange : ratioRange,
});

const twoSidesAndAngle = ([side, angle]: readonly [ParameterKey, ParameterKey]): NumericField[] => [
  ratioField(side, 'Сторона основи b'),
  { type: 'number', key: angle, label: 'Кут α', suffix: '°', range: angleRange },
];

const section = (
  key: string,
  title: string,
  fields: readonly ParameterField[],
  options: { initiallyOpen?: boolean; help?: Help | undefined; status?: ParameterSection['status'] } = {},
): ParameterSection => ({
  key,
  title,
  fields,
  initiallyOpen: options.initiallyOpen ?? true,
  help: options.help,
  status: options.status,
});

/** What the sidebar shows besides the choices: the tilt input modes, and the valid values that bound the inclination. */
export type PanelContext = {
  readonly tiltModes?: TiltModes | undefined;
  readonly values?: ParameterValues | undefined;
};

type TiltConfig = {
  readonly title: string;
  readonly offsetFields: TiltGroup['fields'];
  readonly offsetHelp: Help;
  readonly angleHelp: Help;
  readonly resetLabel: string;
  readonly status: TiltGroup['status'];
};

/**
 * A displacement of an upper base or apex: optional, so its group starts collapsed. The sliders of its fields span the
 * values allowed at the current height and, for an offset, the other offset, or for the inclination, the direction.
 */
function tiltSection(
  solid: TiltSolid,
  key: string,
  config: TiltConfig,
  { tiltModes = initialTiltModes(), values = {} }: PanelContext,
): ParameterSection {
  const keys = tiltKeys[solid];
  const mode = tiltModes[solid];
  const circular = keys.direction === undefined;
  const height = values[keys.height];
  const direction = keys.direction === undefined ? DIRECTION_LIMITS.min : values[keys.direction];
  const inclination: NumericField = {
    type: 'number',
    key: keys.inclination,
    label: 'Кут до площини основи',
    suffix: '°',
    range: { ...inclinationRange(circular, height, direction), increment: INCLINATION_INCREMENT },
  };
  const angleFields: TiltGroup['fields'] =
    keys.direction === undefined
      ? [inclination]
      : [inclination, { type: 'number', key: keys.direction, label: 'Напрям зміщення', suffix: '°', range: directionRange }];
  const [first, ...rest] = config.offsetFields.map((field, index) => {
    const other = keys.offsets[1 - index];
    const range = offsetRange(circular, height, other === undefined ? undefined : values[other]);
    return { ...field, range: { ...range, increment: RATIO_INCREMENT } };
  });
  const offsetFields: TiltGroup['fields'] = [first as NumericField, ...rest];
  const group: TiltGroup = {
    type: 'tilt',
    key: `${key}-offset`,
    solid,
    mode,
    modeLabels: { offset: 'Зміщення', angle: keys.direction === undefined ? 'Кут' : 'Кути' },
    canSwitch: canSwitchTiltMode(solid, values),
    fields: mode === 'offset' ? offsetFields : angleFields,
    offsetKeys: keys.offsets,
    centredTexts:
      mode === 'offset'
        ? keys.offsets.map((offset) => [offset, '0'] as const)
        : [[keys.inclination, formatDecimal(RIGHT_INCLINATION_DEG)]],
    resetLabel: config.resetLabel,
    status: config.status,
  };
  return section(key, config.title, [group], {
    initiallyOpen: false,
    help: mode === 'offset' ? config.offsetHelp : config.angleHelp,
  });
}

/** The offsets X and Y; their ranges follow from the current values, see `tiltSection`. */
const offsetFields = ([x, y]: readonly [ParameterKey, ParameterKey]): TiltGroup['fields'] => [
  { type: 'number', key: x, label: 'Зміщення X', suffix: '× a', range: ratioRange },
  { type: 'number', key: y, label: 'Зміщення Y', suffix: '× a', range: ratioRange },
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

// The position moves in steps of 5 percentage points; a typed value between them is kept.
const sectionPositionRange: StepRange = { ...SECTION_POSITION_LIMITS, increment: 5 };

const sectionNames: Readonly<Record<SectionChoice, string>> = {
  none: 'Без перерізу',
  'parallel-to-bases': 'Паралельно основам',
};

const parallelSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина паралельна основам і проходить на заданій відстані від нижньої основи — у відсотках висоти h. Переріз — ' +
    'круг радіуса r; у похилого циліндра його центр зміщено разом із віссю, а площина не перпендикулярна до осі. ' +
    'Частини експортуються окремими об’єктами в одному масштабі; розсування змінює лише перегляд. Межі 10–90 % ' +
    'відсувають площину від основ, але не гарантують, що тонку частину вдасться надрукувати.',
};

/**
 * "Переріз": optional, so the group starts collapsed with the chosen section in its summary. The position and the
 * separation are shown only while a section is chosen.
 */
function planeSection(kind: 'cylinder', choices: ParameterChoices): ParameterSection {
  const keys = sectionKeys[kind];
  if (keys === undefined) throw new Error(`No section fields for ${kind}.`);
  const chosen = choices[keys.choice];
  const selector: ChoiceField = {
    type: 'choice',
    key: keys.choice,
    label: 'Тип перерізу',
    options: (['none', 'parallel-to-bases'] as const).map((value) => ({ value, label: sectionNames[value] })),
  };
  const details: ParameterField[] =
    chosen === 'none'
      ? []
      : [
          { type: 'number', key: keys.position, label: 'Від нижньої основи', suffix: '% h', range: sectionPositionRange },
          { type: 'toggle', key: keys.separated, label: 'Розсунути частини' },
        ];
  return section(`${kind}-section`, 'Переріз', [selector, ...details], {
    initiallyOpen: false,
    help: chosen === 'none' ? undefined : parallelSectionHelp,
    status: { text: chosen === 'none' ? 'немає' : sectionNames[chosen].toLowerCase(), highlighted: chosen !== 'none' },
  });
}

/** The sidebar of the selected shape; for a prism or pyramid, only the selected base type's fields. */
export function shapePanel(kind: ShapeKind, choices: ParameterChoices, context: PanelContext = {}): ShapePanel {
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
        help: referenceHelp('a', 'a — довжина; ширину b і висоту c задано відносно неї.'),
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
        help: referenceHelp('a', sideAMeaning),
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
          tiltSection(
            'parallelepiped',
            'parallelepiped-tilt',
            {
              title: 'Нахил',
              offsetFields: offsetFields(['parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio']),
              offsetHelp: shiftHelp,
              angleHelp: edgeAngleHelp,
              resetLabel: 'Прибрати нахил',
              status: { centred: 'прямий', moved: 'похилий' },
            },
            context,
          ),
        ],
      };
    case 'prism':
      return {
        type: 'parameters',
        help: referenceHelp('a', sideAMeaning),
        sections: [
          baseSection('prism', prismBaseKeys, choices.prismBaseType),
          // "Висота призми h" next to the trapezoid's own height t.
          section('prism-height', 'Висота', [
            ratioField('prismHeightRatio', choices.prismBaseType === 'trapezoid' ? 'Висота призми h' : 'Висота h'),
          ]),
          tiltSection(
            'prism',
            'prism-tilt',
            {
              title: 'Нахил',
              offsetFields: offsetFields(['prismOffsetXRatio', 'prismOffsetYRatio']),
              offsetHelp: shiftHelp,
              angleHelp: edgeAngleHelp,
              resetLabel: 'Прибрати нахил',
              status: { centred: 'пряма', moved: 'похила' },
            },
            context,
          ),
        ],
      };
    case 'pyramid':
      return {
        type: 'parameters',
        help: referenceHelp('a', sideAMeaning),
        sections: [
          baseSection('pyramid', pyramidBaseKeys, choices.pyramidBaseType),
          section('pyramid-height', 'Висота', [ratioField('pyramidHeightRatio', 'Висота піраміди h')]),
          tiltSection(
            'pyramid',
            'pyramid-apex',
            {
              title: 'Вершина',
              offsetFields: offsetFields(['pyramidApexXRatio', 'pyramidApexYRatio']),
              offsetHelp: apexHelp,
              angleHelp: apexAngleHelp,
              resetLabel: 'Над центром основи',
              status: { centred: 'над центром', moved: 'зміщена' },
            },
            context,
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
        help: referenceHelp('r', 'r — радіус основи.'),
        sections: [
          section(`${kind}-height`, 'Висота', [ratioField(heightKey, 'Висота h', 'r')]),
          tiltSection(
            kind,
            `${kind}-tilt`,
            {
              title: 'Нахил',
              offsetFields: [{ type: 'number', key: offsetKey, label: offsetLabel, suffix: '× r', range: ratioRange }],
              offsetHelp: roundShiftHelp(kind === 'cylinder' ? 'Центр верхньої основи' : 'Вершина'),
              angleHelp: roundAngleHelps[kind],
              resetLabel: 'Прибрати нахил',
              status: { centred: 'прямий', moved: 'похилий' },
            },
            context,
          ),
          ...(kind === 'cylinder' ? [planeSection(kind, choices)] : []),
        ],
      };
    }
  }
}

/** The numeric fields of a section in display order, including those inside groups. */
export function sectionNumberFields(target: ParameterSection): NumericField[] {
  return target.fields.flatMap((field): readonly NumericField[] =>
    field.type === 'number' ? [field] : field.type === 'choice' || field.type === 'toggle' ? [] : field.fields,
  );
}
