<script lang="ts">
import { THREE_MF_MEDIA_TYPE } from '@diploma-3d/engine';
import type { ShapeKind } from '@diploma-3d/schema';
import { untrack } from 'svelte';
import AppHeader from './lib/components/AppHeader.svelte';
import Button from './lib/components/Button.svelte';
import ControlsPanel from './lib/components/ControlsPanel.svelte';
import NumberField from './lib/components/NumberField.svelte';
import PreviewPanel from './lib/components/PreviewPanel.svelte';
import Select from './lib/components/Select.svelte';
import { saveFile } from './lib/download.ts';
import { buildModel } from './lib/model/buildModel.ts';
import { type ConnectorScale, connectorScaleOf } from './lib/model/connectorScale.ts';
import { describeModelError, type ModelState, visibleArtifacts } from './lib/model/modelState.ts';
import {
  activeConnector,
  activeSection,
  canResetShapeParameters,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterExact,
  type ParameterState,
  partsSeparated,
  resetShapeParameters,
  resolveModelRequest,
  type SectionRanges,
  sectionKeys,
  switchTiltMode,
} from './lib/model/parameters.ts';
import { loadPrintSizeText, savePrintSize } from './lib/model/printSize.ts';
import { initialTiltModes, type TiltMode, type TiltSolid } from './lib/model/tilt.ts';
import { isAvailableShape, printSizeField, sectionNumberFields, shapeLabel, shapeOptions, shapePanel } from './lib/shapes.ts';

// Parameter edits are coalesced briefly so that typing "1,75" does not rebuild the model for every keystroke.
const EDIT_DEBOUNCE_MS = 150;

let selectedShape = $state<string>('cube');
// The print size is the only setting remembered between visits.
let parameterTexts = $state({ ...initialParameterTexts(), ...withStoredPrintSize() });
let parameterChoices = $state(initialParameterChoices());
// Replaced as a whole, never mutated: the exact values behind converted texts and each solid's tilt input mode.
let parameterExact = $state.raw<ParameterExact>({});
let tiltModes = $state.raw(initialTiltModes());
let attempt = $state(0);
// Raw state: the artifacts hold large typed arrays that must not be wrapped in deep reactive proxies.
let model = $state.raw<ModelState>({ status: 'generating', stale: undefined });
let controls = $state<ControlsPanel>();

const selectedKind = $derived(isAvailableShape(selectedShape) ? selectedShape : undefined);
const selectedShapeName = $derived(shapeLabel(selectedShape));
const parameterState = $derived<ParameterState>({
  texts: parameterTexts,
  choices: parameterChoices,
  exact: parameterExact,
  tiltModes,
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
      }),
);
const connectorScale = $derived(
  selectedKind === undefined
    ? undefined
    : (connectorScaleOf(selectedKind, request?.values ?? {}, lastConnectorScale) ?? lastConnectorScale),
);
$effect.pre(() => {
  if (selectedKind === undefined) return;
  // Only a different scale is stored: the request reads it, so storing an equal copy would recompute it in a loop.
  const last = untrack(() => lastConnectorScales[selectedKind]);
  const current = connectorScaleOf(selectedKind, request?.values ?? {}, last);
  if (
    current !== undefined &&
    (current.longestDimensionMm !== last?.longestDimensionMm ||
      current.radiusMm !== last?.radiusMm ||
      current.heightMm !== last?.heightMm ||
      current.obliqueSpanMm !== last?.obliqueSpanMm ||
      current.parallelSpanMm !== last?.parallelSpanMm)
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
    : shapePanel(selectedKind, parameterChoices, { tiltModes, values: request?.values, connectorScale, sectionRanges }),
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
}

let latestRequest = 0;

$effect(() => {
  void attempt;
  const kind = selectedKind;
  const key = requestKey;
  const spec = untrack(() => request?.spec);
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
      buildModel(spec).then(
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
  if (model.status !== 'ready' || model.key !== requestKey) return;
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
      <Button disabled={model.status !== 'ready'} loading={model.status === 'generating'} onclick={downloadPrintFile}>
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
