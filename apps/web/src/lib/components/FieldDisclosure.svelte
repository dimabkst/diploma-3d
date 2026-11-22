<script lang="ts">
import type { Snippet } from 'svelte';

let { id, label, open = $bindable(false), children }: { id: string; label: string; open?: boolean; children: Snippet } = $props();
</script>

<!-- Further fields of a group, collapsed at first; a button rather than <details>, so that the page owns the open state. -->
<div class="disclosure">
  <button type="button" class="disclosure-toggle" aria-expanded={open} aria-controls={id} onclick={() => (open = !open)}>
    <span class="disclosure-mark" aria-hidden="true"></span>
    {label}
  </button>
  <div class="disclosure-body" {id} hidden={!open}>
    {@render children()}
  </div>
</div>

<style>
  .disclosure {
    display: grid;
    gap: var(--space-2);
  }

  .disclosure-toggle {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0;
    color: var(--color-link);
    background: none;
    border: 0;
    font-size: var(--text-small);
    text-align: left;
    transition: color 200ms ease;
  }

  .disclosure-toggle:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  /* A chevron that points down once open. */
  .disclosure-mark {
    width: 0.5rem;
    height: 0.5rem;
    border-right: 1.5px solid currentcolor;
    border-bottom: 1.5px solid currentcolor;
    transform: rotate(-45deg);
    transition: transform 200ms ease;
  }

  [aria-expanded='true'] > .disclosure-mark {
    transform: rotate(45deg);
  }

  .disclosure-body {
    display: grid;
    gap: var(--space-4);
    padding-left: var(--space-4);
    border-left: 1px solid var(--color-border);
  }

  .disclosure-body[hidden] {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .disclosure-toggle,
    .disclosure-mark {
      transition: none;
    }
  }
</style>
