<script lang="ts">
import type { MeasurementItem, ShapeOption } from '../shapes.ts';
import Field from './Field.svelte';
import MeasurementList from './MeasurementList.svelte';
import SectionHeading from './SectionHeading.svelte';

let {
  shapes,
  selectedShape = $bindable(),
  description,
  measurements,
}: {
  shapes: readonly ShapeOption[];
  selectedShape: string;
  description: string;
  measurements: readonly MeasurementItem[];
} = $props();
</script>

<aside class="controls-panel" aria-label="Налаштування моделі">
  <section aria-labelledby="shape-heading">
    <SectionHeading id="shape-heading" step="01" title="Вибір фігури" />
    <Field label="Геометричне тіло" forId="shape">
      <select id="shape" bind:value={selectedShape}>
        {#each shapes as shape (shape.value)}
          <option value={shape.value} disabled={!shape.available}>
            {shape.available ? shape.label : `${shape.label} — незабаром`}
          </option>
        {/each}
      </select>
    </Field>
  </section>

  <section aria-labelledby="parameters-heading">
    <SectionHeading id="parameters-heading" step="02" title="Параметри" />
    <p class="hint">{description}</p>
    <MeasurementList items={measurements} />
    <p class="hint">Розміри наведено для файлу друку. За потреби змініть масштаб у слайсері.</p>
  </section>
</aside>

<style>
  .controls-panel {
    align-self: start;
    padding: var(--space-6);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
  }

  section + section {
    margin-top: var(--space-8);
    padding-top: var(--space-8);
    border-top: 1px solid var(--color-border);
  }

  select {
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    color-scheme: dark;
    transition: border-color 200ms ease;
  }

  select:hover:not(:disabled):not(:focus-visible):not(:open) {
    border-color: var(--color-border-strong);
  }

  select:focus-visible,
  select:open {
    border-color: var(--color-border);
  }

  select:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .hint {
    margin: 0 0 var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--text-small);
    line-height: 1.5;
  }

  .hint:last-child {
    margin: var(--space-4) 0 0;
  }

  @media (max-width: 420px) {
    .controls-panel {
      padding: var(--space-4);
    }
  }
</style>
