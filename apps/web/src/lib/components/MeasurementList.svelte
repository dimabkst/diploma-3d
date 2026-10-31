<script lang="ts">
import type { MeasurementItem } from '../shapes.ts';

let { items }: { items: readonly MeasurementItem[] } = $props();
</script>

<dl class="measurements">
  {#each items as item (item.label)}
    <div class="measurement">
      <dt>{item.label}</dt>
      <dd>{item.value}</dd>
    </div>
  {/each}
</dl>

<style>
  .measurements {
    display: grid;
    margin: 0;
    border-top: 1px solid var(--color-border);
  }

  .measurement {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
  }

  dt {
    color: var(--color-text-muted);
    font-size: var(--text-small);
  }

  dd {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
  }
</style>
