<script lang="ts">
import { formatDecimal, formatSteppedDecimal, type StepDirection, type StepRange, snapDecimal, stepDecimal } from '../decimal.ts';
import Button from './Button.svelte';
import Field from './Field.svelte';

let {
  id,
  label,
  text = $bindable(),
  value,
  range,
  suffix,
  error,
  describedBy,
  variant = 'slider',
}: {
  id: string;
  label: string;
  /** Raw text of the numeric entry, kept exactly as typed. */
  text: string;
  /** The validated value of `text`, or undefined while it is not valid; the controls never parse `text` themselves. */
  value: number | undefined;
  /** Bounds of the slider and stepping; buttons, arrow keys and dragging move to multiples of `increment`. */
  range: StepRange;
  suffix?: string | undefined;
  error?: string | undefined;
  /** Further descriptions of both the entry and the slider, after the error. */
  describedBy?: string | undefined;
  /** `entry`: only the compact text entry, for a value typed rather than explored, such as a size in millimetres. */
  variant?: 'slider' | 'entry';
} = $props();

const description = $derived(
  [error === undefined ? undefined : `${id}-error`, describedBy].filter((part) => part !== undefined).join(' ') || undefined,
);
// Stepping starts only from a valid value; empty, partial or out-of-range text is never replaced by an invented one.
const lower = $derived(value === undefined ? undefined : stepDecimal(value, -1, range));
const higher = $derived(value === undefined ? undefined : stepDecimal(value, 1, range));

// While the text is being corrected, the disabled slider stays where the last valid value put it.
let lastValid = $state<number>();
$effect.pre(() => {
  if (value !== undefined) lastValid = value;
});
const sliderValue = $derived(value ?? lastValid ?? range.min);

function select(next: number | undefined) {
  if (next !== undefined) text = formatSteppedDecimal(next);
}

const hasModifier = (event: KeyboardEvent) =>
  event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;

function onentrykeydown(event: KeyboardEvent) {
  if (hasModifier(event)) return;
  const direction: StepDirection | undefined = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : undefined;
  if (direction === undefined) return;
  // The caret would otherwise jump to the start or end. Auto-repeat is ignored: one press is one step.
  event.preventDefault();
  if (!event.repeat) select(direction > 0 ? higher : lower);
}

const sliderKeys: Readonly<Record<string, () => number | undefined>> = {
  ArrowUp: () => higher,
  ArrowRight: () => higher,
  ArrowDown: () => lower,
  ArrowLeft: () => lower,
  Home: () => range.min,
  End: () => range.max,
};

// The slider uses step="any" so that a typed value between the multiples, such as 2,05, is shown exactly instead of
// being sanitised to the native step grid. Its keys and dragging are therefore quantised here; handled keys suppress
// the native change, so each press is applied once.
function onsliderkeydown(event: KeyboardEvent) {
  const target = hasModifier(event) ? undefined : sliderKeys[event.key];
  if (target === undefined) return;
  event.preventDefault();
  if (!event.repeat) select(target());
}

function onsliderinput(event: Event & { currentTarget: HTMLInputElement }) {
  const next = snapDecimal(Number(event.currentTarget.value), range);
  // Show the quantised position at once, also when it equals the current value and no update will follow.
  event.currentTarget.value = String(next);
  select(next);
}
</script>

<Field {label} forId={id} {error}>
  {#snippet accessory()}
    <span class="entry">
      <!-- A text field rather than type="number": it accepts the Ukrainian decimal comma and keeps partial input as typed. -->
      <input
        class="entry-input"
        {id}
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        bind:value={text}
        onkeydown={onentrykeydown}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={description}
      />
      {#if suffix}<span class="suffix" aria-hidden="true">{suffix}</span>{/if}
    </span>
  {/snippet}
  {#if variant === 'slider'}
  <div class="slider-group">
    <Button
      variant="secondary"
      size="icon"
      aria-label={`${label}: зменшити`}
      disabled={lower === undefined}
      onclick={() => select(lower)}
    >
      <svg class="step-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
    </Button>
    <input
      class="slider"
      type="range"
      min={range.min}
      max={range.max}
      step="any"
      value={sliderValue}
      style:--fill={(sliderValue - range.min) / (range.max - range.min)}
      disabled={value === undefined}
      aria-label={`${label}: повзунок`}
      aria-valuetext={formatSteppedDecimal(sliderValue)}
      aria-describedby={description}
      oninput={onsliderinput}
      onkeydown={onsliderkeydown}
    />
    <Button
      variant="secondary"
      size="icon"
      aria-label={`${label}: збільшити`}
      disabled={higher === undefined}
      onclick={() => select(higher)}
    >
      <svg class="step-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg>
    </Button>
    <span class="limits" aria-hidden="true">
      <span>{formatDecimal(range.min)}</span>
      <span>{formatDecimal(range.max)}</span>
    </span>
  </div>
  {/if}
</Field>

<style>
  .entry {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .entry-input {
    width: 6.5rem;
    min-height: 44px;
    padding: 0 var(--space-3);
    color: var(--color-text);
    text-align: right;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    font-family: var(--font-heading);
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
    transition: border-color 200ms ease;
  }

  .entry-input:hover:not(:focus-visible):not([aria-invalid="true"]) {
    border-color: var(--color-border-strong);
  }

  .entry-input[aria-invalid="true"] {
    border-color: var(--color-error);
  }

  .suffix {
    color: var(--color-text-muted);
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    white-space: nowrap;
  }

  .slider-group {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0 var(--space-2);
  }

  /* Drawn with the theme tokens instead of accent-color, whose hover shade the browser derives on its own. The filled
     part of the track ends at the thumb centre, which travels between half a thumb from either end. */
  .slider {
    --slider-color: var(--color-primary);
    --thumb-size: 18px;
    --track-height: 6px;
    width: 100%;
    min-width: 0;
    height: 44px;
    margin: 0;
    background: transparent;
    cursor: pointer;
    appearance: none;
  }

  .slider:hover:not(:disabled) {
    --slider-color: var(--color-primary-hover);
  }

  .slider:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .slider::-webkit-slider-runnable-track {
    height: var(--track-height);
    background: linear-gradient(
      to right,
      var(--slider-color) calc(var(--thumb-size) / 2 + var(--fill) * (100% - var(--thumb-size))),
      var(--color-text-dim) 0
    );
    border-radius: var(--track-height);
  }

  .slider::-webkit-slider-thumb {
    width: var(--thumb-size);
    height: var(--thumb-size);
    margin-top: calc((var(--track-height) - var(--thumb-size)) / 2);
    background: var(--slider-color);
    border: none;
    border-radius: 50%;
    appearance: none;
  }

  .slider::-moz-range-track {
    height: var(--track-height);
    background: var(--color-text-dim);
    border-radius: var(--track-height);
  }

  .slider::-moz-range-progress {
    height: var(--track-height);
    background: var(--slider-color);
    border-radius: var(--track-height);
  }

  .slider::-moz-range-thumb {
    width: var(--thumb-size);
    height: var(--thumb-size);
    background: var(--slider-color);
    border: none;
    border-radius: 50%;
  }

  .limits {
    display: flex;
    grid-column: 2;
    justify-content: space-between;
    color: var(--color-text-dim);
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  .step-icon {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentcolor;
    stroke-linecap: round;
    stroke-width: 1.75;
  }
</style>
