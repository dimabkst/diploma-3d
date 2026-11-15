<script lang="ts">
let {
  id,
  label,
  checked = $bindable(),
  disabled = false,
  describedBy,
}: {
  id: string;
  label: string;
  checked: boolean;
  /** Not to be switched now; a note among the fields, named by `describedBy`, says why. */
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
} = $props();
</script>

<!-- A native checkbox: keyboard operation and its state come with the element; the whole row is the touch target. -->
<label class={['checkbox', { disabled }]} for={id}>
  <input {id} class="input" type="checkbox" bind:checked {disabled} aria-describedby={describedBy} />
  <span>{label}</span>
</label>

<style>
  .checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: fit-content;
    max-width: 100%;
    min-height: 44px;
    color: var(--color-text-muted);
    font-size: var(--text-small);
    cursor: pointer;
  }

  .checkbox:hover {
    color: var(--color-text);
  }

  .checkbox.disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .checkbox.disabled:hover {
    color: var(--color-text-muted);
  }

  .input {
    flex: none;
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--color-primary);
    cursor: inherit;
  }
</style>
