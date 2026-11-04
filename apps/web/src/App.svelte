<script lang="ts">
import { THREE_MF_MEDIA_TYPE } from '@diploma-3d/engine';
import { untrack } from 'svelte';
import AppHeader from './lib/components/AppHeader.svelte';
import Button from './lib/components/Button.svelte';
import ControlsPanel from './lib/components/ControlsPanel.svelte';
import PreviewPanel from './lib/components/PreviewPanel.svelte';
import Select from './lib/components/Select.svelte';
import { saveFile } from './lib/download.ts';
import { buildModel } from './lib/model/buildModel.ts';
import { describeModelError, type ModelState, visibleArtifacts } from './lib/model/modelState.ts';
import { initialParameterChoices, initialParameterTexts, resolveModelRequest } from './lib/model/parameters.ts';
import { isAvailableShape, sectionNumberFields, shapeLabel, shapeOptions, shapePanel } from './lib/shapes.ts';

// Parameter edits are coalesced briefly so that typing "1,75" does not rebuild the model for every keystroke.
const EDIT_DEBOUNCE_MS = 150;

let selectedShape = $state<string>('cube');
let parameterTexts = $state(initialParameterTexts());
let parameterChoices = $state(initialParameterChoices());
let attempt = $state(0);
// Raw state: the artifacts hold large typed arrays that must not be wrapped in deep reactive proxies.
let model = $state.raw<ModelState>({ status: 'generating', stale: undefined });
let controls = $state<ControlsPanel>();

const selectedKind = $derived(isAvailableShape(selectedShape) ? selectedShape : undefined);
const selectedShapeName = $derived(shapeLabel(selectedShape));
const request = $derived(
  selectedKind === undefined ? undefined : resolveModelRequest(selectedKind, parameterTexts, parameterChoices),
);
// Texts that denote the same specification ("1,5" and "1.50") share a key and do not trigger a rebuild.
const requestKey = $derived(request?.key);
const panel = $derived(
  selectedKind === undefined ? { type: 'fixed' as const, note: '' } : shapePanel(selectedKind, parameterChoices),
);
const invalidFields = $derived(
  panel.type === 'fixed'
    ? []
    : panel.sections
        .flatMap(sectionNumberFields)
        .filter((field) => request?.errors[field.key] !== undefined)
        .map(({ key, label }) => ({ key, label })),
);

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
    <Button disabled={model.status !== 'ready'} loading={model.status === 'generating'} onclick={downloadPrintFile}>
      Завантажити 3MF
    </Button>
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
      />
    </div>
    <div class="preview-area">
      <PreviewPanel
        shapeName={selectedShapeName}
        {model}
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
