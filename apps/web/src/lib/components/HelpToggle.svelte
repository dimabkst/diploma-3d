<script lang="ts">
import type { Help } from '../shapes.ts';

let { id, help }: { id: string; help: Help } = $props();

// A disclosure button rather than a hover tooltip: it works by click, keyboard and touch alike.
let open = $state(false);
</script>

<div class="help">
  <button type="button" class="help-toggle" aria-expanded={open} aria-controls={id} onclick={() => (open = !open)}>
    <span class="help-mark" aria-hidden="true">?</span>
    {help.label}
  </button>
  <p class="help-text" {id} hidden={!open}>{help.text}</p>
</div>

<style>
  .help {
    display: grid;
    justify-items: start;
    gap: var(--space-1);
  }

  .help-toggle {
    display: inline-flex;
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

  .help-toggle:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .help-mark {
    display: inline-grid;
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    place-items: center;
    border: 1px solid currentcolor;
    border-radius: 50%;
    font-family: var(--font-heading);
    font-size: var(--text-tiny);
    font-variant-ligatures: none;
    line-height: 1;
  }

  /* Blank lines in the text separate its paragraphs. */
  .help-text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-small);
    line-height: 1.5;
    white-space: pre-line;
  }
</style>
