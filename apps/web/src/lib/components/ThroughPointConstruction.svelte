<script lang="ts">
import type { BoxSegment } from '@diploma-3d/schema';
import type { SegmentKey } from '../model/box.ts';
import type { ParameterTexts, ParameterValues, PilotChoice } from '../model/parameters.ts';
import type { ConstructionField, PointMode } from '../model/throughPoint.ts';
import type { ThroughPointField } from '../shapes.ts';
import Button from './Button.svelte';
import ConstructionPicker from './ConstructionPicker.svelte';
import Field from './Field.svelte';
import NumberField from './NumberField.svelte';
import RatioInput from './RatioInput.svelte';
import SegmentedControl from './SegmentedControl.svelte';
import Select from './Select.svelte';

let {
  field,
  texts = $bindable(),
  values,
  onopen,
  onchoice,
  oncancelpending,
}: {
  field: ThroughPointField;
  texts: ParameterTexts;
  values: ParameterValues;
  /** Opens one of the two fields, or closes the construction with none; the model's picking follows. */
  onopen: (open: ConstructionField | undefined) => void;
  onchoice: (choice: PilotChoice) => void;
  /** Lets go of a first vertex picked on the model. */
  oncancelpending: () => void;
} = $props();

const segmentOf = (key: SegmentKey): BoxSegment => key.split('-') as unknown as BoxSegment;
const ratioError = $derived(field.point.ratioError);
const toggle = (open: ConstructionField) => onopen(field.open === open ? undefined : open);
// A list's first entry while nothing is chosen, so that a choice is always an act of the user.
const withNone = (options: readonly { readonly value: SegmentKey; readonly label: string }[]) => [
  { value: '' as const, label: 'Не обрано', disabled: true },
  ...options,
];
const modes: readonly { readonly value: PointMode; readonly label: string }[] = [
  { value: 'midpoint', label: 'Середина' },
  { value: 'ratio', label: 'За відношенням' },
];
</script>

<div class="construction">
  <Field label="Спосіб" forId={`${field.key}-method`}>
    <Select
      id={`${field.key}-method`}
      bind:value={() => field.method, (method: 'point' | 'angle') => onchoice({ kind: 'method', method })}
      options={field.methods}
    />
  </Field>
  <ConstructionPicker
    id={`${field.key}-segment`}
    label={field.segment.baseEdge ? 'Ребро основи' : 'Відрізок'}
    value={field.segment.title ?? 'не обрано'}
    open={field.open === 'segment'}
    ontoggle={() => toggle('segment')}
  >
    {#if field.segment.pending === undefined}
      <p class="hint">
        {field.segment.baseEdge
          ? 'Оберіть ребро основи або дві його вершини: на моделі їх підсвічено.'
          : 'Оберіть ребро або дві вершини однієї грані: на моделі придатні вершини й ребра підсвічено.'}
      </p>
    {:else}
      <p class="hint" role="status">
        Перша вершина — {field.segment.pending}. Оберіть другу вершину {field.segment.baseEdge ? 'основи' : 'тієї самої грані'}: їх
        підсвічено.
      </p>
      <div class="actions">
        <Button variant="secondary" onclick={oncancelpending}>Скасувати вибір вершини</Button>
      </div>
    {/if}
    <Field label="Або зі списку" forId={`${field.key}-segment-list`}>
      <Select
        id={`${field.key}-segment-list`}
        bind:value={
          () => field.segment.selected,
          (value) => {
            if (value !== '') onchoice({ kind: 'segment', segment: segmentOf(value) });
          }
        }
        options={withNone(field.segment.options)}
      />
    </Field>
  </ConstructionPicker>

  {#if field.angle !== undefined}
    {@const angle = field.angle}
    <ConstructionPicker
      id={`${field.key}-angle`}
      label={angle.title}
      value={angle.value}
      open={field.open === 'angle'}
      ontoggle={() => toggle('angle')}
    >
      {#if angle.faces.length > 1}
        <SegmentedControl
          legend="Кут відраховано від грані"
          name={`${field.key}-angle-face`}
          value={angle.face}
          options={angle.faces}
          onchange={(face) => onchoice({ kind: 'angle-face', face })}
        />
        <p class="hint">
          Або клацніть на моделі іншу грань ребра {field.segment.title}: її підсвічено під вказівником, а грань відліку — завжди.
        </p>
      {:else}
        <p class="hint">Відрізок {field.segment.title} лежить лише в грані {angle.faces[0]?.label}: кут відраховано від неї.</p>
      {/if}
      <NumberField
        id={angle.field.key}
        label={angle.field.label}
        bind:text={texts[angle.field.key]}
        value={values[angle.field.key]}
        range={angle.field.range}
        suffix={angle.field.suffix}
        error={angle.error}
      />
      <p class="hint">
        Менший кут між площиною перерізу і гранню {angle.faces.find(({ value }) => value === angle.face)?.label}: 0° — сама грань,
        90° — площина перпендикулярна до неї.
      </p>
    </ConstructionPicker>
  {:else}
  <ConstructionPicker
    id={`${field.key}-point`}
    label="Точка M"
    value={field.point.title ?? 'не обрано'}
    open={field.open === 'point'}
    describedBy={ratioError === undefined ? undefined : `${field.key}-point-error`}
    ontoggle={() => toggle('point')}
  >
    <p class="hint">
      {field.segment.title === undefined
        ? 'Спершу оберіть відрізок.'
        : `Оберіть ребро для точки M: на моделі підсвічено ребра, що дають переріз з ${field.segment.title}.`}
    </p>
    <Field label="Ребро зі списку" forId={`${field.key}-point-list`}>
      <Select
        id={`${field.key}-point-list`}
        bind:value={
          () => field.point.selected,
          (value) => {
            if (value !== '') onchoice({ kind: 'point-edge', edge: segmentOf(value) });
          }
        }
        options={withNone(field.point.options)}
      />
    </Field>
    {#if field.point.labels !== undefined}
      <SegmentedControl
        legend="Положення M"
        name={`${field.key}-mode`}
        value={field.point.mode}
        options={modes}
        onchange={(mode) => onchoice({ kind: 'mode', mode })}
      />
      {#if field.point.mode === 'ratio'}
        <!-- Read as written: DM : MD₁ = a : b, each number labelled by the part of the edge it is. -->
        <RatioInput
          keys={[field.point.fields[0].key, field.point.fields[1].key]}
          labels={field.point.labels}
          bind:texts
          {values}
          invalid={field.point.ratioInvalid}
          describedBy={ratioError === undefined ? undefined : `${field.key}-point-error`}
        />
      {/if}
    {/if}
  </ConstructionPicker>
  {/if}
  {#if field.angle?.alternative === true}
    <!-- The other plane through the segment at the same angle to the same face, chosen only on request. -->
    <div class="actions">
      <Button variant="secondary" disabled={field.angle.switching} onclick={() => onchoice({ kind: 'angle-side' })}>
        Інше положення перерізу
      </Button>
    </div>
  {/if}
  {#if ratioError !== undefined}
    <p class="error" id={`${field.key}-point-error`}>{ratioError}</p>
  {/if}
  {#if field.notice !== undefined}
    <p class="hint" role="status">{field.notice}</p>
  {/if}
  <!-- The next choice to make, or why the construction gives no section; the model stays as it is meanwhile. -->
  {#if field.status !== undefined}
    <p class={['status', field.status.tone]} role="status">{field.status.text}</p>
  {/if}
  {#if field.open !== undefined}
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
</style>
