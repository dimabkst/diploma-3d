<script lang="ts">
import StatusBadge from './StatusBadge.svelte';
</script>

<header class="site-header">
  <div class="header-inner">
    <div class="brand-group">
      <a class="brand" href="/" aria-label="Стереометрія 3D — головна">
        <span class="brand-copy">
          <strong>Стереометрія 3D</strong>
          <small>Навчальні моделі для 10–11 класів</small>
        </span>
      </a>
      <StatusBadge label="Початкова версія" />
    </div>
    <span class="header-label">3D-друк · стереометрія</span>
  </div>
</header>

<style>
  .site-header {
    position: sticky;
    z-index: 10;
    top: 0;
    min-height: 72px;
    background: rgb(20 20 20 / 96%);
    border-bottom: 1px solid var(--color-border);
    backdrop-filter: blur(12px);
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    max-width: var(--page-max);
    min-height: 72px;
    margin: 0 auto;
    padding: var(--space-3) var(--page-gutter);
  }

  .brand-group,
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }

  .brand {
    color: var(--color-text);
    font-family: var(--font-heading);
    font-variant-ligatures: none;
    line-height: 1.2;
    text-decoration: none;
  }

  .brand:hover {
    color: var(--color-text);
    text-decoration: none;
  }

  .brand-copy {
    display: grid;
    gap: 2px;
  }

  strong {
    font-size: var(--text-small);
    font-weight: 500;
  }

  small,
  .header-label {
    color: var(--color-text-dim);
    font-family: var(--font-body);
    font-size: var(--text-tiny);
  }

  .header-label {
    font-family: var(--font-heading);
    font-variant-ligatures: none;
  }

  @media (max-width: 600px) {
    small,
    .header-label {
      display: none;
    }

    .brand-group {
      gap: var(--space-2);
    }
  }
</style>
