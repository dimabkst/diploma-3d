import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  hasNoHorizontalOverflow,
  openSection,
  parameterSection,
  previewPlace,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type Field =
  | 'Висота піраміди h'
  | 'Зміщення X'
  | 'Зміщення Y'
  | 'Сторона основи b'
  | 'Кут α'
  | 'Паралельна сторона b'
  | 'Висота трапеції t'
  | 'Зміщення сторони b';
type Vec2 = readonly [number, number];

const entry = (page: Page, field: Field) => page.getByLabel(field, { exact: true });
const slider = (page: Page, field: Field) => page.getByRole('slider', { name: `${field}: повзунок`, exact: true });
const stepButton = (page: Page, field: Field, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${field}: ${action}`, exact: true });
const baseType = (page: Page) => page.getByLabel('Тип основи', { exact: true });
/** The summary of the "Вершина" group, which reports the apex position also while collapsed. */
const apexStatus = (page: Page) => parameterSection(page, 'Вершина').locator('summary');
const resetApex = (page: Page) => page.getByRole('button', { name: 'Над центром основи', exact: true });

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const centred = (points: readonly Vec2[], [gx, gy]: Vec2): Vec2[] => points.map(([x, y]): Vec2 => [x - gx, y - gy]);

/** Bases with a0 = 1, counter-clockwise and centred on their area centroids, from their definitions. */
const bases = {
  square: () =>
    centred(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      [0.5, 0.5],
    ),
  triangle: (b: number, angle: number) => {
    const p2: Vec2 = [b * Math.cos(radians(angle)), b * Math.sin(radians(angle))];
    return centred([[0, 0], [1, 0], p2], [(1 + p2[0]) / 3, p2[1] / 3]);
  },
  parallelogram: (b: number, angle: number) => {
    const v: Vec2 = [b * Math.cos(radians(angle)), b * Math.sin(radians(angle))];
    return centred([[0, 0], [1, 0], [1 + v[0], v[1]], v], [(1 + v[0]) / 2, v[1] / 2]);
  },
  trapezoid: (b: number, t: number, delta: number) => {
    const k = (1 + 2 * b) / (3 * (1 + b));
    return centred(
      [
        [-0.5, 0],
        [0.5, 0],
        [delta + b / 2, t],
        [delta - b / 2, t],
      ],
      [k * delta, k * t],
    );
  },
};

/** The pyramid over `base` with height h0 and apex (qx0, qy0), scaled so that its bounding box is at most 80 mm. */
function geometry(base: readonly Vec2[], h0: number, qx0 = 0, qy0 = 0) {
  const points = [...base, [qx0, qy0] as Vec2];
  const extent = (axis: 0 | 1) => Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]));
  const size0 = [extent(0), extent(1), h0];
  const s = 80 / Math.max(...size0);
  const apex = [qx0 * s, qy0 * s, h0 * s] as const;
  const scaled = base.map(([x, y]) => [x * s, y * s] as const);
  const baseArea = scaled.reduce((sum, [x, y], i) => {
    const [nx, ny] = scaled[(i + 1) % scaled.length] as Vec2;
    return sum + (x * ny - nx * y) / 2;
  }, 0);
  const faces = scaled.map(([x, y], i) => {
    const [nx, ny] = scaled[(i + 1) % scaled.length] as Vec2;
    const e = [nx - x, ny - y, 0];
    const w = [apex[0] - x, apex[1] - y, apex[2]];
    const cross = [
      (e[1] as number) * (w[2] as number) - (e[2] as number) * (w[1] as number),
      (e[2] as number) * (w[0] as number) - (e[0] as number) * (w[2] as number),
      (e[0] as number) * (w[1] as number) - (e[1] as number) * (w[0] as number),
    ];
    const area = Math.hypot(...cross) / 2;
    return { area, height: (2 * area) / Math.hypot(nx - x, ny - y), edge: Math.hypot(...w) };
  });
  const lateralArea = faces.reduce((sum, face) => sum + face.area, 0);
  return {
    a: s,
    h: h0 * s,
    size: size0.map((value) => value * s),
    baseArea,
    lateralArea,
    lateralEdges: faces.map((face) => face.edge),
    faceHeights: faces.map((face) => face.height),
    volume: (baseArea * h0 * s) / 3,
    surfaceArea: baseArea + lateralArea,
  };
}

const summary = (expected: { size: number[] }) =>
  `Піраміда · ${expected.size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

async function expectDownloadedPyramid(page: Page, fileName: string, expected: ReturnType<typeof geometry>): Promise<void> {
  const { fileName: actual, measurements } = await downloadThreeMf(page);
  expect(actual).toBe(fileName);
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(measurements.surfaceArea / expected.surfaceArea - 1)).toBeLessThan(1e-6);
}

test('pyramid: the apex moves within and beyond the square base, and returns above its centre', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Піраміда' });
  await expect(apexStatus(page)).toHaveText(/^Вершина\s*над центром\s*$/);
  await openSection(page, 'Вершина');
  await page.getByRole('button', { name: 'Як задано вершину?' }).click();
  await expect(page.getByText('Зміщення відлічується від центра мас основи')).toBeVisible();
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(resetApex(page)).toBeDisabled();

  // The reference: the apex above the corner (−a/2, −a/2) of the square with h = a. The box stays 1 × 1 × 1, so
  // a = h = 80 mm; the lateral edges are 80, 80√2, 80√3 and 80√2 mm.
  await entry(page, 'Зміщення X').fill('-0,5');
  await entry(page, 'Зміщення Y').fill('-0,5');
  await expect(apexStatus(page)).toHaveText(/^Вершина\s*зміщена\s*$/);
  const corner = geometry(bases.square(), 1, -0.5, -0.5);
  await expectPreviewOf(page, 'Піраміда · 80 × 80 × 80 мм');
  await expectDownloadedPyramid(page, 'pyramid-4-sided.3mf', corner);

  // Outside the base: the apex at (a, 0) widens the box to 1,5a, so a = h = 160/3 mm.
  await entry(page, 'Зміщення X').fill('1');
  await entry(page, 'Зміщення Y').fill('0');
  await expectPreviewOf(page, summary(geometry(bases.square(), 1, 1, 0)));

  // Negative and typed values with the quarter steps. The limits are ±4, but at h = a the lean reaches 15° at
  // a / tan 15° ≈ 3,732a, where the slider ends.
  const x = entry(page, 'Зміщення X');
  await x.fill('-0,1');
  await stepButton(page, 'Зміщення X', 'зменшити').click();
  await expect(x).toHaveValue('-0,25');
  await x.fill('-0,1');
  await stepButton(page, 'Зміщення X', 'збільшити').click();
  await expect(x).toHaveValue('0');
  await expect(slider(page, 'Зміщення X')).toHaveAttribute('max', '3.732');
  await slider(page, 'Зміщення X').press('End');
  await expect(x).toHaveValue('3,732');
  await expect(stepButton(page, 'Зміщення X', 'збільшити')).toBeDisabled();
  // At h = 2a the apex may lie as far as (2,35a, −3,05a): about 3,85a from the centroid.
  await entry(page, 'Висота піраміди h').fill('2');
  await x.fill('2.35');
  await x.blur();
  await expect(x).toHaveValue('2.35');
  await entry(page, 'Зміщення Y').fill('-3,05');
  const far = geometry(bases.square(), 2, 2.35, -3.05);
  await expectPreviewOf(page, summary(far));
  await expectDownloadedPyramid(page, 'pyramid-4-sided.3mf', far);

  // Back above the centre: only the apex changes.
  await entry(page, 'Висота піраміди h').fill('1,5');
  await resetApex(page).click();
  await expect(x).toHaveValue('0');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('0');
  await expect(entry(page, 'Висота піраміди h')).toHaveValue('1,5');
  await expect(apexStatus(page)).toHaveText(/^Вершина\s*над центром\s*$/);
  await expect(resetApex(page)).toBeDisabled();
  await expectPreviewOf(page, summary(geometry(bases.square(), 1.5)));

  expect(errors).toEqual([]);
});

test('pyramid: triangle, parallelogram and trapezoid bases with their own fields and files', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Піраміда' });
  await expect(baseType(page).locator('option')).toHaveText(['Правильний багатокутник', 'Трикутник', 'Паралелограм', 'Трапеція']);
  await entry(page, 'Висота піраміди h').fill('1');
  await openSection(page, 'Вершина');
  await entry(page, 'Зміщення X').fill('0,25');

  // The right triangle a = 4, b = 3 (in units of a/4); the apex keeps its offset.
  await baseType(page).selectOption({ label: 'Трикутник' });
  await expect(page.getByLabel('Багатокутник', { exact: true })).toHaveCount(0);
  await entry(page, 'Сторона основи b').fill('0,75');
  await entry(page, 'Кут α').fill('90');
  const triangle = geometry(bases.triangle(0.75, 90), 1, 0.25, 0);
  await expectPreviewOf(page, summary(triangle));
  await expectDownloadedPyramid(page, 'pyramid-triangle.3mf', triangle);

  // The parallelogram with b = 2a and α = 120°, with an off-step angle.
  await baseType(page).selectOption({ label: 'Паралелограм' });
  await expect(entry(page, 'Сторона основи b')).toHaveValue('1');
  await entry(page, 'Сторона основи b').fill('2');
  await entry(page, 'Кут α').fill('117,5');
  const parallelogram = geometry(bases.parallelogram(2, 117.5), 1, 0.25, 0);
  await expectPreviewOf(page, summary(parallelogram));
  await expectDownloadedPyramid(page, 'pyramid-parallelogram.3mf', parallelogram);

  // The right trapezoid of the prism reference, aligned with the existing action, and the apex across the base.
  await baseType(page).selectOption({ label: 'Трапеція' });
  await entry(page, 'Висота трапеції t').fill('0,375');
  await page.getByRole('button', { name: 'Вирівняти зліва', exact: true }).click();
  await expect(entry(page, 'Зміщення сторони b')).toHaveValue('-0,25');
  await entry(page, 'Зміщення Y').fill('-0,75');
  const trapezoid = geometry(bases.trapezoid(0.5, 0.375, -0.25), 1, 0.25, -0.75);
  await expectPreviewOf(page, summary(trapezoid));
  await expectDownloadedPyramid(page, 'pyramid-trapezoid.3mf', trapezoid);

  expect(errors).toEqual([]);
});

test('pyramid: switching bases keeps the height and apex and validates only the active base', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Піраміда' });
  await entry(page, 'Висота піраміди h').fill('0,75');
  await openSection(page, 'Вершина');
  await entry(page, 'Зміщення Y').fill('1,5');
  await expectPreviewOf(page, summary(geometry(bases.square(), 0.75, 0, 1.5)));

  // Switch and read the download button in the same task: the square pyramid must not be offered for the triangle.
  const disabledRightAfterSwitch = await baseType(page).evaluate(async (select: HTMLSelectElement) => {
    select.value = 'triangle';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterSwitch).toBe(true);
  await expect(entry(page, 'Висота піраміди h')).toHaveValue('0,75');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('1,5');
  await expectPreviewOf(page, summary(geometry(bases.triangle(1, 60), 0.75, 0, 1.5)));

  // An invalid parallelogram angle blocks only the parallelogram.
  await baseType(page).selectOption({ label: 'Паралелограм' });
  await entry(page, 'Кут α').fill('170');
  await expect(page.getByText('Допустимі значення — від 15° до 165°.')).toBeVisible();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(downloadButton(page)).toBeDisabled();
  await baseType(page).selectOption({ label: 'Трикутник' });
  await expect(entry(page, 'Кут α')).toHaveValue('60');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  expect((await downloadThreeMf(page)).fileName).toBe('pyramid-triangle.3mf');

  // An invalid apex blocks every base until it is reset.
  await entry(page, 'Зміщення X').fill('-');
  await expect(page.getByText('Введіть число, наприклад -0,5.')).toBeVisible();
  await expect(downloadButton(page)).toBeDisabled();
  await expect(apexStatus(page)).toHaveText(/^Вершина\s*помилка\s*$/);
  await resetApex(page).click();
  await expect(entry(page, 'Зміщення Y')).toHaveValue('0');
  await baseType(page).selectOption({ label: 'Правильний багатокутник' });
  const latest = geometry(bases.square(), 0.75);
  await expectPreviewOf(page, summary(latest));
  await expectDownloadedPyramid(page, 'pyramid-4-sided.3mf', latest);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`pyramid apex: the preview keeps its place without horizontal overflow (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough on a phone to keep the 3D viewer, which loads models only while visible, on screen above the controls.
    await page.setViewportSize({ width, height: width < 600 ? 2400 : 900 });
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: 'Піраміда' });
    await baseType(page).selectOption({ label: 'Трапеція' });
    await openSection(page, 'Вершина');

    let reference: Awaited<ReturnType<typeof previewPlace>> | undefined;
    // Equal and unequal lateral edges, the apex inside, on the border and far outside, flat and tall pyramids.
    for (const [x, y, h] of [
      ['0', '0', '1'],
      ['-0,5', '0', '1'],
      ['4', '-4', '4'],
      ['0,5', '0,5', '0,25'],
      ['-2,35', '3,05', '4'],
      ['0,1', '-0,2', '2'],
    ] as const) {
      await entry(page, 'Зміщення X').fill(x);
      await entry(page, 'Зміщення Y').fill(y);
      await entry(page, 'Висота піраміди h').fill(h);
      const [qx, qy, h0] = [x, y, h].map((text) => Number(text.replace(',', '.'))) as [number, number, number];
      await expectPreviewOf(page, summary(geometry(bases.trapezoid(0.5, 0.5, 0), h0, qx, qy)));
      const current = await previewPlace(page);
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    }
  });
}
