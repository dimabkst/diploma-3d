<script lang="ts">
import SectionHeading from './SectionHeading.svelte';
import StatusBadge from './StatusBadge.svelte';

let { shapeName, width, height }: { shapeName: string; width: number; height: number } = $props();
</script>

<section class="preview-panel" aria-labelledby="preview-heading">
  <div class="preview-header">
    <SectionHeading id="preview-heading" step="03" title="3D-перегляд" />
    <div class="unit-badge"><StatusBadge label="мм" /></div>
  </div>
  <div class="viewport">
    <div class="grid" aria-hidden="true"></div>
    <div class="wire-cube" aria-hidden="true">
      <span></span>
    </div>
    <div class="empty-state">
      <strong>Область 3D-моделі</strong>
      <span>Інтерактивний перегляд з’явиться на наступному етапі.</span>
    </div>
  </div>
  <div class="preview-footer">
    <span>Фігура: {shapeName}</span>
    <span>{width} × {height} мм</span>
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
    overflow: hidden;
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

  .wire-cube {
    position: absolute;
    top: 27%;
    width: 145px;
    height: 145px;
    border: 2px solid var(--color-link);
    transform: rotate(-8deg) skewY(12deg);
  }

  .wire-cube::before,
  .wire-cube::after,
  .wire-cube span {
    position: absolute;
    content: "";
    border: inherit;
  }

  .wire-cube::before {
    inset: -28px 24px 26px -26px;
    border-color: var(--color-accent);
  }

  .wire-cube::after {
    top: -29px;
    left: -27px;
    width: 33px;
    height: 175px;
    border-width: 2px 0 0 2px;
    transform: skewY(-43deg);
  }

  .wire-cube span {
    top: -29px;
    right: -26px;
    width: 33px;
    height: 175px;
    border-width: 2px 2px 0 0;
    transform: skewY(-43deg);
  }

  .empty-state {
    position: relative;
    z-index: 1;
    display: grid;
    align-self: end;
    justify-items: center;
    max-width: 440px;
    margin: 0 var(--space-4) var(--space-8);
    text-align: center;
  }

  .empty-state strong {
    margin-bottom: var(--space-1);
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    font-weight: 400;
  }

  .empty-state span,
  .preview-footer {
    color: var(--color-text-dim);
    font-size: var(--text-tiny);
  }

  .preview-footer {
    padding-top: var(--space-4);
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
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-1);
    }
  }
</style>
