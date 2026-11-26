<script lang="ts">
import type { BoxSegment, BoxVertex } from '@diploma-3d/schema';
import type { SegmentKey } from '../model/box.ts';
import type { ParameterTexts, ParameterValues, PilotChoice } from '../model/parameters.ts';
import type { ConstructionField, PointMode } from '../model/throughPoint.ts';
import type { TraceField } from '../shapes.ts';
import Button from './Button.svelte';
import ConstructionPicker from './ConstructionPicker.svelte';
import Field from './Field.svelte';
import RatioInput from './RatioInput.svelte';
import SegmentedControl from './SegmentedControl.svelte';
import Select from './Select.svelte';

let {
  field,
  texts = $bindable(),
  values,
  onopen,
  onchoice,
}: {
  field: TraceField;
  texts: ParameterTexts;
  values: ParameterValues;
  /** Opens the field, or closes it; the model's picking follows. */
  onopen: (open: ConstructionField | undefined) => void;
  onchoice: (choice: PilotChoice) => void;
} = $props();

const segmentOf = (value: string) => value.split('-') as unknown as BoxSegment;
const choose = (value: string) =>
  onchoice(
    field.target === 'side'
      ? { kind: 'trace-side', segment: segmentOf(value) }
      : { kind: 'trace-vertex', vertex: value as BoxVertex },
  );
const modes: readonly { readonly value: PointMode; readonly label: string }[] = [
  { value: 'midpoint', label: 'Середина' },
  { value: 'ratio', label: 'За відношенням' },
];
const pointOpen = $derived(field.point?.open === true);
</script>

<div class="construction">
  <ConstructionPicker
    id={`${field.key}-body`}
    label={field.label}
    value={field.title}
    open={field.open}
    ontoggle={() => onopen(field.open ? undefined : 'trace')}
  >
    <p class="hint">{field.hint}</p>
    <Field label="Або зі списку" forId={`${field.key}-list`}>
      <Select id={`${field.key}-list`} bind:value={() => field.selected, choose} options={field.options} />
    </Field>
  </ConstructionPicker>
  {#if field.point !== undefined}
    {@const point = field.point}
    {@const errorId = `${field.key}-point-error`}
    <ConstructionPicker
      id={`${field.key}-point`}
      label="Точка M"
      value={point.title}
      open={point.open}
      describedBy={point.error === undefined ? undefined : errorId}
      ontoggle={() => onopen(point.open ? undefined : 'trace-point')}
    >
      <p class="hint">
        Клацніть на моделі ребро основи для M: підсвічено ті, що дають переріз із вибраним бічним ребром.
      </p>
      <Field label="Ребро зі списку" forId={`${field.key}-point-list`}>
        <Select
          id={`${field.key}-point-list`}
          bind:value={
            () => point.selected,
            (value: SegmentKey | '') => {
              if (value !== '') onchoice({ kind: 'trace-side', segment: segmentOf(value) });
            }
          }
          options={point.options}
        />
      </Field>
      <SegmentedControl
        legend="Положення точки M"
        name={`${field.key}-point-mode`}
        value={point.mode}
        options={modes}
        onchange={(mode) => onchoice({ kind: 'trace-point-mode', mode })}
      />
      {#if point.mode === 'ratio'}
        <p class="hint">
          {point.labels[0]} : {point.labels[1]} — частини ребра по обидва боки від M. Так 1 : 2 — третина ребра від початку.
        </p>
        <RatioInput
          keys={point.keys}
          labels={point.labels}
          bind:texts
          {values}
          invalid={point.invalid}
          describedBy={point.error === undefined ? undefined : errorId}
        />
      {/if}
    </ConstructionPicker>
    {#if point.error !== undefined}
      <p class="error" id={errorId}>{point.error}</p>
    {/if}
  {/if}
  <!-- Why the construction gives no section; the model stays as it is meanwhile. -->
  {#if field.status !== undefined}
    <p class={['status', field.status.tone]} role="status">{field.status.text}</p>
  {/if}
  {#if field.open || pointOpen}
    <div class="actions">
      <Button variant="secondary" onclick={() => onopen(undefined)}>Готово</Button>
    </div>
  {/if}
</div>

<style>
  .construction {
    display: grid;
    gap: var(--space-2);
  }

  .hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  .error {
    margin: 0;
    color: var(--color-error);
    font-size: var(--text-small);
  }

  .status {
    margin: 0;
    font-size: var(--text-small);
  }

  .status.hint {
    color: var(--color-text-muted);
  }

  .status.warning {
    padding-left: var(--space-3);
    color: var(--color-text);
    border-left: 2px solid var(--color-error);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
