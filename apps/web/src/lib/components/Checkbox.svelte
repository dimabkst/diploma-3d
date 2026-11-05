<script lang="ts">
let {
  id,
  label,
  checked = $bindable(),
}: {
  id: string;
  label: string;
  checked: boolean;
} = $props();
</script>

<!-- A native checkbox: keyboard operation and its state come with the element; the whole row is the touch target. -->
<label class="checkbox" for={id}>
  <input {id} class="input" type="checkbox" bind:checked />
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

  .input {
    flex: none;
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--color-primary);
    cursor: inherit;
  }
</style>
