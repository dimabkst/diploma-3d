<script lang="ts">
import { addDecimal } from '../decimal.ts';
import type { ParameterKey, ParameterTexts, ParameterValues } from '../model/parameters.ts';
import StepperInput from './StepperInput.svelte';

let {
  keys,
  labels,
  texts = $bindable(),
  values,
  invalid,
  describedBy,
  context,
}: {
  /** The fields of the ratio's two numbers, a and b of a : b. */
  keys: readonly [ParameterKey, ParameterKey];
  /** What each number measures, such as "DM" and "MD₁"; read as written, "DM : MD₁ = a : b". */
  labels: readonly [string, string];
  texts: ParameterTexts;
  values: ParameterValues;
  invalid: readonly [boolean, boolean];
  describedBy?: string | undefined;
  /** What the ratio belongs to where two read alike, such as "Другий переріз": it leads the entries' accessible names. */
  context?: string | undefined;
} = $props();

const named = (label: string) => (context === undefined ? label : `${context}: ${label}`);

/**
 * A ratio's part one up or down, exactly, from its valid value: never below zero, and never to zero while the other part is zero.
 * A fraction typed stays a fraction, 1,5 going to 2,5.
 */
function stepped(value: number | undefined, other: number | undefined, direction: 1 | -1): number | undefined {
  if (value === undefined) return undefined;
  const next = addDecimal(value, direction);
  return next < 0 || (next === 0 && other === 0) ? undefined : next;
}

const [first, second] = $derived([values[keys[0]], values[keys[1]]]);
</script>

<!-- The equation on its own line, the two numbers under it: both entries keep their arrows at the sidebar's width. -->
<div class="ratio" role="group" aria-label={`${labels[0]} : ${labels[1]}`}>
  <span class="ratio-text ratio-equation" aria-hidden="true">{labels[0]} : {labels[1]} =</span>
  <StepperInput
    id={keys[0]}
    label={named(labels[0])}
    bind:text={texts[keys[0]]}
    lower={stepped(first, second, -1)}
    higher={stepped(first, second, 1)}
    invalid={invalid[0]}
    {describedBy}
  />
  <span class="ratio-text" aria-hidden="true">:</span>
  <StepperInput
    id={keys[1]}
    label={named(labels[1])}
    bind:text={texts[keys[1]]}
    lower={stepped(second, first, -1)}
    higher={stepped(second, first, 1)}
    invalid={invalid[1]}
    {describedBy}
  />
</div>

<style>
  .ratio {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .ratio-equation {
    flex-basis: 100%;
  }

  .ratio-text {
    font-family: var(--font-heading);
    font-variant-ligatures: none;
  }
</style>
