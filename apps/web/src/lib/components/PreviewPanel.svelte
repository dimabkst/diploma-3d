<script lang="ts">
import type { ModelState } from '../model/modelState.ts';
import { formatSize } from '../shapes.ts';
import Button from './Button.svelte';
import ModelViewer from './ModelViewer.svelte';
import SectionHeading from './SectionHeading.svelte';
import StatusBadge from './StatusBadge.svelte';

let {
  shapeName,
  model,
  onretry,
  ondownload,
}: {
  shapeName: string;
  model: ModelState;
  onretry: () => void;
  ondownload: () => void;
} = $props();

// Keyed by the GLB bytes so that events of a replaced preview cannot mark the current one as loaded or failed.
let loadedGlb = $state.raw<Uint8Array<ArrayBuffer>>();
let failedGlb = $state.raw<Uint8Array<ArrayBuffer>>();

const glb = $derived(model.status === 'ready' ? model.artifacts.previewGlb : undefined);
const previewStatus = $derived(
  glb === undefined ? 'waiting' : glb === failedGlb ? 'failed' : glb === loadedGlb ? 'loaded' : 'loading',
);
const size = $derived(model.status === 'ready' ? model.artifacts.model.solids[0]?.measurements.size : undefined);
</script>

<section class="preview-panel" aria-labelledby="preview-heading">
  <div class="preview-header">
    <SectionHeading id="preview-heading" step="03" title="3D-перегляд" />
    <div class="unit-badge"><StatusBadge label="мм" /></div>
  </div>
  <div class="viewport" data-preview-status={previewStatus} aria-busy={previewStatus === 'loading' || model.status === 'generating'}>
    <div class="grid" aria-hidden="true"></div>
    {#if glb !== undefined}
      {#key glb}
        <ModelViewer
          {glb}
          alt={`Інтерактивна 3D-модель: ${shapeName.toLowerCase()}`}
          onload={() => (loadedGlb = glb)}
          onerror={() => (failedGlb = glb)}
        />
      {/key}
    {/if}

    {#if model.status === 'generating'}
      <div class="viewport-status" role="status">
        <strong>Створення моделі…</strong>
        <span>Обчислюємо геометрію та готуємо файли.</span>
      </div>
    {:else if model.status === 'error'}
      <div class="viewport-status error" role="alert">
        <strong>Не вдалося створити модель</strong>
        <span>{model.message}</span>
        <div class="status-action"><Button variant="secondary" onclick={onretry}>Спробувати ще раз</Button></div>
      </div>
    {:else if previewStatus === 'loading'}
      <div class="viewport-status" role="status">
        <strong>Завантаження 3D-перегляду…</strong>
      </div>
    {:else if previewStatus === 'failed'}
      <div class="viewport-status error" role="alert">
        <strong>Не вдалося показати 3D-перегляд</strong>
        <span>Модель створено, і файл 3MF можна завантажити. Перевірте, чи браузер підтримує WebGL.</span>
      </div>
    {/if}
  </div>
  <div class="preview-footer">
    <div class="preview-meta">
      <span>Фігура: {shapeName} · {formatSize(size)}</span>
      <span>Перетягніть, щоб обертати; прокрутіть або зведіть пальці, щоб масштабувати.</span>
    </div>
    <Button disabled={model.status !== 'ready'} loading={model.status === 'generating'} onclick={ondownload}>
      Завантажити 3MF
    </Button>
  </div>
</section>

<style>
  .preview-panel {
    display: grid;
    min-width: 0;
    padding: var(--space-6);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
    grid-template-rows: auto 1fr auto;
  }

  .preview-header,
  .preview-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .unit-badge {
    margin-bottom: var(--space-6);
  }

  .viewport {
    position: relative;
    display: grid;
    min-height: 480px;
    place-items: center;
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

  .status-action {
    margin-top: var(--space-3);
  }

  .preview-footer {
    padding-top: var(--space-4);
  }

  .preview-meta {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
    color: var(--color-text-dim);
    font-size: var(--text-tiny);
  }

  .preview-meta span:first-child {
    color: var(--color-text-muted);
    font-family: var(--font-heading);
    font-variant-ligatures: none;
  }

  @media (max-width: 600px) {
    .preview-panel {
      padding: var(--space-4);
    }

    .viewport {
      min-height: 390px;
    }

    .preview-footer {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
