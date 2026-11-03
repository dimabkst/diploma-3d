<script lang="ts">
import type { MeasurementItem } from '../shapes.ts';

let { items }: { items: readonly MeasurementItem[] } = $props();

// One shared value column, as wide as the widest text any of the values can take.
const widest = $derived(items.reduce((longest, item) => (item.widest.length > longest.length ? item.widest : longest), ''));
</script>

<dl class="measurements">
  {#each items as item (item.label)}
    <div class="measurement">
      <dt>{item.label}</dt>
      <!-- No whitespace between the parts: it would become part of the value's text. -->
      <dd data-approximate={item.approximate}
        ><span class="placeholder" data-widest={widest} aria-hidden="true"
          >{#if item.approximate !== undefined}<span class="approximate"></span>{/if}</span
        ><span class="value"
          >{#if item.approximate !== undefined}<span class={['approximate', { shown: item.approximate }]}></span
            >{/if}{item.value}</span
        ></dd
      >
    </div>
  {/each}
</dl>

<style>
  .measurements {
    display: grid;
    margin: 0;
    border-top: 1px solid var(--color-border);
    container-type: inline-size;
  }

  .measurement {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--space-1) var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
  }

  dt {
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  /* The value and an invisible copy of the widest possible value share one cell, so the column width and therefore
     the row heights do not depend on the current value. The copy's text is generated content, so that it stays out of
     the value's text. */
  dd {
    display: grid;
    justify-items: end;
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .placeholder {
    visibility: hidden;
  }

  .placeholder::after {
    content: attr(data-widest);
  }

  .placeholder,
  .value {
    grid-area: 1 / 1;
  }

  /* A value that may be approximate keeps room for the "≈" mark before it, shown or not, and so does its invisible
     copy: the width never changes. The mark is generated content in both, so that it takes exactly the same width, and
     stays out of the value's text; screen readers announce it when it is shown. */
  .approximate {
    visibility: hidden;
  }

  .approximate::before {
    content: "≈\00a0";
  }

  .value .approximate.shown {
    visibility: visible;
  }

  /* Decided by the available width only: below it every value moves under its label. */
  @container (width < 18rem) {
    .measurement {
      grid-template-columns: minmax(0, 1fr);
    }

    dd {
      justify-items: start;
    }
  }
</style>
