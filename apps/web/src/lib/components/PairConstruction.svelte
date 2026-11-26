<script lang="ts">
import type { BoxSegment } from '@diploma-3d/schema';
import type { PairKey } from '../model/box.ts';
import type { PilotChoice } from '../model/parameters.ts';
import type { ConstructionField } from '../model/throughPoint.ts';
import type { PairField } from '../shapes.ts';
import Button from './Button.svelte';
import ConstructionPicker from './ConstructionPicker.svelte';
import Field from './Field.svelte';
import Select from './Select.svelte';

let {
  field,
  onopen,
  onchoice,
}: {
  field: PairField;
  /** Opens the field, or closes it; the model's picking follows. */
  onopen: (open: ConstructionField | undefined) => void;
  onchoice: (choice: PilotChoice) => void;
} = $props();

// A pair by its first edge: either edge stands for the pair.
const firstOf = (pair: PairKey) => (pair.split('|')[0] as string).split('-') as unknown as BoxSegment;
// The list's first entry while the plane is given otherwise, so that a choice is always an act of the user.
const options = $derived([{ value: '' as const, label: 'Не вибрано', disabled: true }, ...field.options]);
</script>

<div class="construction">
  <ConstructionPicker
    id={`${field.key}-body`}
    label="Паралельно ребрам"
    value={field.title}
    open={field.open}
    ontoggle={() => onopen(field.open ? undefined : 'pair')}
  >
    <p class="hint">
      Клацніть ребро на моделі: мимобіжне до нього ребро визначене однозначно, і обидва підсвічено. Площина паралельна обом
      ребрам, але не проходить через них.
    </p>
    <Field label="Або зі списку" forId={`${field.key}-list`}>
      <Select
        id={`${field.key}-list`}
        bind:value={
          () => field.selected,
          (value: PairKey | '') => {
            if (value !== '') onchoice({ kind: 'pair', segment: firstOf(value) });
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
