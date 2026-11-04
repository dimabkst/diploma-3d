import { expect, test } from '@playwright/test';
import { EDGE_LIFT_RELATIVE } from '../../packages/engine/src/export/glb.ts';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  hasNoHorizontalOverflow,
  type ModelViewerElement,
  modelViewer,
  previewPlace,
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
    note: '8 граней — рівносторонні трикутники; модель лежить на грані. Параметрів немає.',
    box: [1, 2 / Math.sqrt(3), Math.sqrt(2 / 3)],
    area: 2 * Math.sqrt(3),
    volume: Math.SQRT2 / 3,
  },
  {
    kind: 'icosahedron',
    label: 'Ікосаедр',
    note: '20 граней — рівносторонні трикутники; модель лежить на грані. Параметрів немає.',
    box: [PHI, (2 * PHI) / Math.sqrt(3), PHI ** 2 / Math.sqrt(3)],
    area: 5 * Math.sqrt(3),
    volume: (5 * (3 + Math.sqrt(5))) / 12,
  },
  {
    kind: 'dodecahedron',
    label: 'Додекаедр',
    note: '12 граней — правильні п’ятикутники; модель лежить на грані. Параметрів немає.',
    box: [PHI ** 2, 2 * TAN_54, Math.sqrt((25 + 11 * Math.sqrt(5)) / 10)],
    area: 3 * Math.sqrt(25 + 10 * Math.sqrt(5)),
    volume: (15 + 7 * Math.sqrt(5)) / 4,
  },
] as const;

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
  test(`${solid.kind}: a fixed regular polyhedron with its dimensions, preview and 3MF download`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: solid.label });

    // Fixed proportions: one line, no groups, fields or measurements table.
    await expect(page.getByText(solid.note)).toBeVisible();
    await expect(page.locator('details')).toHaveCount(0);
    await expect(page.getByRole('slider')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('term')).toHaveCount(0);
    await expectPreviewOf(page, summary(solid));

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

test('regular polyhedra: switching to and from parameterised shapes updates controls, dimensions and the download', async ({
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
  await expect(page.getByLabel('Висота h', { exact: true })).toHaveCount(0);
  await expect(page.getByText(dodecahedron.note)).toBeVisible();
  expect((await downloadThreeMf(page)).fileName).toBe('dodecahedron.3mf');

  // From one polyhedron to another, the line and the dimensions change.
  await shapeSelect(page).selectOption({ label: octahedron.label });
  await expectPreviewOf(page, summary(octahedron));
  await expect(page.getByText(octahedron.note)).toBeVisible();
  expectSizesClose((await downloadThreeMf(page)).measurements.size, geometry(octahedron).size, 1e-3);

  // Rapid switches end on a prism, whose own controls and file return.
  for (const { label } of [icosahedron, dodecahedron, octahedron]) await shapeSelect(page).selectOption({ label });
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expect(page.getByLabel('Тип основи', { exact: true })).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(1);
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');
  await expect(downloadButton(page)).toBeEnabled();
  expect((await downloadThreeMf(page)).fileName).toBe('prism-3-sided.3mf');

  // To the icosahedron and back to the cone, whose ratio was kept.
  await shapeSelect(page).selectOption({ label: icosahedron.label });
  await expectPreviewOf(page, summary(icosahedron));
  expect((await downloadThreeMf(page)).fileName).toBe('icosahedron.3mf');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await expect(page.getByLabel('Висота h', { exact: true })).toHaveValue('1');
  await expectPreviewOf(page, 'Конус · 80 × 80 × 40 мм');
  await expect(page.getByRole('slider')).toHaveCount(1);
  expect((await downloadThreeMf(page)).fileName).toBe('cone.3mf');

  expect(errors).toEqual([]);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`regular polyhedra: the preview keeps its place and the page fits (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough on a phone to keep the 3D viewer, which loads models only while visible, on screen above the controls.
    await page.setViewportSize({ width, height: width < 600 ? 2400 : 900 });
    await page.goto('/');

    let reference: Awaited<ReturnType<typeof previewPlace>> | undefined;
    for (const solid of [...solids, solids[0]]) {
      await shapeSelect(page).selectOption({ label: solid.label });
      await expectPreviewOf(page, summary(solid));
      const current = await previewPlace(page);
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    }
  });
}
