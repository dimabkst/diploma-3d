<script lang="ts">
import type { Snippet } from 'svelte';
import SectionSwatch from './SectionSwatch.svelte';

let {
  id,
  label,
  value,
  open,
  describedBy,
  tone,
  ontoggle,
  children,
}: {
  /** The id of the body, which the button controls. */
  id: string;
  label: string;
  /** What is chosen, or "не обрано". */
  value: string;
  open: boolean;
  describedBy?: string | undefined;
  /** The plane the field belongs to, marked with its colour where there are two; see `SectionSwatch`. */
  tone?: 0 | 1 | undefined;
  ontoggle: () => void;
  children: Snippet;
} = $props();
</script>

<!-- A field of a construction: what is chosen, and under it, while open, the ways to choose it, on the model or by name. -->
<button
  type="button"
  class={['picker', open && 'open']}
  aria-expanded={open}
  aria-controls={id}
  aria-describedby={describedBy}
  onclick={ontoggle}
>
  <span class="picker-label">{#if tone !== undefined}<SectionSwatch {tone} />{/if}{label}</span>
  <span class="picker-value">{value}</span>
</button>
<div class="picker-body" {id} hidden={!open}>
  {@render children()}
</div>

<style>
  .picker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 44px;
    padding: 0 var(--space-3);
    color: var(--color-text);
    text-align: left;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    transition: border-color 200ms ease;
  }

  .picker:hover {
    border-color: var(--color-border-strong);
  }

  .picker.open {
    border-color: var(--color-link);
  }

  .picker-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  .picker-value {
    font-family: var(--font-heading);
    font-variant-ligatures: none;
    text-align: right;
  }

  .picker-body {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-3) var(--space-3);
    border-left: 1px solid var(--color-border);
  }

  .picker-body[hidden] {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .picker {
      transition: none;
    }
  }
</style>
