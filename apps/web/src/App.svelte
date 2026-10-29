<script lang="ts">
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

let selectedShape: (typeof shapes)[number]['value'] = $state('cube');
let width = $state(40);
let height = $state(40);
const selectedShapeName = $derived(shapes.find((shape) => shape.value === selectedShape)?.label ?? '—');
</script>

<svelte:head>
  <title>Стереометрія 3D</title>
</svelte:head>

<header class="topbar">
  <a class="brand" href="/" aria-label="Стереометрія 3D — головна">
    <span class="brand-mark" aria-hidden="true">S3</span>
    <span>Стереометрія 3D</span>
  </a>
  <p>Навчальні моделі для 10–11 класів</p>
</header>

<main>
  <section class="intro" aria-labelledby="page-title">
    <div>
      <p class="eyebrow">Від формули до фізичної моделі</p>
      <h1 id="page-title">Створіть геометричне тіло</h1>
      <p class="lead">Оберіть фігуру, налаштуйте параметри та підготуйте модель до 3D-друку.</p>
    </div>
    <span class="status">Початкова версія</span>
  </section>

  <div class="workspace">
    <aside class="controls" aria-label="Налаштування моделі">
      <section aria-labelledby="shape-heading">
        <div class="section-heading">
          <span>01</span>
          <h2 id="shape-heading">Вибір фігури</h2>
        </div>
        <label for="shape">Геометричне тіло</label>
        <select id="shape" bind:value={selectedShape}>
          {#each shapes as shape}
            <option value={shape.value}>{shape.label}</option>
          {/each}
        </select>
      </section>

      <section aria-labelledby="parameters-heading">
        <div class="section-heading">
          <span>02</span>
          <h2 id="parameters-heading">Параметри</h2>
        </div>
        <div class="field-grid">
          <label>
            <span>Ширина</span>
            <span class="number-field"><input bind:value={width} type="number" min="1" /><small>мм</small></span>
          </label>
          <label>
            <span>Висота</span>
            <span class="number-field"><input bind:value={height} type="number" min="1" /><small>мм</small></span>
          </label>
        </div>
        <p class="hint">Точні обмеження параметрів будуть додані разом із геометричним рушієм.</p>
      </section>
    </aside>

    <section class="preview" aria-labelledby="preview-heading">
      <div class="preview-header">
        <div class="section-heading">
          <span>03</span>
          <h2 id="preview-heading">3D-перегляд</h2>
        </div>
        <span class="units">мм</span>
      </div>
      <div class="viewport">
        <div class="grid" aria-hidden="true"></div>
        <div class="wire-cube" aria-hidden="true">
          <span></span>
        </div>
        <div class="empty-state">
          <strong>Область 3D-моделі</strong>
          <span>Інтерактивний перегляд з’явиться на наступному етапі.</span>
        </div>
      </div>
      <div class="preview-footer">
        <span>Фігура: {selectedShapeName}</span>
        <span>{width} × {height} мм</span>
      </div>
    </section>
  </div>
</main>
