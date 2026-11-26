import {
  axialApexAngles,
  DOVETAIL_PROPORTIONS,
  type LinkedPart,
  obliquePlaneContainsAxis,
  ROUND_CONNECTOR_PROPORTIONS,
  ROUND_CONNECTOR_STEPS_MM,
  ROUND_PAIR_TYPES,
  type TrapezoidKind,
  TWIST_STEPS_MM,
  trapezoidKind,
} from '@diploma-3d/engine';
import {
  BASE_ANGLE_LIMITS,
  BASE_SHIFT_LIMITS,
  type BoxFace,
  type BoxSegment,
  type BoxVertex,
  CONNECTOR_PROFILES,
  type ConnectorProfile,
  DIAMETRAL_CLEARANCE_LIMITS,
  DOVETAIL_CLEARANCE_LIMITS,
  type DovetailEntrance,
  defaultModelSpecs,
  MAGNET_LIMITS,
  MAX_LONGEST_DIMENSION_MM,
  MIN_LONGEST_DIMENSION_MM,
  OBLIQUE_DIRECTION_LIMITS,
  OBLIQUE_INCLINATION_LIMITS,
  PRISM_BASE_SIDES,
  PRISM_BASE_TYPES,
  type PrismBaseSides,
  type PrismTopology,
  PYRAMID_APEX,
  PYRAMID_BASE_TYPES,
  type PyramidBaseType,
  RATIO_LIMITS,
  ROUND_HEIGHT_LIMITS,
  SECTION_PLATE_MARGIN_LIMITS,
  SECTION_PLATE_THICKNESS_LIMITS,
  SECTION_POSITION_LIMITS,
  SECTIONS_BY_SHAPE,
  type SectionType,
  type ShapeKind,
  TWIST_AXIAL_CLEARANCE_LIMITS,
  TWIST_CLEARANCE_LIMITS,
} from '@diploma-3d/schema';
import { formatDecimal, type StepRange } from './decimal.ts';
import { angleTitle, referenceFaceOf, referenceFaces } from './model/angleConstruction.ts';
import {
  type BoxChoices,
  type BoxContext,
  type BoxKeysOf,
  type BoxSolid,
  boxContextFrom,
  faceName,
  isBoxSolid,
  normalSelection,
  oppositeEdgePairs,
  type PairKey,
  pairOf,
  pairSelection,
  type SegmentKey,
  segmentKey,
  segmentName,
  segmentOf,
  type TraceSelection,
  traceSelection,
  vertexName,
} from './model/box.ts';
import {
  type ConnectorScale,
  connectorScaleOf,
  connectorUnits,
  percentRange,
  physicalRange,
  planeAngleRange,
  type ScaledConnectorKey,
} from './model/connectorScale.ts';
import { diagonalFamilies, familyLabel, familyOf } from './model/diagonalConstruction.ts';
import {
  distanceLabels,
  faceOrientations,
  facePairOf,
  facePilotActive,
  farSideOf,
  type Placement,
  placementKeys,
  positionTitle,
} from './model/faceConstruction.ts';
import { entryGroup, entryKindName, entryName, normalEntries } from './model/normalConstruction.ts';
import {
  activeSection,
  boxCutHorizontal,
  type ChoiceKey,
  type ConnectorChoice,
  type ConnectorStatus,
  canSwitchTiltMode,
  coneApexKeys,
  heightFootPercent,
  LINKED_KEYS,
  type LinkedDiagram,
  linkedAlternativeOffered,
  linkedAxialOffered,
  linkedDiagram,
  linkedFieldRange,
  linkedThinPart,
  type ParameterChoices,
  type ParameterKey,
  type ParameterValues,
  PLATE_CLIPPED_NOTE,
  PLATE_MARGIN_INCREMENT_MM,
  PLATE_THICKNESS_INCREMENT_MM,
  PLATE_UNAVAILABLE_ELSEWHERE_MESSAGE,
  PLATE_UNAVAILABLE_MESSAGE,
  type PlanarSectionKeys,
  plateChosen,
  type SectionChoice,
  type SectionRanges,
  secondCutChosen,
  sectionKeys,
  type ToggleKey,
  TWIST_UNSUPPORTED_MESSAGE,
  twistAvailable,
} from './model/parameters.ts';
import {
  type ConstructionField,
  type PilotDraft,
  type PointMode,
  pointTitle,
  ratioLabels,
  segmentOptionLabel,
  segmentTitle,
  throughPointSelection,
} from './model/throughPoint.ts';
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
import { type TraceTarget, traceTargetOf } from './model/traceConstruction.ts';

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
  /**
   * The allowed values, shared by the entry, the slider and the buttons, and the increment of their steps; undefined
   * while no value is allowed, or while a connector's other settings are not valid numbers yet.
   */
  readonly range: StepRange | undefined;
  /**
   * For a setting stored as a multiplier or percentage but shown in millimetres: the millimetres per stored unit. The
   * entry, slider and range are then in millimetres, and what is typed is converted back.
   */
  readonly unit?: number;
  /** The field changes nothing now: every control is off, and the value stays for when it does again. */
  readonly disabled?: boolean;
  /** The id of a note that explains why it is disabled. */
  readonly describedBy?: string;
  /** A setting of a round connector: editing it by hand ends what the section's capacity decided for it. */
  readonly editsRoundConnector?: boolean;
  /** The field of a section's first (0) or second (1) plane, marked with that plane's colour in the preview. */
  readonly sectionTone?: 0 | 1;
};

/** A parameter picked from fixed options, such as the base type or the regular polygon. */
export type ChoiceField = {
  readonly type: 'choice';
  readonly key: ChoiceKey;
  readonly label: string;
  readonly options: readonly {
    readonly value: ParameterChoices[ChoiceKey];
    readonly label: string;
    /** Listed, but not to be chosen now; a note among the fields says why. */
    readonly disabled?: boolean;
  }[];
};

/** A switch, such as whether the preview moves the parts of a section apart. */
export type ToggleField = {
  readonly type: 'toggle';
  readonly key: ToggleKey;
  readonly label: string;
  /** Not to be switched now; the note named by `describedBy` says why. */
  readonly disabled?: boolean;
  readonly describedBy?: string;
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

/** A short explanation among the fields, such as what a single round connector allows. */
export type NoteField = {
  readonly type: 'note';
  readonly key: string;
  readonly text: string;
  /** `status`: announced as it changes, such as an automatic correction; `alert`: also shown as an error. */
  readonly tone?: 'status' | 'alert';
};

/** A button among the fields, whose effect belongs to the page. */
export type ActionField = {
  readonly type: 'action';
  readonly key: string;
  readonly label: string;
  readonly action: PanelAction;
  /** Nothing to do now, such as a reset of values that are already the defaults. */
  readonly disabled?: boolean;
};

export type PanelAction =
  | 'download-pins'
  | 'linked-alternative'
  | 'linked-axial'
  | 'download-trial'
  | 'choose-no-connector'
  | 'reset-magnet-allowances'
  | 'add-second-cut'
  | 'remove-second-cut'
  | 'axial-section'
  | 'trace-through'
  | 'normal-manual'
  | 'height-foot';

/**
 * Further fields within a group, collapsed at first, such as the magnets' fit allowances. Opening or closing it changes no value
 * and no geometry; its fields count as the group's own for errors and focus.
 */
export type DisclosureGroup = {
  readonly type: 'disclosure';
  readonly key: string;
  readonly label: string;
  readonly fields: readonly (NumericField | ChoiceField | NoteField | ActionField)[];
};

/**
 * The lower base of a cylinder's section through a shared generatrix, drawn beside its controls: the base circle, the points
 * A, B and C where the generatrices meet it, the chords AB and AC of the first and the second plane and, with the third plane,
 * BC. Display only; undefined while the construction is not valid, which the diagram answers with the last valid one.
 */
export type LinkedDiagramField = {
  readonly type: 'linked-diagram';
  readonly key: string;
  readonly diagram: LinkedDiagram | undefined;
  /** Which elements each control changes, by the control's key, for highlighting while it is active. */
  readonly affects: Readonly<Record<string, readonly LinkedElement[]>>;
};

/** An element of the construction that a control changes, in the diagram and in the 3D preview alike. */
export type LinkedElement = 'A' | 'B' | 'C' | 'AB' | 'AC' | 'BC' | 'alternative';

/**
 * The name of a section's first or second plane above its fields, with the colour its cut faces have in the preview; shown where
 * two parallel planes are and the fields do not name their plane themselves.
 */
export type SectionMarkField = {
  readonly type: 'section-mark';
  readonly key: string;
  readonly label: string;
  readonly tone: 0 | 1;
};

/**
 * The pilot's plane through a segment and a point M of a cube or a parallelepiped: its two fields, "Відрізок" and "Точка M", each
 * opening its choices on the model or by name; see `throughPoint.ts`. The ratio's two numbers are fields of their own.
 */
export type ThroughPointField = {
  readonly type: 'through-point';
  readonly key: string;
  /** Through a point M or at an angle: the segment is the same, and its field with it. */
  readonly method: 'point' | 'angle';
  readonly methods: readonly { readonly value: 'point' | 'angle'; readonly label: string }[];
  /** The angle's field, in the way at an angle. */
  readonly angle: AngleField | undefined;
  /** The field open now, whose elements the model's picking chooses. */
  readonly open: ConstructionField | undefined;
  readonly segment: {
    /** Whether the segment is a pyramid's edge of its base, the only segments its plane through one is built on. */
    readonly baseEdge: boolean;
    readonly title: string | undefined;
    readonly selected: SegmentKey | '';
    readonly options: readonly { readonly value: SegmentKey; readonly label: string }[];
    /** The first vertex picked on the model, waiting for a second one. */
    readonly pending: string | undefined;
  };
  readonly point: {
    readonly title: string | undefined;
    readonly selected: SegmentKey | '';
    readonly options: readonly { readonly value: SegmentKey; readonly label: string }[];
    readonly mode: PointMode;
    /** The parts of the edge on either side of M, as the ratio's labels read: "DM", "MD₁". */
    readonly labels: readonly [string, string] | undefined;
    readonly fields: readonly [NumericField, NumericField];
    /** What is wrong with the ratio as typed, said beside it, and which of its two numbers that is about. */
    readonly ratioError: string | undefined;
    readonly ratioInvalid: readonly [boolean, boolean];
  };
  /** Beneath the fields: the next choice to make, or why the construction gives no section. */
  readonly status: { readonly tone: 'hint' | 'warning'; readonly text: string } | undefined;
  /** Why a tap on the model chose nothing. */
  readonly notice: string | undefined;
};

/**
 * The angle of a plane through a segment to a face that holds it: the smaller dihedral angle, named with its face, "Кут до ABCD";
 * for an edge, either of its two faces, for a face's diagonal its own.
 */
export type AngleField = {
  /** "Кут до ABCD". */
  readonly title: string;
  /** "30°", or the text as typed. */
  readonly value: string;
  readonly face: BoxFace;
  /** The faces the angle may be measured from, by name; one for a face's diagonal. */
  readonly faces: readonly { readonly value: BoxFace; readonly label: string }[];
  readonly field: NumericField;
  /** Why the angle as typed gives nothing, said at its field. */
  readonly error: string | undefined;
  /**
   * Whether the other plane at this angle is usable, as the whole request checks it, which "Інше положення перерізу" then gives:
   * from a valid plane, or as the way back from one that is not.
   */
  readonly alternative: boolean;
  /** Whether a switch to it waits for its model, during which another click does nothing. */
  readonly switching: boolean;
};

/** A position of a plane parallel to a face: at the midpoint, or at a ratio of its distances to the face and the opposite one. */
export type FacePositionField = {
  readonly which: Placement;
  /** The construction's field that opens it. */
  readonly field: ConstructionField;
  readonly label: string;
  /** The plane's colour, where there are two. */
  readonly tone: 0 | 1 | undefined;
  /** "Посередині", or the ratio as typed. */
  readonly title: string;
  readonly mode: PointMode;
  /** The two distances: "Від ABCD" and "До A₁B₁C₁D₁". */
  readonly labels: readonly [string, string];
  readonly keys: readonly [ParameterKey, ParameterKey];
  /** Why the position gives no section, said beside it, and which of its two numbers that is about. */
  readonly error: string | undefined;
  readonly invalid: readonly [boolean, boolean];
};

/**
 * A plane parallel to a face of a cube or a parallelepiped: its face, picked on the model or by its pair of opposite faces, and
 * its position, with a second plane's where there is one; see `faceConstruction.ts`.
 */
export type FaceConstructionField = {
  readonly type: 'face-construction';
  readonly key: string;
  readonly open: ConstructionField | undefined;
  readonly face: {
    /** The face in effect, as a textbook writes it: "ABCD", and the opposite one. */
    readonly title: string;
    readonly opposite: string;
    /** Whether the far side is a lateral edge, as for a lateral face of a prism with no parallel one, triangular or pentagonal. */
    readonly oppositeEdge: boolean;
    /** Whether the far side is a vertex, a pyramid's opposite the face. */
    readonly oppositeVertex: boolean;
    /** Its pair, by the pair's first face, which the list shows. */
    readonly selected: BoxFace;
    readonly options: readonly { readonly value: BoxFace; readonly label: string }[];
  };
  readonly positions: readonly FacePositionField[];
};

/**
 * The base diagonal of a longitudinal plane, chosen on the model or by name: an n-gonal base's n(n − 3)/2 families, AC and BD of a
 * quadrilateral, each with the upper base's diagonal over it; see `diagonalConstruction.ts`.
 */
export type DiagonalField = {
  readonly type: 'diagonal-construction';
  readonly key: string;
  readonly open: boolean;
  /** "AC". */
  readonly title: string;
  readonly selected: SegmentKey;
  readonly options: readonly { readonly value: SegmentKey; readonly label: string }[];
  /** A first vertex picked on the model, waiting for the opposite one. */
  readonly pending: string | undefined;
  /** Why a tap chose nothing. */
  readonly notice: string | undefined;
  /** Whether it is a pyramid's, whose plane holds the apex and which has no upper base. */
  readonly pyramid: boolean;
};

/**
 * The segment an inclined plane of a cube or a parallelepiped is perpendicular to, chosen on the model or by name: any edge, face's
 * diagonal or the solid's diagonal, which gives the plane's direction only; see `normalConstruction.ts`.
 */
export type NormalField = {
  readonly type: 'normal-construction';
  readonly key: string;
  readonly open: boolean;
  /** "AC₁", "бічні ребра", or "не вибрано" while the plane is given by its angles. */
  readonly title: string;
  /** What the segment is, said in the open field: "AC₁ — діагональ тіла". */
  readonly chosen: string | undefined;
  readonly selected: SegmentKey | '';
  readonly options: readonly { readonly value: SegmentKey; readonly label: string; readonly group: string }[];
  /** A first vertex picked on the model, waiting for a second one. */
  readonly pending: string | undefined;
};

/**
 * The base element a triangular prism's longitudinal plane runs along: the vertex of a median, an altitude or a bisector, or the
 * side a midline is parallel to, chosen on the model or by name; see `traceConstruction.ts`.
 */
export type TraceField = {
  readonly type: 'trace-construction';
  readonly key: string;
  readonly open: boolean;
  readonly label: string;
  readonly target: TraceTarget;
  /** "A", "AB", or a pyramid's lateral edge "SA". */
  readonly title: string;
  readonly selected: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** How to choose it on the model. */
  readonly hint: string;
  /** M of a pyramid's plane through a lateral edge and a point of the base edge opposite, where that is the construction. */
  readonly point: TracePointField | undefined;
  /** Why the construction gives no section, beneath its fields: M at a vertex, or a part too thin. */
  readonly status: { readonly tone: 'hint' | 'warning'; readonly text: string } | undefined;
};

/** M on a base edge BC, at the midpoint or at BM : MC = a : b, as a pyramid's plane through a lateral edge and M takes it. */
export type TracePointField = {
  readonly open: boolean;
  /** "Середина BC", or "BM : MC = 1 : 2". */
  readonly title: string;
  readonly selected: SegmentKey | '';
  readonly options: readonly { readonly value: SegmentKey; readonly label: string }[];
  readonly mode: PointMode;
  /** "BM" and "MC". */
  readonly labels: readonly [string, string];
  readonly keys: readonly [ParameterKey, ParameterKey];
  /** Why M as typed gives no section, said beside it, and which of its two numbers that is about. */
  readonly error: string | undefined;
  readonly invalid: readonly [boolean, boolean];
};

/**
 * The pair of opposite edges of a triangular pyramid an inclined plane is parallel to, picked on the model by either edge or by
 * name: SA and BC, SB and CA, SC and AB; see `PilotChoice` 'pair'.
 */
export type PairField = {
  readonly type: 'pair-construction';
  readonly key: string;
  readonly open: boolean;
  /** "SA і BC", or "не вибрано". */
  readonly title: string;
  readonly selected: PairKey | '';
  readonly options: readonly { readonly value: PairKey; readonly label: string }[];
};

export type ParameterField =
  | PairField
  | TraceField
  | NormalField
  | DiagonalField
  | FaceConstructionField
  | ThroughPointField
  | SectionMarkField
  | LinkedDiagramField
  | NumericField
  | ChoiceField
  | ToggleField
  | NoteField
  | ActionField
  | TiltGroup
  | TrapezoidGroup
  | DisclosureGroup;

/** A collapsible group of the sidebar, such as "Основа" or "Нахил". */
export type ParameterSection = {
  /** Unique across all shapes, so that each group keeps its own open state. Every group starts collapsed. */
  readonly key: string;
  readonly title: string;
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
  | {
      readonly type: 'parameters';
      /** The reference length's explanation; a solid with fixed proportions has a line of its own instead. */
      readonly help?: Help;
      readonly note?: string;
      readonly sections: readonly ParameterSection[];
    };

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

type FixedShapeKind = 'cube' | 'tetrahedron' | 'octahedron' | 'icosahedron' | 'dodecahedron';

const fixedNotes: Readonly<Record<FixedShapeKind, string>> = {
  cube: 'Усі ребра рівні, грані — квадрати. Пропорції фіксовані.',
  tetrahedron: 'Усі ребра рівні, грані — рівносторонні трикутники. Пропорції фіксовані.',
  octahedron: '8 граней — рівносторонні трикутники; модель лежить на грані. Пропорції фіксовані.',
  icosahedron: '20 граней — рівносторонні трикутники; модель лежить на грані. Пропорції фіксовані.',
  dodecahedron: '12 граней — правильні п’ятикутники; модель лежить на грані. Пропорції фіксовані.',
};

const BALL_NOTE = 'Суцільна куля. Пропорції фіксовані.';

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

/** "Що означає × AB?": what the reference length is and how the print size rescales everything. */
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
    'Верхня основа зсувається відносно нижньої: X — уздовж AB, Y — перпендикулярно до AB. Обидва нулі дають пряме тіло. ' +
    'Висота — перпендикулярна відстань між площинами основ — не змінюється; бічне ребро AA₁ стає похилим і довшим за неї.',
};

const apexHelp: Help = {
  label: 'Як задано вершину?',
  text:
    'Зміщення вершини S відлічується від центра мас основи: X — уздовж AB, Y — перпендикулярно до AB. Висота лишається ' +
    'перпендикуляром з S до площини основи; S може лежати й поза основою.',
};

const roundShiftHelp = (moving: string): Help => ({
  label: 'Як працює зміщення?',
  text: `${moving} зсувається вздовж осі X на задану частку r. Висота h лишається перпендикуляром до основи.`,
});

const directionText =
  'Напрям зміщення відлічується від осі X проти годинникової стрілки, якщо дивитися згори: 0° — уздовж X ' +
  '(уздовж AB), 90° — уздовж Y. Від повороту камери він не залежить.';

const edgeAngleHelp: Help = {
  label: 'Як задано кути?',
  text:
    'Кут між AA₁ і основою — кут між бічним ребром AA₁, напрямленим від нижньої основи до верхньої, і площиною основи; ' +
    `інші бічні ребра йому паралельні. 90° дає пряме тіло. ${directionText} Висота не змінюється.`,
};

const apexAngleHelp: Help = {
  label: 'Як задано кути?',
  text:
    'Кут до площини основи — кут між цією площиною і відрізком від центра мас основи до вершини S; 90° ставить S ' +
    `над центром. ${directionText} Висота не змінюється.`,
};

/** The lateral edges of a prism or parallelepiped, which its height equals only while the solid is right. */
const prismHeightHelp = (solid: string): Help => ({
  label: 'Що таке висота?',
  text:
    `Перпендикулярна відстань між площинами основ ${solid}. У прямого тіла вона дорівнює бічному ребру AA₁, і поле ` +
    'називається «Висота AA₁». У похилого AA₁ довше за висоту, тому поле називається просто «Висота»; зміщення висоти ' +
    'не змінює.',
});

const pyramidHeightHelp: Help = {
  label: 'Що таке висота?',
  text:
    'Перпендикулярна відстань від вершини S до площини основи. Бічне ребро, наприклад SA, — інший відрізок: воно не ' +
    'коротше за висоту й дорівнює їй, лише коли S лежить точно над A.',
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
  text: 'Сторонами AB і AC та кутом BAC між ними; третя сторона BC обчислюється автоматично.',
};

const parallelogramHelp: Help = {
  label: 'Як задано паралелограм?',
  text: 'Сторонами AB і AD та кутом BAD між ними; протилежні сторони рівні й паралельні: CD = AB, BC = AD.',
};

const trapezoidHelp: Help = {
  label: 'Як задано трапецію?',
  text:
    'AB і CD — паралельні сторони; відстань між ними — висота трапеції. Зміщення сторони CD зсуває її середину уздовж AB ' +
    'відносно середини AB. Якщо CD = AB, основа — паралелограм, а без зміщення — прямокутник.',
};

const trapezoidKindNames: Readonly<Record<TrapezoidKind, string>> = {
  general: 'трапеція',
  isosceles: 'рівнобічна трапеція',
  right: 'прямокутна трапеція',
  parallelogram: 'паралелограм (CD = AB)',
  rectangle: 'прямокутник (CD = AB)',
};

/** The special case of the trapezoid base, such as "рівнобічна трапеція"; undefined while CD or its shift is not valid. */
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

/** A length relative to the reference: AB, the first side of a base, or the radius r of a round solid. */
const ratioField = (key: ParameterKey, label: string, reference = 'AB'): NumericField => ({
  type: 'number',
  key,
  label,
  suffix: `× ${reference}`,
  // h/r spans the ratios' limits applied to the diameter.
  range: reference === 'r' ? roundHeightRange : ratioRange,
});

/**
 * The second side and the angle of a base built from AB along X, another side from A and the angle between them at A: AC and
 * ∠BAC of a triangle, AD and ∠BAD of a parallelogram, as the engine places A, B, C, D.
 */
const twoSidesAndAngle = (
  [side, angle]: readonly [ParameterKey, ParameterKey],
  [sideName, angleName]: readonly [string, string],
): NumericField[] => [
  ratioField(side, `Сторона ${sideName}`),
  { type: 'number', key: angle, label: `Кут ${angleName}`, suffix: '°', range: angleRange },
];

const TRIANGLE_NAMES = ['AC', 'BAC'] as const;
const PARALLELOGRAM_NAMES = ['AD', 'BAD'] as const;

const section = (
  key: string,
  title: string,
  fields: readonly ParameterField[],
  options: { help?: Help | undefined; status?: ParameterSection['status'] } = {},
): ParameterSection => ({
  key,
  title,
  fields,
  help: options.help,
  status: options.status,
});

/** What the sidebar shows besides the choices: the tilt input modes, and the valid values that bound the inclination. */
export type PanelContext = {
  readonly tiltModes?: TiltModes | undefined;
  readonly values?: ParameterValues | undefined;
  /** The scale that turns connector settings into millimetres; the connector group needs it. */
  readonly connectorScale?: ConnectorScale | undefined;
  /** What became of a round connector's stored dimensions. */
  readonly connectorStatus?: ConnectorStatus | undefined;
  /** The feasible millimetres of the connector's fields, see `SectionRanges`. */
  readonly sectionRanges?: SectionRanges | undefined;
  /** Whether the solid's lower base cuts the chosen section plate off. */
  readonly plateClipped?: boolean | undefined;
  /** Whether the magnets' fit allowances differ from their defaults, which their reset then restores. */
  readonly magnetAllowancesChanged?: boolean | undefined;
  /** A connector replaced by the page, such as on turning a section plate on, said once among the connector's fields. */
  readonly connectorNotice?: string | undefined;
  /** The pilot's construction as the page has it: the field open, a first vertex picked, why a tap chose nothing. */
  readonly construction?:
    | {
        readonly field: ConstructionField | undefined;
        readonly pending: BoxVertex | undefined;
        readonly notice: string | undefined;
        /** Whether the switch to the other plane at the angle waits for its model. */
        readonly switching?: boolean | undefined;
      }
    | undefined;
  /** The pilot's construction as drafted, from the request; see `PilotDraft`. */
  readonly pilotDraft?: PilotDraft | undefined;
};

type TiltConfig = {
  readonly title: string;
  /** The inclination's label, such as "Кут між AA₁ і основою"; "Кут до площини основи" by default. */
  readonly inclinationLabel?: string;
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
    label: config.inclinationLabel ?? 'Кут до площини основи',
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
    help: mode === 'offset' ? config.offsetHelp : config.angleHelp,
  });
}

/** The offsets X and Y; their ranges follow from the current values, see `tiltSection`. */
const offsetFields = ([x, y]: readonly [ParameterKey, ParameterKey]): TiltGroup['fields'] => [
  { type: 'number', key: x, label: 'Зміщення X', suffix: '× AB', range: ratioRange },
  { type: 'number', key: y, label: 'Зміщення Y', suffix: '× AB', range: ratioRange },
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
    triangle: twoSidesAndAngle(keys.triangle, TRIANGLE_NAMES),
    parallelogram: keys.parallelogram === undefined ? [] : twoSidesAndAngle(keys.parallelogram, PARALLELOGRAM_NAMES),
    trapezoid: [
      {
        type: 'trapezoid',
        key: keys.trapezoid.key,
        fields: [
          ratioField(side, 'Сторона CD'),
          // The trapezoid's height: its feet on AB and CD are not named points.
          ratioField(height, 'Відстань між AB і CD'),
          { type: 'number', key: shift, label: 'Зміщення сторони CD', suffix: '× AB', range: shiftRange },
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

const sideAMeaning = 'AB — сторона основи.';

// A cut's position and its distance from the axis move in steps of 5 percentage points; a typed value between them is kept.
const SECTION_PERCENT_INCREMENT = 5;
const sectionPositionRange: StepRange = { ...SECTION_POSITION_LIMITS, increment: SECTION_PERCENT_INCREMENT };
const ANGLE_INCREMENT_DEG = 5;
const obliqueInclinationRange: StepRange = { ...OBLIQUE_INCLINATION_LIMITS, increment: ANGLE_INCREMENT_DEG };
const obliqueDirectionRange: StepRange = { ...OBLIQUE_DIRECTION_LIMITS, increment: ANGLE_INCREMENT_DEG };

const sectionNames: Readonly<Record<SectionChoice, string>> = {
  none: 'Без перерізу',
  'parallel-to-bases': 'Паралельно основам',
  vertical: 'Вертикальний',
  oblique: 'Похилий',
  horizontal: 'Горизонтальний',
  'axis-parallel': 'Паралельно осі',
  'shared-generatrix': 'Через спільну твірну',
  'oblique-apex': 'Через вершину',
  'face-parallel': 'Паралельно грані',
  longitudinal: 'Поздовжній',
  'through-apex': 'Через вершину піраміди',
  'through-line': 'Через ребро або діагональ',
  inclined: 'Похилий',
};

const parallelSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина паралельна основам і проходить на заданій відстані від нижньої основи — у відсотках висоти h. Переріз — ' +
    'круг радіуса r; у похилого циліндра його центр зміщено разом із віссю, а площина не перпендикулярна до осі. ' +
    'Частини експортуються окремими об’єктами в одному масштабі; розсування змінює лише перегляд. Межі 10–90 % ' +
    'відсувають площину від основ, але не гарантують, що тонку частину вдасться надрукувати.',
};

const verticalSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина вертикальна й паралельна осі циліндра. 0% — осьовий переріз. Значення 50% зміщує площину на половину ' +
    'радіуса основи. Знак визначає бік зміщення.\n\n' +
    'У прямого циліндра переріз — прямокутник, у похилого в цьому режимі — паралелограм. Зміщення від осі зсуває ' +
    'площину вбік: ширина перерізу змінюється, а висота лишається тією самою.\n\n' +
    'Частини 1 і 2 лежать по різні боки площини й експортуються окремими об’єктами в одному масштабі; розсування ' +
    'змінює лише перегляд. У файлі вони стоять на залишках своїх основ. Межі зміщення відсувають площину від бічної ' +
    'поверхні, але не гарантують, що тонку частину вдасться надрукувати.',
};

const axisParallelSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина паралельна осі циліндра — відрізку між центрами основ — навіть у похилого циліндра, тож вона не обов’язково ' +
    'вертикальна. Її слід на нижній основі — пряма, зміщена від центра основи на задану частку радіуса r у напрямку ' +
    '«Напрям зміщення» (0° — уздовж осі X, 90° — уздовж осі Y); уздовж осі ця пряма й витягується в площину.\n\n' +
    '0% — осьовий переріз: площина проходить через центри обох основ. Кнопка «Осьовий переріз» ставить зміщення 0%, ' +
    'напрям лишається. Переріз прямого циліндра — прямокутник, похилого — паралелограм; зі зміщенням змінюється його ' +
    'ширина, а не нахил.\n\n' +
    'Частини 1 і 2 лежать по різні боки площини й експортуються окремими об’єктами в одному масштабі. Межі зміщення ' +
    'залежать від напрямку й відсувають площину від бічної поверхні, але не гарантують, що тонку частину вдасться ' +
    'надрукувати.',
};

const linkedSectionHelp: Help = {
  label: 'Як задано перерізи?',
  text:
    'Два перерізи проходять через одну спільну твірну AA₁ — відрізок бічної поверхні, паралельний осі. Кожна площина ' +
    'містить цю твірну, тож вона паралельна осі навіть у похилого циліндра. Площини вдруге перетинають бічну поверхню по ' +
    'твірних BB₁ (перший переріз) і CC₁ (другий переріз).\n\n' +
    '«Кут між площинами» — менший двогранний кут між ними, від 0° до 90°. Він змінює лише другий переріз: перший і ' +
    'твірна AA₁ лишаються на місці.\n\n' +
    '«Повернути обидва перерізи» повертає обидві площини навколо AA₁ на той самий кут, тож кут між ними не змінюється. ' +
    'Відлік — від осьової площини: 0° означає, що перший переріз проходить через вісь; «Перший переріз — осьовий» ставить ' +
    '0°, якщо така побудова можлива.\n\n' +
    'За того самого першого перерізу й кута є дві різні площини другого перерізу — з одного й з іншого боку від першого. ' +
    '«Інше положення другої площини» вибирає іншу; програма сама цього ніколи не робить. За 90° обидві збігаються.\n\n' +
    '«Додати третій переріз» проводить площину через BB₁ і CC₁: середня частина тоді — трикутна призма ABCA₁B₁C₁. Без ' +
    'неї частин три, з нею — чотири; усі експортуються окремими об’єктами в одному масштабі.\n\n' +
    'Недоступні лише положення, де площина дотикається до циліндра або площини майже збігаються: там частина вироджується. ' +
    'Циліндр у файлі — многогранник, вписаний у коло, тож поблизу дотику площина майже не відрізає його; це дає вузький ' +
    'проміжок, який повзунок і кнопки оминають. Тонкі частини дозволено, але програма попереджає, що їх може не вдатися ' +
    'надрукувати.\n\n' +
    'На схемі нижньої основи кольори відповідають перегляду: перший переріз, другий і третій. Кут BAC на схемі в похилого ' +
    'циліндра загалом не дорівнює куту між площинами, тому на схемі його не підписано.',
};

const obliqueSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина проходить через вибрану точку на осі циліндра: її положення задано у відсотках висоти h від нижньої основи. ' +
    'Кут вимірюється відносно площини основи. Напрям показує, куди площина піднімається: 0° — уздовж осі X, 90° — уздовж ' +
    'осі Y. Поворот камери його не змінює, а компас у перегляді показує осі й стрілку підйому.\n\n' +
    'Поки площина не торкається основ, переріз прямого циліндра — еліпс. Якщо площина перетинає основу, частина межі ' +
    'перерізу стає відрізком, і це вже не повний еліпс. Кріплення розміщуються за фактичною формою перерізу.\n\n' +
    'Частини 1 і 2 лежать по різні боки площини й експортуються окремими об’єктами в одному масштабі; розсування змінює ' +
    'лише перегляд. Межі кута є обмеженнями застосунку: точно горизонтальний і вертикальний перерізи мають окремі режими.',
};

const coneSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина перерізу паралельна основі. Положення задається у відсотках від висоти конуса: 50% — на половині висоти. ' +
    'Нижня частина є зрізаним конусом, верхня — меншим конусом. Ближче до вершини переріз стає меншим.\n\n' +
    'Висота h — відстань від вершини до площини основи, також у похилого конуса; центр перерізу зміщується разом із ' +
    'відрізком від центра основи до вершини. Однакові висоти не означають однакових об’ємів: на половині висоти верхня ' +
    'частина має 1/8 об’єму конуса.\n\n' +
    'Частини експортуються окремими об’єктами в одному масштабі; розсування змінює лише перегляд. Межі 10–90 % відсувають ' +
    'площину від основи й вершини, але не гарантують, що тонку частину вдасться надрукувати.',
};

const CONE_PLATE_HELP =
  'Січна пластина — окрема пласка деталь, що показує переріз. Із фігури вирізається шар завтовшки з пластину, ' +
  'посередині якого лежить площина перерізу; товщина вимірюється перпендикулярно до площини. Частини не зсуваються й не ' +
  'масштабуються, тож складена модель — це та сама фігура, а пластина виступає за її поверхню на заданий виступ. Дві ' +
  'грані пластини перетинають фігуру по різних перерізах, з різними розмірами й центрами. Контур пластини — прямокутник у ' +
  'площині перерізу навколо всього вирізаного шару, із заокругленими кутами.\n\n' +
  'Товщина обмежена так, щоб кожна частина лишалася не тоншою за 1,2 мм. Пластина з кріпленням друкується разом із ' +
  'частинами як третій об’єкт.';

const APEX_PLATE_HELP =
  'Площина проходить через вершину, тож шар пластини забирає вершину з обох частин: їхні грані біля пластини вже не ' +
  'трикутники, а вершина опиняється всередині пластини.';

const BALL_PLATE_HELP =
  'Якщо шар пластини містить центр кулі, куля найширша саме всередині пластини: контур пластини охоплює весь екватор, хоча ' +
  'обидві грані менші за нього.';

const CYLINDER_PLATE_HELP =
  'Якщо шар пластини містить вісь циліндра, циліндр найширший саме всередині пластини, і контур охоплює цю ширину. Похилий ' +
  'переріз може зачіпати основи, тож грані пластини не завжди є повними еліпсами. Поворотне з’єднання з пластиною ' +
  'недоступне.';

const withPlateHelp = (help: Help, throughApex = false, extra?: string): Help => ({
  ...help,
  text: [help.text, CONE_PLATE_HELP, ...(throughApex ? [APEX_PLATE_HELP] : []), ...(extra === undefined ? [] : [extra])].join(
    '\n\n',
  ),
});

const plateThicknessWindow: StepRange = { ...SECTION_PLATE_THICKNESS_LIMITS, increment: PLATE_THICKNESS_INCREMENT_MM };
const plateMarginRange: StepRange = { ...SECTION_PLATE_MARGIN_LIMITS, increment: PLATE_MARGIN_INCREMENT_MM };

const coneVerticalSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина вертикальна й паралельна осі конуса — відрізку від центра основи до вершини. 0% — осьовий переріз. Значення ' +
    '50% зміщує площину на половину радіуса основи. Знак визначає бік зміщення.\n\n' +
    'Осьовий переріз — трикутник; у похилого конуса він не обов’язково рівнобедрений. Зі зміщенням площина перетинає бічну ' +
    'поверхню по кривій і не доходить до вершини: чим більше зміщення, тим нижчий переріз.\n\n' +
    'Частини 1 і 2 лежать по різні боки площини й експортуються окремими об’єктами в одному масштабі; розсування змінює ' +
    'лише перегляд. У файлі вони стоять на залишках основи. Межі зміщення відсувають площину від бічної поверхні, але не ' +
    'гарантують, що тонку частину вдасться надрукувати.',
};

const ballSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Переріз кулі площиною — круг. За зміщення 0% площина проходить через центр і ділить кулю на дві півкулі. Додатне ' +
    'значення піднімає площину, від’ємне — опускає. Що далі площина від центра, то менший круг перерізу.\n\n' +
    'Частини експортуються окремими об’єктами в одному масштабі; розсування змінює лише перегляд. Межі ±80 % відсувають ' +
    'площину від полюсів, але не гарантують, що тонку частину вдасться надрукувати.',
};

const BALL_SECOND_CUT_HELP =
  'Другий переріз паралельний першому, і кожен задано зміщенням від центра всієї кулі, тож куля ділиться на три частини: ' +
  'нижню, середню й верхню. Перерізи можуть лежати по різні боки від центра, з одного боку або один — через центр; ' +
  'середня частина має бути не тоншою за десяту частину діаметра. Кріплення однакове на обох перерізах, а для середньої ' +
  'частини враховано обидва.';

const coneObliqueSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина проходить через вибрану точку на осі конуса — відрізку від центра основи до вершини: її положення задано у ' +
    'відсотках висоти h від основи. Кут вимірюється відносно площини основи. Напрям показує, куди площина піднімається: ' +
    '0° — уздовж осі X, 90° — уздовж осі Y. Поворот камери його не змінює, а компас у перегляді показує осі й стрілку ' +
    'підйому.\n\n' +
    'Поки площина не торкається основи, переріз прямого конуса — еліпс. Якщо площина перетинає основу, частина межі ' +
    'перерізу стає відрізком. Кріплення розміщуються за фактичною формою перерізу.\n\n' +
    'Частини 1 і 2 лежать по різні боки площини й експортуються окремими об’єктами в одному масштабі; розсування змінює ' +
    'лише перегляд. Яка частина містить вершину, а яка основу, залежить від площини. Межі кута є обмеженнями застосунку: ' +
    'горизонтальний, вертикальний і проведений через вершину перерізи мають окремі режими.',
};

const coneApexSectionHelp: Help = {
  label: 'Як задано переріз?',
  text:
    'У режимі «Через вершину» площина проходить точно через вершину конуса та перетинає його основу. Переріз є трикутником. ' +
    'Допустимі кути залежать від форми конуса й напряму нахилу площини.\n\n' +
    'Вершини трикутника — вершина конуса й кінці хорди на основі; він зазвичай не рівнобедрений. Кут вимірюється відносно ' +
    'площини основи, напрям показує, куди площина піднімається: компас у перегляді показує осі й стрілку підйому. Межі кута ' +
    'лишають кожній частині щонайменше десяту частину ширини основи вздовж цього напряму, а площина, що лише торкається ' +
    'конуса, його не ділить.\n\n' +
    'Частини 1 і 2 лежать по різні боки площини, обидві стоять у файлі на залишках основи й експортуються окремими ' +
    'об’єктами в одному масштабі; розсування змінює лише перегляд.',
};

const axisInPlaneNote = (kind: 'cylinder' | 'cone') =>
  `Площина містить усю вісь ${kind === 'cone' ? 'конуса' : 'циліндра'}, тому положення точки за висотою не змінює переріз.`;

const connectorNames: Readonly<Record<ConnectorChoice, string>> = {
  none: 'Без кріплення',
  dovetail: 'Ластівчин хвіст',
  plug: 'Виступ і отвір',
  dowel: 'Знімні штифти',
  twist: 'Поворотне з’єднання',
  magnet: 'Магнітні гнізда',
};

/** How magnet pockets work, with the practical notes their fit depends on. */
const magnetHelp = (plated: boolean): Help => ({
  label: 'Як працюють магнітні гнізда?',
  text:
    'Кожна пара — два глухі гнізда на одній осі, по одному в кожній частині, тож N пар потребують 2N магнітів. Розміри ' +
    'магнітів — справжні міліметри друку: вони не змінюються разом із розміром моделі.\n\n' +
    'Гнізда розміщуються автоматично: подалі від краю перерізу й рівномірно навколо його середини. Усе гніздо разом із 2 мм ' +
    'матеріалу навколо й під дном має вміститися в обидві частини, а не лише його отвір. Невелика фаска на вході ' +
    'полегшує вставлення магніту.' +
    (plated
      ? '\n\nЗ січною пластиною гнізда є лише у двох частинах, а пластина лишається суцільною між ними: магніти тягнуть ' +
        'одне одного крізь неї, тож тонша пластина тримає краще.'
      : '') +
    '\n\nЦе стартові значення для пробного друку. Перевірка геометрії не гарантує сили притягання чи надійності: це ' +
    'залежить від магнітів, відстані між ними, матеріалу, налаштувань слайсера й клею.\n\n' +
    'Спершу надрукуйте маленький пробний зразок гнізда. Перевірте полярність кожної пари, перш ніж закріпити магніти. У ' +
    'гнізда із зазором вклейте магніти відповідним клеєм; магніт має сидіти врівень із гранню або трохи глибше. У ' +
    'слайсері перегляньте стінки й нижні шари навколо гнізд.',
});

const CONNECTOR_PROFILE_NAMES: Readonly<Record<ConnectorProfile, string>> = {
  circle: 'Круг',
  triangle: 'Трикутник',
  square: 'Квадрат',
  hexagon: 'Шестикутник',
  'flatted-circle': 'Круг зі зрізаним боком',
};

// A dovetail's dimensions move in steps of 0,25 mm, clearances in 0,05 mm, a round connector's as the engine's defaults are
// rounded; typed values between the steps are kept.
const DIMENSION_INCREMENT_MM = 0.25;
const dovetailClearanceRange: StepRange = { ...DOVETAIL_CLEARANCE_LIMITS, increment: 0.05 };
const diametralClearanceRange: StepRange = { ...DIAMETRAL_CLEARANCE_LIMITS, increment: 0.05 };

const BOUNDS_HELP =
  'Межі повзунків залежать від моделі, положення перерізу та інших розмірів кріплення: вони зберігають мінімальні ' +
  'товщини стінок і довжини робочих ділянок. Ці межі означають лише, що кріплення можна побудувати; міцність і ' +
  'зручність посадки перевіряє пробний друк.';

const dovetailHelp: Help = {
  label: 'Як працює кріплення?',
  text:
    'На нижній частині є виступ, у верхній — паз. Щоб скласти модель, насуньте верхню частину вздовж перерізу до ' +
    'упора. Для розбирання посуньте її назад. Похилі боки під кутом 45° утримують половинки від роз’єднання ' +
    'перпендикулярно до перерізу, але не блокують зворотне зсування.\n\n' +
    'Висота визначає, наскільки виступ піднімається над перерізом. Довжина вимірюється вздовж напряму насування. ' +
    'Зазор — заданий у моделі проміжок між відповідними поверхнями виступу й паза.\n\n' +
    BOUNDS_HELP,
};

const plugHelp: Help = {
  label: 'Як працює кріплення?',
  text:
    'Виступ друкується разом із нижньою половинкою та входить в отвір верхньої. Частини з’єднують і розбирають ' +
    'рухом перпендикулярно до перерізу.\n\n' +
    'Висота виступу визначає, наскільки він заходить у верхню частину. Отвір має додаткові 0,3 мм глибини, щоб його ' +
    'дно не заважало зімкнути половинки.\n\n' +
    'Збільшення діаметра отвору визначає, наскільки отвір ширший за виступ. Наприклад, для виступу діаметром 5 мм ' +
    'значення 0,2 мм дає отвір діаметром 5,2 мм.\n\n' +
    BOUNDS_HELP,
};

const dowelHelp: Help = {
  label: 'Як працює кріплення?',
  text:
    'Штифти друкуються окремо та вставляються в отвори обох половинок. Їх можна вийняти або замінити.\n\n' +
    'Поле довжини задає повну довжину штифта. Номінально в кожну половинку входить половина цієї довжини. Кожен ' +
    'отвір має додаткові 0,3 мм глибини, тому штифт може трохи зміщуватися вздовж осі.\n\n' +
    'Розміри отворів нижньої та верхньої частин налаштовуються окремо. Наприклад, для штифта діаметром 5 мм ' +
    'збільшення діаметра отвору на 0,2 мм дає отвір діаметром 5,2 мм.\n\n' +
    BOUNDS_HELP,
};

const twistHelp: Help = {
  label: 'Як працює кріплення?',
  text:
    'Вставте частини, поверніть до упору. Для розбирання поверніть назад і роз’єднайте. З’єднання не має окремого фіксатора від ' +
    'зворотного повороту.\n\n' +
    'Якщо дивитися зверху, верхню частину вставляють повернутою на 45° за годинниковою стрілкою від зібраного положення, а потім ' +
    'повертають проти годинникової стрілки до упору. Одне вушко ширше за два інші, тому частини сходяться лише в одному положенні. ' +
    'Виступи гнізда під вушками не дають роз’єднати частини прямо.\n\n' +
    'Нижня частина друкується на основі, кріпленням угору; низ вушок — короткі пласкі нависання. Верхня друкується перерізом на ' +
    'столі: виступи гнізда — перші шари, а склепіння скошене під 45°.\n\n' +
    'Розміри шийки, головки й вушок — пробні, а не перевірена міцність. Спершу надрукуйте пробне з’єднання: воно має те саме ' +
    'кріплення в малих тримачах, і масштабувати його не можна.\n\n' +
    BOUNDS_HELP,
};

const TWIST_SCALE_NOTE =
  'Показано фактичний розмір. Спочатку його визначає місце в обох частинах; заданий вручну зберігається, поки вміщується. ' +
  'Розмір і зазори задано в міліметрах і не змінюються разом із моделлю.';

const VERTICAL_PRINT_NOTE =
  'Вісь кріплення горизонтальна, а частини у файлі стоять вертикально, тому виступи й отвори можуть потребувати ' +
  'підтримок або іншої орієнтації в слайсері.';

/** How a dovetail along a vertical or inclined slide is assembled, for each entrance; neither entrance makes it a latch. */
const VERTICAL_DOVETAIL_MOTION: Readonly<Record<DovetailEntrance, string>> = {
  standard:
    'Паз відкритий угорі та закінчується упором унизу. Щоб скласти модель, опустіть половинку з виступом уздовж паза ' +
    'до упора. Для розбирання утримуйте половинку з пазом і підніміть половинку з виступом. У такому положенні її вага ' +
    'притискає виступ до нижнього упора.',
  opposite:
    'Паз відкритий унизу та закінчується упором угорі. Щоб скласти модель, підніміть половинку з виступом уздовж паза ' +
    'знизу до упора. Для розбирання утримуйте половинку з пазом і опустіть половинку з виступом. У такому положенні її ' +
    'вага тягне виступ із паза, тож модель треба тримати або покласти.',
};

const verticalDovetailHelp = (entrance: DovetailEntrance): Help => ({
  label: 'Як працює кріплення?',
  text:
    `${VERTICAL_DOVETAIL_MOTION[entrance]}\n\n` +
    'Виступ — на частині 1, паз — у частині 2. Похилі боки під кутом 45° утримують половинки від роз’єднання ' +
    'перпендикулярно до перерізу, але це не замок: половинки роз’єднаються, якщо утримувати іншу або перевернути модель.\n\n' +
    'Висота визначає, наскільки виступ виходить за переріз. Довжина вимірюється вертикально, вздовж паза. Зазор — ' +
    'заданий у моделі проміжок між відповідними поверхнями виступу й паза.\n\n' +
    BOUNDS_HELP,
});

/** What every connector through a shared generatrix adds: one at each plane, apart from each other in the middle part. */
const LINKED_CONNECTOR_NOTE =
  'Біля кожної площини стоїть своє кріплення з тими самими налаштуваннями, підігнане до її перерізу. Їхні отвори й пази ' +
  'в середній частині мають лишатися щонайменше на 1,2 мм від інших граней і одне від одного; інакше модель не ' +
  'створюється й пояснюється чому.';

/** The connectors of planes through a shared generatrix: the middle part against each outer part. */
const linkedConnectorHelps = (entrance: DovetailEntrance): Record<Exclude<ConnectorChoice, 'none'>, Help> => ({
  dovetail: {
    label: 'Як працює кріплення?',
    text:
      `${VERTICAL_DOVETAIL_MOTION[entrance]}\n\n` +
      'Виступи — на середній частині, пази — у відрізаних частинах. Похилі боки під кутом 45° утримують частини від ' +
      'роз’єднання перпендикулярно до перерізу, але це не замок.\n\n' +
      `${LINKED_CONNECTOR_NOTE}\n\n${BOUNDS_HELP}`,
  },
  plug: {
    label: 'Як працює кріплення?',
    text:
      'Виступи друкуються разом із середньою частиною та входять в отвори відрізаних частин. Кожну частину з’єднують і ' +
      'розбирають рухом перпендикулярно до її перерізу. Отвір має додаткові 0,3 мм глибини, щоб його дно не заважало ' +
      `зімкнути частини.\n\n${VERTICAL_PRINT_NOTE}\n\n${LINKED_CONNECTOR_NOTE}\n\n${BOUNDS_HELP}`,
  },
  dowel: {
    label: 'Як працює кріплення?',
    text:
      'Штифти друкуються окремо та вставляються в отвори середньої й відрізаної частини. Поле довжини задає повну довжину ' +
      'штифта; номінально в кожну частину входить половина. Збільшення діаметра отворів середньої та відрізаних частин ' +
      `налаштовуються окремо.\n\n${VERTICAL_PRINT_NOTE}\n\n${LINKED_CONNECTOR_NOTE}\n\n${BOUNDS_HELP}`,
  },
  twist: twistHelp,
  magnet: {
    ...magnetHelp(false),
    text: `${magnetHelp(false).text}\n\n${LINKED_CONNECTOR_NOTE}`,
  },
});

const OBLIQUE_PRINT_NOTE =
  'Вісь кріплення перпендикулярна до нахиленої площини, а кожна частина у файлі стоїть на своїй плоскій грані, тому ' +
  'виступи й отвори можуть потребувати підтримок або іншої орієнтації в слайсері.';

const OBLIQUE_DOVETAIL_MOTION: Readonly<Record<DovetailEntrance, string>> = {
  standard:
    'Виступ — на частині 1, паз — у частині 2. Паз відкритий угорі схилу площини й закінчується упором унизу. Щоб скласти ' +
    'модель, насуньте частину 1 уздовж площини вниз по схилу до упора. Для розбирання утримуйте частину 2 й посуньте ' +
    'частину 1 вгору по схилу.\n\n' +
    'Рух іде вздовж нахиленої площини, а не обов’язково вертикально. Коли модель стоїть прямо, вага частини 1 має складову ' +
    'вниз по схилу, але це не замок і не гарантія посадки без тертя.',
  opposite:
    'Виступ — на частині 1, паз — у частині 2. Паз відкритий унизу схилу площини й закінчується упором угорі. Щоб скласти ' +
    'модель, насуньте частину 1 уздовж площини вгору по схилу до упора. Для розбирання утримуйте частину 2 й посуньте ' +
    'частину 1 вниз по схилу.\n\n' +
    'Рух іде вздовж нахиленої площини, а не обов’язково вертикально. Коли модель стоїть прямо, вага частини 1 тягне її вниз ' +
    'по схилу, до входу, тож модель треба тримати або покласти; це не замок.',
};

const obliqueDovetailHelp = (entrance: DovetailEntrance): Help => ({
  label: 'Як працює кріплення?',
  text:
    `${OBLIQUE_DOVETAIL_MOTION[entrance]} Похилі боки під кутом 45° утримують половинки від ` +
    'роз’єднання перпендикулярно до перерізу.\n\n' +
    'Висота визначає, наскільки виступ виходить за переріз. Довжина вимірюється вздовж паза. Зазор — заданий у моделі ' +
    'проміжок між відповідними поверхнями виступу й паза.\n\n' +
    OBLIQUE_PRINT_NOTE +
    '\n\n' +
    BOUNDS_HELP,
});

const numberedPlugHelp = (printNote: string): Help => ({
  label: 'Як працює кріплення?',
  text:
    'Виступ друкується разом із частиною 1 та входить в отвір частини 2. Частини з’єднують і розбирають рухом ' +
    'перпендикулярно до перерізу.\n\n' +
    'Висота виступу визначає, наскільки він заходить у частину 2. Отвір має додаткові 0,3 мм глибини, щоб його дно не ' +
    'заважало зімкнути половинки.\n\n' +
    'Збільшення діаметра отвору визначає, наскільки отвір ширший за виступ. Наприклад, для виступу діаметром 5 мм ' +
    'значення 0,2 мм дає отвір діаметром 5,2 мм.\n\n' +
    printNote +
    '\n\n' +
    BOUNDS_HELP,
});

const numberedDowelHelp = (printNote: string): Help => ({
  label: 'Як працює кріплення?',
  text:
    'Штифти друкуються окремо та вставляються в отвори обох половинок. Їх можна вийняти або замінити.\n\n' +
    'Поле довжини задає повну довжину штифта. Номінально в кожну половинку входить половина цієї довжини. Кожен ' +
    'отвір має додаткові 0,3 мм глибини, тому штифт може трохи зміщуватися вздовж осі.\n\n' +
    'Розміри отворів частин 1 і 2 налаштовуються окремо. Наприклад, для штифта діаметром 5 мм збільшення діаметра ' +
    'отвору на 0,2 мм дає отвір діаметром 5,2 мм.\n\n' +
    printNote +
    '\n\n' +
    BOUNDS_HELP,
});

const BOX_PRINT_NOTE =
  'Кожна частина у файлі лежить на плоскій грані, яка її утримує: на залишку основи, на іншій грані або на площині ' +
  'перерізу. Вісь кріплення перпендикулярна до перерізу, тож виступи, пази й отвори можуть потребувати підтримок або іншої ' +
  'орієнтації в слайсері.';

/** A box's connector helps: by the parts' place for a horizontal plane, by their numbers for any other. */
const boxHelps = (horizontal: boolean, entrance: DovetailEntrance): Record<Exclude<ConnectorChoice, 'none'>, Help> =>
  horizontal
    ? {
        dovetail: { ...dovetailHelp, text: `${dovetailHelp.text}\n\n${BOX_PRINT_NOTE}` },
        plug: { ...plugHelp, text: `${plugHelp.text}\n\n${BOX_PRINT_NOTE}` },
        dowel: { ...dowelHelp, text: `${dowelHelp.text}\n\n${BOX_PRINT_NOTE}` },
        twist: twistHelp,
        magnet: magnetHelp(false),
      }
    : {
        dovetail: obliqueDovetailHelp(entrance),
        plug: numberedPlugHelp(BOX_PRINT_NOTE),
        dowel: numberedDowelHelp(BOX_PRINT_NOTE),
        twist: twistHelp,
        magnet: magnetHelp(false),
      };

const CONE_PRINT_NOTE =
  'Верхня частина звужується, тому ближче до вершини кріплення вміщується гірше: повзунки враховують усю глибину отвору ' +
  'чи паза, а не лише переріз. У файлі зрізаний конус стоїть на основі, а менший конус — на площині перерізу, вершиною ' +
  'догори, тому його отвори й паз відкриваються до столу. Їхні склепіння можуть потребувати підтримок або іншої ' +
  'орієнтації в слайсері.';

const withConeNote = (help: Help): Help => ({ ...help, text: `${help.text}\n\n${CONE_PRINT_NOTE}` });

const CONE_PLATE_PRINT_NOTE =
  'У файлі зрізаний конус стоїть на основі, а менший конус — на грані біля пластини, вершиною догори, тож його отвори чи ' +
  'паз відкриваються до столу й можуть потребувати підтримок. Пластина з отворами або без кріплення лежить пласко. З ' +
  'виступами на обох гранях вона стоїть на ребрі, виступами вздовж висоти друку: додайте кайму (brim) і перевірте в ' +
  'слайсері, чи потрібні підтримки.';

const CYLINDER_PLATE_PRINT_NOTE =
  'У файлі нижня частина стоїть на нижній основі, а верхня перевернута на верхню, тож отвори чи пази обох частин ' +
  'відкриваються догори. Пластина з отворами або без кріплення лежить пласко. З виступами на обох гранях вона стоїть на ' +
  'ребрі, виступами вздовж висоти друку: додайте кайму (brim) і перевірте в слайсері, чи потрібні підтримки.';

const EXPLODED_PLATE_NOTE = 'Розсунутий перегляд лише показує деталі окремо вздовж нормалі до пластини; це не напрям складання.';

const BALL_PLATE_PRINT_NOTE =
  'У файлі кожна частина кулі без виступу лежить гранню біля пластини на столі, тож склепіння її отворів чи паза можуть ' +
  'потребувати підтримок. Пластина з отворами або без кріплення лежить пласко. З виступами на обох гранях вона стоїть на ребрі, ' +
  'виступами вздовж висоти друку: додайте кайму (brim) і перевірте в слайсері, чи потрібні підтримки.';

const NUMBERED_PLATE_PRINT_NOTE =
  'У файлі частини стоять так само, як без пластини, а вісь кріплення лежить уздовж нормалі до перерізу, тож отвори й ' +
  'пази можуть потребувати підтримок або іншої орієнтації в слайсері. Пластина з отворами або без кріплення лежить ' +
  'пласко. З виступами на обох гранях вона стоїть на ребрі, виступами вздовж висоти друку: додайте кайму (brim) і ' +
  'перевірте в слайсері, чи потрібні підтримки.';

/** The parts' names beside a plate: below and above it on a cut parallel to the base, by number on any other. */
const plateParts = (numbered: boolean) =>
  numbered
    ? { both: 'частинах 1 і 2', first: 'частиною 1', firstOf: 'частини 1', second: 'частини 2', into: 'частину 2' }
    : {
        both: 'нижній і верхній частинах',
        first: 'нижньою частиною',
        firstOf: 'нижньої частини',
        second: 'верхньої частини',
        into: 'верхню частину',
      };

const plateDovetailHelp = (numbered: boolean, entrance: DovetailEntrance, printNote: string): Help => ({
  label: 'Як працює кріплення?',
  text:
    `Виступи друкуються на обох гранях січної пластини, пази — у ${plateParts(numbered).both}. Обидва пази відкриті з ` +
    `${numbered ? `обраного боку — ${entrance === 'standard' ? 'угорі' : 'внизу'} — ` : 'того самого боку '}й закінчуються ` +
    'упором з протилежного. Утримуючи пластину, насуньте кожну частину вздовж пластини до упора; знімаються частини ' +
    'незалежно одна від одної, зворотним зсуванням. Похилі боки під кутом 45° не дають частинам відійти від пластини ' +
    'перпендикулярно до неї, але не блокують зсування.\n\n' +
    `${EXPLODED_PLATE_NOTE}\n\n` +
    'Висота, довжина й зазор спільні для обох виступів, і повзунки враховують обидва пази разом. Довжина вимірюється ' +
    'вздовж напряму насування.\n\n' +
    `${printNote}\n\n${BOUNDS_HELP}`,
});

const platePlugHelp = (numbered: boolean, printNote: string): Help => {
  const names = plateParts(numbered);
  return {
    label: 'Як працює кріплення?',
    text:
      `Виступ друкується разом із ${names.first}, проходить крізь отвір пластини й входить у глухий отвір ${names.second}. ` +
      `Над ${names.first} він має висоту, що дорівнює товщині пластини плюс заглибленню; поле задає саме заглиблення у ` +
      `${names.into}. Глухий отвір має додаткові 0,3 мм глибини.\n\n` +
      `Отвір пластини наскрізний, із тим самим збільшенням діаметра, що й отвір ${names.second}. Частини й пластину ` +
      'з’єднують і розбирають рухом перпендикулярно до перерізу.\n\n' +
      `${EXPLODED_PLATE_NOTE}\n\n${printNote}\n\n${BOUNDS_HELP}`,
  };
};

const plateDowelHelp = (numbered: boolean, printNote: string): Help => ({
  label: 'Як працює кріплення?',
  text:
    'Штифти друкуються окремо, проходять крізь отвори пластини й входять у глухі отвори обох частин. Поле задає довжину ' +
    `в частинах — суму заглиблень у ${numbered ? 'частини 1 і 2' : 'нижню й верхню'}; повна довжина штифта більша на ` +
    'товщину пластини. Кожен глухий отвір має додаткові 0,3 мм глибини.\n\n' +
    'Отвори пластини мають більше з двох збільшень діаметра: так штифт вільно проходить крізь неї, а посадку визначають ' +
    'отвори частин.\n\n' +
    `${EXPLODED_PLATE_NOTE}\n\n${printNote}\n\n${BOUNDS_HELP}`,
});

const ENTRY_NOTCH_NOTE = 'У звуженій верхній частині може бути помітна виїмка для входу в паз.';

const CONE_VERTICAL_DOVETAIL_MOTION: Readonly<Record<DovetailEntrance, string>> = {
  standard:
    'Щоб скласти модель, опустіть частину з виступом уздовж паза до упора. Для розбирання утримуйте частину з пазом і ' +
    'підніміть частину з виступом. Паз відкритий угорі, упор — унизу; рух вертикальний, також у похилого конуса.\n\n' +
    ENTRY_NOTCH_NOTE,
  opposite:
    'Щоб скласти модель, підніміть частину з виступом уздовж паза знизу до упора. Для розбирання утримуйте частину з пазом і ' +
    'опустіть частину з виступом. Паз відкритий унизу, біля основи, упор — угорі; рух вертикальний, також у похилого конуса. ' +
    'Вага частини з виступом тягне її з паза, тож модель треба тримати або покласти.',
};

const coneVerticalDovetailHelp = (entrance: DovetailEntrance): Help => ({
  label: 'Як працює кріплення?',
  text:
    `${CONE_VERTICAL_DOVETAIL_MOTION[entrance]}\n\n` +
    'Виступ — на частині 1, паз — у частині 2. Похилі боки під кутом 45° утримують половинки від роз’єднання ' +
    'перпендикулярно до перерізу, але це не замок: половинки роз’єднаються, якщо утримувати іншу або перевернути модель.\n\n' +
    'Висота визначає, наскільки виступ виходить за переріз. Довжина вимірюється вертикально, вздовж паза. Зазор — ' +
    'заданий у моделі проміжок між відповідними поверхнями виступу й паза.\n\n' +
    BOUNDS_HELP,
});

const CONE_VERTICAL_NOTE =
  'Конус звужується догори, а порожнина перетинає різні висоти й іде до вигнутої поверхні, тому повзунки враховують ' +
  'увесь її об’єм, а не лише вхід. ';

const BALL_PRINT_NOTE =
  'Куля вигинається всередину навколо отвору чи паза, тому повзунки враховують увесь їхній об’єм, а не лише вхід. У файлі ' +
  'частини лежать перерізом на столі, якщо він вільний. Частина, більша за півкулю, розширюється над столом, а склепіння ' +
  'отворів і паза можуть потребувати підтримок.';

const PROTRUDING_ON_BALL_NOTE =
  'Частина з виступом розміщена перерізом догори. Перед друком налаштуйте підтримки під її округлою поверхнею.';

const withBallNote = (help: Help): Help => ({ ...help, text: `${help.text}\n\n${BALL_PRINT_NOTE}` });

const SCALE_NOTE =
  'Показано фактичні розміри для поточного масштабу моделі. Розміри кріплення змінюються разом із найбільшим габаритом.';
const ROUND_SCALE_NOTE =
  'Показано фактичні розміри кріплення. Спочатку їх визначає місце в обох частинах; задані вручну змінюються разом із ' +
  'найбільшим габаритом, а якщо вже не вміщуються, зменшуються автоматично.';
// A hole is the pin's outline moved outwards, whatever its shape; the circle's help above says it in diameters.
const PROFILE_CLEARANCE_HELP =
  'Отвір має той самий контур, що й кріплення, зсунутий назовні на половину значення збільшення, тому кожна грань отримує ' +
  'однаковий зазор, а кути отвору лишаються гострими й не зменшують його.';
const TRIAL_VALUES_HELP =
  'Початкові збільшення отворів — лише орієнтир для пробного друку, а не перевірене налаштування принтера чи матеріалу.';
const CLEARANCE_NOTE = 'Значення 0,4 мм дає зазор 0,2 мм з кожного боку.';

/** What one connector of this profile leaves free; a pair of different sizes leaves one position, whatever the profile. */
const countNote = (profile: ConnectorProfile): string => {
  const pair = 'Два кріплення різного розміру задають їхнє взаємне положення.';
  if (profile === 'circle')
    return 'Одне кругле кріплення дозволяє повертати половинки. Два кріплення різного діаметра задають їхнє взаємне положення.';
  if (profile === 'flatted-circle')
    return 'Зрізаний бік допускає лише одне положення половинок уже за одного кріплення. Невеликий люфт через зазор нормальний.';
  const turns = { triangle: '120°', square: '90°', hexagon: '60°' }[profile];
  return `Одне таке кріплення дозволяє складати половинки з поворотом на ${turns}. ${pair}`;
};

/** What the nominal size of a profile measures: never a side or the width across flats. */
const sizeNote = (profile: ConnectorProfile): string | undefined => {
  if (profile === 'circle') return undefined;
  if (profile === 'flatted-circle') return 'Розмір — діаметр вихідного кола, з якого зрізано один бік.';
  return profile === 'square'
    ? 'Розмір — діаметр описаного кола, тобто діагональ квадрата.'
    : 'Розмір — діаметр описаного кола, а не довжина сторони.';
};

/** A millimetre value for the linked lines; "—" while the setting it follows is not valid. */
const millimetres = (value: number | undefined): string =>
  value === undefined ? '— мм' : `${formatDecimal(Math.round(value * 1000) / 1000)} мм`;

/**
 * "Кріплення", after the section's own group: the connector's type and the settings of the chosen one. Settings stored
 * as multipliers or percentages are shown in millimetres at the current scale, with their linked dimensions on one
 * line each: the dovetail's widths, a pair's second diameter, a dowel's insertion into each part. Shown while a section
 * is chosen; a connector is optional, so its state is summarised.
 */
function connectorSection(
  kind: 'cylinder' | 'cone' | 'ball' | BoxSolid,
  choices: ParameterChoices,
  context: PanelContext,
): ParameterSection[] {
  const keys = sectionKeys[kind];
  const scale = context.connectorScale ?? connectorScaleOf(kind, context.values ?? {}, undefined, choices);
  if (keys === undefined || scale === undefined || activeSection(kind, choices) === undefined) return [];
  const chosen = choices[keys.connector];
  const values = context.values ?? {};
  const offersTwist = twistAvailable(kind, choices, values);
  // Through a section plate the pins also cross its thickness, which their fields leave out.
  const plated = plateChosen(kind, choices);
  const plateThickness = plated && keys.plate !== undefined ? values[keys.plate.thickness] : undefined;
  const selector: ChoiceField = {
    type: 'choice',
    key: keys.connector,
    label: 'Тип кріплення',
    options: (['none', 'dovetail', 'plug', 'dowel', 'twist', 'magnet'] as const).map((value) => ({
      value,
      label: connectorNames[value],
      ...(value === 'twist' && !offersTwist ? { disabled: true } : {}),
    })),
  };
  const { dovetail, round } = keys;
  const cut = activeSection(kind, choices) as SectionType;
  // Only a parallel cut has a lower and an upper part wherever it runs, and a box's horizontal plane; the others number theirs.
  const boxHorizontal = isBoxSolid(kind) && boxCutHorizontal(kind, choices, context.values ?? {});
  const numbered = isBoxSolid(kind) ? !boxHorizontal : cut !== 'parallel-to-bases' && cut !== 'horizontal';
  const units = connectorUnits(scale, chosen === 'dowel' ? 'dowel' : 'plug', cut);
  const fittedToSection = chosen === 'plug' || chosen === 'dowel' || chosen === 'twist';
  /** The feasible range that the request computed; the calibration window, or nothing, until it can. */
  const rangeOf = (key: ParameterKey, increment: number, fallback?: StepRange): StepRange | undefined => {
    const interval = context.sectionRanges?.[key];
    return interval === undefined ? fallback : physicalRange(interval, increment);
  };
  /** A stored multiplier or percentage shown in millimetres, over its feasible range. */
  const millimetreField = (key: ScaledConnectorKey, label: string, increment = DIMENSION_INCREMENT_MM): NumericField => ({
    type: 'number',
    key,
    label,
    suffix: '',
    unit: units[key],
    range: rangeOf(key, increment),
    ...(fittedToSection ? { editsRoundConnector: true } : {}),
  });
  const clearanceField = (key: ParameterKey, label: string, window: StepRange): NumericField => ({
    type: 'number',
    key,
    label,
    suffix: '',
    range: rangeOf(key, window.increment, window),
    ...(fittedToSection ? { editsRoundConnector: true } : {}),
  });
  const shown = (key: ScaledConnectorKey) => {
    const value = values[key];
    return value === undefined ? undefined : value * units[key];
  };
  const note = (key: string, text: string): NoteField => ({ type: 'note', key: `${kind}-${key}`, text });
  const scaleNote = note('connector-scale', SCALE_NOTE);
  const height = shown(dovetail.size);
  const pair = choices[round.count] === 2;
  const diameter = shown(round.diameter);
  const profile = choices[round.profile];
  const circular = profile === 'circle';
  const pinName = chosen === 'plug' ? 'виступу' : 'штифта';
  const diameterLabel =
    profile === 'flatted-circle'
      ? 'Діаметр вихідного кола, мм'
      : circular
        ? `Діаметр ${pinName}, мм`
        : 'Діаметр описаного кола, мм';
  const enlargement = circular ? 'Збільшення діаметра' : 'Збільшення';
  const unavailable = context.connectorStatus?.unavailable;
  const corrections = (context.connectorStatus?.corrections ?? []).map(
    (text, index): NoteField => ({ ...note(`connector-correction-${index}`, text), tone: 'status' }),
  );
  const size = sizeNote(profile);
  const profileField: ChoiceField = {
    type: 'choice',
    key: round.profile,
    label: 'Профіль',
    options: CONNECTOR_PROFILES.map((value) => ({ value, label: CONNECTOR_PROFILE_NAMES[value] })),
  };
  const countField: ChoiceField = {
    type: 'choice',
    key: round.count,
    label: 'Кількість',
    options: [
      { value: 1, label: '1' },
      { value: 2, label: '2' },
    ],
  };
  const roundFields = (lengthField: NumericField, lengthNote: NoteField[]): ParameterField[] =>
    unavailable !== undefined
      ? [
          profileField,
          countField,
          { ...note('connector-unavailable', unavailable), tone: 'alert' },
          { type: 'action', key: `${kind}-choose-no-connector`, label: 'Обрати «Без кріплення»', action: 'choose-no-connector' },
        ]
      : [
          note('connector-scale', ROUND_SCALE_NOTE),
          profileField,
          countField,
          note('connector-count', countNote(profile)),
          ...corrections,
          millimetreField(round.diameter, diameterLabel, ROUND_CONNECTOR_STEPS_MM.size),
          ...(size === undefined ? [] : [note('connector-size', size)]),
          ...(pair
            ? [
                note(
                  'connector-second-diameter',
                  `Друге кріплення: ${circular ? 'діаметр' : 'розмір'} ${millimetres(diameter === undefined ? undefined : ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * diameter)}.`,
                ),
                millimetreField(round.spacing, 'Від центра до осі кріплення, мм', ROUND_CONNECTOR_STEPS_MM.spacing),
              ]
            : []),
          lengthField,
          ...lengthNote,
        ];
  const twistKeys = keys.twist;
  const entrance = choices[keys.dovetailEntrance];
  // On a horizontal cut the slide has no upper and lower end; the two sides are named by the cut's own frame.
  const horizontalCut = cut === 'parallel-to-bases' || cut === 'horizontal' || boxHorizontal;
  const entranceField: ChoiceField = {
    type: 'choice',
    key: keys.dovetailEntrance,
    label: 'Вхід у паз',
    options: [
      { value: 'standard', label: horizontalCut ? 'З одного боку' : 'Зверху' },
      { value: 'opposite', label: horizontalCut ? 'З протилежного боку' : 'Знизу' },
    ],
  };
  const plugLength = shown(round.depth);
  const magnetKeys = keys.magnet;
  const magnetMm = (key: ParameterKey, label: string, limits: { min: number; max: number }, increment: number): NumericField => ({
    type: 'number',
    key,
    label,
    suffix: '',
    range: { ...limits, increment },
  });
  const sumOf = (first: ParameterKey, second: ParameterKey) =>
    values[first] === undefined || values[second] === undefined
      ? undefined
      : (values[first] as number) + (values[second] as number);
  const pocketDiameter = sumOf(magnetKeys.DiameterMm, magnetKeys.DiameterAllowanceMm);
  const pocketDepth = sumOf(magnetKeys.ThicknessMm, magnetKeys.DepthAllowanceMm);
  const hundredths = (value: number | undefined) => (value === undefined ? '—' : value.toFixed(2).replace('.', ','));
  const fields: Record<ConnectorChoice, ParameterField[]> = {
    none: [],
    magnet: [
      ...(unavailable === undefined
        ? []
        : [
            { ...note('connector-unavailable', unavailable), tone: 'alert' as const },
            {
              type: 'action',
              key: `${kind}-choose-no-connector`,
              label: 'Обрати «Без кріплення»',
              action: 'choose-no-connector',
            } as const,
          ]),
      {
        type: 'number',
        key: magnetKeys.Count,
        label: 'Кількість пар магнітів',
        suffix: '',
        range: { ...MAGNET_LIMITS.count, increment: 1 },
      },
      note('magnet-pairs', 'Одна пара — два магніти, по одному в кожній частині.'),
      magnetMm(magnetKeys.DiameterMm, 'Діаметр магніту, мм', MAGNET_LIMITS.magnetDiameterMm, 0.1),
      magnetMm(magnetKeys.ThicknessMm, 'Товщина магніту, мм', MAGNET_LIMITS.magnetThicknessMm, 0.1),
      {
        type: 'disclosure',
        key: `${kind}-magnet-fit`,
        label: 'Додаткові налаштування',
        fields: [
          magnetMm(magnetKeys.DiameterAllowanceMm, 'Запас за діаметром, мм', MAGNET_LIMITS.diameterAllowanceMm, 0.05),
          note('magnet-diameter-allowance', 'Додається до повного діаметра магніту.'),
          magnetMm(magnetKeys.DepthAllowanceMm, 'Запас за глибиною, мм', MAGNET_LIMITS.depthAllowanceMm, 0.05),
          note('magnet-depth-allowance', 'Додається до товщини магніту.'),
          note('magnet-hole', `Розмір отвору: Ø${hundredths(pocketDiameter)} × ${hundredths(pocketDepth)} мм`),
          {
            type: 'action',
            key: `${kind}-magnet-fit-reset`,
            label: 'Відновити стандартні значення',
            action: 'reset-magnet-allowances',
            disabled: !context.magnetAllowancesChanged,
          },
        ],
      },
    ],
    twist:
      twistKeys === undefined || unavailable !== undefined
        ? [
            { ...note('connector-unavailable', unavailable ?? TWIST_UNSUPPORTED_MESSAGE), tone: 'alert' },
            {
              type: 'action',
              key: `${kind}-choose-no-connector`,
              label: 'Обрати «Без кріплення»',
              action: 'choose-no-connector',
            },
          ]
        : [
            note('twist-scale', TWIST_SCALE_NOTE),
            ...corrections,
            millimetreField(twistKeys[0], 'Розмір кріплення, мм', TWIST_STEPS_MM.size),
            note('twist-size', 'Розмір — діаметр кола навколо всієї головки разом із вушками, а не діаметр шийки.'),
            clearanceField(twistKeys[1], 'Збільшення гнізда Δ, мм', {
              ...TWIST_CLEARANCE_LIMITS,
              increment: TWIST_STEPS_MM.clearance,
            }),
            note(
              'twist-clearance',
              'Значення 0,5 мм дає зазор 0,25 мм з кожного боку. Бічний зазор дає змогу вставити й повернути головку.',
            ),
            clearanceField(twistKeys[2], 'Осьовий зазор, мм', {
              ...TWIST_AXIAL_CLEARANCE_LIMITS,
              increment: TWIST_STEPS_MM.clearance,
            }),
            note(
              'twist-axial',
              'Проміжок окремо над головкою й під нею. Більше значення зменшує ризик заїдання по висоті, але дає більший люфт уздовж осі.',
            ),
            { type: 'action', key: `${kind}-download-trial`, label: 'Завантажити пробне з’єднання', action: 'download-trial' },
          ],
    dovetail: [
      entranceField,
      ...(plated ? [note('dovetail-plate', 'Виступи — на обох гранях пластини, пази — в обох частинах.')] : []),
      scaleNote,
      millimetreField(dovetail.size, 'Висота виступу, мм'),
      note(
        'dovetail-widths',
        `Ширина виступу: біля основи ${millimetres(height === undefined ? undefined : (height * DOVETAIL_PROPORTIONS.rootWidth) / DOVETAIL_PROPORTIONS.height)}, ` +
          `угорі ${millimetres(height === undefined ? undefined : height * (2 + DOVETAIL_PROPORTIONS.rootWidth / DOVETAIL_PROPORTIONS.height))}.`,
      ),
      millimetreField(dovetail.length, 'Довжина виступу, мм'),
      clearanceField(dovetail.clearance, 'Зазор між поверхнями, мм', dovetailClearanceRange),
    ],
    plug: [
      ...(plated
        ? roundFields(millimetreField(round.depth, 'Заглиблення виступу, мм', ROUND_CONNECTOR_STEPS_MM.length), [
            note(
              'plug-height',
              `Над ${plateParts(numbered).first} виступ має ${millimetres(plugLength === undefined || plateThickness === undefined ? undefined : plugLength + plateThickness)}: ` +
                `${millimetres(plateThickness)} крізь пластину й ${millimetres(plugLength)} у ${plateParts(numbered).into}.`,
            ),
          ])
        : roundFields(millimetreField(round.depth, 'Висота виступу, мм', ROUND_CONNECTOR_STEPS_MM.length), [
            note('plug-height', 'Висота від площини перерізу: на стільки виступ заходить в отвір другої частини.'),
          ])),
      clearanceField(round.plugClearance, `${enlargement} отвору, мм`, diametralClearanceRange),
      note('connector-clearance', CLEARANCE_NOTE),
    ],
    dowel: [
      ...(plated
        ? roundFields(millimetreField(round.depth, 'Довжина штифта в частинах, мм', ROUND_CONNECTOR_STEPS_MM.length), [
            note(
              'dowel-insertion',
              `Повна довжина штифта — ${millimetres(plugLength === undefined || plateThickness === undefined ? undefined : plugLength + plateThickness)}: ` +
                `по ${millimetres(shownHalf(plugLength))} у кожній частині та ${millimetres(plateThickness)} крізь пластину.`,
            ),
          ])
        : roundFields(millimetreField(round.depth, 'Повна довжина штифта, мм', ROUND_CONNECTOR_STEPS_MM.length), [
            note('dowel-insertion', `У кожну половинку штифт входить на ${millimetres(shownHalf(shown(round.depth)))}.`),
          ])),
      clearanceField(
        round.dowelLowerClearance,
        cut === 'shared-generatrix'
          ? `${enlargement} отворів середньої частини, мм`
          : numbered
            ? `${enlargement} отворів частини 1, мм`
            : `${enlargement} нижніх отворів, мм`,
        diametralClearanceRange,
      ),
      clearanceField(
        round.dowelUpperClearance,
        cut === 'shared-generatrix'
          ? `${enlargement} отворів відрізаних частин, мм`
          : numbered
            ? `${enlargement} отворів частини 2, мм`
            : `${enlargement} верхніх отворів, мм`,
        diametralClearanceRange,
      ),
      note('connector-clearance', CLEARANCE_NOTE),
      ...(plated
        ? [note('plate-hole-clearance', 'Отвори пластини мають більше з двох збільшень, щоб штифт проходив крізь неї вільно.')]
        : []),
      ...(unavailable === undefined
        ? [{ type: 'action', key: `${kind}-download-pins`, label: 'Завантажити лише штифти', action: 'download-pins' } as const]
        : []),
    ],
  };
  const helps: Record<SectionType, Record<Exclude<ConnectorChoice, 'none'>, Help>> = {
    'parallel-to-bases': {
      dovetail: dovetailHelp,
      plug: plugHelp,
      dowel: dowelHelp,
      twist: twistHelp,
      magnet: magnetHelp(false),
    },
    vertical: {
      dovetail: verticalDovetailHelp(entrance),
      plug: numberedPlugHelp(VERTICAL_PRINT_NOTE),
      dowel: numberedDowelHelp(VERTICAL_PRINT_NOTE),
      twist: twistHelp,
      magnet: magnetHelp(false),
    },
    oblique: {
      dovetail: obliqueDovetailHelp(entrance),
      plug: numberedPlugHelp(OBLIQUE_PRINT_NOTE),
      dowel: numberedDowelHelp(OBLIQUE_PRINT_NOTE),
      twist: twistHelp,
      magnet: magnetHelp(false),
    },
    'oblique-apex': {
      dovetail: obliqueDovetailHelp(entrance),
      plug: numberedPlugHelp(OBLIQUE_PRINT_NOTE),
      dowel: numberedDowelHelp(OBLIQUE_PRINT_NOTE),
      twist: twistHelp,
      magnet: magnetHelp(false),
    },
    'axis-parallel': {
      dovetail: verticalDovetailHelp(entrance),
      plug: numberedPlugHelp(VERTICAL_PRINT_NOTE),
      dowel: numberedDowelHelp(VERTICAL_PRINT_NOTE),
      twist: twistHelp,
      magnet: magnetHelp(false),
    },
    'shared-generatrix': linkedConnectorHelps(entrance),
    horizontal: {
      dovetail: withBallNote(dovetailHelp),
      plug: withBallNote(plugHelp),
      dowel: withBallNote(dowelHelp),
      twist: twistHelp,
      magnet: magnetHelp(false),
    },
    'face-parallel': boxHelps(boxHorizontal, entrance),
    longitudinal: boxHelps(boxHorizontal, entrance),
    'through-apex': boxHelps(boxHorizontal, entrance),
    'through-line': boxHelps(boxHorizontal, entrance),
    inclined: boxHelps(boxHorizontal, entrance),
  };
  // A chosen one explains itself; otherwise the disabled option is explained here.
  const unsupportedNote =
    !offersTwist && chosen !== 'twist'
      ? [
          note(
            'twist-unsupported',
            plated && kind === 'cylinder'
              ? 'Поворотне з’єднання не працює із січною пластиною; його налаштування збережено.'
              : 'Поворотне з’єднання поки доступне лише для прямого циліндра з перерізом, паралельним основам.',
          ),
        ]
      : [];
  // Only this part leaves the bed without a flat face, and it holds for this model, whatever the plane.
  const printNote =
    kind === 'ball' && (chosen === 'plug' || (chosen === 'dovetail' && !plated))
      ? [note('connector-print-placement', PROTRUDING_ON_BALL_NOTE)]
      : [];
  const helpOf = (type: Exclude<ConnectorChoice, 'none'>): Help => {
    if (type === 'magnet') return magnetHelp(plated);
    if (plated && type !== 'twist') {
      const note =
        kind === 'ball'
          ? BALL_PLATE_PRINT_NOTE
          : numbered
            ? NUMBERED_PLATE_PRINT_NOTE
            : kind === 'cylinder'
              ? CYLINDER_PLATE_PRINT_NOTE
              : CONE_PLATE_PRINT_NOTE;
      return type === 'dovetail'
        ? plateDovetailHelp(numbered, entrance, note)
        : type === 'plug'
          ? platePlugHelp(numbered, note)
          : plateDowelHelp(numbered, note);
    }
    if (kind !== 'cone' || type === 'twist') return helps[cut][type];
    if (cut === 'parallel-to-bases') return withConeNote(helps[cut][type]);
    if (cut === 'vertical' && type === 'dovetail') return coneVerticalDovetailHelp(entrance);
    if (type === 'dovetail') {
      // Only an entrance at the top opens through the narrowing part of the cone, near its apex.
      const { label, text } = helps[cut][type];
      return entrance === 'standard' ? { label, text: `${ENTRY_NOTCH_NOTE}\n\n${text}` } : { label, text };
    }
    const printNote = cut === 'vertical' ? VERTICAL_PRINT_NOTE : OBLIQUE_PRINT_NOTE;
    return (type === 'plug' ? numberedPlugHelp : numberedDowelHelp)(CONE_VERTICAL_NOTE + printNote);
  };
  const withRoundNotes = (type: Exclude<ConnectorChoice, 'none'>, help: Help): Help =>
    type === 'dovetail' || type === 'twist' || type === 'magnet'
      ? help
      : {
          ...help,
          text: [help.text, ...(circular ? [] : [PROFILE_CLEARANCE_HELP]), TRIAL_VALUES_HELP].join('\n\n'),
        };
  const bothPlanes =
    chosen !== 'none' && secondCutChosen(kind, choices)
      ? [
          note(
            'connector-both-planes',
            numbered
              ? 'Кріплення однакове на обох перерізах: між частиною 1 і середньою та між середньою й частиною 2.'
              : 'Кріплення однакове на обох перерізах: між нижньою й середньою та між середньою й верхньою частинами.',
          ),
        ]
      : [];
  const notice =
    context.connectorNotice === undefined
      ? []
      : [{ ...note('connector-notice', context.connectorNotice), tone: 'status' as const }];
  return [
    section(
      `${kind}-connector`,
      'Кріплення',
      [selector, ...bothPlanes, ...notice, ...unsupportedNote, ...printNote, ...fields[chosen]],
      {
        help: chosen === 'none' ? undefined : withRoundNotes(chosen, helpOf(chosen)),
        status:
          chosen !== 'none' && unavailable !== undefined && chosen !== 'dovetail'
            ? { text: chosen === 'twist' && !offersTwist ? 'недоступно' : 'не вміщується', highlighted: true }
            : { text: chosen === 'none' ? 'немає' : connectorNames[chosen].toLowerCase(), highlighted: chosen !== 'none' },
      },
    ),
  ];
}

/** A dowel enters each part by half its whole length. */
const shownHalf = (length: number | undefined) => (length === undefined ? undefined : length / 2);

/** Whether the current valid plane contains the current valid solid's whole axis. */
function obliqueContainsAxis(
  kind: 'cylinder' | 'cone',
  values: ParameterValues | undefined,
  inclinationKey: ParameterKey,
  directionKey: ParameterKey,
): boolean {
  const heightRatio = kind === 'cone' ? values?.coneHeightRatio : values?.cylinderHeightRatio;
  const offsetRatio = kind === 'cone' ? values?.coneOffsetRatio : values?.cylinderOffsetRatio;
  const [inclination, direction] = [values?.[inclinationKey], values?.[directionKey]];
  if (heightRatio === undefined || offsetRatio === undefined || inclination === undefined || direction === undefined)
    return false;
  return obliquePlaneContainsAxis({ kind, heightRatio, offsetRatio }, inclination, direction);
}

/**
 * "Переріз": optional, so the group starts collapsed with the chosen section in its summary. The position and the
 * separation are shown only while a section is chosen.
 */
function ballPlaneSection(choices: ParameterChoices, context: PanelContext): ParameterSection {
  const keys = sectionKeys.ball;
  if (keys === undefined || keys.secondCut === undefined) throw new Error('No section fields for the ball.');
  const chosen = choices[keys.choice];
  const twoPlanes = choices[keys.secondCut.toggle];
  const plateOn = !twoPlanes && keys.plate !== undefined && choices[keys.plate.toggle];
  const offsetField = (key: ParameterKey, label: string): NumericField => {
    const interval = context.sectionRanges?.[key];
    return {
      type: 'number',
      key,
      label,
      suffix: '% r',
      range: interval === undefined || interval === null ? undefined : percentRange(interval, SECTION_PERCENT_INCREMENT),
    };
  };
  const plateNote = 'ball-second-cut-plate';
  const planes: ParameterField[] = twoPlanes
    ? [
        { ...offsetField(keys.offset, 'Перший переріз: зміщення від центра'), sectionTone: 0 },
        { ...offsetField(keys.secondCut.offset, 'Другий переріз: зміщення від центра'), sectionTone: 1 },
        { type: 'action', key: 'ball-remove-second-cut', label: 'Прибрати другий переріз', action: 'remove-second-cut' },
      ]
    : [
        offsetField(keys.offset, 'Зміщення від центра'),
        {
          type: 'action',
          key: 'ball-add-second-cut',
          label: 'Додати паралельний переріз',
          action: 'add-second-cut',
          ...(plateOn ? { disabled: true } : {}),
        },
        ...(plateOn
          ? [{ type: 'note' as const, key: plateNote, text: 'Паралельний переріз недоступний із січною пластиною.' }]
          : []),
      ];
  // Two planes take no plate: its switch stays, off, with the reason.
  const plateFields: ParameterField[] =
    twoPlanes && keys.plate !== undefined
      ? [
          { type: 'toggle', key: keys.plate.toggle, label: 'Січна пластина', disabled: true, describedBy: plateNote },
          { type: 'note', key: plateNote, text: 'Січна пластина доступна лише з одним перерізом.' },
        ]
      : plateFieldsOf('ball', keys, choices, context, chosen);
  const help = twoPlanes ? { ...ballSectionHelp, text: `${ballSectionHelp.text}\n\n${BALL_SECOND_CUT_HELP}` } : ballSectionHelp;
  return section(
    'ball-section',
    'Переріз',
    [
      {
        type: 'choice',
        key: keys.choice,
        label: 'Тип перерізу',
        options: [
          { value: 'none', label: sectionNames.none },
          { value: 'horizontal', label: sectionNames.horizontal },
        ],
      },
      ...(chosen === 'horizontal'
        ? [...planes, { type: 'toggle' as const, key: keys.separated, label: 'Розсунути частини' }, ...plateFields]
        : []),
    ],
    {
      help: chosen !== 'horizontal' ? undefined : plateOn ? withPlateHelp(ballSectionHelp, false, BALL_PLATE_HELP) : help,
      status: {
        text:
          chosen === 'none' ? 'немає' : twoPlanes ? 'два перерізи' : plateOn ? 'з пластиною' : sectionNames[chosen].toLowerCase(),
        highlighted: chosen !== 'none',
      },
    },
  );
}

/**
 * The section plate's switch and, once it is on, its thickness and margin, for a solid that offers one: the switch is off where
 * no plate fits the current valid solid and cut, which the request knows, and offered while one of them is being typed.
 */
function plateFieldsOf(
  kind: 'cylinder' | 'cone' | 'ball',
  keys: NonNullable<(typeof sectionKeys)[ShapeKind]>,
  choices: ParameterChoices,
  context: PanelContext,
  chosen: SectionChoice,
): ParameterField[] {
  const plate = keys.plate;
  if (plate === undefined) return [];
  const plateOn = choices[plate.toggle];
  const thicknessInterval = context.sectionRanges?.[plate.thickness];
  const fits = thicknessInterval !== null;
  const plateNoteId = `${kind}-plate-unavailable`;
  const unavailableText = chosen === 'parallel-to-bases' ? PLATE_UNAVAILABLE_MESSAGE : PLATE_UNAVAILABLE_ELSEWHERE_MESSAGE;
  return [
    {
      type: 'toggle',
      key: plate.toggle,
      label: 'Січна пластина',
      ...(!fits && !plateOn ? { disabled: true, describedBy: plateNoteId } : {}),
    },
    // Once chosen, the thickness field itself says why it does not fit, and the switch stays free to turn it off.
    ...(fits || plateOn ? [] : [{ type: 'note' as const, key: plateNoteId, text: unavailableText }]),
    ...(plateOn
      ? [
          {
            type: 'number' as const,
            key: plate.thickness,
            label: 'Товщина пластини, мм',
            suffix: '',
            range:
              thicknessInterval === undefined || thicknessInterval === null
                ? plateThicknessWindow
                : physicalRange(thicknessInterval, PLATE_THICKNESS_INCREMENT_MM),
          },
          { type: 'number' as const, key: plate.margin, label: 'Виступ за межі фігури, мм', suffix: '', range: plateMarginRange },
          ...(context.plateClipped === true
            ? [{ type: 'note' as const, key: `${kind}-plate-clipped`, text: PLATE_CLIPPED_NOTE }]
            : []),
        ]
      : []),
  ];
}

/**
 * What the 3D preview shows stronger while a control is in use: the GLB's materials by name, a section's planes (`plane-…`) and
 * guides (`guide-…`), and the vertex labels by the model's names of them, such as A1.
 */
export type PreviewHighlight = { readonly materials: readonly string[]; readonly labels: readonly string[] };

/** The preview's materials and vertex names of each element of a section through a shared generatrix. */
const LINKED_PREVIEW_ELEMENTS: Readonly<Record<LinkedElement, PreviewHighlight>> = {
  A: { materials: ['guide-AA1'], labels: ['A', 'A1'] },
  B: { materials: ['guide-BB1'], labels: ['B', 'B1'] },
  C: { materials: ['guide-CC1'], labels: ['C', 'C1'] },
  AB: { materials: ['plane-1'], labels: [] },
  AC: { materials: ['plane-2'], labels: [] },
  BC: { materials: ['plane-3'], labels: [] },
  alternative: { materials: ['plane-2', 'guide-CC1'], labels: ['C', 'C1'] },
};

/**
 * What the preview shows stronger while a control is in use: the elements its group's diagram marks for it, the same in the 3D
 * view; undefined for a control without a diagram's elements.
 */
export function previewHighlightOf(panel: ShapePanel, activeKey: string | undefined): PreviewHighlight | undefined {
  if (activeKey === undefined || panel.type !== 'parameters') return undefined;
  const diagram = panel.sections
    .flatMap((section) => section.fields)
    .find((field): field is LinkedDiagramField => field.type === 'linked-diagram');
  const elements = diagram?.affects[activeKey];
  if (elements === undefined) return undefined;
  const parts = elements.map((element) => LINKED_PREVIEW_ELEMENTS[element]);
  return {
    materials: [...new Set(parts.flatMap(({ materials }) => materials))],
    labels: [...new Set(parts.flatMap(({ labels }) => labels))],
  };
}

/** How a cylinder's or a cone's second plane is set, after its cut's own explanation. */
const ROUND_SECOND_CUT_HELP =
  '«Додати паралельний переріз» додає другу площину, паралельну першій. Перша лишається такою, як її задано, — площина ' +
  'через вершину й далі проходить через вершину; друга лише паралельна їй. Положення другого перерізу — у відсотках ширини ' +
  'фігури вздовж спільної нормалі площин: 0 % і 100 % — площини, що лише торкаються фігури з двох боків. Другий переріз ' +
  'може лежати з будь-якого боку від першого. Дві площини ділять фігуру на три частини; у перегляді перший переріз ' +
  'помаранчевий, другий — зелений.';

/**
 * A cylinder's or a cone's cut with the second parallel plane's controls before "Розсунути частини": the first plane's name and
 * colour above its fields, the second's position and its removal; or the action that adds it. Two planes take no section plate,
 * whose switch then stays, off, with the reason, as a ball's.
 */
function withSecondPlane(
  kind: 'cylinder' | 'cone',
  keys: PlanarSectionKeys,
  fields: readonly ParameterField[],
  twoPlanes: boolean,
  plateOn: boolean,
): ParameterField[] {
  const second = keys.secondCut;
  if (second === undefined) return [...fields];
  const plate = keys.plate;
  const plateNote = `${kind}-second-cut-plate`;
  const isPlateField = (field: ParameterField) =>
    plate !== undefined &&
    (field.key === plate.toggle ||
      field.key === plate.thickness ||
      field.key === plate.margin ||
      field.key.startsWith(`${kind}-plate-`));
  const own = twoPlanes ? fields.filter((field) => !isPlateField(field)) : [...fields];
  const separatedAt = own.findIndex((field) => field.key === keys.separated);
  const at = separatedAt < 0 ? own.length : separatedAt;
  const block: ParameterField[] = twoPlanes
    ? [
        {
          type: 'number',
          key: second.offset,
          label: 'Другий переріз: положення',
          suffix: '%',
          range: sectionPositionRange,
          sectionTone: 1,
        },
        { type: 'action', key: `${kind}-remove-second-cut`, label: 'Прибрати другий переріз', action: 'remove-second-cut' },
      ]
    : [
        {
          type: 'action',
          key: `${kind}-add-second-cut`,
          label: 'Додати паралельний переріз',
          action: 'add-second-cut',
          ...(plateOn ? { disabled: true } : {}),
        },
        ...(plateOn
          ? [{ type: 'note' as const, key: plateNote, text: 'Паралельний переріз недоступний із січною пластиною.' }]
          : []),
      ];
  const plateAfter: ParameterField[] =
    twoPlanes && plate !== undefined
      ? [
          { type: 'toggle', key: plate.toggle, label: 'Січна пластина', disabled: true, describedBy: plateNote },
          { type: 'note', key: plateNote, text: 'Січна пластина недоступна з двома паралельними перерізами.' },
        ]
      : [];
  return [
    ...(twoPlanes
      ? [{ type: 'section-mark' as const, key: `${kind}-first-section`, label: 'Перший переріз', tone: 0 as const }]
      : []),
    ...own.slice(0, at),
    ...block,
    ...own.slice(at),
    ...plateAfter,
  ];
}

/** The part of a section through a shared generatrix as a warning names it. */
const LINKED_PART_NAMES: Readonly<Record<LinkedPart, string>> = {
  middle: 'Середня частина',
  'part-1': 'Частина за першим перерізом',
  'part-2': 'Частина за другим перерізом',
  'part-3': 'Частина за третім перерізом',
};

/**
 * The controls of a cylinder's section through a shared generatrix, each saying what it changes: the angle between the planes
 * the second plane alone, the pair's turn both planes about AA1, the explicit action the second plane's other solution, and,
 * further down, the generatrix itself. The diagram shows what each one changes while it is hovered or focused.
 */
function linkedFields(
  kind: 'cylinder' | 'cone',
  linked: NonNullable<PlanarSectionKeys['linked']>,
  choices: ParameterChoices,
  values: ParameterValues,
  toggle: ToggleField,
): ParameterField[] {
  const axialKey = `${kind}-linked-axial`;
  const alternativeKey = `${kind}-linked-alternative`;
  const thin = linkedThinPart(values, choices);
  return [
    {
      type: 'linked-diagram',
      key: `${kind}-linked-diagram`,
      diagram: linkedDiagram(values, choices),
      affects: {
        [linked.generatrix]: ['A'],
        [linked.firstPlane]: ['AB', 'AC', 'B', 'C'],
        [linked.dihedral]: ['AC', 'C'],
        [axialKey]: ['AB', 'AC', 'B', 'C'],
        [alternativeKey]: ['alternative'],
        [linked.third]: ['BC'],
      },
    },
    {
      type: 'number',
      key: linked.dihedral,
      label: 'Кут між площинами',
      suffix: '°',
      range: linkedFieldRange(values, choices, 'dihedral', ANGLE_INCREMENT_DEG),
    },
    {
      type: 'number',
      key: linked.firstPlane,
      label: 'Повернути обидва перерізи',
      suffix: '°',
      range: linkedFieldRange(values, choices, 'pair', ANGLE_INCREMENT_DEG),
      describedBy: `${kind}-linked-pair-note`,
    },
    { type: 'note', key: `${kind}-linked-pair-note`, text: '0° — перший переріз проходить через вісь' },
    {
      type: 'action',
      key: axialKey,
      label: 'Перший переріз — осьовий',
      action: 'linked-axial',
      ...(linkedAxialOffered(values, choices) ? {} : { disabled: true }),
    },
    ...(linkedAlternativeOffered(values, choices)
      ? [
          {
            type: 'action' as const,
            key: alternativeKey,
            label: 'Інше положення другої площини',
            action: 'linked-alternative' as const,
          },
        ]
      : []),
    { type: 'toggle', key: linked.third, label: 'Додати третій переріз', describedBy: `${kind}-linked-third-note` },
    { type: 'note', key: `${kind}-linked-third-note`, text: 'Третя площина проходить через дві інші твірні.' },
    ...(thin === undefined
      ? []
      : [
          {
            type: 'note' as const,
            key: `${kind}-linked-thin-note`,
            tone: 'status' as const,
            text:
              `${LINKED_PART_NAMES[thin.part]} має завтовшки лише ${formatDecimal(Math.round(thin.reachMm * 100) / 100)} мм — ` +
              'її може не вдатися надрукувати. Переріз дозволено; розведіть площини або збільште модель.',
          },
        ]),
    {
      type: 'disclosure',
      key: `${kind}-linked-more`,
      label: 'Додаткові налаштування',
      fields: [
        {
          type: 'number',
          key: linked.generatrix,
          label: 'Положення спільної твірної',
          suffix: '°',
          range: linkedFieldRange(values, choices, 'generatrix', ANGLE_INCREMENT_DEG),
        },
      ],
    },
    toggle,
  ];
}

function planeSection(kind: 'cylinder' | 'cone', choices: ParameterChoices, context: PanelContext): ParameterSection {
  const keys = sectionKeys[kind] as PlanarSectionKeys | undefined;
  if (keys === undefined) throw new Error(`No section fields for ${kind}.`);
  const chosen = choices[keys.choice];
  const values = context.values ?? {};
  const leaning = kind === 'cylinder' && values.cylinderOffsetRatio !== undefined && values.cylinderOffsetRatio !== 0;
  const axisKeys = keys.axisParallel;
  const axisInterval = axisKeys === undefined ? undefined : context.sectionRanges?.[axisKeys.offset];
  const axial = chosen === 'axis-parallel' && axisKeys !== undefined && values[axisKeys.offset] === 0;
  const apexAxial = kind === 'cone' && choices.coneApexAxial;
  const coneShape =
    kind === 'cone' && values.coneHeightRatio !== undefined && values.coneOffsetRatio !== undefined
      ? ({ kind: 'cone', heightRatio: values.coneHeightRatio, offsetRatio: values.coneOffsetRatio } as const)
      : undefined;
  const apexDirection = values[coneApexKeys.direction];
  const axialAngle =
    coneShape === undefined || apexDirection === undefined ? undefined : axialApexAngles(coneShape, apexDirection).inclinationDeg;
  // A cone has one base to be parallel to.
  const namesOf = (choice: SectionChoice) =>
    kind === 'cone' && choice === 'parallel-to-bases' ? 'Паралельно основі' : sectionNames[choice];
  const selector: ChoiceField = {
    type: 'choice',
    key: keys.choice,
    label: 'Тип перерізу',
    options: (['none', 'parallel-to-bases', 'vertical', 'oblique', 'oblique-apex', 'axis-parallel', 'shared-generatrix'] as const)
      // A right cylinder's planes parallel to its axis are its vertical ones; a cone has no other. Only a cone has an apex.
      .filter((value) => value !== 'axis-parallel' || (kind === 'cylinder' && (leaning || chosen === value)))
      .filter((value) => value !== 'oblique-apex' || kind === 'cone')
      .filter((value) => value !== 'shared-generatrix' || kind === 'cylinder')
      .map((value) => ({ value, label: namesOf(value) })),
  };
  const { offset, oblique } = keys;
  const interval = context.sectionRanges?.[offset];
  const toggle: ToggleField = { type: 'toggle', key: keys.separated, label: 'Розсунути частини' };
  const noteId = `${kind}-oblique-axis-note`;
  const containsAxis = obliqueContainsAxis(kind, context.values, oblique.inclination, oblique.direction);
  const apexAngles = context.sectionRanges?.[coneApexKeys.inclination];
  const plate = keys.plate;
  const plateOn = plate !== undefined && choices[plate.toggle];
  const plateFields = plateFieldsOf(kind, keys, choices, context, chosen);
  const linked = keys.linked;
  const details: Record<SectionChoice, ParameterField[]> = {
    none: [],
    horizontal: [],
    'shared-generatrix': linked === undefined ? [] : linkedFields(kind, linked, choices, values, toggle),
    'face-parallel': [],
    longitudinal: [],
    'through-apex': [],
    'through-line': [],
    inclined: [],
    'axis-parallel':
      axisKeys === undefined
        ? []
        : [
            {
              type: 'number',
              key: axisKeys.offset,
              label: 'Зміщення від осі',
              suffix: '% r',
              range:
                axisInterval === undefined || axisInterval === null
                  ? undefined
                  : percentRange(axisInterval, SECTION_PERCENT_INCREMENT),
            },
            { type: 'number', key: axisKeys.direction, label: 'Напрям зміщення', suffix: '°', range: obliqueDirectionRange },
            {
              type: 'action',
              key: `${kind}-axial-section`,
              label: 'Осьовий переріз',
              action: 'axial-section',
              ...(axial ? { disabled: true } : {}),
            },
            toggle,
            ...plateFields,
          ],
    'parallel-to-bases': [
      {
        type: 'number',
        key: keys.position,
        label: kind === 'cone' ? 'Від основи' : 'Від нижньої основи',
        suffix: '% h',
        range: sectionPositionRange,
      },
      toggle,
      ...plateFields,
    ],
    vertical: [
      {
        type: 'number',
        key: offset,
        label: 'Зміщення від осі',
        suffix: '% r',
        range: interval === undefined || interval === null ? undefined : percentRange(interval, SECTION_PERCENT_INCREMENT),
      },
      toggle,
      ...plateFields,
    ],
    // A plane through the cone's apex, its own type: the apex stays on it whatever the cone becomes.
    'oblique-apex': [
      { type: 'toggle', key: 'coneApexAxial', label: 'Осьовий переріз' },
      // Held to the axis, the angle follows from the cone and the direction; the own angle waits for the switch to go off.
      apexAxial
        ? {
            type: 'note' as const,
            key: 'cone-apex-axial-angle',
            text:
              `Площина проходить через вершину й центр основи, кут до площини основи — ` +
              `${axialAngle === undefined ? '—' : formatDecimal(Math.round(axialAngle * 10) / 10)}°.`,
          }
        : {
            type: 'number',
            key: coneApexKeys.inclination,
            label: 'Кут до площини основи',
            suffix: '°',
            range: apexAngles === undefined || apexAngles === null ? undefined : planeAngleRange(apexAngles, ANGLE_INCREMENT_DEG),
          },
      { type: 'number', key: coneApexKeys.direction, label: 'Напрям нахилу', suffix: '°', range: obliqueDirectionRange },
      toggle,
      ...plateFields,
    ],
    oblique: [
      {
        type: 'number',
        key: oblique.position,
        label: kind === 'cone' ? 'Точка на осі від основи' : 'Точка на осі від нижньої основи',
        suffix: '% h',
        range: sectionPositionRange,
        ...(containsAxis ? { disabled: true, describedBy: noteId } : {}),
      },
      ...(containsAxis ? [{ type: 'note' as const, key: noteId, text: axisInPlaneNote(kind) }] : []),
      {
        type: 'number',
        key: oblique.inclination,
        label: 'Кут до площини основи',
        suffix: '°',
        range: obliqueInclinationRange,
      },
      { type: 'number', key: oblique.direction, label: 'Напрям нахилу', suffix: '°', range: obliqueDirectionRange },
      toggle,
      ...plateFields,
    ],
  };
  const help: Record<SectionChoice, Help | undefined> = {
    none: undefined,
    horizontal: undefined,
    'face-parallel': undefined,
    longitudinal: undefined,
    'through-apex': undefined,
    'through-line': undefined,
    inclined: undefined,
    'axis-parallel': axisParallelSectionHelp,
    'shared-generatrix': linkedSectionHelp,
    'parallel-to-bases': kind === 'cone' ? coneSectionHelp : parallelSectionHelp,
    vertical: kind === 'cone' ? coneVerticalSectionHelp : verticalSectionHelp,
    oblique: kind === 'cone' ? coneObliqueSectionHelp : obliqueSectionHelp,
    'oblique-apex': coneApexSectionHelp,
  };
  const pairable = (ROUND_PAIR_TYPES as readonly string[]).includes(chosen);
  const twoPlanes = pairable && secondCutChosen(kind, choices);
  const basicHelp = help[chosen];
  const shownHelp =
    basicHelp === undefined || !pairable ? basicHelp : { ...basicHelp, text: `${basicHelp.text}\n\n${ROUND_SECOND_CUT_HELP}` };
  // Short enough for the summary line; the cut's type is the first thing its group shows.
  const withPlate = chosen !== 'none' && plateOn && !twoPlanes;
  const fields = pairable ? withSecondPlane(kind, keys, details[chosen], twoPlanes, plateOn) : details[chosen];
  return section(`${kind}-section`, 'Переріз', [selector, ...fields], {
    help:
      withPlate && shownHelp !== undefined
        ? withPlateHelp(shownHelp, chosen === 'oblique-apex', kind === 'cylinder' ? CYLINDER_PLATE_HELP : undefined)
        : shownHelp,
    status: {
      text:
        chosen === 'none'
          ? 'немає'
          : twoPlanes
            ? 'два перерізи'
            : withPlate
              ? 'з пластиною'
              : axial || (apexAxial && chosen === 'oblique-apex')
                ? 'осьовий'
                : chosen === 'shared-generatrix'
                  ? choices[LINKED_KEYS.third]
                    ? 'три перерізи'
                    : 'два перерізи'
                  : namesOf(chosen).toLowerCase(),
      highlighted: chosen !== 'none',
    },
  });
}

const BOX_POSITION_TEXT =
  'Положення — у відсотках ширини фігури вздовж нормалі до площини: 0 % і 100 % — площини через крайні вершини з двох ' +
  'боків, 50 % — через центр фігури.';

const BOX_PARTS_TEXT =
  'Частини 1 і 2 лежать по різні боки площини, а горизонтальна площина ділить фігуру на нижню й верхню частини. Вони ' +
  'експортуються окремими об’єктами в одному масштабі; розсування змінює лише перегляд. Межі відсувають площину від ' +
  'вершин, ребер і граней, але не гарантують, що тонку частину вдасться надрукувати. Вершини позначено в перегляді.';

/** A pyramid's planes through its apex, and through an edge of its base, which are another family. */
const pyramidSectionHelps = {
  'through-apex': {
    label: 'Як задано переріз?',
    text:
      'Площина проходить через вершину S і пряму в площині основи — слід. Слід можна задати кутом до ребра AB і положенням ' +
      'поперек основи або вибрати лінію основи: діагональ, у трикутника — медіану, висоту чи бісектрису основи або середню ' +
      'лінію. Інші побудови: через бічне ребро SV і точку ребра основи; через висоту піраміди SH і бічне ребро SV, де H — ' +
      'основа висоти, тобто проєкція S на площину основи, а не обов’язково центр основи. Висота основи й висота піраміди — ' +
      'різні відрізки.\n\nПереріз через вершину й слід, що перетинає основу, — трикутник: S і два кінці сліду. Положення сліду — ' +
      'у відсотках ширини основи поперек нього; площину це не зсуває з вершини.\n\n' +
      BOX_PARTS_TEXT,
  },
  'through-line': {
    label: 'Як задано переріз?',
    text:
      'Площина проходить через вибране ребро основи, але не обов’язково через вершину S.\n\n«За кутом»: площина повертається ' +
      'навколо ребра від площини основи всередину піраміди, до бічної грані над цим ребром.\n\n«Через точку ребра»: площина ' +
      'проходить через ребро основи й точку бічного ребра. Наприклад, у SABC через AB і середину SC переріз — трикутник. Кінці ' +
      'ребра, що дають грань піраміди, а також бічні ребра з того ж кінця, не запропоновано.\n\n' +
      BOX_PARTS_TEXT,
  },
} as const satisfies Record<string, Help>;

/** The plane parallel to a face of a cube or a parallelepiped, by its face and the ratio of its distances. */
const FACE_CONSTRUCTION_HELP: Help = {
  label: 'Як задано переріз?',
  text:
    'Площина паралельна вибраній грані й лежить між нею та протилежною гранню. «Посередині» — на однаковій відстані від обох. ' +
    '«За відношенням» a : b — перше число відповідає відстані від вибраної грані до перерізу, друге — від перерізу до ' +
    'протилежної грані: 1 : 2 — третина відстані між гранями від вибраної. Протилежна грань задає ті самі площини: якщо ' +
    'вибрати її, переріз лишається на місці, а відношення читається з іншого боку, 2 : 1. У похилому паралелепіпеді ' +
    'відстані між гранями перпендикулярні до них.\n\n' +
    BOX_PARTS_TEXT,
};

// A plane parallel to a face is the face construction's, with its own help; see `FACE_CONSTRUCTION_HELP`.
const boxSectionHelps: Readonly<Record<'longitudinal' | 'through-line' | 'inclined', Help>> = {
  longitudinal: {
    label: 'Як задано переріз?',
    text:
      'Площина паралельна бічним ребрам, тож у похилої фігури вона нахилена разом із ними. Її слід на основі йде під заданим ' +
      'кутом до ребра AB (проти годинникової стрілки, якщо дивитися згори) або вздовж лінії основи: діагоналі, а в ' +
      'трикутника — медіани, висоти чи бісектриси з вершини або середньої лінії, паралельної стороні. Висоту основи ' +
      'проведено з вершини перпендикулярно до прямої протилежної сторони; це не висота призми. Переріз — паралелограм, ' +
      'у прямої фігури — прямокутник.\n\n' +
      'Вибрана лінія задає площину, що проходить через неї, і так лишається, хоч би як змінилася фігура. Якщо пересунути ' +
      'положення, площина лишається паралельною лінії, але вже не проходить через неї; «Провести через цю лінію» повертає ' +
      'її. Лінію, площина через яку лише торкається фігури, у списку не запропоновано.\n\n' +
      `${BOX_POSITION_TEXT}\n\n${BOX_PARTS_TEXT}`,
  },
  'through-line': {
    label: 'Як задано переріз?',
    text:
      'Площина проходить через вибране ребро або діагональ грані.\n\n' +
      '«За кутом»: площина повертається навколо цієї прямої від площини грані всередину фігури. 0° і 180° — сама грань, тож ' +
      'допустимі кути залежать від фігури; на початку кут стоїть посередині допустимих.\n\n' +
      '«Через точку ребра»: площина проходить через пряму й точку на іншому ребрі. Положення точки — у відсотках довжини ' +
      'ребра від першої вершини: 0 % і 100 % — вершини, «Середина ребра» ставить 50 %. Точка не може лежати на самій прямій.' +
      `\n\n${BOX_PARTS_TEXT}`,
  },
  inclined: {
    label: 'Як задано переріз?',
    text:
      'Площину задано кутом до площини основи й напрямом, куди вона піднімається: 0° — уздовж осі X, тобто ребра AB, 90° — ' +
      'уздовж осі Y. Кут 0° дає горизонтальну площину, 90° — вертикальну. Компас у перегляді показує осі.\n\n' +
      'Спосіб «Перпендикулярно ребру або діагоналі» проводить площину перпендикулярно до ребра, діагоналі грані чи діагоналі ' +
      'тіла. Наприклад, у кубі площина, перпендикулярна до діагоналі AC₁, біля вершини A дає трикутний переріз, а посередині — ' +
      'правильний шестикутник. Бічні ребра в цьому списку дають перпендикулярний переріз призми; у похилої призми він ' +
      'може перетинати й основи, тож його кутів не обов’язково стільки, скільки в основи.\n\n' +
      `${BOX_POSITION_TEXT}\n\n${BOX_PARTS_TEXT}`,
  },
};

const BOX_SECOND_CUT_HELP =
  'Другий переріз паралельний першому й задається відсотком тієї самої ширини фігури, від тієї самої точки відліку, тож ' +
  'фігура ділиться на три частини. Середня частина має бути не тоншою за десяту частину цієї ширини. Кріплення однакове на ' +
  'обох перерізах, а для середньої частини враховано обидва.';

const TRACE_ANGLE_RANGE: StepRange = { min: 0, max: 180, increment: ANGLE_INCREMENT_DEG };
const BOX_INCLINATION_RANGE: StepRange = { min: 0, max: 90, increment: ANGLE_INCREMENT_DEG };

/**
 * How a base's diagonal compares with the others of a regular base, which fall into classes by how many sides they span: a
 * hexagon's shorter and longer ones, the latter through the centre; none where all are equal, as in a pentagon.
 */
function diagonalClass(topology: PrismTopology, [first, second]: BoxSegment, centre = false): string {
  const corners = topology.faces[topology.lowerBase] ?? [];
  const apart = Math.abs(corners.indexOf(first) - corners.indexOf(second));
  const span = Math.min(apart, topology.sides - apart);
  const classes = Math.floor(topology.sides / 2) - 1;
  const through = centre && 2 * span === topology.sides ? ', через центр' : '';
  if (classes < 2) return through === '' ? '' : ` (${through.slice(2)})`;
  const names = classes === 2 ? ['коротша', 'довша'] : ['найкоротша', 'середня', 'найдовша'];
  return ` (${names[span - 2] ?? ''}${through})`;
}

/** The line of a longitudinal trace, after "через" and after "паралельна", and as an option of its kind. */
function traceTexts(selection: TraceSelection, topology: PrismTopology, regular: boolean) {
  const { kind, segment, vertex, equilateral } = selection;
  const side = segment === undefined ? '' : segmentName(segment);
  const at = vertex === undefined ? '' : vertexName(vertex);
  switch (kind) {
    case 'diagonal': {
      const suffix = regular && segment !== undefined ? diagonalClass(topology, segment, true) : '';
      return { through: `діагональ ${side}${suffix}`, parallel: `діагоналі ${side}` };
    }
    case 'median':
      return equilateral
        ? { through: `медіану з вершини ${at}, вона ж висота й бісектриса`, parallel: `медіані з вершини ${at}` }
        : { through: `медіану з вершини ${at}`, parallel: `медіані з вершини ${at}` };
    case 'height':
      return { through: `висоту основи з вершини ${at}`, parallel: `висоті основи з вершини ${at}` };
    case 'bisector':
      return { through: `бісектрису кута ${at}`, parallel: `бісектрисі кута ${at}` };
    case 'midline':
      return { through: `середню лінію, паралельну ${side}`, parallel: `середній лінії, паралельній ${side}` };
    default:
      return { through: '', parallel: '' };
  }
}

const TRACE_KIND_LABELS = {
  angle: 'Під кутом до ребра AB',
  diagonal: 'Через діагональ',
  median: 'Через медіану',
  height: 'Через висоту основи',
  bisector: 'Через бісектрису',
  midline: 'Через середню лінію',
  'edge-point': 'Через бічне ребро й точку',
  'height-edge': 'Через висоту піраміди',
} as const;

/** The median of an equilateral base, which is also its altitude and bisector; the note beside it says so. */
const EQUILATERAL_MEDIAN_LABEL = 'Через медіану (= висоту)';

/**
 * "Переріз" of a cube or parallelepiped: the mode and its own fields, a second parallel plane, and the separation. The plane's
 * fields keep their meaning whatever the solid becomes: a face, an edge or a diagonal by its letters, positions in percent of
 * the solid's own extent.
 */
/** The field of the base element a longitudinal plane runs along; see `TraceField`. */
function traceField(
  kind: BoxSolid,
  box: BoxKeysOf,
  choices: ParameterChoices,
  values: ParameterValues,
  trace: ReturnType<typeof traceSelection>,
  pyramid: boolean,
  context: PanelContext,
): TraceField {
  const open = context.construction?.field === 'trace';
  const result = ' Слід перерізу на основі показано лінією.';
  // A prism's upper base stands for the lower one under it; a pyramid has none.
  const upper = pyramid ? '' : ' (або верхньої основи над нею)';
  const target = traceTargetOf(trace.kind);
  if (target === 'side') {
    return {
      type: 'trace-construction',
      key: `${kind}-trace`,
      open,
      label: 'Паралельно стороні',
      target: 'side',
      title: trace.segment === undefined ? 'не вибрано' : segmentName(trace.segment),
      selected: trace.segment === undefined ? '' : segmentKey(trace.segment),
      options: trace.segments.map((segment) => ({ value: segmentKey(segment), label: `Стороні ${segmentName(segment)}` })),
      hint: `Клацніть сторону основи на моделі${upper}.${result}`,
      point: undefined,
      status: undefined,
    };
  }
  if (target === 'lateral') {
    const shown = (key: ParameterKey) => {
      const value = values[key];
      return value === undefined ? '' : formatDecimal(value);
    };
    const draft = context.pilotDraft;
    const edge = trace.segment;
    const mode = choices[box.TracePointMode];
    const labels = edge === undefined ? (['BM', 'MC'] as const) : ratioLabels(edge);
    const error = draft?.status === 'invalid' && draft.problem === 'ratio' ? draft.message : undefined;
    const keys = [box.TracePointRatioFirst, box.TracePointRatioSecond] as const;
    const point: TracePointField | undefined =
      trace.kind !== 'edge-point'
        ? undefined
        : {
            open: context.construction?.field === 'trace-point',
            title: pointTitle(edge, mode, [shown(keys[0]), shown(keys[1])]) ?? 'не вибрано',
            selected: edge === undefined ? '' : segmentKey(edge),
            options: trace.segments.map((segment) => ({ value: segmentKey(segment), label: `Ребро ${segmentName(segment)}` })),
            mode,
            labels,
            keys,
            error,
            invalid: keys.map((key) => error !== undefined && (values[key] === undefined || values[key] === 0)) as [
              boolean,
              boolean,
            ],
          };
    return {
      type: 'trace-construction',
      key: `${kind}-trace`,
      open,
      label: 'Бічне ребро',
      target: 'lateral',
      title: trace.vertex === undefined ? 'не вибрано' : segmentName([PYRAMID_APEX, trace.vertex]),
      selected: trace.vertex ?? '',
      options: trace.vertices.map((vertex) => ({ value: vertex, label: segmentName([PYRAMID_APEX, vertex]) })),
      hint:
        trace.kind === 'height-edge'
          ? 'Клацніть бічне ребро на моделі або його вершину в основі. Площина проходить через це ребро й висоту SH; H — ' +
            'основа висоти, а не обов’язково центр основи.'
          : 'Клацніть бічне ребро на моделі або його вершину в основі.',
      point,
      status:
        trace.kind !== 'edge-point'
          ? undefined
          : draft?.status === 'incomplete'
            ? { tone: 'hint', text: draft.message }
            : draft?.status === 'invalid' && draft.problem !== 'ratio'
              ? { tone: 'warning', text: draft.message }
              : undefined,
    };
  }
  return {
    type: 'trace-construction',
    key: `${kind}-trace`,
    open,
    label: trace.kind === 'bisector' ? 'Кут при вершині' : 'З вершини',
    target: 'vertex',
    title: trace.vertex === undefined ? 'не вибрано' : vertexName(trace.vertex),
    selected: trace.vertex ?? '',
    options: trace.vertices.map((vertex) => ({ value: vertex, label: vertexName(vertex) })),
    hint: `Клацніть вершину основи на моделі${upper}.${result}`,
    point: undefined,
    status: undefined,
  };
}

/** The field of the pair of opposite edges an inclined plane is parallel to; see `PairField`. */
function pairField(kind: BoxSolid, pair: 'none' | PairKey, pairs: readonly PairKey[], context: PanelContext): PairField {
  const name = (key: PairKey) => pairOf(key).map(segmentName).join(' і ');
  return {
    type: 'pair-construction',
    key: `${kind}-pair`,
    open: context.construction?.field === 'pair',
    title: pair === 'none' ? 'не вибрано' : name(pair),
    selected: pair === 'none' ? '' : pair,
    options: pairs.map((key) => ({ value: key, label: name(key) })),
  };
}

/** The field of the segment an inclined plane is perpendicular to; see `NormalField`. */
function normalField(
  kind: BoxSolid,
  box: BoxKeysOf,
  choices: ParameterChoices,
  topology: PrismTopology,
  context: PanelContext,
): NormalField {
  const entries = normalEntries(topology);
  const along = choices[box.NormalAlong];
  const chosen = along === 'none' ? undefined : entries.find(({ key }) => key === along);
  return {
    type: 'normal-construction',
    key: `${kind}-normal`,
    open: context.construction?.field === 'normal',
    title: chosen === undefined ? 'не вибрано' : chosen.kind === 'lateral' ? 'бічні ребра' : entryName(chosen),
    chosen: chosen === undefined ? undefined : `${entryName(chosen)} — ${entryKindName(chosen)}`,
    selected: chosen?.key ?? '',
    options: entries.map((entry) => ({ value: entry.key, label: entryName(entry), group: entryGroup(entry) })),
    pending: context.construction?.pending === undefined ? undefined : vertexName(context.construction.pending),
  };
}

/** The face construction's field from the choices in effect; see `FaceConstructionField`. */
function faceConstructionField(
  kind: BoxSolid,
  box: BoxKeysOf,
  choices: ParameterChoices,
  solid: BoxContext,
  values: ParameterValues,
  context: PanelContext,
  twoPlanes: boolean,
): FaceConstructionField {
  const { topology } = solid;
  const face = choices[box.Face];
  const labels = distanceLabels(solid, face);
  const draft = context.pilotDraft;
  const shown = (key: ParameterKey) => {
    const value = values[key];
    return value === undefined ? '' : formatDecimal(value);
  };
  const position = (which: Placement): FacePositionField => {
    const keys = placementKeys(box, which);
    const mode = choices[keys.mode];
    const error = draft?.status === 'invalid' && (draft.position ?? 'first') === which ? draft.message : undefined;
    // A number that is not valid or puts the plane on a face, or both numbers where they are zeros.
    const flagged = (key: ParameterKey) =>
      error !== undefined &&
      mode === 'ratio' &&
      draft?.status === 'invalid' &&
      draft.problem !== 'thin' &&
      (values[key] === undefined || values[key] === 0);
    return {
      which,
      field: which === 'first' ? 'position' : 'second-position',
      label: which === 'first' ? 'Положення' : 'Другий переріз',
      tone: twoPlanes ? (which === 'first' ? 0 : 1) : undefined,
      title: positionTitle(mode, [shown(keys.first), shown(keys.second)]),
      mode,
      labels,
      keys: [keys.first, keys.second],
      error,
      invalid: [flagged(keys.first), flagged(keys.second)],
    };
  };
  return {
    type: 'face-construction',
    key: `${kind}-face-construction`,
    open: context.construction?.field,
    face: {
      title: faceName(topology, face),
      opposite: farSideOf(solid, face).name,
      oppositeEdge: farSideOf(solid, face).edge,
      oppositeVertex: farSideOf(solid, face).vertex,
      selected: facePairOf(solid, face),
      // A pair of parallel faces under one name, a face with none, as a triangular or a pentagonal prism's lateral face, alone.
      options: faceOrientations(solid).map((orientation) => ({
        value: orientation.face,
        label:
          orientation.opposite === undefined
            ? faceName(topology, orientation.face)
            : `${faceName(topology, orientation.face)} ∥ ${faceName(topology, orientation.opposite)}`,
      })),
    },
    positions: twoPlanes ? [position('first'), position('second')] : [position('first')],
  };
}

/** Why a second plane, the parts set apart and their download wait while the pilot's construction gives no section. */
const CONSTRUCTION_BLOCKED_NOTE =
  'Паралельний переріз, розсування частин і завантаження стануть доступні, щойно побудова дасть переріз.';

/** The pilot's construction field from the choices in effect; see `ThroughPointField`. */
function throughPointField(
  kind: BoxSolid,
  box: BoxKeysOf,
  choices: ParameterChoices,
  solid: BoxContext,
  values: ParameterValues,
  context: PanelContext,
): ThroughPointField {
  const selection = throughPointSelection(box, choices as unknown as BoxChoices, solid);
  const { segment, pointEdge, mode } = selection;
  const labels = pointEdge === undefined ? undefined : ratioLabels(pointEdge);
  const draft = context.pilotDraft;
  const ratioError = draft?.status === 'invalid' && draft.problem === 'ratio' ? draft.message : undefined;
  // A number that is not valid, or both numbers where they are zeros.
  const ratioInvalid = [box.PointRatioFirst, box.PointRatioSecond].map(
    (key) => ratioError !== undefined && (values[key] === undefined || values[key] === 0),
  ) as [boolean, boolean];
  // An edge chosen earlier that gives no section with this segment stays chosen and named, though not offered.
  const ineligible =
    pointEdge === undefined || selection.pointEdgeEligible
      ? []
      : [
          {
            value: segmentKey(pointEdge),
            label: `Ребро ${segmentName(pointEdge)} — не дає перерізу`,
            disabled: true,
          },
        ];
  const ratioField = (key: ParameterKey, label: string): NumericField => ({
    type: 'number',
    key,
    label,
    suffix: '',
    range: { min: 0, max: 100, increment: 1 },
  });
  const texts = (key: ParameterKey) => {
    const value = values[key];
    return value === undefined ? '' : formatDecimal(value);
  };
  const method = choices[box.LineMethod];
  const angleError = draft?.status === 'invalid' && draft.problem === 'angle' ? draft.message : undefined;
  const face = segment === undefined ? undefined : referenceFaceOf(solid.topology, segment, choices[box.LineFace]);
  const angle: AngleField | undefined =
    method !== 'angle' || segment === undefined || face === undefined
      ? undefined
      : {
          title: angleTitle(solid.topology, face),
          value: values[box.LineDihedralDeg] === undefined ? '…' : `${texts(box.LineDihedralDeg)}°`,
          face,
          faces: referenceFaces(solid.topology, segment).map((option) => ({
            value: option,
            label: faceName(solid.topology, option),
          })),
          field: {
            type: 'number',
            key: box.LineDihedralDeg,
            label: angleTitle(solid.topology, face),
            suffix: '°',
            range: { min: 0, max: 90, increment: 1 },
          },
          error: angleError,
          alternative: draft !== undefined && 'alternative' in draft && draft.alternative === true,
          switching: context.construction?.switching === true,
        };
  return {
    type: 'through-point',
    key: `${kind}-through-point`,
    method,
    methods: (['point', 'angle'] as const).map((value) => ({
      value,
      label: value === 'angle' ? 'За кутом' : 'Через точку ребра',
    })),
    angle,
    open: context.construction?.field,
    segment: {
      baseEdge: solid.topology.kind === 'pyramid',
      title: segmentTitle(segment),
      selected: segment === undefined ? '' : segmentKey(segment),
      options: selection.segments.map((option) => ({ value: segmentKey(option.segment), label: segmentOptionLabel(option) })),
      pending: context.construction?.pending === undefined ? undefined : vertexName(context.construction.pending),
    },
    point: {
      title: pointTitle(pointEdge, mode, [texts(box.PointRatioFirst), texts(box.PointRatioSecond)]),
      selected: pointEdge === undefined ? '' : segmentKey(pointEdge),
      options: [
        ...selection.pointEdges.map((edge) => ({ value: segmentKey(edge), label: `Ребро ${segmentName(edge)}` })),
        ...ineligible,
      ],
      mode,
      labels,
      fields: [
        ratioField(box.PointRatioFirst, labels?.[0] ?? 'Перша частина'),
        ratioField(box.PointRatioSecond, labels?.[1] ?? 'Друга частина'),
      ],
      ratioError,
      ratioInvalid,
    },
    status:
      draft?.status === 'incomplete'
        ? { tone: 'hint', text: draft.message }
        : draft?.status === 'invalid' && draft.problem !== 'ratio' && draft.problem !== 'angle'
          ? { tone: 'warning', text: draft.message }
          : undefined,
    notice: context.construction?.notice,
  };
}

function boxPlaneSection(kind: BoxSolid, choices: ParameterChoices, context: PanelContext): ParameterSection {
  const keys = sectionKeys[kind];
  const box = keys?.box;
  const second = keys?.secondCut;
  if (keys === undefined || box === undefined || second === undefined) throw new Error(`No section fields for ${kind}.`);
  const chosen = choices[keys.choice];
  const values = context.values ?? {};
  const twoPlanes = choices[second.toggle];
  // The pilot's construction that gives no section yet: what needs its section waits.
  const facePilot = chosen === 'face-parallel' && facePilotActive(box, choices as unknown as BoxChoices);
  const drafting =
    (chosen === 'through-line' || facePilot) &&
    (context.pilotDraft?.status === 'incomplete' || context.pilotDraft?.status === 'invalid');
  const rangeOf = (key: ParameterKey, fallback: StepRange, increment = SECTION_PERCENT_INCREMENT): StepRange | undefined => {
    const interval = context.sectionRanges?.[key];
    if (interval === undefined) return fallback;
    return interval === null ? undefined : planeAngleRange(interval, increment);
  };
  const percentField = (key: ParameterKey, label: string): NumericField => ({
    type: 'number',
    key,
    label,
    suffix: '%',
    range: rangeOf(key, sectionPositionRange),
  });
  const note = (key: string, text: string): NoteField => ({ type: 'note', key: `${kind}-${key}`, text });
  const action = (key: string, label: string, panelAction: PanelAction, disabled = false): ActionField => ({
    type: 'action',
    key: `${kind}-${key}`,
    label,
    action: panelAction,
    ...(disabled ? { disabled: true } : {}),
  });
  const position = (label: string) =>
    percentField(
      box.SectionPercent,
      twoPlanes ? `Перший переріз: ${label}` : `${label.charAt(0).toUpperCase()}${label.slice(1)}`,
    );
  // A range not yet known allows everything; null, nothing.
  const allows = (interval: { readonly min: number; readonly max: number } | null | undefined, value: number) =>
    interval === undefined || (interval !== null && value >= interval.min && value <= interval.max);
  // Only the choices that lead to a usable plane of this solid are offered, each list given those before it.
  const solid = boxContextFrom(kind, values, choices);
  const { topology } = solid;
  const trace = traceSelection(box, choices, solid);
  const traceText = traceTexts(trace, topology, solid.regular);
  const through = trace.kind !== 'angle' && choices[box.TraceThrough];
  const along = normalSelection(box, choices, solid);
  const families = diagonalFamilies(trace.segments, topology.kind !== 'pyramid');
  const diagonal = trace.segment === undefined ? undefined : familyOf(families, trace.segment);
  // Every box solid's trace is picked in a construction's own field, with its named list: a base diagonal, a base vertex or side,
  // or a pyramid's lateral edge; a trace at an angle to AB is the one given by a number.
  const traceReference: ParameterField[] =
    trace.kind === 'diagonal'
      ? diagonal === undefined
        ? []
        : [
            {
              type: 'diagonal-construction',
              key: `${kind}-diagonal`,
              open: context.construction?.field === 'diagonal',
              title: segmentName(diagonal.lower),
              selected: diagonal.key,
              // A regular base's diagonals by their lengths too: a hexagon's AC is shorter than AD, which passes through the centre.
              options: families.map((family) => ({
                value: family.key,
                label: `${familyLabel(family)}${solid.regular ? diagonalClass(topology, family.lower, true).replace(/^ \((.*)\)$/, ' — $1') : ''}`,
              })),
              pending: context.construction?.pending === undefined ? undefined : vertexName(context.construction.pending),
              notice: context.construction?.notice,
              pyramid: topology.kind === 'pyramid',
            },
          ]
      : traceTargetOf(trace.kind) !== undefined
        ? [traceField(kind, box, choices, values, trace, topology.kind === 'pyramid', context)]
        : [{ type: 'number', key: box.TraceAngleDeg, label: 'Кут сліду до AB', suffix: '°', range: TRACE_ANGLE_RANGE }];
  const throughVertex = trace.kind === 'median' || trace.kind === 'height' || trace.kind === 'bisector';
  const sameNote: ParameterField[] = !throughVertex
    ? []
    : trace.equilateral && trace.kind === 'median'
      ? [
          note(
            'trace-equilateral',
            'В основі рівносторонній трикутник: медіана, висота й бісектриса з однієї вершини збігаються.',
          ),
        ]
      : trace.vertex !== undefined && trace.sameLines.length === 3
        ? [
            note(
              'trace-same',
              `З вершини ${vertexName(trace.vertex)} медіана, висота й бісектриса збігаються: трикутник рівнобедрений.`,
            ),
          ]
        : [];
  const pyramid = topology.kind === 'pyramid';
  const pair = pairSelection(box, choices, solid);
  const pairs = oppositeEdgePairs(topology);
  const constrained = along !== 'none' || pair !== 'none';
  const pairName = (key: PairKey) => pairOf(key).map(segmentName).join(' і ');
  const footPercent = heightFootPercent(kind, choices, values);
  const modeFields: Record<'face-parallel' | 'longitudinal' | 'through-apex' | 'through-line' | 'inclined', ParameterField[]> = {
    'through-apex': [
      {
        type: 'choice',
        key: box.Trace,
        label: 'Слід на основі',
        options: trace.kinds.map((kindOption) => ({
          value: kindOption,
          label: kindOption === 'median' && trace.equilateral ? EQUILATERAL_MEDIAN_LABEL : TRACE_KIND_LABELS[kindOption],
        })),
      },
      ...traceReference,
      ...sameNote,
      ...(trace.kind === 'angle'
        ? [
            percentField(box.SectionPercent, twoPlanes ? 'Перший переріз: слід' : 'Положення сліду'),
            note('apex-angle', 'Слід перетинає основу; площина завжди проходить через вершину S.'),
          ]
        : [
            note(
              'apex-through',
              trace.kind === 'edge-point' && trace.vertex !== undefined && trace.segment !== undefined
                ? `Площина проходить через бічне ребро ${segmentName([PYRAMID_APEX, trace.vertex])} і точку ребра ${segmentName(trace.segment)}.`
                : trace.kind === 'height-edge' && trace.vertex !== undefined
                  ? `Площина проходить через висоту піраміди SH і бічне ребро ${segmentName([PYRAMID_APEX, trace.vertex])}; ` +
                    'H — основа висоти, а не обов’язково центр основи.'
                  : trace.kind === 'diagonal' && trace.segment !== undefined
                    ? `Діагональний переріз: площина проходить через вершину S і діагональ ${traceText.through.replace('діагональ ', '')}.`
                    : `Площина проходить через вершину S і ${traceText.through}.`,
            ),
          ]),
    ],
    'face-parallel': [faceConstructionField(kind, box, choices, solid, values, context, twoPlanes)],
    longitudinal: [
      {
        type: 'choice',
        key: box.Trace,
        label: 'Слід на основі',
        options: trace.kinds.map((kindOption) => ({
          value: kindOption,
          label: kindOption === 'median' && trace.equilateral ? EQUILATERAL_MEDIAN_LABEL : TRACE_KIND_LABELS[kindOption],
        })),
      },
      ...traceReference,
      ...sameNote,
      position('положення'),
      ...(trace.kind === 'angle'
        ? []
        : through
          ? [
              note(
                'trace-through',
                trace.kind === 'diagonal' && trace.segment !== undefined
                  ? `Діагональний переріз: площина проходить через ${traceText.through} і бічні ребра ` +
                      `${segmentName([trace.segment[0], `${trace.segment[0]}1` as BoxVertex])} та ` +
                      `${segmentName([trace.segment[1], `${trace.segment[1]}1` as BoxVertex])}.`
                  : `Площина проходить через ${traceText.through} і паралельна бічним ребрам.`,
              ),
            ]
          : [
              note(
                'trace-parallel',
                trace.kind === 'diagonal' && trace.segment !== undefined
                  ? `Площина паралельна діагональному перерізу через ${segmentName(trace.segment)}, але не проходить через ` +
                      'діагональ.'
                  : `Площина паралельна ${traceText.parallel}, але не проходить через неї.`,
              ),
              action('trace-through', 'Провести через цю лінію', 'trace-through'),
            ]),
    ],
    // A plane through a segment, by a point or at an angle, is built in one construction, whose way is chosen within it, so that
    // the segment and the plane go with the change; a pyramid's segment is an edge of its base.
    'through-line': [throughPointField(kind, box, choices, solid, values, context)],
    inclined: [
      ...(!constrained
        ? [
            {
              type: 'number' as const,
              key: box.PlaneInclinationDeg,
              label: 'Кут до площини основи',
              suffix: '°',
              range: BOX_INCLINATION_RANGE,
            },
            {
              type: 'number' as const,
              key: box.PlaneDirectionDeg,
              label: 'Напрям нахилу',
              suffix: '°',
              range: obliqueDirectionRange,
            },
          ]
        : [
            note(
              'normal-along-note',
              pair !== 'none'
                ? `Площина паралельна ребрам ${pairName(pair)}, але не обов’язково проходить через них.`
                : along === 'A-A1' && !pyramid
                  ? 'Площина перпендикулярна до бічних ребер.'
                  : `Площина перпендикулярна до відрізка ${segmentName(segmentOf(along as SegmentKey))}: він задає лише ` +
                    'напрям, а положення площини — поле нижче, тож сам відрізок вона може й не перетинати.',
            ),
          ]),
      position('положення'),
      ...(pair !== 'none' && footPercent !== undefined && allows(context.sectionRanges?.[box.SectionPercent], footPercent)
        ? [
            action(
              'height-foot',
              'Через основу висоти',
              'height-foot',
              values[box.SectionPercent] !== undefined && Math.abs((values[box.SectionPercent] as number) - footPercent) < 1e-6,
            ),
          ]
        : []),
      // Out of a plane perpendicular to a segment or parallel to two edges by its angles, which start where the plane is; into
      // a plane perpendicular to a prism's lateral edges, which are all parallel, a pyramid's are not.
      ...(constrained ? [action('normal-manual', 'Змінити нахил', 'normal-manual')] : []),
      // A triangular pyramid's pair of opposite edges, picked on the model or by name; another solid has no such pairs.
      ...(pairs.length === 0 ? [] : [pairField(kind, pair, pairs, context)]),
      // The segment the plane is perpendicular to, picked on the model or by name: a prism's lateral edges among them, AA₁
      // standing for them all.
      normalField(kind, box, choices, topology, context),
    ],
  };
  const isMode = (value: SectionChoice): value is keyof typeof modeFields => Object.hasOwn(modeFields, value);
  const planes: ParameterField[] = !isMode(chosen)
    ? []
    : [
        ...(twoPlanes && !facePilot
          ? [{ type: 'section-mark' as const, key: `${kind}-first-section`, label: 'Перший переріз', tone: 0 as const }]
          : []),
        ...modeFields[chosen],
        ...(drafting ? [note('construction-blocked', CONSTRUCTION_BLOCKED_NOTE)] : []),
        ...(twoPlanes
          ? [
              // The face construction shows its second plane's position among its own fields.
              ...(facePilot ? [] : [{ ...percentField(second.offset, 'Другий переріз: положення'), sectionTone: 1 as const }]),
              ...(chosen === 'through-line'
                ? [note('second-from', 'Відсотки — тієї самої ширини фігури, що й для першого перерізу.')]
                : []),
              action('remove-second-cut', 'Прибрати другий переріз', 'remove-second-cut'),
            ]
          : [action('add-second-cut', 'Додати паралельний переріз', 'add-second-cut', drafting)]),
        {
          type: 'toggle',
          key: keys.separated,
          label: 'Розсунути частини',
          ...(drafting ? { disabled: true, describedBy: `${kind}-construction-blocked` } : {}),
        },
      ];
  const help = !isMode(chosen)
    ? undefined
    : chosen === 'through-apex' || (pyramid && chosen === 'through-line')
      ? pyramidSectionHelps[chosen]
      : chosen === 'face-parallel'
        ? FACE_CONSTRUCTION_HELP
        : boxSectionHelps[chosen];
  return section(
    `${kind}-section`,
    'Переріз',
    [
      {
        type: 'choice',
        key: keys.choice,
        label: 'Тип перерізу',
        options: (['none', ...(SECTIONS_BY_SHAPE[kind] ?? [])] as SectionChoice[]).map((value) => ({
          value,
          label: value === 'through-line' && pyramid ? 'Через ребро основи' : sectionNames[value],
        })),
      },
      ...planes,
    ],
    {
      help: help === undefined ? undefined : twoPlanes ? { ...help, text: `${help.text}\n\n${BOX_SECOND_CUT_HELP}` } : help,
      status: {
        text:
          chosen === 'none'
            ? 'немає'
            : twoPlanes
              ? 'два перерізи'
              : chosen === 'longitudinal' && trace.kind === 'diagonal' && through
                ? 'діагональний'
                : sectionNames[chosen].toLowerCase(),
        highlighted: chosen !== 'none',
      },
    },
  );
}

/** A cube's or parallelepiped's section and connector groups. */
const boxSections = (kind: BoxSolid, choices: ParameterChoices, context: PanelContext): ParameterSection[] => [
  boxPlaneSection(kind, choices, context),
  ...connectorSection(kind, choices, context),
];

/** The angle of a prism's or parallelepiped's lateral edges, all parallel to AA₁, with the plane of its base. */
const LATERAL_EDGE_ANGLE_LABEL = 'Кут між AA₁ і основою';

/**
 * The height of a prism or parallelepiped: "Висота AA₁" while the solid is right, as AA₁ is then its altitude; "Висота" once it
 * leans or while its displacement is not valid, as AA₁ is then a slanted lateral edge, longer than the height.
 */
function heightField(solid: 'prism' | 'parallelepiped', { values = {} }: PanelContext): NumericField {
  const { height, offsets } = tiltKeys[solid];
  const right = offsets.every((key) => values[key] === 0);
  return ratioField(height, right ? 'Висота AA₁' : 'Висота');
}

/** The sidebar of the selected shape; for a prism or pyramid, only the selected base type's fields. */
export function shapePanel(kind: ShapeKind, choices: ParameterChoices, context: PanelContext = {}): ShapePanel {
  switch (kind) {
    case 'cube':
      return { type: 'parameters', note: fixedNotes.cube, sections: boxSections(kind, choices, context) };
    case 'tetrahedron':
      return { type: 'parameters', note: fixedNotes.tetrahedron, sections: boxSections(kind, choices, context) };
    case 'octahedron':
    case 'icosahedron':
    case 'dodecahedron':
      return { type: 'fixed', note: fixedNotes[kind] };
    case 'ball':
      return {
        type: 'parameters',
        note: BALL_NOTE,
        sections: [ballPlaneSection(choices, context), ...connectorSection(kind, choices, context)],
      };
    case 'cuboid':
      return {
        type: 'parameters',
        help: referenceHelp('AB', 'AB — довжина; ширину AD і висоту AA₁ задано відносно неї.'),
        sections: [
          section('cuboid-size', 'Розміри', [
            ratioField('cuboidWidthRatio', 'Ширина AD'),
            // Always right: its lateral edge is its height.
            ratioField('cuboidHeightRatio', 'Висота AA₁'),
          ]),
          ...boxSections(kind, choices, context),
        ],
      };
    case 'parallelepiped':
      return {
        type: 'parameters',
        help: referenceHelp('AB', sideAMeaning),
        sections: [
          section(
            'parallelepiped-base',
            'Основа',
            twoSidesAndAngle(['parallelepipedBaseSideRatio', 'parallelepipedBaseAngleDeg'], PARALLELOGRAM_NAMES),
            {
              help: parallelogramHelp,
            },
          ),
          section('parallelepiped-height', 'Висота', [heightField('parallelepiped', context)], {
            help: prismHeightHelp('паралелепіпеда'),
          }),
          tiltSection(
            'parallelepiped',
            'parallelepiped-tilt',
            {
              title: 'Нахил',
              inclinationLabel: LATERAL_EDGE_ANGLE_LABEL,
              offsetFields: offsetFields(['parallelepipedOffsetXRatio', 'parallelepipedOffsetYRatio']),
              offsetHelp: shiftHelp,
              angleHelp: edgeAngleHelp,
              resetLabel: 'Прибрати нахил',
              status: { centred: 'прямий', moved: 'похилий' },
            },
            context,
          ),
          ...boxSections(kind, choices, context),
        ],
      };
    case 'prism':
      return {
        type: 'parameters',
        help: referenceHelp('AB', sideAMeaning),
        sections: [
          baseSection('prism', prismBaseKeys, choices.prismBaseType),
          section('prism-height', 'Висота', [heightField('prism', context)], { help: prismHeightHelp('призми') }),
          tiltSection(
            'prism',
            'prism-tilt',
            {
              title: 'Нахил',
              inclinationLabel: LATERAL_EDGE_ANGLE_LABEL,
              offsetFields: offsetFields(['prismOffsetXRatio', 'prismOffsetYRatio']),
              offsetHelp: shiftHelp,
              angleHelp: edgeAngleHelp,
              resetLabel: 'Прибрати нахил',
              status: { centred: 'пряма', moved: 'похила' },
            },
            context,
          ),
          ...boxSections(kind, choices, context),
        ],
      };
    case 'pyramid':
      return {
        type: 'parameters',
        help: referenceHelp('AB', sideAMeaning),
        sections: [
          baseSection('pyramid', pyramidBaseKeys, choices.pyramidBaseType),
          // The foot of the altitude from S is not a named point, and a lateral edge such as SA is not the height.
          section('pyramid-height', 'Висота', [ratioField('pyramidHeightRatio', 'Висота')], { help: pyramidHeightHelp }),
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
          ...boxSections(kind, choices, context),
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
          planeSection(kind, choices, context),
          ...connectorSection(kind, choices, context),
        ],
      };
    }
  }
}

/** The numeric fields of a section in display order, including those inside groups. */
export function sectionNumberFields(target: ParameterSection): NumericField[] {
  return target.fields.flatMap((field): readonly NumericField[] =>
    field.type === 'number'
      ? [field]
      : field.type === 'tilt' || field.type === 'trapezoid'
        ? field.fields
        : field.type === 'through-point'
          ? field.point.fields
          : field.type === 'disclosure'
            ? field.fields.filter((inner): inner is NumericField => inner.type === 'number')
            : [],
  );
}
