import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  hasNoHorizontalOverflow,
  previewPlace,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type BaseSides = 3 | 4 | 5 | 6 | 8;

const PYRAMID = 'Піраміда';
const TETRAHEDRON = 'Правильний тетраедр';
const baseSelect = (page: Page) => page.getByLabel('Багатокутник', { exact: true });
const heightRatio = (page: Page) => page.getByLabel('Висота піраміди h', { exact: true });
const heightSlider = (page: Page) => page.getByRole('slider', { name: 'Висота піраміди h: повзунок', exact: true });
const stepButton = (page: Page, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `Висота піраміди h: ${action}`, exact: true });

const baseNames: Readonly<Record<BaseSides, string>> = {
  3: 'Рівносторонній трикутник',
  4: 'Квадрат',
  5: 'Правильний п’ятикутник',
  6: 'Правильний шестикутник',
  8: 'Правильний восьмикутник',
};
const chooseBase = (page: Page, sides: BaseSides) => baseSelect(page).selectOption({ label: baseNames[sides] });

// Width and depth of a base with edge 1 (see the engine's prism tests for their derivation).
const unitBaseExtents: Readonly<Record<BaseSides, readonly [number, number]>> = {
  3: [1, Math.sqrt(3) / 2],
  4: [1, 1],
  5: [(1 + Math.sqrt(5)) / 2, (1 + Math.cos(Math.PI / 5)) / (2 * Math.sin(Math.PI / 5))],
  6: [2, Math.sqrt(3)],
  8: [1 + Math.SQRT2, 1 + Math.SQRT2],
};

/** A regular pyramid with h = ratio × a and the longest dimension at 80 mm, from the textbook formulas. */
function pyramidGeometry(sides: BaseSides, ratio: number) {
  const [width, depth] = unitBaseExtents[sides];
  const a = 80 / Math.max(width, depth, ratio);
  const h = ratio * a;
  const baseArea = (sides * a ** 2) / (4 * Math.tan(Math.PI / sides));
  const apothem = a / (2 * Math.tan(Math.PI / sides));
  return {
    size: [width * a, depth * a, h] as const,
    volume: (baseArea * h) / 3,
    surfaceArea: baseArea + (sides * a * Math.hypot(h, apothem)) / 2,
  };
}

const sizeFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const summary = (name: string, size: readonly number[]) =>
  `${name} · ${size.map((value) => sizeFormat.format(value)).join(' × ')} мм`;
const pyramidSummary = (sides: BaseSides, ratio: number) => summary(PYRAMID, pyramidGeometry(sides, ratio).size);

async function expectDownloaded(
  page: Page,
  fileName: string,
  expected: { size: readonly number[]; volume: number; surfaceArea: number },
): Promise<void> {
  const downloaded = await downloadThreeMf(page);
  expect(downloaded.fileName).toBe(fileName);
  expectSizesClose(downloaded.measurements.size, expected.size, 1e-3);
  expect(downloaded.measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(downloaded.measurements.volume / expected.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(downloaded.measurements.surfaceArea / expected.surfaceArea - 1)).toBeLessThan(1e-6);
}

const expectDownloadedPyramid = (page: Page, sides: BaseSides, ratio: number) =>
  expectDownloaded(page, `pyramid-${sides}-sided.3mf`, pyramidGeometry(sides, ratio));

test('pyramid: base and height drive the preview and the downloaded 3MF', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: PYRAMID });

  // Defaults: square base with h = a, so a = h = 80 mm.
  await expect(baseSelect(page).locator('option')).toHaveText(Object.values(baseNames));
  await expect(baseSelect(page).locator('option:checked')).toHaveText(baseNames[4]);
  await expect(heightRatio(page)).toHaveValue('1');
  await expectPreviewOf(page, `${PYRAMID} · 80 × 80 × 80 мм`);
  await expect(page.locator('summary')).toHaveText([/^Основа/, /^Висота/, /^Вершина\s*над центром/]);
  await expectDownloadedPyramid(page, 4, 1);

  // The hexagon is two edges wide; h/a = 1 is kept, so a = h = 40 mm.
  await chooseBase(page, 6);
  await expect(heightRatio(page)).toHaveValue('1');
  await expectPreviewOf(page, pyramidSummary(6, 1));
  await heightRatio(page).fill('2');
  await expectPreviewOf(page, pyramidSummary(6, 2));
  await expectDownloadedPyramid(page, 6, 2);

  // Triangle at the upper limit h = 4a: a = 20 mm, h = 80 mm.
  await chooseBase(page, 3);
  await heightSlider(page).press('End');
  await expect(heightRatio(page)).toHaveValue('4');
  await expect(stepButton(page, 'збільшити')).toBeDisabled();
  await expectPreviewOf(page, pyramidSummary(3, 4));
  await expectDownloadedPyramid(page, 3, 4);

  // A precise typed value with the pentagon, and quarter steps from it.
  await chooseBase(page, 5);
  await heightRatio(page).fill('1.1');
  await heightRatio(page).blur();
  await expect(heightRatio(page)).toHaveValue('1.1');
  await expectPreviewOf(page, pyramidSummary(5, 1.1));
  await expectDownloadedPyramid(page, 5, 1.1);
  await stepButton(page, 'зменшити').click();
  await expect(heightRatio(page)).toHaveValue('1');
  await expectPreviewOf(page, pyramidSummary(5, 1));

  // The octagon is (1 + √2)·a wide and deep; with h = a the base edge is 80 / (1 + √2) ≈ 33,1 mm.
  await chooseBase(page, 8);
  await expect(heightRatio(page)).toHaveValue('1');
  await expectPreviewOf(page, pyramidSummary(8, 1));
  await expectDownloadedPyramid(page, 8, 1);

  expect(errors).toEqual([]);
});

test('tetrahedron: a fixed preset with six equal edges and no adjustable parameters', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: TETRAHEDRON });

  await expect(baseSelect(page)).toHaveCount(0);
  await expect(heightRatio(page)).toHaveCount(0);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByText('Усі ребра рівні, грані — рівносторонні трикутники. Параметрів немає.')).toBeVisible();
  await expect(page.locator('details')).toHaveCount(0);

  // The base edge is the longest dimension: a = 80 mm, h = a·√(2/3) ≈ 65,3 mm and the base is √3/2·a ≈ 69,3 mm deep.
  const a = 80;
  const expected = {
    size: [a, (Math.sqrt(3) / 2) * a, a * Math.sqrt(2 / 3)],
    volume: a ** 3 / (6 * Math.SQRT2),
    surfaceArea: Math.sqrt(3) * a ** 2,
  };
  await expectPreviewOf(page, summary(TETRAHEDRON, expected.size));
  await expectDownloaded(page, 'tetrahedron.3mf', expected);

  // The triangular pyramid at the nearest quarter, h = 0,75a, is a different, flatter solid.
  await shapeSelect(page).selectOption({ label: PYRAMID });
  await chooseBase(page, 3);
  await heightRatio(page).fill('0,75');
  await expectPreviewOf(page, pyramidSummary(3, 0.75));

  expect(errors).toEqual([]);
});

test('pyramid: rapid base and height changes never offer outdated geometry for download', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: PYRAMID });
  await expectPreviewOf(page, `${PYRAMID} · 80 × 80 × 80 мм`);

  const disabledRightAfterChange = await baseSelect(page).evaluate(async (select: HTMLSelectElement) => {
    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterChange).toBe(true);

  for (const sides of [5, 8, 3, 6, 4] as const) await chooseBase(page, sides);
  for (const ratio of ['3', '0,25', '2,5']) await heightRatio(page).fill(ratio);
  await shapeSelect(page).selectOption({ label: TETRAHEDRON });
  await shapeSelect(page).selectOption({ label: PYRAMID });
  await chooseBase(page, 6);
  await expectPreviewOf(page, pyramidSummary(6, 2.5));
  await expectDownloadedPyramid(page, 6, 2.5);
});

test('pyramid: an invalid height is explained and blocks the download until corrected', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: PYRAMID });
  await expectPreviewOf(page, `${PYRAMID} · 80 × 80 × 80 мм`);

  for (const [text, message] of [
    ['', 'Введіть значення.'],
    ['абв', 'Введіть число, наприклад 1,5.'],
    ['0,2', 'Допустимі значення — від 0,25 до 4.'],
    ['4,5', 'Допустимі значення — від 0,25 до 4.'],
  ] as const) {
    await heightRatio(page).fill(text);
    await expect(heightRatio(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(message)).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(downloadButton(page)).toBeDisabled();
    await expect(heightSlider(page)).toBeDisabled();
  }
  await chooseBase(page, 5);
  await expect(heightRatio(page)).toHaveValue('4,5');
  await expect(downloadButton(page)).toBeDisabled();

  // The lower limit is valid: a pentagon φ·a wide with h = 0,25a.
  await heightRatio(page).fill('0,25');
  await expect(stepButton(page, 'зменшити')).toBeDisabled();
  await expectPreviewOf(page, pyramidSummary(5, 0.25));
  await expectDownloadedPyramid(page, 5, 0.25);

  expect(errors).toEqual([]);
});

test('pyramid: switching shapes keeps the pyramid and prism parameters apart', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: PYRAMID });
  await chooseBase(page, 6);
  await heightRatio(page).fill('0,5');
  await expectPreviewOf(page, pyramidSummary(6, 0.5));

  await shapeSelect(page).selectOption({ label: 'Призма' });
  // The prism has its own polygon and height fields.
  await expect(baseSelect(page).locator('option:checked')).toHaveText(baseNames[3]);
  await expect(page.getByLabel('Висота h', { exact: true })).toHaveValue('2');
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');

  await shapeSelect(page).selectOption({ label: TETRAHEDRON });
  await expectPreviewOf(page, `${TETRAHEDRON} · 80 × 69,3 × 65,3 мм`);

  await shapeSelect(page).selectOption({ label: PYRAMID });
  await expect(baseSelect(page).locator('option:checked')).toHaveText(baseNames[6]);
  await expect(heightRatio(page)).toHaveValue('0,5');
  await expectPreviewOf(page, pyramidSummary(6, 0.5));
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`pyramid: the preview keeps its place across bases, heights and the tetrahedron (${layout}, ${width} px)`, async ({
    page,
  }) => {
    // Tall enough on a phone to keep the 3D viewer, which loads models only while visible, on screen above the controls.
    await page.setViewportSize({ width, height: width < 600 ? 2400 : 900 });
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: PYRAMID });

    let reference: Awaited<ReturnType<typeof previewPlace>> | undefined;
    for (const [sides, ratio] of [
      [4, 1],
      [3, 1.1],
      [6, 0.25],
      [5, 4],
      [3, 2.05],
      [8, 0.5],
    ] as const) {
      await chooseBase(page, sides);
      await heightRatio(page).fill(String(ratio).replace('.', ','));
      await expectPreviewOf(page, pyramidSummary(sides, ratio));
      const current = await previewPlace(page);
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    }

    // The tetrahedron, a fixed solid with a single line instead of groups, leaves the preview where it was.
    await shapeSelect(page).selectOption({ label: TETRAHEDRON });
    await expectPreviewOf(page, `${TETRAHEDRON} · 80 × 69,3 × 65,3 мм`);
    expect(await previewPlace(page)).toEqual(reference);
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
  });
}
