<script lang="ts">
let { label }: { label: string } = $props();
</script>

<span>{label}</span>

<style>
  span {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: var(--space-1) var(--space-3);
    color: var(--color-text-dim);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-button);
    font-family: var(--font-heading);
    font-size: var(--text-tiny);
    font-variant-ligatures: none;
    line-height: 1;
    white-space: nowrap;
  }

</style>
