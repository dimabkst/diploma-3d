<script lang="ts" generics="Value extends string | number">
import type { HTMLSelectAttributes } from 'svelte/elements';

type Props = Omit<HTMLSelectAttributes, 'class' | 'value' | 'children'> & {
  value: Value;
  options: readonly { readonly value: Value; readonly label: string; readonly disabled?: boolean | undefined }[];
};

let { value = $bindable(), options, ...rest }: Props = $props();
</script>

<!-- A native select: keyboard operation and the platform popup are kept; only the closed control is themed. -->
<select {...rest} class="select" bind:value>
  {#each options as option (option.value)}
    <option value={option.value} disabled={option.disabled}>{option.label}</option>
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
    color-scheme: dark;
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
