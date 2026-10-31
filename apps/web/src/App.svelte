<script lang="ts">
import { THREE_MF_MEDIA_TYPE } from '@diploma-3d/engine';
import { defaultModelSpecs } from '@diploma-3d/schema';
import AppHeader from './lib/components/AppHeader.svelte';
import ControlsPanel from './lib/components/ControlsPanel.svelte';
import PageHeading from './lib/components/PageHeading.svelte';
import PreviewPanel from './lib/components/PreviewPanel.svelte';
import { saveFile } from './lib/download.ts';
import { buildModel } from './lib/model/buildModel.ts';
import { describeModelError, type ModelState } from './lib/model/modelState.ts';
import { isAvailableShape, measurementItems, shapeDescriptions, shapeLabel, shapeOptions } from './lib/shapes.ts';

let selectedShape = $state<string>('cube');
let attempt = $state(0);
// Raw state: the artifacts hold large typed arrays that must not be wrapped in deep reactive proxies.
let model = $state.raw<ModelState>({ status: 'generating' });

const selectedKind = $derived(isAvailableShape(selectedShape) ? selectedShape : undefined);
const selectedShapeName = $derived(shapeLabel(selectedShape));
const measurements = $derived(
  selectedKind === undefined
    ? []
    : measurementItems(selectedKind, model.status === 'ready' ? model.artifacts.model.solids[0]?.measurements : undefined),
);

let latestRequest = 0;

$effect(() => {
  void attempt;
  const kind = selectedKind;
  const request = ++latestRequest;
  if (kind === undefined) {
    model = { status: 'error', message: 'Ця фігура ще недоступна.' };
    return;
  }
  model = { status: 'generating' };
  buildModel(defaultModelSpecs[kind]).then(
    (artifacts) => {
      if (request === latestRequest) model = { status: 'ready', artifacts };
    },
    (error: unknown) => {
      console.error(error);
      if (request === latestRequest) model = { status: 'error', message: describeModelError(error) };
    },
  );
});

function downloadPrintFile() {
  if (model.status !== 'ready') return;
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
      description={selectedKind === undefined ? '' : shapeDescriptions[selectedKind]}
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
