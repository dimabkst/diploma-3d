import { expect, test } from '@playwright/test';
import { EDGE_LIFT_RELATIVE } from '../../packages/engine/src/export/glb.ts';
import {
  boxesOf,
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  type ModelViewerElement,
  measurementValue,
  modelViewer,
  shapeSelect,
} from './helpers.ts';

const PHI = (1 + Math.sqrt(5)) / 2;
const TAN_54 = Math.tan((54 * Math.PI) / 180);

/**
 * Resting on a face with an edge along X, the box in edges a is: octahedron 1 × 2/√3 × √(2/3), icosahedron
 * φ × 2φ/√3 × φ²/√3, dodecahedron φ² × 2·tan 54° × √((25 + 11√5)/10). The depth is the largest, so a = 80 mm / depth.
 */
const solids = [
  {
    kind: 'octahedron',
    label: 'Октаедр',
    faces: 'вісім граней — рівносторонні трикутники',
    box: [1, 2 / Math.sqrt(3), Math.sqrt(2 / 3)],
    area: 2 * Math.sqrt(3),
    volume: Math.SQRT2 / 3,
    shown: { edge: '69,3 мм', area: '16 627,7 мм²', volume: '156 767,3 мм³', counts: ['6', '12', '8'] },
  },
  {
    kind: 'icosahedron',
    label: 'Ікосаедр',
    faces: 'двадцять граней — рівносторонні трикутники',
    box: [PHI, (2 * PHI) / Math.sqrt(3), PHI ** 2 / Math.sqrt(3)],
    area: 5 * Math.sqrt(3),
    volume: (5 * (3 + Math.sqrt(5))) / 12,
    shown: { edge: '42,8 мм', area: '15 878 мм²', volume: '171 274,6 мм³', counts: ['12', '30', '20'] },
  },
  {
    kind: 'dodecahedron',
    label: 'Додекаедр',
    faces: 'дванадцять граней — правильні п’ятикутники',
    box: [PHI ** 2, 2 * TAN_54, Math.sqrt((25 + 11 * Math.sqrt(5)) / 10)],
    area: 3 * Math.sqrt(25 + 10 * Math.sqrt(5)),
    volume: (15 + 7 * Math.sqrt(5)) / 4,
    shown: { edge: '29,1 мм', area: '17 437 мм²', volume: '188 091,3 мм³', counts: ['20', '30', '12'] },
  },
] as const;

const TERMS = ['Ребро a', 'Площа поверхні', 'Об’єм', 'Кількість вершин', 'Кількість ребер', 'Кількість граней'];

const sizeFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const geometry = (solid: (typeof solids)[number]) => {
  const a = 80 / Math.max(...solid.box);
  return { a, size: solid.box.map((value) => value * a) as [number, number, number] };
};
const summary = (solid: (typeof solids)[number]) =>
  `${solid.label} · ${geometry(solid)
    .size.map((value) => sizeFormat.format(value))
    .join(' × ')} мм`;

for (const solid of solids) {
  test(`${solid.kind}: a fixed regular polyhedron with exact measurements, preview and 3MF download`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: solid.label });

    await expect(page.getByText(solid.faces)).toBeVisible();
    await expect(page.getByText(`ребро a — ${solid.shown.edge}`)).toBeVisible();
    await expect(page.getByRole('slider')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByLabel('Висота h', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Основа', { exact: true })).toHaveCount(0);
    await expectPreviewOf(page, summary(solid));

    await expect(page.getByRole('term')).toHaveText(TERMS);
    await expect(measurementValue(page, 'Ребро a')).toHaveText(solid.shown.edge);
    await expect(measurementValue(page, 'Площа поверхні')).toHaveText(solid.shown.area);
    await expect(measurementValue(page, 'Об’єм')).toHaveText(solid.shown.volume);
    const [vertices, edges, faces] = solid.shown.counts;
    await expect(measurementValue(page, 'Кількість вершин')).toHaveText(vertices);
    await expect(measurementValue(page, 'Кількість ребер')).toHaveText(edges);
    await expect(measurementValue(page, 'Кількість граней')).toHaveText(faces);
    // Flat faces with exact vertices: nothing is approximate.
    await expect(page.locator('dd[data-approximate]')).toHaveCount(0);

    // The viewer shows glTF (x, z, y) in metres. Edge lines run outside the slanted faces by up to three lifts at a
    // vertex, so the shown box may exceed the solid by that much on each side, never fall short of it.
    const { a, size } = geometry(solid);
    const shown = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
    const lift = EDGE_LIFT_RELATIVE * Math.hypot(...size);
    [shown.x, shown.z, shown.y].forEach((value, axis) => {
      const excess = value * 1000 - (size[axis] as number);
      expect(excess).toBeGreaterThan(-0.01);
      expect(excess).toBeLessThan(6 * lift);
    });

    const { fileName, measurements } = await downloadThreeMf(page);
    expect(fileName).toBe(`${solid.kind}.3mf`);
    expectSizesClose(measurements.size, size, 1e-3);
    expectSizesClose(measurements.bounds.min, [-size[0] / 2, -size[1] / 2, 0], 1e-3);
    expect(Math.max(...measurements.size)).toBeCloseTo(80, 3);
    expect(measurements.surfaceArea / (solid.area * a ** 2)).toBeCloseTo(1, 5);
    expect(measurements.volume / (solid.volume * a ** 3)).toBeCloseTo(1, 5);

    expect(errors).toEqual([]);
  });
}

test('regular polyhedra: switching to and from parameterised shapes updates controls, measurements and the download', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const [octahedron, icosahedron, dodecahedron] = solids;
  await page.goto('/');

  // A cone with h = r: 80 × 80 × 40 mm.
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await page.getByLabel('Висота h', { exact: true }).fill('1');
  await expectPreviewOf(page, 'Конус · 80 × 80 × 40 мм');

  // Switch and read the download button in the same task: the cone must not be offered for the dodecahedron.
  const disabledRightAfterSwitch = await shapeSelect(page).evaluate(async (select: HTMLSelectElement) => {
    select.value = 'dodecahedron';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterSwitch).toBe(true);
  await expectPreviewOf(page, summary(dodecahedron));
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByRole('term')).toHaveText(TERMS);
  await expect(measurementValue(page, 'Ребро a')).toHaveText(dodecahedron.shown.edge);
  await expect(page.getByText('Твірні')).toHaveCount(0);
  expect((await downloadThreeMf(page)).fileName).toBe('dodecahedron.3mf');

  // From one polyhedron to another, the rows stay and their values change.
  await shapeSelect(page).selectOption({ label: octahedron.label });
  await expectPreviewOf(page, summary(octahedron));
  await expect(measurementValue(page, 'Ребро a')).toHaveText(octahedron.shown.edge);
  await expect(measurementValue(page, 'Кількість граней')).toHaveText('8');
  expectSizesClose((await downloadThreeMf(page)).measurements.size, geometry(octahedron).size, 1e-3);

  // Rapid switches end on a prism, whose own controls and file return.
  for (const { label } of [icosahedron, dodecahedron, octahedron]) await shapeSelect(page).selectOption({ label });
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expect(page.getByLabel('Основа', { exact: true })).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(3);
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');
  await expect(page.getByRole('term').first()).toHaveText('Сторона основи a');
  await expect(downloadButton(page)).toBeEnabled();
  expect((await downloadThreeMf(page)).fileName).toBe('prism-3-sided.3mf');

  // To the icosahedron and back to the cone, whose ratio was kept.
  await shapeSelect(page).selectOption({ label: icosahedron.label });
  await expectPreviewOf(page, summary(icosahedron));
  await expect(measurementValue(page, 'Кількість вершин')).toHaveText('12');
  expect((await downloadThreeMf(page)).fileName).toBe('icosahedron.3mf');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await expect(page.getByLabel('Висота h', { exact: true })).toHaveValue('1');
  await expectPreviewOf(page, 'Конус · 80 × 80 × 40 мм');
  await expect(page.getByRole('term')).toHaveCount(7);
  expect((await downloadThreeMf(page)).fileName).toBe('cone.3mf');

  expect(errors).toEqual([]);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`regular polyhedra: measurements keep their positions and fit (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough to keep the 3D viewer, which loads only when visible, on screen below the stacked controls.
    await page.setViewportSize({ width, height: 3000 });
    await page.goto('/');
    const values = page.getByRole('definition');

    let reference: Awaited<ReturnType<typeof boxesOf>> | undefined;
    for (const solid of [...solids, solids[0]]) {
      await shapeSelect(page).selectOption({ label: solid.label });
      await expectPreviewOf(page, summary(solid));
      const current = await boxesOf(values);
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const value of await values.all()) {
        expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
    }
  });
}
