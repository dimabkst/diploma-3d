<script lang="ts">
import type { Snippet } from 'svelte';

let { label, forId, children }: { label: string; forId: string; children: Snippet } = $props();
</script>

<div class="field">
  <label for={forId}>{label}</label>
  {@render children()}
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  label {
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }
</style>
