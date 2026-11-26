<script lang="ts" generics="Value extends string | number">
import type { HTMLSelectAttributes } from 'svelte/elements';

type Option = {
  readonly value: Value;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  /** The named group the option is listed under; options of one group follow each other. */
  readonly group?: string | undefined;
};

type Props = Omit<HTMLSelectAttributes, 'class' | 'value' | 'children'> & {
  value: Value;
  options: readonly Option[];
};

let { value = $bindable(), options, ...rest }: Props = $props();

// Runs of options with the same group, in order; options with none stand on their own.
const runs = $derived(
  options.reduce<{ group: string | undefined; options: Option[] }[]>((found, option) => {
    const last = found.at(-1);
    if (last !== undefined && option.group !== undefined && last.group === option.group) last.options.push(option);
    else found.push({ group: option.group, options: [option] });
    return found;
  }, []),
);
</script>

{#snippet item(option: Option)}
  <option value={option.value} disabled={option.disabled}>{option.label}</option>
{/snippet}

<!-- A native select: keyboard operation and the platform popup are kept; only the closed control is themed. -->
<select {...rest} class="select" bind:value>
  {#each runs as run, index (index)}
    {#if run.group === undefined}
      {#each run.options as option (option.value)}{@render item(option)}{/each}
    {:else}
      <optgroup label={run.group}>
        {#each run.options as option (option.value)}{@render item(option)}{/each}
      </optgroup>
    {/if}
  {/each}
</select>

<style>
  .select {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 0 var(--space-3);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    transition: border-color 200ms ease;
  }

  .select:hover:not(:disabled):not(:focus-visible):not(:open) {
    border-color: var(--color-border-strong);
  }

  .select:focus-visible,
  .select:open {
    border-color: var(--color-border);
  }

  .select:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
</style>
