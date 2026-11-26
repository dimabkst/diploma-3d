<script lang="ts">
import { THREE_MF_MEDIA_TYPE } from '@diploma-3d/engine';
import type { BoxVertex, ShapeKind } from '@diploma-3d/schema';
import { untrack } from 'svelte';
import AppHeader from './lib/components/AppHeader.svelte';
import Button from './lib/components/Button.svelte';
import ControlsPanel from './lib/components/ControlsPanel.svelte';
import NumberField from './lib/components/NumberField.svelte';
import PreviewPanel from './lib/components/PreviewPanel.svelte';
import Select from './lib/components/Select.svelte';
import { saveFile } from './lib/download.ts';
import { angleConstructionDraftOf, anglePilotActive, referenceFaceOf, referenceFaces } from './lib/model/angleConstruction.ts';
import {
  type BoxSolid,
  boxContextFrom,
  boxKeysOf,
  boxTopologyFor,
  isBoxSolid,
  segmentKey,
  segmentOf,
  traceSelection,
  vertexName,
} from './lib/model/box.ts';
import { buildModel } from './lib/model/buildModel.ts';
import { type ConnectorScale, connectorScaleOf } from './lib/model/connectorScale.ts';
import {
  diagonalFamilies,
  diagonalPartners,
  diagonalPilotActive,
  diagonalsThrough,
  familyOf,
} from './lib/model/diagonalConstruction.ts';
import { faceConstructionDraftOf, facePilotActive } from './lib/model/faceConstruction.ts';
import { describeModelError, type ModelState, visibleArtifacts } from './lib/model/modelState.ts';
import { normalEntries, normalPilotActive } from './lib/model/normalConstruction.ts';
import {
  activeConnector,
  activeSection,
  addSecondCut,
  angleSideRefusal,
  applyPilotChoice,
  axialAxisParallel,
  type ConnectorEdits,
  canResetShapeParameters,
  commitConnectorEdit,
  followNormal,
  followTrace,
  initialParameterChoices,
  initialParameterTexts,
  LINKED_TEXT_KEYS,
  linkedAxial,
  magnetAllowancesChanged,
  normalAlongManual,
  type ParameterExact,
  type ParameterKey,
  type ParameterState,
  type PilotChoice,
  PLATE_TWIST_NOTICE,
  partsSeparated,
  plateChosen,
  plateConnectorFallback,
  pointAtMidpoint,
  removeSecondCut,
  resetMagnetAllowances,
  resetShapeParameters,
  resolveModelRequest,
  type SectionRanges,
  secondCutChosen,
  sectionKeys,
  settleBoxChoices,
  startApexSection,
  startLineAngle,
  startLinkedSection,
  startPoint,
  startTracePoint,
  switchLinkedAlternative,
  switchTiltMode,
  throughHeightFoot,
  tracePointAtMidpoint,
  traceThrough,
} from './lib/model/parameters.ts';
import { loadPrintSizeText, savePrintSize } from './lib/model/printSize.ts';
import {
  type ConstructionDraft,
  type ConstructionField,
  type ConstructionPick,
  canonicalSegment,
  constructionDraftOf,
  constructionTargets,
  eligibleSecondVertices,
  isConstructionSolid,
  type ThroughPointSelection,
  throughPointSelection,
} from './lib/model/throughPoint.ts';
import { initialTiltModes, type TiltMode, type TiltSolid } from './lib/model/tilt.ts';
import { tracePilotActive, traceTargetOf } from './lib/model/traceConstruction.ts';
import {
  isAvailableShape,
  type PanelAction,
  previewHighlightOf,
  printSizeField,
  sectionNumberFields,
  shapeLabel,
  shapeOptions,
  shapePanel,
} from './lib/shapes.ts';

// Parameter edits are coalesced briefly so that typing "1,75" does not rebuild the model for every keystroke.
const EDIT_DEBOUNCE_MS = 150;

let selectedShape = $state<string>('cube');
// The print size is the only setting remembered between visits.
let parameterTexts = $state({ ...initialParameterTexts(), ...withStoredPrintSize() });
let parameterChoices = $state(initialParameterChoices());
// Replaced as a whole, never mutated: the exact values behind converted texts and each solid's tilt input mode.
let parameterExact = $state.raw<ParameterExact>({});
let tiltModes = $state.raw(initialTiltModes());
let connectorEdits = $state.raw<ConnectorEdits>({});
let attempt = $state(0);
// Raw state: the artifacts hold large typed arrays that must not be wrapped in deep reactive proxies.
let model = $state.raw<ModelState>({ status: 'generating', stale: undefined });
let controls = $state<ControlsPanel>();
// Why the page replaced a connector, such as on turning a section plate on; cleared once it no longer applies.
let plateNotice = $state<string | undefined>();
// The control hovered or focused in the panel, whose effect the preview shows stronger.
let activeField = $state<string>();
/**
 * The pilot's construction as the page has it, apart from the parameters: the field open, whose elements a tap on the model
 * chooses; a first vertex picked; why the last tap chose nothing.
 */
let construction = $state.raw<{
  readonly field: ConstructionField | undefined;
  readonly pending: BoxVertex | undefined;
  readonly notice: string | undefined;
}>({ field: undefined, pending: undefined, notice: undefined });
// A switch to the other plane at the angle waiting for its model, with the state to restore if it cannot be built.
let angleSwitch = $state.raw<{ readonly key: string | undefined; readonly previous: ParameterState }>();
// The section's field the user changed last, where a problem that any of them could cause is said.
let editedField = $state<ParameterKey>();
let seenLinkedTexts: Partial<Record<ParameterKey, string>> = {};
$effect.pre(() => {
  for (const key of LINKED_TEXT_KEYS) {
    const text = parameterTexts[key];
    if (seenLinkedTexts[key] !== undefined && seenLinkedTexts[key] !== text) editedField = key;
    seenLinkedTexts = { ...seenLinkedTexts, [key]: text };
  }
});

const selectedKind = $derived(isAvailableShape(selectedShape) ? selectedShape : undefined);
const selectedShapeName = $derived(shapeLabel(selectedShape));
const parameterState = $derived<ParameterState>({
  texts: parameterTexts,
  choices: parameterChoices,
  exact: parameterExact,
  tiltModes,
  connectorEdits,
});
// The last valid scale of each solid with connectors, so that its settings stay in millimetres while the print size or
// the solid is being corrected.
let lastConnectorScales = $state.raw<Partial<Record<ShapeKind, ConnectorScale>>>({});
const lastConnectorScale = $derived(selectedKind === undefined ? undefined : lastConnectorScales[selectedKind]);
const request = $derived(
  selectedKind === undefined
    ? undefined
    : resolveModelRequest(selectedKind, parameterTexts, parameterChoices, {
        exact: parameterExact,
        tiltModes,
        connectorScale: lastConnectorScale,
        connectorEdits,
        edited: editedField,
      }),
);
const connectorScale = $derived(
  selectedKind === undefined
    ? undefined
    : (connectorScaleOf(selectedKind, request?.values ?? {}, lastConnectorScale, parameterChoices) ?? lastConnectorScale),
);
$effect.pre(() => {
  if (selectedKind === undefined) return;
  // Only a different scale is stored: the request reads it, so storing an equal copy would recompute it in a loop.
  const last = untrack(() => lastConnectorScales[selectedKind]);
  const current = connectorScaleOf(selectedKind, request?.values ?? {}, last, parameterChoices);
  if (
    current !== undefined &&
    (current.longestDimensionMm !== last?.longestDimensionMm ||
      current.radiusMm !== last?.radiusMm ||
      current.heightMm !== last?.heightMm ||
      current.obliqueSpanMm !== last?.obliqueSpanMm ||
      current.parallelSpanMm !== last?.parallelSpanMm ||
      current.verticalSpanMm !== last?.verticalSpanMm ||
      current.apexSpanMm !== last?.apexSpanMm ||
      current.horizontalSpanMm !== last?.horizontalSpanMm ||
      current.axisSpanMm !== last?.axisSpanMm ||
      current.boxSpanMm !== last?.boxSpanMm)
  ) {
    lastConnectorScales = { ...untrack(() => lastConnectorScales), [selectedKind]: current };
  }
});
// The last feasible ranges of the chosen cut and connector, so that their sliders keep their ranges while one of their
// fields is being typed; ranges of another cut, connector or count are never shown.
let lastSectionRanges = $state.raw<{ readonly context: string; readonly ranges: SectionRanges } | undefined>();
const connectorContext = $derived(
  selectedKind === undefined
    ? ''
    : [
        selectedKind,
        activeSection(selectedKind, parameterChoices) ?? 'none',
        activeConnector(selectedKind, parameterChoices) ?? 'none',
        parameterChoices[sectionKeys[selectedKind]?.round.count ?? 'cylinderRoundCount'],
        parameterChoices[sectionKeys[selectedKind]?.round.profile ?? 'cylinderRoundProfile'],
        parameterChoices[sectionKeys[selectedKind]?.dovetailEntrance ?? 'cylinderDovetailEntrance'],
        plateChosen(selectedKind, parameterChoices) ? 'plate' : 'no-plate',
      ].join(':'),
);
$effect.pre(() => {
  const ranges = request?.sectionRanges;
  if (ranges === undefined) return;
  // Merged, not replaced; the request reads no ranges, so this cannot loop.
  const previous = untrack(() => lastSectionRanges);
  const kept = previous?.context === connectorContext ? previous.ranges : undefined;
  lastSectionRanges = { context: connectorContext, ranges: { ...kept, ...ranges } };
});
// A plane beyond its limit has no connector ranges of its own, so the last ones stay until it is corrected.
const sectionRanges = $derived.by(() => {
  const last = lastSectionRanges?.context === connectorContext ? lastSectionRanges.ranges : undefined;
  return { ...last, ...request?.sectionRanges };
});
// Texts that denote the same specification ("1,5" and "1.50") share a key and do not trigger a rebuild.
const requestKey = $derived(request?.key);
const panel = $derived(
  selectedKind === undefined
    ? { type: 'fixed' as const, note: '' }
    : shapePanel(selectedKind, parameterChoices, {
        tiltModes,
        values: request?.values,
        connectorScale,
        sectionRanges,
        connectorStatus: request?.connectorStatus,
        connectorNotice: plateNotice,
        magnetAllowancesChanged: selectedKind !== undefined && magnetAllowancesChanged(selectedKind, parameterTexts),
        plateClipped: request?.plateClipped,
        construction: { ...construction, switching: angleSwitch !== undefined },
        pilotDraft: request?.pilotDraft,
      }),
);
const invalidFields = $derived(
  [printSizeField, ...(panel.type === 'fixed' ? [] : panel.sections.flatMap(sectionNumberFields))]
    .filter((field) => request?.errors[field.key] !== undefined)
    .map(({ key, label }) => ({ key, label })),
);
const canReset = $derived(selectedKind !== undefined && canResetShapeParameters(selectedKind, parameterState));
// The download exports the parts of the chosen section, or the whole solid.
const sectioned = $derived(selectedKind !== undefined && activeSection(selectedKind, parameterChoices) !== undefined);
const separated = $derived(selectedKind !== undefined && partsSeparated(selectedKind, parameterChoices));
// The model shown for a connector that does not fit is the plain cut, which nobody asked to print; nor is the plain solid shown
// for the pilot's construction while it gives no section.
const canDownload = $derived(
  model.status === 'ready' &&
    request?.connectorStatus?.unavailable === undefined &&
    (request?.pilotDraft === undefined || request.pilotDraft.status === 'valid'),
);
const pinsFile = $derived(model.status === 'ready' && model.key === requestKey ? model.artifacts.pinsFile : undefined);
const trialFile = $derived(model.status === 'ready' && model.key === requestKey ? model.artifacts.trialFile : undefined);

// The pilot's construction is open only in its own mode; any other leaves it, and with it the model's picking.
const pilotOn = $derived(
  selectedKind !== undefined &&
    isBoxSolid(selectedKind) &&
    isConstructionSolid(selectedKind) &&
    activeSection(selectedKind, parameterChoices) === 'through-line',
);
// The same construction by a point or at an angle: the segment's field is shared, the other one is M's or the angle's.
const angleOn = $derived(
  pilotOn &&
    selectedKind !== undefined &&
    isBoxSolid(selectedKind) &&
    anglePilotActive(boxKeysOf(selectedKind), parameterChoices as never),
);
const pilotSelection = $derived(
  selectedKind === undefined || !pilotOn || !isBoxSolid(selectedKind)
    ? undefined
    : throughPointSelection(
        boxKeysOf(selectedKind),
        parameterChoices as never,
        boxContextFrom(selectedKind, request?.values ?? {}, parameterChoices),
      ),
);
// The plane parallel to a face of a cube or a parallelepiped is built the same way, by its face and its position.
const facePilotOn = $derived(
  selectedKind !== undefined &&
    isBoxSolid(selectedKind) &&
    activeSection(selectedKind, parameterChoices) === 'face-parallel' &&
    facePilotActive(boxKeysOf(selectedKind), parameterChoices as never),
);
// A longitudinal plane through a base diagonal: its diagonal picked on the model.
const diagonalOn = $derived(
  selectedKind !== undefined &&
    isBoxSolid(selectedKind) &&
    diagonalPilotActive(boxKeysOf(selectedKind), parameterChoices as never),
);
// An inclined plane perpendicular to a segment: its segment picked on the model.
const normalOn = $derived(
  selectedKind !== undefined && isBoxSolid(selectedKind) && normalPilotActive(boxKeysOf(selectedKind), parameterChoices as never),
);
// A triangular prism's longitudinal plane along a median, an altitude, a bisector or a midline: its base element picked on the model.
const traceOn = $derived(
  selectedKind !== undefined && isBoxSolid(selectedKind) && tracePilotActive(boxKeysOf(selectedKind), parameterChoices as never),
);
$effect.pre(() => {
  if (!pilotOn && !facePilotOn && !diagonalOn && !normalOn && !traceOn && untrack(() => construction.field) !== undefined) {
    construction = { field: undefined, pending: undefined, notice: undefined };
  }
});
// Parts set apart explicitly end the construction: its picking works on the assembled solid.
let wasSeparated = untrack(() => separated);
$effect.pre(() => {
  const now = separated;
  if (now && !wasSeparated && untrack(() => construction.field) !== undefined) {
    construction = { ...untrack(() => construction), field: undefined, pending: undefined };
  }
  wasSeparated = now;
});
// The second parallel plane's valid position, which the construction view draws with the first.
const secondPlanePercent = $derived.by(() => {
  const second = selectedKind === undefined ? undefined : sectionKeys[selectedKind]?.secondCut;
  if (selectedKind === undefined || second === undefined || !secondCutChosen(selectedKind, parameterChoices)) return undefined;
  return request?.errors[second.offset] === undefined ? request?.values[second.offset] : undefined;
});
// A construction that gives no section stays drawn on the assembled solid also with no field open, never an earlier section.
const drafting = $derived(request?.pilotDraft?.status === 'incomplete' || request?.pilotDraft?.status === 'invalid');
const constructionForPreview = $derived(
  selectedKind === undefined || !isBoxSolid(selectedKind) || (construction.field === undefined && !drafting)
    ? undefined
    : traceOn
      ? traceView(selectedKind)
      : normalOn
        ? normalView(selectedKind)
        : diagonalOn
          ? diagonalView(selectedKind)
          : facePilotOn
            ? {
                field: construction.field,
                pending: undefined,
                draft: faceConstructionDraftOf(parameterChoices[boxKeysOf(selectedKind).Face], request?.pilotDraft),
                vertexTargets: [],
                edgeTargets: [],
                // Every face can be clicked; opposite ones give the same planes, measured from the other side.
                faceTargets: construction.field === 'face' ? boxTopologyFor(selectedKind, parameterChoices).faceNames : [],
              }
            : pilotSelection === undefined
              ? undefined
              : angleOn
                ? angleView(selectedKind, pilotSelection)
                : {
                    field: construction.field,
                    pending: construction.pending,
                    draft: constructionDraftOf(
                      boxKeysOf(selectedKind),
                      pilotSelection,
                      request?.values ?? {},
                      request?.pilotDraft,
                      secondPlanePercent,
                    ),
                    ...constructionTargets(construction.field, pilotSelection, construction.pending),
                  },
);

/**
 * The view of a longitudinal plane along a line of the base while its base element is chosen: the base vertices, or the base sides,
 * of both bases, an upper one standing for the lower one; the side chosen marked; the trace and the section as the request has them.
 */
function traceView(kind: BoxSolid) {
  const keys = boxKeysOf(kind);
  const trace = traceSelection(keys, parameterChoices as never, boxContextFrom(kind, request?.values ?? {}, parameterChoices));
  const choosing = construction.field === 'trace';
  const upper = (vertex: BoxVertex) => `${vertex}1` as BoxVertex;
  const sides = traceTargetOf(trace.kind) === 'side';
  const section = request?.spec?.section;
  const { connector: _connector, ...plane } = (section ?? {}) as Record<string, unknown>;
  return {
    field: construction.field,
    pending: undefined,
    draft: {
      segment: undefined,
      pointEdge: undefined,
      pointEdgeEligible: false,
      percent: undefined,
      plane: section?.type === 'longitudinal' ? (plane as ConstructionDraft['plane']) : undefined,
    },
    lines:
      sides && trace.segment !== undefined
        ? [{ key: segmentKey(trace.segment), ends: trace.segment, state: 'selected' as const }]
        : [],
    vertexTargets: choosing && !sides ? trace.vertices.flatMap((vertex) => [vertex, upper(vertex)]) : [],
    edgeTargets:
      choosing && sides
        ? trace.segments.flatMap(([a, b]) => [
            segmentKey(canonicalSegment([a, b])),
            segmentKey(canonicalSegment([upper(a), upper(b)])),
          ])
        : [],
    faceTargets: [],
  };
}

/**
 * The view of an inclined plane while the segment it is perpendicular to is chosen: every edge and vertex may be tapped, as any two
 * vertices make a segment; of the diagonals, only the chosen segment is drawn, besides the one a first vertex would make with the
 * vertex under the pointer; and the section as the request has it.
 */
function normalView(kind: BoxSolid) {
  const keys = boxKeysOf(kind);
  const topology = boxTopologyFor(kind, parameterChoices);
  const along = parameterChoices[keys.NormalAlong];
  const chosen = along === 'none' ? undefined : normalEntries(topology).find(({ key }) => key === along);
  const section = request?.spec?.section;
  const { connector: _connector, ...plane } = (section ?? {}) as Record<string, unknown>;
  return {
    field: construction.field,
    pending: construction.pending,
    draft: {
      segment: undefined,
      pointEdge: undefined,
      pointEdgeEligible: false,
      percent: undefined,
      plane: section?.type === 'inclined' ? (plane as ConstructionDraft['plane']) : undefined,
    },
    lines: chosen === undefined ? [] : [{ key: chosen.key, ends: chosen.segment, state: 'selected' as const }],
    vertexTargets: construction.field === 'normal' ? [...topology.vertices] : [],
    edgeTargets: construction.field === 'normal' ? topology.edges.map((edge) => segmentKey(canonicalSegment(edge))) : [],
    faceTargets: [],
  };
}

/**
 * The view of a longitudinal plane through a base diagonal while its diagonal is chosen: both bases' diagonals offered, the chosen
 * family's marked, in the plane while it passes through them; a first vertex's opposite one to complete it; and the section as the
 * request has it, drawn with it.
 */
function diagonalView(kind: BoxSolid) {
  const keys = boxKeysOf(kind);
  const context = boxContextFrom(kind, request?.values ?? {}, parameterChoices);
  const trace = traceSelection(keys, parameterChoices as never, context);
  const families = diagonalFamilies(trace.segments);
  const chosen = trace.segment === undefined ? undefined : familyOf(families, trace.segment);
  const through = parameterChoices[keys.TraceThrough];
  const { pending } = construction;
  // A quadrilateral's four diagonals are all drawn; a denser base's only the chosen family and, after a first vertex, the
  // diagonals through it, so that the drawing stays readable.
  const dense = families.length > 2;
  const candidates = pending === undefined ? [] : diagonalsThrough(families, pending);
  const lines = families.flatMap((family) =>
    [family.lower, family.upper]
      .filter((ends) => !dense || family === chosen || candidates.some((candidate) => segmentKey(candidate) === segmentKey(ends)))
      .map((ends) => ({
        key: segmentKey(ends),
        ends,
        state: family !== chosen ? ('candidate' as const) : through ? ('in-plane' as const) : ('selected' as const),
      })),
  );
  const partners = pending === undefined ? [] : diagonalPartners(families, pending);
  const section = request?.spec?.section;
  const { connector: _connector, ...plane } = (section ?? {}) as Record<string, unknown>;
  return {
    field: construction.field,
    pending,
    draft: {
      segment: undefined,
      pointEdge: undefined,
      pointEdgeEligible: false,
      percent: undefined,
      plane: section?.type === 'longitudinal' ? (plane as ConstructionDraft['plane']) : undefined,
    },
    lines,
    vertexTargets: [
      ...new Set(pending === undefined ? families.flatMap(({ lower, upper }) => [...lower, ...upper]) : [pending, ...partners]),
    ],
    edgeTargets: lines.map(({ key }) => key),
    faceTargets: [],
  };
}

/**
 * The view of a plane at an angle: the segment's picking as by a point; for the angle, the two faces of an edge to choose its
 * reference from, which is highlighted meanwhile.
 */
function angleView(kind: BoxSolid, selection: ThroughPointSelection) {
  const { segment } = selection;
  const topology = boxTopologyFor(kind, parameterChoices);
  const face = segment === undefined ? undefined : referenceFaceOf(topology, segment, parameterChoices[boxKeysOf(kind).LineFace]);
  const faces = segment === undefined ? [] : referenceFaces(topology, segment);
  const choosing = construction.field === 'angle';
  return {
    field: construction.field,
    pending: construction.pending,
    draft: angleConstructionDraftOf(segment, face, choosing, request?.pilotDraft, secondPlanePercent),
    ...constructionTargets(construction.field, selection, construction.pending),
    ...(choosing ? { faceTargets: faces.length > 1 ? faces : [] } : {}),
  };
}

function openConstruction(field: ConstructionField | undefined) {
  construction = { field, pending: undefined, notice: undefined };
}

function choosePilot(choice: PilotChoice) {
  if (selectedKind === undefined) return;
  if (choice.kind === 'angle-side') {
    switchAngleSide(selectedKind);
    return;
  }
  applyState(applyPilotChoice(selectedKind, parameterState, request?.values ?? {}, choice));
  construction = { ...construction, pending: undefined, notice: undefined };
}

/**
 * The switch to the other plane at the angle, made whole or not at all: checked first by the same request the geometry is built
 * from, refused with the reason while the plane in effect stays; once made, the previous state is kept until the new model is
 * built, and restored if it cannot be. One switch at a time: a click while one is pending does nothing.
 */
function switchAngleSide(kind: ShapeKind) {
  if (angleSwitch !== undefined) return;
  const options = { exact: parameterExact, tiltModes, connectorScale: lastConnectorScale, connectorEdits };
  const refusal = angleSideRefusal(kind, parameterTexts, parameterChoices, options);
  if (refusal !== undefined) {
    construction = { ...construction, notice: `Інше положення перерізу не підходить: ${refusal} Залишено поточний переріз.` };
    return;
  }
  const previous = parameterState;
  const next = applyPilotChoice(kind, previous, request?.values ?? {}, { kind: 'angle-side' });
  if (next === previous) return;
  applyState(next);
  construction = { ...construction, pending: undefined, notice: undefined };
  angleSwitch = { key: request?.key, previous };
}

$effect.pre(() => {
  const pending = angleSwitch;
  if (pending === undefined) return;
  // Anything else changed meanwhile: that is the state now, the switch with it.
  if (requestKey !== pending.key || (model.status === 'ready' && model.key === pending.key)) {
    angleSwitch = undefined;
    return;
  }
  if (model.status === 'error') {
    untrack(() => applyState(pending.previous));
    angleSwitch = undefined;
    construction = {
      ...untrack(() => construction),
      notice: 'Не вдалося побудувати інше положення перерізу, тому повернено попередній переріз.',
    };
  }
});

/**
 * A tap on the model in the construction view: for the segment, an edge, or a vertex and then a second one of a common face, the
 * same vertex again letting it go; for M, an edge. As choosing it from the list does. A vertex that makes no segment with the
 * first is refused, said why, and the first stays.
 */
function pickOnModel(pick: ConstructionPick) {
  const { field, pending } = construction;
  if (field === 'normal') {
    pickNormal(pick);
    return;
  }
  if (field === 'trace') {
    if (pick.kind === 'vertex') choosePilot({ kind: 'trace-vertex', vertex: pick.vertex });
    if (pick.kind === 'edge') choosePilot({ kind: 'trace-side', segment: segmentOf(pick.edge) });
    return;
  }
  if (field === 'diagonal' && selectedKind !== undefined && isBoxSolid(selectedKind)) {
    pickDiagonal(selectedKind, pick);
    return;
  }
  if (pick.kind === 'face') {
    if (field === 'face') choosePilot({ kind: 'face', face: pick.face });
    if (field === 'angle') choosePilot({ kind: 'angle-face', face: pick.face });
    return;
  }
  if (field === 'point') {
    if (pick.kind === 'edge') choosePilot({ kind: 'point-edge', edge: segmentOf(pick.edge) });
    return;
  }
  if (pick.kind === 'edge') {
    choosePilot({ kind: 'segment', segment: segmentOf(pick.edge) });
    return;
  }
  const segments = pilotSelection?.segments ?? [];
  if (pending === undefined) {
    construction =
      eligibleSecondVertices(segments, pick.vertex).length > 0
        ? { ...construction, pending: pick.vertex, notice: undefined }
        : { ...construction, notice: `Через вершину ${vertexName(pick.vertex)} немає відрізка для перерізу.` };
    return;
  }
  if (pick.vertex === pending) {
    construction = { ...construction, pending: undefined, notice: undefined };
    return;
  }
  if (eligibleSecondVertices(segments, pending).includes(pick.vertex)) {
    choosePilot({ kind: 'segment', segment: [pending, pick.vertex] });
    return;
  }
  const [first, second] = [vertexName(pending), vertexName(pick.vertex)];
  construction = {
    ...construction,
    notice: `${first} і ${second} не лежать в одній грані, тож відрізок ${first}${second} не підходить. Оберіть підсвічену вершину.`,
  };
}

/** A tap while the segment a plane is perpendicular to is chosen: an edge, or any two vertices, the same one again letting it go. */
function pickNormal(pick: ConstructionPick) {
  if (pick.kind === 'edge') {
    choosePilot({ kind: 'normal', segment: segmentOf(pick.edge) });
    return;
  }
  if (pick.kind !== 'vertex') return;
  const { pending } = construction;
  if (pending === undefined || pending === pick.vertex) {
    construction = { ...construction, pending: pending === undefined ? pick.vertex : undefined, notice: undefined };
    return;
  }
  choosePilot({ kind: 'normal', segment: [pending, pick.vertex] });
}

/**
 * A tap while a base diagonal is chosen: a diagonal of either base, or a vertex and then the opposite one of the same base, the same
 * vertex again letting it go; any other vertex is refused with the reason, and the first stays.
 */
function pickDiagonal(kind: BoxSolid, pick: ConstructionPick) {
  const keys = boxKeysOf(kind);
  const families = diagonalFamilies(
    traceSelection(keys, parameterChoices as never, boxContextFrom(kind, request?.values ?? {}, parameterChoices)).segments,
  );
  if (pick.kind === 'edge') {
    choosePilot({ kind: 'diagonal', segment: segmentOf(pick.edge) });
    return;
  }
  if (pick.kind !== 'vertex') return;
  const { pending } = construction;
  if (pending === undefined) {
    construction = { ...construction, pending: pick.vertex, notice: undefined };
    return;
  }
  if (pick.vertex === pending) {
    construction = { ...construction, pending: undefined, notice: undefined };
    return;
  }
  if (diagonalPartners(families, pending).includes(pick.vertex)) {
    choosePilot({ kind: 'diagonal', segment: [pending, pick.vertex] });
    return;
  }
  const [first, second] = [vertexName(pending), vertexName(pick.vertex)];
  const upper = (vertex: BoxVertex) => vertex.endsWith('1');
  construction = {
    ...construction,
    notice:
      (upper(pending) === upper(pick.vertex)
        ? `${first} і ${second} — сусідні вершини основи, тож ${first}${second} — її сторона, а не діагональ. `
        : `${first} і ${second} лежать у різних основах, тож ${first}${second} — не діагональ основи. `) +
      'Оберіть підсвічену вершину.',
  };
}

function withStoredPrintSize() {
  const stored = loadPrintSizeText();
  return stored === undefined ? {} : { printSizeMm: stored };
}

// Only a valid size is remembered; a draft being typed, or an invalid one, leaves the stored value as it was.
$effect(() => {
  const size = request?.values.printSizeMm;
  if (size !== undefined) savePrintSize(size);
});

/**
 * Restores the selected shape's initial parameters. Its drafts and their errors go with the texts; the shared print
 * size, other shapes' values and the viewing direction stay.
 */
function resetParameters() {
  if (selectedKind === undefined) return;
  applyState(resetShapeParameters(selectedKind, parameterState));
}

/** Shows the displacement in the other mode; the converted values describe the same solid, so it is not rebuilt. */
function changeTiltMode(solid: TiltSolid, mode: TiltMode) {
  if (tiltModes[solid] === mode || request === undefined) return;
  const next = switchTiltMode(solid, parameterState, request.values);
  if (next !== undefined) applyState(next);
}

function applyState(state: ParameterState) {
  parameterTexts = state.texts;
  parameterChoices = state.choices;
  parameterExact = state.exact ?? {};
  tiltModes = state.tiltModes ?? tiltModes;
  connectorEdits = state.connectorEdits ?? {};
}

/** Before a round connector's field changes by hand, what it shows becomes what it stores. */
function commitRoundEdit() {
  if (selectedKind !== undefined) applyState(commitConnectorEdit(selectedKind, parameterState, request));
}

function runPanelAction(action: PanelAction) {
  if (action === 'download-pins') {
    if (pinsFile !== undefined) saveFile(pinsFile.bytes, pinsFile.fileName, THREE_MF_MEDIA_TYPE);
    return;
  }
  if (action === 'download-trial') {
    if (trialFile !== undefined) saveFile(trialFile.bytes, trialFile.fileName, THREE_MF_MEDIA_TYPE);
    return;
  }
  if (action === 'add-second-cut' || action === 'remove-second-cut') {
    if (selectedKind === undefined) return;
    applyState(
      action === 'add-second-cut'
        ? addSecondCut(selectedKind, parameterState, request?.values ?? {})
        : removeSecondCut(selectedKind, parameterState),
    );
    return;
  }
  if (action === 'linked-alternative') {
    applyState(switchLinkedAlternative(parameterState));
    return;
  }
  if (action === 'linked-axial') {
    applyState(linkedAxial(parameterState));
    return;
  }
  if (action === 'axial-section') {
    if (selectedKind !== undefined) applyState(axialAxisParallel(selectedKind, parameterState));
    return;
  }
  if (action === 'trace-through') {
    if (selectedKind !== undefined) applyState(traceThrough(selectedKind, parameterState));
    return;
  }
  if (action === 'height-foot') {
    if (selectedKind !== undefined) applyState(throughHeightFoot(selectedKind, parameterState, request?.values ?? {}));
    return;
  }
  if (action === 'trace-midpoint') {
    if (selectedKind !== undefined) applyState(tracePointAtMidpoint(selectedKind, parameterState));
    return;
  }
  if (action === 'normal-manual') {
    if (selectedKind !== undefined) applyState(normalAlongManual(selectedKind, parameterState));
    return;
  }
  if (action === 'line-midpoint') {
    if (selectedKind !== undefined) applyState(pointAtMidpoint(selectedKind, parameterState));
    return;
  }
  if (action === 'reset-magnet-allowances') {
    if (selectedKind !== undefined) applyState(resetMagnetAllowances(selectedKind, parameterState));
    return;
  }
  const key = selectedKind === undefined ? undefined : sectionKeys[selectedKind]?.connector;
  if (key !== undefined) parameterChoices[key] = 'none';
}

// A section plate turned on with a connector that cannot pass through it gets none instead, and says so while that lasts.
$effect.pre(() => {
  if (selectedKind === undefined) return;
  const next = plateConnectorFallback(selectedKind, parameterState);
  if (next !== undefined) {
    untrack(() => applyState(next));
    plateNotice = PLATE_TWIST_NOTICE;
    return;
  }
  const keys = sectionKeys[selectedKind];
  const stillNone = keys !== undefined && parameterChoices[keys.connector] === 'none';
  if (!plateChosen(selectedKind, parameterChoices) || !stillNone) plateNotice = undefined;
});

// The first plane through a cone's apex takes a valid angle for the cone it finds; after that nothing changes on its own.
$effect.pre(() => {
  const next = startApexSection(parameterState, request?.values ?? {});
  if (next !== undefined) untrack(() => applyState(next));
});

// The first planes through a cylinder's shared generatrix take the angles of its generatrices 120° apart; then they keep theirs.
$effect.pre(() => {
  const next = startLinkedSection(parameterState, request?.values ?? {});
  if (next !== undefined) untrack(() => applyState(next));
});

// A box's plane through a line keeps only choices that lead to a usable plane of the solid, all replaced together; each new
// line starts at a usable angle, and a point on a new edge at a usable position.
$effect.pre(() => {
  if (selectedKind === undefined) return;
  const values = request?.values ?? {};
  const settled = settleBoxChoices(selectedKind, parameterState, values);
  if (settled !== undefined) {
    untrack(() => applyState(settled));
    return;
  }
  const next =
    startLineAngle(selectedKind, parameterState, values) ??
    startPoint(selectedKind, parameterState, values) ??
    startTracePoint(selectedKind, parameterState, values) ??
    followTrace(selectedKind, parameterState, values) ??
    followNormal(selectedKind, parameterState, values);
  if (next !== undefined) untrack(() => applyState(next));
});

let latestRequest = 0;

$effect(() => {
  void attempt;
  const kind = selectedKind;
  const key = requestKey;
  // One snapshot: the files record the settings of the very request whose specification they were generated from.
  const snapshot = untrack(() => request);
  const spec = snapshot?.spec;
  const settingsInput = snapshot?.settingsInput ?? {};
  // Every change invalidates the current model at once, so outdated geometry can never be downloaded; results of
  // superseded requests are discarded when they arrive.
  const requestId = ++latestRequest;
  const previous = untrack(() => visibleArtifacts(model));
  const stale = previous?.model.kind === kind ? previous : undefined;

  if (kind === undefined) {
    model = { status: 'error', message: 'Ця фігура ще недоступна.' };
    return;
  }
  if (key === undefined || spec === undefined) {
    model = { status: 'invalid', stale };
    return;
  }
  model = { status: 'generating', stale };
  const timer = setTimeout(
    () => {
      buildModel(spec, settingsInput).then(
        (artifacts) => {
          if (requestId === latestRequest) model = { status: 'ready', key, artifacts };
        },
        (error: unknown) => {
          console.error(error);
          if (requestId === latestRequest) model = { status: 'error', message: describeModelError(error) };
        },
      );
    },
    stale === undefined ? 0 : EDIT_DEBOUNCE_MS,
  );
  return () => clearTimeout(timer);
});

function downloadPrintFile() {
  if (model.status !== 'ready' || model.key !== requestKey || !canDownload) return;
  const { fileName, bytes } = model.artifacts.printFile;
  saveFile(bytes, fileName, THREE_MF_MEDIA_TYPE);
}
</script>

<svelte:head>
  <title>Стереометрія 3D</title>
</svelte:head>

<div class="app-shell">
  <AppHeader>
    <div class="shape-picker">
      <label for="shape">Геометричне тіло</label>
      <Select id="shape" bind:value={selectedShape} options={shapeOptions} />
    </div>
    <!-- The print size belongs to the export, not to one shape: it is shared by all and kept between visits. -->
    <div class="export-controls">
      <NumberField
        id={printSizeField.key}
        label={printSizeField.label}
        bind:text={parameterTexts.printSizeMm}
        value={request?.values.printSizeMm}
        range={printSizeField.range}
        suffix={printSizeField.suffix}
        error={request?.errors.printSizeMm}
        variant="entry"
      />
      <Button disabled={!canDownload} loading={model.status === 'generating'} onclick={downloadPrintFile}>
        {#snippet leadingIcon()}
          <svg class="download-icon" viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></svg>
        {/snippet}
        {sectioned ? 'Завантажити частини · 3MF' : 'Завантажити 3MF'}
      </Button>
    </div>
  </AppHeader>

  <main class="workspace">
    <div class="controls-area">
      <ControlsPanel
        bind:this={controls}
        {panel}
        bind:texts={parameterTexts}
        bind:choices={parameterChoices}
        values={request?.values ?? {}}
        errors={request?.errors ?? {}}
        {canReset}
        onreset={resetParameters}
        ontiltmode={changeTiltMode}
        pinsReady={pinsFile !== undefined}
        trialReady={trialFile !== undefined}
        onaction={runPanelAction}
        onroundedit={commitRoundEdit}
        onactivefield={(key) => (activeField = key)}
        onconstruction={openConstruction}
        onpilotchoice={choosePilot}
        oncancelpending={() => (construction = { ...construction, pending: undefined })}
      />
    </div>
    <div class="preview-area">
      <PreviewPanel
        shapeName={selectedShapeName}
        {model}
        {separated}
        {invalidFields}
        onfocusfield={(key) => controls?.focusField(key)}
        onretry={() => (attempt += 1)}
        highlight={previewHighlightOf(panel, activeField)}
        construction={constructionForPreview}
        onconstructionpick={pickOnModel}
      />
    </div>
  </main>
</div>

<style>
  /*
   * The workspace takes the browser's height: the header row keeps its size, the content row gets the rest and may
   * shrink below its content, so only the sidebar scrolls while the preview keeps its position and size.
   */
  .app-shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100vh;
    height: 100dvh;
  }

  .workspace {
    --controls-overflow-y: auto;
    display: grid;
    grid-template-areas: "controls preview";
    grid-template-columns: clamp(300px, 25vw, 340px) minmax(0, 1fr);
    gap: var(--space-4);
    min-height: 0;
    padding: var(--space-4);
  }

  /* Each area passes its bounded height on to its panel, which may shrink below its content. */
  .controls-area,
  .preview-area {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }

  .controls-area {
    grid-area: controls;
  }

  .preview-area {
    grid-area: preview;
  }

  .shape-picker {
    display: flex;
    flex: 1 1 18rem;
    align-items: center;
    gap: var(--space-3);
    max-width: 30rem;
    min-width: 0;
  }

  /*
   * The size and the download stay together and wrap below the shape picker where the header is narrow. On the
   * desktop workspace a size error is lifted out of the flow, so that it does not make the header, and with it the
   * workspace below, move.
   */
  .export-controls {
    --field-error-position: absolute;
    --field-error-width: max-content;
    --field-error-padding: var(--space-2) var(--space-3);
    --field-error-background: var(--color-surface-raised);
    --field-error-border: 1px solid var(--color-border-strong);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    min-width: 0;
  }

  .download-icon {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentcolor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.75;
  }

  .shape-picker label {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  /*
   * Narrow screens and high zoom levels (1366 × 768 at 200 % leaves 683 × 384 CSS pixels): one column with the preview
   * above the controls and ordinary page scrolling.
   */
  @media (max-width: 860px), (max-height: 480px) {
    .app-shell {
      display: block;
      height: auto;
    }

    .workspace {
      grid-template-areas:
        "preview"
        "controls";
      grid-template-columns: minmax(0, 1fr);
      /* The page scrolls; the controls grow with their content. */
      --controls-overflow-y: visible;
      --preview-viewport-height: clamp(260px, 55vh, 480px);
    }

    /* The page scrolls anyway: the message takes its place in the flow under the field. */
    .export-controls {
      --field-error-position: static;
      --field-error-width: auto;
      --field-error-padding: 0;
      --field-error-background: transparent;
      --field-error-border: 0;
    }
  }

  @media (max-width: 480px) {
    .workspace {
      padding: var(--space-3);
    }

    .shape-picker {
      flex-wrap: wrap;
      gap: var(--space-1);
    }
  }
</style>
