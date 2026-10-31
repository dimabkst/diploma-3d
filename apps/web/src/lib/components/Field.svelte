<script lang="ts">
import type { Snippet } from 'svelte';

let { label, forId, error, children }: { label: string; forId: string; error?: string | undefined; children: Snippet } = $props();
</script>

<div class="field">
  <label for={forId}>{label}</label>
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
