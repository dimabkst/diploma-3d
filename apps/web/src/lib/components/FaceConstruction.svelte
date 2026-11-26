<script lang="ts">
import type { BoxFace } from '@diploma-3d/schema';
import type { ParameterTexts, ParameterValues, PilotChoice } from '../model/parameters.ts';
import type { ConstructionField, PointMode } from '../model/throughPoint.ts';
import type { FaceConstructionField } from '../shapes.ts';
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
  field: FaceConstructionField;
  texts: ParameterTexts;
  values: ParameterValues;
  /** Opens one of the fields, or closes the construction with none; the model's picking follows. */
  onopen: (open: ConstructionField | undefined) => void;
  onchoice: (choice: PilotChoice) => void;
} = $props();

const toggle = (open: ConstructionField) => onopen(field.open === open ? undefined : open);
const modes: readonly { readonly value: PointMode; readonly label: string }[] = [
  { value: 'midpoint', label: 'Посередині' },
  { value: 'ratio', label: 'За відношенням' },
];
</script>

<div class="construction">
  <ConstructionPicker
    id={`${field.key}-face`}
    label="Грань"
    value={field.face.title}
    open={field.open === 'face'}
    ontoggle={() => toggle('face')}
  >
    <p class="hint">
      Клацніть грань на моделі: під вказівником її підсвічено. Протилежна грань, де вона є, дає ті самі площини, лише відлік
      ведеться від неї.
    </p>
    <Field label="Або зі списку" forId={`${field.key}-face-list`}>
      <Select
        id={`${field.key}-face-list`}
        bind:value={() => field.face.selected, (face: BoxFace) => onchoice({ kind: 'face-pair', face })}
        options={field.face.options}
      />
    </Field>
  </ConstructionPicker>

  {#each field.positions as position (position.which)}
    {@const errorId = `${field.key}-${position.which}-error`}
    <ConstructionPicker
      id={`${field.key}-${position.which}`}
      label={position.label}
      value={position.title}
      tone={position.tone}
      open={field.open === position.field}
      describedBy={position.error === undefined ? undefined : errorId}
      ontoggle={() => toggle(position.field)}
    >
      <SegmentedControl
        legend={position.which === 'first' ? 'Положення перерізу' : 'Положення другого перерізу'}
        name={`${field.key}-${position.which}-mode`}
        value={position.mode}
        options={modes}
        onchange={(mode) => onchoice({ kind: 'placement', which: position.which, mode })}
      />
      {#if position.mode === 'ratio'}
        <p class="hint">
          {#if field.face.oppositeEdge}
            Перше число — відстань від грані {field.face.title} до перерізу, друге — від перерізу до ребра {field.face.opposite},
            найдальшого від грані; обидві відстані — перпендикуляри до грані. Ребро обирати не треба. Так 1 : 2 — третина шляху
            від {field.face.title}.
          {:else if field.face.oppositeVertex}
            Перше число — відстань від грані {field.face.title} до перерізу, друге — від перерізу до вершини {field.face.opposite},
            протилежної грані; обидві відстані — перпендикуляри до грані. Вершину обирати не треба. Так 1 : 2 — третина шляху від
            {field.face.title}.
          {:else}
            Перше число — відстань від грані {field.face.title} до перерізу, друге — від перерізу до {field.face.opposite}. Так 1 :
            2 — третина шляху від {field.face.title}.
          {/if}
        </p>
        <RatioInput
          keys={position.keys}
          labels={position.labels}
          bind:texts
          {values}
          invalid={position.invalid}
          describedBy={position.error === undefined ? undefined : errorId}
          context={position.which === 'second' ? position.label : undefined}
        />
      {/if}
    </ConstructionPicker>
    {#if position.error !== undefined}
      <p class="error" id={errorId}>{position.error}</p>
    {/if}
  {/each}
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
</style>
