<script lang="ts">
import type { BoxSegment } from '@diploma-3d/schema';
import type { SegmentKey } from '../model/box.ts';
import type { PilotChoice } from '../model/parameters.ts';
import type { ConstructionField } from '../model/throughPoint.ts';
import type { NormalField } from '../shapes.ts';
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
  field: NormalField;
  /** Opens the field, or closes it; the model's picking follows. */
  onopen: (open: ConstructionField | undefined) => void;
  onchoice: (choice: PilotChoice) => void;
  /** Lets go of a first vertex picked on the model. */
  oncancelpending: () => void;
} = $props();

const segmentOf = (key: SegmentKey): BoxSegment => key.split('-') as unknown as BoxSegment;
// The list's first entry while the plane is given by its angles, so that a choice is always an act of the user.
const options = $derived([{ value: '' as const, label: 'Не вибрано — задано кутами', disabled: true }, ...field.options]);
</script>

<div class="construction">
  <ConstructionPicker
    id={`${field.key}-body`}
    label="Перпендикулярно до"
    value={field.title}
    open={field.open}
    ontoggle={() => onopen(field.open ? undefined : 'normal')}
  >
    {#if field.chosen !== undefined}
      <p class="chosen">Обрано: {field.chosen}.</p>
    {/if}
    {#if field.pending === undefined}
      <p class="hint">
        Клацніть ребро на моделі або дві будь-які вершини: їхній відрізок — ребро, діагональ грані чи діагональ тіла — задає
        напрям, перпендикулярний до площини. Сам відрізок площина може й не перетинати.
      </p>
    {:else}
      <p class="hint" role="status">Перша вершина — {field.pending}. Оберіть другу вершину.</p>
      <div class="actions">
        <Button variant="secondary" onclick={oncancelpending}>Скасувати вибір вершини</Button>
      </div>
    {/if}
    <Field label="Або зі списку" forId={`${field.key}-list`}>
      <Select
        id={`${field.key}-list`}
        bind:value={
          () => field.selected,
          (value: SegmentKey | '') => {
            if (value !== '') onchoice({ kind: 'normal', segment: segmentOf(value) });
          }
        }
        {options}
      />
    </Field>
  </ConstructionPicker>
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

  .chosen {
    margin: 0;
    font-size: var(--text-small);
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
