<script lang="ts">
import type { ParameterChoices, ParameterErrors, ParameterTexts, ParameterValues } from '../model/parameters.ts';
import type { MeasurementItem, ParameterField, ShapeOption } from '../shapes.ts';
import Field from './Field.svelte';
import MeasurementList from './MeasurementList.svelte';
import NumberField from './NumberField.svelte';
import SectionHeading from './SectionHeading.svelte';

let {
  shapes,
  selectedShape = $bindable(),
  description,
  fields,
  texts = $bindable(),
  choices = $bindable(),
  values,
  errors,
  parameterHint,
  measurements,
}: {
  shapes: readonly ShapeOption[];
  selectedShape: string;
  description: string;
  fields: readonly ParameterField[];
  texts: ParameterTexts;
  choices: ParameterChoices;
  values: ParameterValues;
  errors: ParameterErrors;
  parameterHint: string | undefined;
  measurements: readonly MeasurementItem[];
} = $props();
</script>

<aside class="controls-panel" aria-label="Налаштування моделі">
  <section aria-labelledby="shape-heading">
    <SectionHeading id="shape-heading" step="01" title="Вибір фігури" />
    <Field label="Геометричне тіло" forId="shape">
      <select id="shape" bind:value={selectedShape}>
        {#each shapes as shape (shape.value)}
          <option value={shape.value}>{shape.label}</option>
        {/each}
      </select>
    </Field>
  </section>

  <section aria-labelledby="parameters-heading">
    <SectionHeading id="parameters-heading" step="02" title="Параметри" />
    <div class="section-body">
      <p class="hint">{description}</p>
      {#if fields.length > 0}
        <div class="field-grid">
          {#each fields as field (field.key)}
            {#if field.type === 'choice'}
              <Field label={field.label} forId={field.key}>
                <select id={field.key} bind:value={choices[field.key]}>
                  {#each field.options as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </Field>
            {:else}
              <NumberField
                id={field.key}
                label={field.label}
                bind:text={texts[field.key]}
                value={values[field.key]}
                range={field.range}
                suffix={field.suffix}
                error={errors[field.key]}
                describedBy={parameterHint === undefined ? undefined : 'parameter-hint'}
              />
            {/if}
          {/each}
        </div>
      {/if}
      {#if parameterHint !== undefined}
        <p class="hint" id="parameter-hint">{parameterHint}</p>
      {/if}
      <MeasurementList items={measurements} />
      <p class="hint">Розміри наведено для файлу друку. За потреби змініть масштаб у слайсері.</p>
    </div>
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

  .section-body {
    display: grid;
    gap: var(--space-4);
  }

  .field-grid {
    display: grid;
    gap: var(--space-4);
  }

  .hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
    line-height: 1.5;
  }

  @media (max-width: 420px) {
    .controls-panel {
      padding: var(--space-4);
    }
  }
</style>
