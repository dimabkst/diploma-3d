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
      <dd data-widest={widest}><span class="value">{item.value}</span></dd>
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
     the row heights do not depend on the current value. */
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

  dd::before {
    content: attr(data-widest);
    visibility: hidden;
  }

  dd::before,
  .value {
    grid-area: 1 / 1;
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
