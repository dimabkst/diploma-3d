<script lang="ts">
import type { Snippet } from 'svelte';

/** `children`: the page's main actions, laid out after the application name. */
let { children }: { children: Snippet } = $props();
</script>

<header class="site-header">
  <h1 class="brand">Стереометрія 3D</h1>
  <div class="header-actions">
    {@render children()}
  </div>
</header>

<style>
  .site-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-6);
    min-height: 64px;
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg);
    border-bottom: 1px solid var(--color-border);
  }

  .brand {
    margin: 0;
    font-size: var(--text-small);
    font-weight: 500;
    white-space: nowrap;
  }

  .header-actions {
    display: flex;
    flex: 1 1 24rem;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-4);
    min-width: 0;
  }
</style>
