<script lang="ts">
import { tick } from 'svelte';
import { formatSteppedDecimal } from '../decimal.ts';
import {
  alignedTrapezoidShift,
  type ParameterChoices,
  type ParameterErrors,
  type ParameterKey,
  type ParameterTexts,
  type ParameterValues,
  type TrapezoidAlignment,
} from '../model/parameters.ts';
import {
  type NumericField,
  type OffsetGroup,
  type ParameterSection as Section,
  type ShapePanel,
  sectionNumberFields,
  type TrapezoidGroup,
  trapezoidKindName,
} from '../shapes.ts';
import Button from './Button.svelte';
import Field from './Field.svelte';
import HelpToggle from './HelpToggle.svelte';
import NumberField from './NumberField.svelte';
import ParameterSection from './ParameterSection.svelte';
import Select from './Select.svelte';

let {
  panel,
  texts = $bindable(),
  choices = $bindable(),
  values,
  errors,
}: {
  panel: ShapePanel;
  texts: ParameterTexts;
  choices: ParameterChoices;
  values: ParameterValues;
  errors: ParameterErrors;
} = $props();

// Per group, across shapes: a group keeps its open state and its fields keep their values while collapsed.
let openSections = $state<Record<string, boolean>>({});
const isOpen = (section: Section) => openSections[section.key] ?? section.initiallyOpen;

const hasError = (section: Section) => sectionNumberFields(section).some((field) => errors[field.key] !== undefined);

/** Opens the group of the field, which may have been collapsed after the error appeared, and moves focus to it. */
export async function focusField(key: ParameterKey): Promise<void> {
  if (panel.type !== 'parameters') return;
  const owner = panel.sections.find((section) => sectionNumberFields(section).some((field) => field.key === key));
  if (owner !== undefined) openSections[owner.key] = true;
  await tick();
  document.getElementById(key)?.focus();
}

/** Centred when every value is zero, moved otherwise; undefined while any is not valid. */
function offsetState(group: OffsetGroup): 'centred' | 'moved' | undefined {
  const positions = group.fields.map((field) => values[field.key]);
  if (positions.some((value) => value === undefined)) return undefined;
  return positions.every((value) => value === 0) ? 'centred' : 'moved';
}

const offsetOf = (section: Section) => section.fields.find((field): field is OffsetGroup => field.type === 'offset');

function resetOffset(group: OffsetGroup) {
  for (const field of group.fields) texts[field.key] = '0';
}

function alignSideB(group: TrapezoidGroup, alignment: TrapezoidAlignment) {
  const [side, , shift] = group.fields;
  const sideRatio = values[side.key];
  if (alignment === 'centre' || sideRatio !== undefined) {
    texts[shift.key] = formatSteppedDecimal(alignedTrapezoidShift(sideRatio ?? 1, alignment));
  }
}

const alignments: readonly { readonly alignment: TrapezoidAlignment; readonly label: string }[] = [
  { alignment: 'left', label: 'Вирівняти зліва' },
  { alignment: 'centre', label: 'По центру' },
  { alignment: 'right', label: 'Вирівняти справа' },
];
</script>

{#snippet numberField(field: NumericField)}
  <NumberField
    id={field.key}
    label={field.label}
    bind:text={texts[field.key]}
    value={values[field.key]}
    range={field.range}
    suffix={field.suffix}
    error={errors[field.key]}
  />
{/snippet}

<aside class="controls-panel" aria-label="Налаштування моделі">
  <div class="controls-scroll">
  {#if panel.type === 'fixed'}
    <p class="note">{panel.note}</p>
  {:else}
    <div class="panel-header">
      <h2 class="panel-title">Параметри</h2>
      <HelpToggle id="reference-help" help={panel.help} />
    </div>
    <div class="sections">
      {#each panel.sections as section (section.key)}
        {@const offset = offsetOf(section)}
        {@const state = offset === undefined ? undefined : offsetState(offset)}
        <ParameterSection
          title={section.title}
          bind:open={() => isOpen(section), (open) => (openSections[section.key] = open)}
          status={offset === undefined || state === undefined ? undefined : offset.status[state]}
          highlighted={state === 'moved'}
          invalid={hasError(section)}
        >
          {#each section.fields as field (field.key)}
            {#if field.type === 'choice'}
              <Field label={field.label} forId={field.key}>
                <Select id={field.key} bind:value={choices[field.key]} options={field.options} />
              </Field>
            {:else if field.type === 'offset'}
              {#each field.fields as offsetField (offsetField.key)}
                {@render numberField(offsetField)}
              {/each}
              <div class="group-actions">
                <!-- Also enabled while a value is invalid: resetting is a way to correct it. -->
                <Button variant="secondary" disabled={state === 'centred'} onclick={() => resetOffset(field)}>
                  {field.resetLabel}
                </Button>
              </div>
            {:else if field.type === 'trapezoid'}
              {@const sideRatio = values[field.fields[0].key]}
              {@const kindName = trapezoidKindName(sideRatio, values[field.fields[2].key])}
              {#each field.fields as trapezoidField (trapezoidField.key)}
                {@render numberField(trapezoidField)}
              {/each}
              <div class="group-actions" role="group" aria-label="Вирівнювання сторони b">
                {#each alignments as { alignment, label } (alignment)}
                  <Button
                    variant="secondary"
                    disabled={alignment !== 'centre' && sideRatio === undefined}
                    onclick={() => alignSideB(field, alignment)}
                  >
                    {label}
                  </Button>
                {/each}
              </div>
              <p class="group-status" aria-live="polite">{#if kindName !== undefined}Зараз: {kindName}{/if}</p>
            {:else}
              {@render numberField(field)}
            {/if}
          {/each}
          {#if section.help !== undefined}
            <HelpToggle id={`${section.key}-help`} help={section.help} />
          {/if}
        </ParameterSection>
      {/each}
    </div>
  {/if}
  </div>
</aside>

<style>
  /*
   * The outline follows the content up to the height the page allows. The vertical padding equals the corner radius,
   * so a scrollbar of the inner element runs along the straight part of the border and its ends stay inside the
   * rounded outline. `clip`, unlike `hidden`, does not make the panel a scroll container.
   */
  .controls-panel {
    display: flex;
    flex-direction: column;
    align-self: start;
    min-width: 0;
    min-height: 0;
    max-height: 100%;
    padding-block: var(--radius-card);
    overflow: clip;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-card);
  }

  /*
   * Scrolls only where the page asks for it with --controls-overflow-y: auto, in the two-column layout. Elsewhere it
   * is no scroll container at all, so a touch gesture that starts on the controls scrolls the page. The small vertical
   * padding keeps focus outlines of the first and last controls clear of the clipping edge.
   */
  .controls-scroll {
    min-height: 0;
    padding: var(--space-1) var(--space-6);
    overflow-y: var(--controls-overflow-y, visible);
    scrollbar-gutter: stable;
  }

  .note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
    line-height: 1.5;
  }

  .panel-header {
    display: grid;
    gap: var(--space-1);
    padding-bottom: var(--space-2);
  }

  .panel-title {
    margin: 0;
    font-size: var(--text-small);
    color: var(--color-text-dim);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .sections {
    border-bottom: 1px solid var(--color-border);
  }

  .group-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .group-status {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  @media (max-width: 420px) {
    .controls-scroll {
      padding-inline: var(--space-4);
    }
  }
</style>
