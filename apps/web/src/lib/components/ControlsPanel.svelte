<script lang="ts">
import type { ParameterChoices, ParameterErrors, ParameterTexts, ParameterValues } from '../model/parameters.ts';
import {
  type MeasurementItem,
  type NumericField,
  type OffsetGroup,
  offsetHint,
  type ParameterField,
  type ShapeOption,
} from '../shapes.ts';
import Button from './Button.svelte';
import Field from './Field.svelte';
import FieldGroup from './FieldGroup.svelte';
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

const describedBy = (...ids: (string | undefined)[]) => ids.filter((id) => id !== undefined).join(' ') || undefined;
const hintId = $derived(parameterHint === undefined ? undefined : 'parameter-hint');

/** Right when both offsets are zero, oblique otherwise; undefined while either is not valid. */
function offsetState(group: OffsetGroup): 'right' | 'oblique' | undefined {
  const [x, y] = group.fields.map((field) => values[field.key]);
  if (x === undefined || y === undefined) return undefined;
  return x === 0 && y === 0 ? 'right' : 'oblique';
}

function removeTilt(group: OffsetGroup) {
  for (const field of group.fields) texts[field.key] = '0';
}
</script>

{#snippet numberField(field: NumericField, description: string | undefined)}
  <NumberField
    id={field.key}
    label={field.label}
    bind:text={texts[field.key]}
    value={values[field.key]}
    range={field.range}
    suffix={field.suffix}
    error={errors[field.key]}
    describedBy={description}
  />
{/snippet}

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
            {:else if field.type === 'offset'}
              {@const state = offsetState(field)}
              <FieldGroup id={field.key} legend={field.legend} description={offsetHint}>
                {#each field.fields as offsetField (offsetField.key)}
                  {@render numberField(offsetField, describedBy(`${field.key}-description`, hintId))}
                {/each}
                <div class="offset-footer">
                  <p class="offset-status" aria-live="polite">
                    {#if state !== undefined}Зараз: {field.solidName[state]}{/if}
                  </p>
                  <Button variant="secondary" disabled={state === 'right'} onclick={() => removeTilt(field)}>
                    Прибрати нахил
                  </Button>
                </div>
              </FieldGroup>
            {:else}
              {@render numberField(field, hintId)}
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

  .offset-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
  }

  .offset-status {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
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
