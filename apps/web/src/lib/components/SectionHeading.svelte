<script lang="ts">
let { id, step, title }: { id: string; step: string; title: string } = $props();
</script>

<div class="section-header">
  <span class="step" aria-hidden="true">{step}</span>
  <h2 {id}>{title}</h2>
</div>

<style>
  .section-header {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    margin-bottom: var(--space-6);
  }

  .step {
    color: var(--color-accent);
    font-family: var(--font-heading);
    font-size: var(--text-tiny);
    font-variant-ligatures: none;
  }

  h2 {
    margin: 0;
    font-size: var(--text-h3);
  }
</style>
