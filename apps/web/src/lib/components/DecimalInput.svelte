<script lang="ts">
let {
  id,
  value = $bindable(),
  invalid = false,
  describedBy,
}: { id: string; value: string; invalid?: boolean; describedBy?: string | undefined } = $props();
</script>

<!-- A text field rather than type="number": it accepts the Ukrainian decimal comma and keeps partial input as typed. -->
<input
  class="decimal-input"
  {id}
  type="text"
  inputmode="decimal"
  autocomplete="off"
  spellcheck="false"
  bind:value
  aria-invalid={invalid || undefined}
  aria-describedby={describedBy}
/>

<style>
  .decimal-input {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 0 var(--space-3);
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-input);
    font-family: var(--font-heading);
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
    transition: border-color 200ms ease;
  }

  .decimal-input:hover:not(:focus-visible):not([aria-invalid="true"]) {
    border-color: var(--color-border-strong);
  }

  .decimal-input[aria-invalid="true"] {
    border-color: var(--color-error);
  }
</style>
