<script lang="ts">
import type { Snippet } from 'svelte';
import SectionSwatch from './SectionSwatch.svelte';

let {
  label,
  forId,
  error,
  accessory,
  children,
  sectionTone,
}: {
  label: string;
  forId: string;
  error?: string | undefined;
  /** Shown on the label row, at its end; for compact controls such as a numeric entry. */
  accessory?: Snippet | undefined;
  /** The control under the label row; a field whose only control is the accessory has none. */
  children?: Snippet | undefined;
  /** A field of a section's first (0) or second (1) plane: that plane's colour beside the label, as in the preview. */
  sectionTone?: 0 | 1 | undefined;
} = $props();
</script>

<div class="field">
  <div class="field-header">
    <label for={forId}>
      {#if sectionTone !== undefined}<SectionSwatch tone={sectionTone} />{/if}
      {label}
    </label>
    {@render accessory?.()}
  </div>
  {@render children?.()}
  {#if error !== undefined}
    <p class="field-error" id={`${forId}-error`}>{error}</p>
  {/if}
</div>

<style>
  .field {
    position: relative;
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

  /*
   * In the flow under the control by default. A page can lift the message out of the flow, for a field in a toolbar
   * whose height must not change: --field-error-position: absolute places it just below the field, over what follows,
   * on the given surface.
   */
  .field-error {
    position: var(--field-error-position, static);
    z-index: 2;
    top: calc(100% + var(--space-1));
    left: 0;
    width: var(--field-error-width, auto);
    max-width: 24rem;
    margin: 0;
    padding: var(--field-error-padding, 0);
    color: var(--color-error);
    background: var(--field-error-background, transparent);
    border: var(--field-error-border, 0);
    border-radius: var(--radius-input);
    font-size: var(--text-small);
    line-height: 1.4;
  }
</style>
