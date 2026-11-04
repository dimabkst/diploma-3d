<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';

type Props = Omit<HTMLButtonAttributes, 'class' | 'children'> & {
  variant?: 'primary' | 'secondary';
  /** `icon`: a square button for a single icon; it needs an `aria-label`. */
  size?: 'default' | 'icon';
  loading?: boolean;
  /**
   * An icon before the label. A button with an icon keeps a fixed slot for it, where the spinner replaces the icon while
   * loading, so the button's size never changes between the two states.
   */
  leadingIcon?: Snippet | undefined;
  children: Snippet;
};

let {
  variant = 'primary',
  size = 'default',
  loading = false,
  disabled = false,
  type = 'button',
  leadingIcon,
  children,
  ...rest
}: Props = $props();
</script>

<button
  {...rest}
  {type}
  class={['button', variant, size]}
  disabled={disabled || loading}
  aria-busy={loading || undefined}
>
  {#if leadingIcon !== undefined}
    <span class="icon-slot" aria-hidden="true">
      {#if loading}<span class="spinner"></span>{:else}{@render leadingIcon()}{/if}
    </span>
  {:else if loading}
    <span class="spinner" aria-hidden="true"></span>
  {/if}
  {@render children()}
</button>

<style>
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0 var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-button);
    font-family: var(--font-heading);
    font-size: var(--text-small);
    font-variant-ligatures: none;
    line-height: 1.2;
    white-space: nowrap;
    transition:
      background-color 200ms ease,
      border-color 200ms ease,
      color 200ms ease;
  }

  .icon {
    flex: none;
    width: 44px;
    padding: 0;
  }

  .primary {
    color: var(--color-on-primary);
    background: var(--color-primary);
  }

  .primary:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  .secondary {
    color: var(--color-text);
    background: transparent;
    border-color: var(--color-border-strong);
  }

  .secondary:hover:not(:disabled) {
    border-color: var(--color-text-dim);
  }

  .button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .button[aria-busy="true"] {
    cursor: progress;
  }

  .icon-slot {
    display: inline-grid;
    flex: none;
    width: 1rem;
    height: 1rem;
    place-items: center;
  }

  .spinner {
    width: 0.875em;
    height: 0.875em;
    border: 2px solid currentcolor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 800ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
</style>
