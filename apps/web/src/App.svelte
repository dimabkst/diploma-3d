<script lang="ts">
import AppHeader from './lib/components/AppHeader.svelte';
import ControlsPanel from './lib/components/ControlsPanel.svelte';
import PageHeading from './lib/components/PageHeading.svelte';
import PreviewPanel from './lib/components/PreviewPanel.svelte';

const shapes = [
  { value: 'cube', label: 'Куб' },
  { value: 'cuboid', label: 'Прямокутний паралелепіпед' },
  { value: 'prism', label: 'Призма' },
  { value: 'pyramid', label: 'Піраміда' },
  { value: 'tetrahedron', label: 'Тетраедр' },
  { value: 'sphere', label: 'Сфера' },
  { value: 'cylinder', label: 'Циліндр' },
  { value: 'cone', label: 'Конус' },
] as const;

let selectedShape = $state<string>('cube');
let width = $state(40);
let height = $state(40);
const selectedShapeName = $derived(shapes.find((shape) => shape.value === selectedShape)?.label ?? '—');
</script>

<svelte:head>
  <title>Стереометрія 3D</title>
</svelte:head>

<AppHeader />

<main>
  <section class="intro" aria-labelledby="page-title">
    <p class="eyebrow">Від формули до фізичної моделі</p>
    <PageHeading id="page-title" title="Створіть геометричне тіло" />
    <p class="lead">Оберіть фігуру, налаштуйте параметри та підготуйте модель до 3D-друку.</p>
  </section>

  <div class="workspace">
    <ControlsPanel {shapes} bind:selectedShape bind:width bind:height />
    <PreviewPanel shapeName={selectedShapeName} {width} {height} />
  </div>
</main>

<style>
  main {
    width: 100%;
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--space-8) var(--page-gutter) var(--space-24);
  }

  .intro {
    margin-bottom: var(--space-6);
  }

  .eyebrow {
    margin-bottom: var(--space-2);
    color: var(--color-text-dim);
    font-family: var(--font-heading);
    font-size: var(--text-tiny);
    font-variant-ligatures: none;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .lead {
    max-width: var(--prose-width);
    margin-bottom: 0;
    color: var(--color-text-muted);
    font-size: var(--text-lead);
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: var(--space-6);
  }

  @media (max-width: 860px) {
    .workspace {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 600px) {
    main {
      padding-top: var(--space-6);
      padding-bottom: var(--space-16);
    }
  }
</style>
