<script lang="ts">
import type { VertexLabel } from '@diploma-3d/engine';
import type { Section } from '@diploma-3d/schema';
import { vertexName } from '../model/box.ts';
import { type ModelState, visibleArtifacts } from '../model/modelState.ts';
import type { ParameterKey } from '../model/parameters.ts';
import { formatSize } from '../shapes.ts';
import Button from './Button.svelte';
import ModelViewer from './ModelViewer.svelte';
import SectionCompass from './SectionCompass.svelte';
import StatusBadge from './StatusBadge.svelte';

let {
  shapeName,
  model,
  separated,
  invalidFields,
  onfocusfield,
  onretry,
}: {
  shapeName: string;
  model: ModelState;
  /**
   * The switch that shows the parts of a section moved apart; the model and its print file stay the same. It selects
   * between the previews of the shown model only, which has none to select from without a section.
   */
  separated: boolean;
  /** The fields that keep the model from updating, in panel order. */
  invalidFields: readonly { readonly key: ParameterKey; readonly label: string }[];
  onfocusfield: (key: ParameterKey) => void;
  onretry: () => void;
} = $props();

let modelViewer = $state<ModelViewer>();

// Keyed by the GLB bytes so that events of a replaced preview cannot mark the current one as loaded or failed.
let loadedGlb = $state.raw<Uint8Array<ArrayBuffer>>();
let failedGlb = $state.raw<Uint8Array<ArrayBuffer>>();

// The section of the model on screen: replaced together with its parts, once they have loaded.
let shownSection = $state.raw<Section | undefined>();
let cameraDirection = $state.raw({ theta: 0, phi: 0 });

const artifacts = $derived(visibleArtifacts(model));
// Either preview of a section is ready with the model, so toggling the separation only swaps them.
const glb = $derived(separated ? (artifacts?.separatedPreviewGlb ?? artifacts?.previewGlb) : artifacts?.previewGlb);
// The vertices go with the preview shown, also with the parts apart; named as a textbook writes them, A₁ for A1.
const labels = $derived<readonly VertexLabel[]>(
  (
    (separated && artifacts?.separatedPreviewGlb !== undefined ? artifacts?.separatedVertexLabels : artifacts?.vertexLabels) ?? []
  ).map((label) => ({ ...label, name: vertexName(label.name as Parameters<typeof vertexName>[0]) })),
);
// The parts of the shown model: two of a single cut, three between two parallel planes.
const partCount = $derived(
  artifacts?.model.solids.filter((solid) => solid.part !== undefined && solid.part !== 'dowel' && solid.part !== 'plate')
    .length ?? 0,
);
const previewStatus = $derived(
  model.status !== 'ready' ? model.status : glb === failedGlb ? 'failed' : glb === loadedGlb ? 'loaded' : 'loading',
);
// Without a GLB the viewer is removed; the next one starts empty.
$effect.pre(() => {
  if (glb === undefined) {
    loadedGlb = undefined;
    shownSection = undefined;
  }
});

function showLoaded(loaded: Uint8Array<ArrayBuffer>) {
  loadedGlb = loaded;
  shownSection = artifacts?.model.spec.section;
}

// Whether some earlier model is already on screen, so an update needs only a small indicator instead of an overlay.
const showsPreview = $derived(glb !== undefined && loadedGlb !== undefined && failedGlb !== glb);
// The exported width, depth and height: of the current model, or of the previous one, marked, while it is replaced. The
// mesh bounds do not depend on the camera.
const shownArtifacts = $derived(model.status === 'ready' || model.status === 'generating' ? visibleArtifacts(model) : undefined);
const size = $derived(shownArtifacts?.model.size);
// The parts of a section together are the whole solid, which the size describes.
const assembled = $derived(shownArtifacts?.model.section !== undefined);
</script>

<section class="preview-panel" aria-label="3D-перегляд">
  <div
    class="viewport"
    data-preview-status={previewStatus}
    aria-busy={previewStatus === 'loading' || previewStatus === 'generating'}
  >
    <div class="grid" aria-hidden="true"></div>
    {#if glb !== undefined}
      <div class={['viewer-layer', { outdated: model.status === 'invalid' }]}>
        <ModelViewer
          bind:this={modelViewer}
          {glb}
          viewKey={artifacts?.model.kind ?? ''}
          alt={`Інтерактивна 3D-модель: ${shapeName.toLowerCase()}${artifacts?.model.section === undefined ? '' : partCount === 3 ? ', три частини перерізу' : ', дві частини перерізу'}`}
          {labels}
          onload={showLoaded}
          onerror={(failed) => (failedGlb = failed)}
          oncamerachange={(direction) => (cameraDirection = direction)}
        />
      </div>
    {/if}
    {#if shownSection?.type === 'oblique' || shownSection?.type === 'oblique-apex' || (shownSection?.type === 'inclined' && shownSection.normalAlong === undefined)}
      <SectionCompass directionDeg={shownSection.directionDeg} camera={cameraDirection} />
    {/if}

    {#if (previewStatus === 'generating' || previewStatus === 'loading') && showsPreview}
      <div class="viewport-badge" role="status"><StatusBadge label="Оновлення…" /></div>
    {:else if previewStatus === 'generating'}
      <div class="viewport-status" role="status">
        <strong>Створення моделі…</strong>
        <span>Обчислюємо геометрію та готуємо файли.</span>
      </div>
    {:else if previewStatus === 'loading'}
      <div class="viewport-status" role="status">
        <strong>Завантаження 3D-перегляду…</strong>
      </div>
    {:else if model.status === 'invalid'}
      <div class="viewport-status error" role="alert">
        <strong>Модель не оновлено</strong>
        {#if invalidFields.length > 0}
          <span>Виправте значення:</span>
          <div class="status-actions">
            {#each invalidFields as field (field.key)}
              <Button variant="secondary" onclick={() => onfocusfield(field.key)}>{field.label}</Button>
            {/each}
          </div>
        {:else}
          <span>Виправте параметри фігури, щоб створити нову модель.</span>
        {/if}
      </div>
    {:else if model.status === 'error'}
      <div class="viewport-status error" role="alert">
        <strong>Не вдалося створити модель</strong>
        <span>{model.message}</span>
        <div class="status-actions"><Button variant="secondary" onclick={onretry}>Спробувати ще раз</Button></div>
      </div>
    {:else if previewStatus === 'failed'}
      <div class="viewport-status error" role="alert">
        <strong>Не вдалося показати 3D-перегляд</strong>
        <span>Модель створено, і файл 3MF можна завантажити. Перевірте, чи браузер підтримує WebGL.</span>
      </div>
    {/if}
  </div>
  <div class="preview-footer">
    <p class={['dimensions', { outdated: model.status !== 'ready' }]}>{assembled ? 'Габарити в зборі' : 'Габарити'}: {formatSize(size)}</p>
    <p class="viewer-tip">Перетягніть — обертання, колесо або два пальці — масштаб</p>
    <Button variant="secondary" disabled={previewStatus !== 'loaded'} onclick={() => modelViewer?.fit()}>
      Вписати модель
    </Button>
  </div>
</section>

<style>
  /* Fills the height the page gives it; without one, the viewport takes --preview-viewport-height. */
  .preview-panel {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    padding: var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
  }

  .viewport {
    position: relative;
    display: grid;
    height: var(--preview-viewport-height, auto);
    min-height: 0;
    place-items: center;
    overflow: hidden;
    background: var(--color-bg);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-input);
  }

  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(#ffffff0a 1px, transparent 1px), linear-gradient(90deg, #ffffff0a 1px, transparent 1px);
    background-size: 32px 32px;
    border-radius: inherit;
  }

  .grid::before,
  .grid::after {
    position: absolute;
    content: "";
    background: var(--color-border-strong);
  }

  .grid::before {
    top: 50%;
    right: 0;
    left: 0;
    height: 1px;
  }

  .grid::after {
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
  }

  .viewer-layer {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    transition: opacity 200ms ease;
  }

  .viewer-layer.outdated {
    opacity: 0.35;
  }

  .viewport-badge {
    position: absolute;
    z-index: 1;
    top: var(--space-3);
    left: var(--space-3);
  }

  .viewport-status {
    position: relative;
    z-index: 1;
    display: grid;
    justify-items: center;
    gap: var(--space-1);
    max-width: 440px;
    margin: 0 var(--space-4);
    padding: var(--space-4);
    text-align: center;
    background: var(--color-bg);
  }

  .viewport-status strong {
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    font-weight: 400;
  }

  .viewport-status.error strong {
    color: var(--color-error);
  }

  .viewport-status span {
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  .status-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .preview-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    padding-top: var(--space-3);
    container-type: inline-size;
  }

  .preview-footer p {
    margin: 0;
    white-space: nowrap;
  }

  .dimensions {
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
    transition: color 200ms ease;
  }

  .dimensions.outdated {
    color: var(--color-text-dim);
  }

  .viewer-tip {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-dim);
    font-size: var(--text-tiny);
    text-overflow: ellipsis;
  }

  /* The tip is optional; where it would not fit on the line it gives way to the dimensions and the action. */
  @container (max-width: 640px) {
    .viewer-tip {
      display: none;
    }

    .dimensions {
      flex: 1;
    }
  }
</style>
