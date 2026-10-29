<script lang="ts">
import Field from './Field.svelte';
import SectionHeading from './SectionHeading.svelte';

type ShapeOption = {
  readonly value: string;
  readonly label: string;
};

let {
  shapes,
  selectedShape = $bindable(),
  width = $bindable(),
  height = $bindable(),
}: {
  shapes: readonly ShapeOption[];
  selectedShape: string;
  width: number;
  height: number;
} = $props();
</script>

<aside class="controls-panel" aria-label="Налаштування моделі">
  <section aria-labelledby="shape-heading">
    <SectionHeading id="shape-heading" step="01" title="Вибір фігури" />
    <Field label="Геометричне тіло" forId="shape">
      <select id="shape" bind:value={selectedShape}>
        {#each shapes as shape}
          <option value={shape.value}>{shape.label}</option>
        {/each}
      </select>
    </Field>
  </section>

  <section aria-labelledby="parameters-heading">
    <SectionHeading id="parameters-heading" step="02" title="Параметри" />
    <div class="field-grid">
      <Field label="Ширина" forId="width">
        <div class="number-field">
          <input id="width" bind:value={width} type="number" min="1" />
          <span aria-hidden="true">мм</span>
        </div>
      </Field>
      <Field label="Висота" forId="height">
        <div class="number-field">
          <input id="height" bind:value={height} type="number" min="1" />
          <span aria-hidden="true">мм</span>
        </div>
      </Field>
    </div>
    <p class="hint">Точні обмеження параметрів будуть додані разом із геометричним рушієм.</p>
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

  select,
  .number-field {
    width: 100%;
    min-height: 44px;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    color-scheme: dark;
    transition: border-color 200ms ease;
  }

  select {
    padding: 0 var(--space-3);
  }

  select:hover:not(:disabled):not(:focus-visible):not(:open),
  .number-field:hover:not(:has(input:disabled)):not(:has(input:focus-visible)):not(:has(input:invalid)) {
    border-color: var(--color-border-strong);
  }

  select:focus-visible,
  select:open {
    border-color: var(--color-border);
  }

  .number-field:has(input:focus-visible) {
    border-color: var(--color-border);
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .number-field:has(input:invalid) {
    border-color: var(--color-error);
  }

  select:disabled,
  .number-field:has(input:disabled) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .number-field {
    display: flex;
    align-items: center;
    overflow: hidden;
  }

  input {
    width: 100%;
    min-width: 0;
    min-height: 42px;
    padding: 0 var(--space-3);
    color: var(--color-text);
    background: transparent;
    border: 0;
    border-radius: inherit;
    font-family: var(--font-heading);
    font-variant-ligatures: none;
  }

  input:focus-visible {
    outline: none;
  }

  input:disabled {
    cursor: not-allowed;
  }

  .number-field span {
    padding-right: var(--space-3);
    color: var(--color-text-muted);
    font-family: var(--font-heading);
    font-size: var(--text-small);
  }

  .hint {
    margin: var(--space-4) 0 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
    line-height: 1.5;
  }

  @media (max-width: 420px) {
    .controls-panel {
      padding: var(--space-4);
    }

    .field-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
