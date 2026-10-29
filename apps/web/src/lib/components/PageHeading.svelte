<script lang="ts">
let { id, title }: { id?: string; title: string } = $props();
</script>

<h1 {id}>{title}</h1>

<style>
  h1 {
    margin-bottom: var(--space-3);
    font-size: var(--text-h1);
    letter-spacing: -0.035em;
  }
</style>
