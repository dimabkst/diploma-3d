<script lang="ts">
import { boxEdgeLengthsMm, THREE_MF_MEDIA_TYPE } from '@diploma-3d/engine';
import { untrack } from 'svelte';
import AppHeader from './lib/components/AppHeader.svelte';
import ControlsPanel from './lib/components/ControlsPanel.svelte';
import PageHeading from './lib/components/PageHeading.svelte';
import PreviewPanel from './lib/components/PreviewPanel.svelte';
import { saveFile } from './lib/download.ts';
import { buildModel } from './lib/model/buildModel.ts';
import { describeModelError, type ModelState, visibleArtifacts } from './lib/model/modelState.ts';
import { initialParameterTexts, resolveModelRequest } from './lib/model/parameters.ts';
import {
  isAvailableShape,
  measurementItems,
  parameterHint,
  shapeDescription,
  shapeLabel,
  shapeOptions,
  shapeParameters,
} from './lib/shapes.ts';

// Parameter edits are coalesced briefly so that typing "1,75" does not rebuild the model for every keystroke.
const EDIT_DEBOUNCE_MS = 150;

let selectedShape = $state<string>('cube');
let parameterTexts = $state(initialParameterTexts());
let attempt = $state(0);
// Raw state: the artifacts hold large typed arrays that must not be wrapped in deep reactive proxies.
let model = $state.raw<ModelState>({ status: 'generating', stale: undefined });

const selectedKind = $derived(isAvailableShape(selectedShape) ? selectedShape : undefined);
const selectedShapeName = $derived(shapeLabel(selectedShape));
const request = $derived(selectedKind === undefined ? undefined : resolveModelRequest(selectedKind, parameterTexts));
// Texts that denote the same specification ("1,5" and "1.50") share a key and do not trigger a rebuild.
const requestKey = $derived(request?.key);
const description = $derived(
  selectedKind === undefined || request === undefined ? '' : shapeDescription(selectedKind, request.scale),
);
const hint = $derived(
  selectedKind === undefined || request === undefined ? undefined : parameterHint(selectedKind, request.scale),
);
const measurements = $derived.by(() => {
  if (selectedKind === undefined || request === undefined) return [];
  const edges = request.spec === undefined ? undefined : boxEdgeLengthsMm(request.spec.shape, request.spec.scale);
  const ready = model.status === 'ready' && model.key === requestKey ? model.artifacts : undefined;
  return measurementItems(selectedKind, request.scale, edges, ready?.model.solids[0]?.measurements);
});

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

<AppHeader />

<main>
  <section class="intro" aria-labelledby="page-title">
    <p class="eyebrow">Від формули до фізичної моделі</p>
    <PageHeading id="page-title" title="Створіть геометричне тіло" />
    <p class="lead">Оберіть фігуру, налаштуйте параметри та підготуйте модель до 3D-друку.</p>
  </section>

  <div class="workspace">
    <ControlsPanel
      shapes={shapeOptions}
      bind:selectedShape
      {description}
      fields={selectedKind === undefined ? [] : shapeParameters[selectedKind]}
      bind:texts={parameterTexts}
      values={request?.values ?? {}}
      errors={request?.errors ?? {}}
      parameterHint={hint}
      {measurements}
    />
    <PreviewPanel
      shapeName={selectedShapeName}
      {model}
      onretry={() => (attempt += 1)}
      ondownload={downloadPrintFile}
    />
  </div>
</main>

<style>
  main {
    width: 100%;
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--space-8) var(--page-gutter) var(--space-24);
  }

  .intro {
    margin-bottom: var(--space-6);
  }

  .eyebrow {
    margin-bottom: var(--space-2);
    color: var(--color-text-dim);
    font-family: var(--font-heading);
    font-size: var(--text-tiny);
    font-variant-ligatures: none;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .lead {
    max-width: var(--prose-width);
    margin-bottom: 0;
    color: var(--color-text-muted);
    font-size: var(--text-lead);
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: var(--space-6);
  }

  @media (max-width: 860px) {
    .workspace {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 600px) {
    main {
      padding-top: var(--space-6);
      padding-bottom: var(--space-16);
    }
  }
</style>
