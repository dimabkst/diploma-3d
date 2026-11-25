<script lang="ts">
import type { BoxSegment } from '@diploma-3d/schema';
import type { SegmentKey } from '../model/box.ts';
import type { PilotChoice } from '../model/parameters.ts';
import type { ConstructionField } from '../model/throughPoint.ts';
import type { DiagonalField } from '../shapes.ts';
import Button from './Button.svelte';
import ConstructionPicker from './ConstructionPicker.svelte';
import Field from './Field.svelte';
import Select from './Select.svelte';

let {
  field,
  onopen,
  onchoice,
  oncancelpending,
}: {
  field: DiagonalField;
  /** Opens the field, or closes it; the model's picking follows. */
  onopen: (open: ConstructionField | undefined) => void;
  onchoice: (choice: PilotChoice) => void;
  /** Lets go of a first vertex picked on the model. */
  oncancelpending: () => void;
} = $props();

const segmentOf = (key: SegmentKey): BoxSegment => key.split('-') as unknown as BoxSegment;
</script>

<div class="construction">
  <ConstructionPicker
    id={`${field.key}-body`}
    label="Діагональ"
    value={field.title}
    open={field.open}
    ontoggle={() => onopen(field.open ? undefined : 'diagonal')}
  >
    {#if field.pending === undefined}
      <p class="hint">
        Клацніть діагональ основи на моделі або дві протилежні вершини однієї основи. Діагональ верхньої основи дає той самий
        переріз, що й нижньої під нею.
      </p>
    {:else}
      <p class="hint" role="status">Перша вершина — {field.pending}. Оберіть протилежну вершину тієї самої основи: її підсвічено.</p>
      <div class="actions">
        <Button variant="secondary" onclick={oncancelpending}>Скасувати вибір вершини</Button>
      </div>
    {/if}
    <Field label="Або зі списку" forId={`${field.key}-list`}>
      <Select
        id={`${field.key}-list`}
        bind:value={() => field.selected, (value: SegmentKey) => onchoice({ kind: 'diagonal', segment: segmentOf(value) })}
        options={field.options}
      />
    </Field>
  </ConstructionPicker>
  {#if field.notice !== undefined}
    <p class="hint" role="status">{field.notice}</p>
  {/if}
  {#if field.open}
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
