<script lang="ts">
import type { Snippet } from 'svelte';

let {
  title,
  open = $bindable(),
  status,
  highlighted = false,
  invalid = false,
  children,
}: {
  title: string;
  open: boolean;
  /** A short state shown in the summary, such as "похила", so that a collapsed group still reports it. */
  status?: string | undefined;
  /** Marks the status as a departure from the default, such as a non-zero displacement. */
  highlighted?: boolean;
  /** Some field inside is invalid; the summary says so even while the group is collapsed. */
  invalid?: boolean;
  children: Snippet;
} = $props();
</script>

<!-- Native details: keyboard operation and the expanded state come with the element, and several can stay open. -->
<details class="parameter-section" bind:open>
  <summary class="section-summary">
    <span class="section-title">{title}</span>
    {#if invalid}
      <span class="section-flag error">помилка</span>
    {:else if status !== undefined}
      <span class={['section-flag', { highlighted }]}>{status}</span>
    {/if}
    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
  </summary>
  <div class="section-body">
    {@render children()}
  </div>
</details>

<style>
  .parameter-section {
    border-top: 1px solid var(--color-border);
  }

  .section-summary {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 48px;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    list-style: none;
    cursor: pointer;
  }

  .section-summary::-webkit-details-marker {
    display: none;
  }

  .section-title {
    flex: 1;
    min-width: 0;
  }

  .section-flag {
    color: var(--color-text-dim);
    font-size: var(--text-tiny);
  }

  .section-flag.highlighted {
    color: var(--color-accent);
  }

  .section-flag.error {
    color: var(--color-error);
  }

  .chevron {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--color-text-dim);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.75;
    transition: transform 200ms ease;
  }

  .parameter-section[open] .chevron {
    transform: rotate(180deg);
  }

  .section-summary:hover .chevron {
    stroke: var(--color-text);
  }

  .section-body {
    display: grid;
    gap: var(--space-4);
    padding-bottom: var(--space-6);
  }
</style>
