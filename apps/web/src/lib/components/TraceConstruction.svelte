<script lang="ts">
import type { BoxSegment, BoxVertex } from '@diploma-3d/schema';
import type { PilotChoice } from '../model/parameters.ts';
import type { ConstructionField } from '../model/throughPoint.ts';
import type { TraceField } from '../shapes.ts';
import Button from './Button.svelte';
import ConstructionPicker from './ConstructionPicker.svelte';
import Field from './Field.svelte';
import Select from './Select.svelte';

let {
  field,
  onopen,
  onchoice,
}: {
  field: TraceField;
  /** Opens the field, or closes it; the model's picking follows. */
  onopen: (open: ConstructionField | undefined) => void;
  onchoice: (choice: PilotChoice) => void;
} = $props();

const choose = (value: string) =>
  onchoice(
    field.target === 'vertex'
      ? { kind: 'trace-vertex', vertex: value as BoxVertex }
      : { kind: 'trace-side', segment: value.split('-') as unknown as BoxSegment },
  );
</script>

<div class="construction">
  <ConstructionPicker
    id={`${field.key}-body`}
    label={field.label}
    value={field.title}
    open={field.open}
    ontoggle={() => onopen(field.open ? undefined : 'trace')}
  >
    <p class="hint">
      {field.target === 'vertex'
        ? 'Клацніть вершину основи на моделі; вершина верхньої основи означає ту, що під нею. Слід перерізу на основі показано лінією.'
        : 'Клацніть сторону основи на моделі; сторона верхньої основи означає ту, що під нею. Слід перерізу на основі показано лінією.'}
    </p>
    <Field label="Або зі списку" forId={`${field.key}-list`}>
      <Select id={`${field.key}-list`} bind:value={() => field.selected, choose} options={field.options} />
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
