<script lang="ts">
import type { Snippet } from 'svelte';

let {
  label,
  forId,
  error,
  accessory,
  children,
}: {
  label: string;
  forId: string;
  error?: string | undefined;
  /** Shown on the label row, at its end; for compact controls such as a numeric entry. */
  accessory?: Snippet | undefined;
  children: Snippet;
} = $props();
</script>

<div class="field">
  <div class="field-header">
    <label for={forId}>{label}</label>
    {@render accessory?.()}
  </div>
  {@render children()}
  {#if error !== undefined}
    <p class="field-error" id={`${forId}-error`}>{error}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    min-width: 0;
  }

  .field-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
  }

  label {
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  .field-error {
    margin: 0;
    color: var(--color-error);
    font-size: var(--text-small);
    line-height: 1.4;
  }
</style>
