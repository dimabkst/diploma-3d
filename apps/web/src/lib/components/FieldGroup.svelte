<script lang="ts">
import type { Snippet } from 'svelte';

let {
  id,
  legend,
  description,
  children,
}: {
  id: string;
  legend: string;
  /** Explains the group; its id, `${id}-description`, can be added to the controls' descriptions. */
  description?: string | undefined;
  children: Snippet;
} = $props();
</script>

<!-- Related fields under one legend, separated from the fields above by a rule rather than a nested card. -->
<fieldset class="field-group" aria-describedby={description === undefined ? undefined : `${id}-description`}>
  <legend>{legend}</legend>
  {#if description !== undefined}
    <p class="group-description" id={`${id}-description`}>{description}</p>
  {/if}
  {@render children()}
</fieldset>

<style>
  .field-group {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    margin: 0;
    padding: var(--space-4) 0 0;
    border: 0;
    border-top: 1px solid var(--color-border);
  }

  /* A legend does not take part in the grid; floating it lets it sit in the first row like any other item. */
  legend {
    float: left;
    width: 100%;
    padding: 0;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
  }

  .group-description {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
    line-height: 1.5;
  }
</style>
