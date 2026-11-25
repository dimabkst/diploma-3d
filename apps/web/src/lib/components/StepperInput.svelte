<script lang="ts">
import { formatSteppedDecimal } from '../decimal.ts';

let {
  id,
  label,
  text = $bindable(),
  lower,
  higher,
  invalid = false,
  describedBy,
}: {
  id: string;
  /** The accessible name of the entry, which its buttons repeat. */
  label: string;
  /** Raw text of the entry, kept exactly as typed. */
  text: string;
  /** The values the down and up buttons and arrow keys set, or undefined where they would set none allowed. */
  lower: number | undefined;
  higher: number | undefined;
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
} = $props();

function select(next: number | undefined) {
  if (next !== undefined) text = formatSteppedDecimal(next);
}

function onkeydown(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const next = event.key === 'ArrowUp' ? higher : lower;
  // The caret would otherwise jump to the start or end. Auto-repeat is ignored: one press is one step.
  event.preventDefault();
  if (!event.repeat) select(next);
}
</script>

<!-- A compact entry with its own up and down buttons, shown always rather than on hover, for a finger as for a mouse. The buttons
     stay out of the tab order: the arrow keys in the entry do the same. -->
<span class={['stepper', invalid && 'invalid']}>
  <input
    class="stepper-input"
    {id}
    type="text"
    inputmode="decimal"
    autocomplete="off"
    spellcheck="false"
    aria-label={label}
    aria-invalid={invalid || undefined}
    aria-describedby={describedBy}
    bind:value={text}
    {onkeydown}
  />
  <span class="stepper-buttons">
    <button
      type="button"
      class="stepper-button"
      tabindex="-1"
      aria-label={`${label}: збільшити на 1`}
      disabled={higher === undefined}
      onclick={() => select(higher)}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3" /></svg>
    </button>
    <button
      type="button"
      class="stepper-button"
      tabindex="-1"
      aria-label={`${label}: зменшити на 1`}
      disabled={lower === undefined}
      onclick={() => select(lower)}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5l3-3" /></svg>
    </button>
  </span>
</span>

<style>
  .stepper {
    --stepper-height: 44px;
    display: inline-flex;
    height: var(--stepper-height);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    transition: border-color 200ms ease;
  }

  .stepper:hover:not(.invalid):not(:has(:focus-visible)) {
    border-color: var(--color-border-strong);
  }

  .stepper.invalid {
    border-color: var(--color-error);
  }

  /* One outline around the whole control while its entry has the keyboard focus. */
  .stepper:has(.stepper-input:focus-visible) {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .stepper-input {
    width: 3.5rem;
    min-width: 0;
    padding: 0 var(--space-2) 0 var(--space-3);
    color: var(--color-text);
    text-align: right;
    background: transparent;
    border: none;
    font-family: var(--font-heading);
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
  }

  .stepper-input:focus-visible {
    outline: none;
  }

  .stepper-buttons {
    display: grid;
    grid-template-rows: 1fr 1fr;
    border-left: 1px solid var(--color-border);
  }

  .stepper-button {
    display: grid;
    place-items: center;
    width: 32px;
    padding: 0;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
      background-color 200ms ease,
      color 200ms ease;
  }

  .stepper-button + .stepper-button {
    border-top: 1px solid var(--color-border);
  }

  .stepper-button:hover:not(:disabled) {
    color: var(--color-text);
    background: var(--color-border);
  }

  .stepper-button:disabled {
    color: var(--color-text-dim);
    cursor: not-allowed;
    opacity: 0.55;
  }

  .stepper-button svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentcolor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.75;
  }

  /* Taller for a finger, so that each half stays a usable target. */
  @media (pointer: coarse) {
    .stepper {
      --stepper-height: 56px;
    }

    .stepper-button {
      width: 40px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stepper,
    .stepper-button {
      transition: none;
    }
  }
</style>
