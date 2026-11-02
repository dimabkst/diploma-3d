import { expect, type Page, test } from '@playwright/test';
import {
  type Box,
  boxesOf,
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  expectViewerBox,
  measurementValue,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type BaseSides = 3 | 4 | 5 | 6 | 8;

const NAME = 'Правильна призма';
const baseSelect = (page: Page) => page.getByLabel('Основа', { exact: true });
const heightRatio = (page: Page) => page.getByLabel('Висота h', { exact: true });
const heightSlider = (page: Page) => page.getByRole('slider', { name: 'Висота h: повзунок', exact: true });
const stepButton = (page: Page, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `Висота h: ${action}`, exact: true });

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

/** Base edge a, height h and the bounding box for h = ratio × a, with the longest dimension at 80 mm. */
function prismGeometry(sides: BaseSides, ratio: number) {
  const [width, depth] = unitBaseExtents[sides];
  const a = 80 / Math.max(width, depth, ratio);
  const h = ratio * a;
  const baseArea = (sides * a ** 2) / (4 * Math.tan(Math.PI / sides));
  return { a, h, size: [width * a, depth * a, h] as const, volume: baseArea * h, surfaceArea: 2 * baseArea + sides * a * h };
}

const sizeFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const summary = (sides: BaseSides, ratio: number) =>
  `${NAME} · ${prismGeometry(sides, ratio)
    .size.map((value) => sizeFormat.format(value))
    .join(' × ')} мм`;

async function expectDownloadedPrism(page: Page, sides: BaseSides, ratio: number): Promise<void> {
  const expected = prismGeometry(sides, ratio);
  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe(`prism-${sides}-sided.3mf`);
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(measurements.surfaceArea / expected.surfaceArea - 1)).toBeLessThan(1e-6);
}

test('prism: base and height drive the preview and the downloaded 3MF', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });

  // Defaults: equilateral triangle with h = 2a, so h = 80 mm and a = 40 mm.
  await expect(baseSelect(page).locator('option:checked')).toHaveText(baseNames[3]);
  await expect(heightRatio(page)).toHaveValue('2');
  await expectPreviewOf(page, summary(3, 2));
  await expect(page.getByRole('term')).toHaveText(['Сторона основи a', 'Висота h', 'Площа основи', 'Площа поверхні', 'Об’єм']);
  await expect(measurementValue(page, 'Сторона основи a')).toHaveText('40 мм');
  await expect(measurementValue(page, 'Висота h')).toHaveText('80 мм');
  // √3/4 · 40² ≈ 692,8 mm².
  await expect(measurementValue(page, 'Площа основи')).toHaveText('692,8 мм²');
  await expectDownloadedPrism(page, 3, 2);

  // The hexagon is two edges wide: with h = 2a both are 80 mm, so a = 40 mm.
  await chooseBase(page, 6);
  await expect(heightRatio(page)).toHaveValue('2');
  await expectPreviewOf(page, summary(6, 2));
  await heightRatio(page).fill('0,5');
  await expectPreviewOf(page, summary(6, 0.5));
  await expect(measurementValue(page, 'Висота h')).toHaveText('20 мм');
  await expectDownloadedPrism(page, 6, 0.5);

  // The height ratio is kept when the base changes; a square base with h = 0,5a is an 80 × 80 × 40 mm box.
  await chooseBase(page, 4);
  await expect(heightRatio(page)).toHaveValue('0,5');
  await expectPreviewOf(page, `${NAME} · 80 × 80 × 40 мм`);
  await expectViewerBox(page, [80, 80, 40]);
  await stepButton(page, 'збільшити').click();
  await expect(heightRatio(page)).toHaveValue('0,75');
  await heightSlider(page).press('ArrowRight');
  await expect(heightRatio(page)).toHaveValue('1');
  await expectPreviewOf(page, `${NAME} · 80 × 80 × 80 мм`);

  // A precise typed value with the pentagon, whose width is its diagonal φ·a.
  await chooseBase(page, 5);
  await heightRatio(page).fill('1.1');
  await heightRatio(page).blur();
  await expect(heightRatio(page)).toHaveValue('1.1');
  await expect(heightSlider(page)).toHaveValue('1.1');
  await expectPreviewOf(page, summary(5, 1.1));
  await expectDownloadedPrism(page, 5, 1.1);

  // The octagon is (1 + √2)·a wide and deep; the typed height ratio stays as it was.
  await chooseBase(page, 8);
  await expect(heightRatio(page)).toHaveValue('1.1');
  await expectPreviewOf(page, summary(8, 1.1));
  await expect(measurementValue(page, 'Сторона основи a')).toHaveText(`${sizeFormat.format(80 / (1 + Math.SQRT2))} мм`);
  await expectDownloadedPrism(page, 8, 1.1);

  expect(errors).toEqual([]);
});

test('prism: a square base with h = a matches the cube', async ({ page }) => {
  await page.goto('/');
  await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
  const cube = await downloadThreeMf(page);

  await shapeSelect(page).selectOption({ label: NAME });
  await chooseBase(page, 4);
  await heightRatio(page).fill('1');
  await expectPreviewOf(page, `${NAME} · 80 × 80 × 80 мм`);
  const prism = await downloadThreeMf(page);
  expect(prism.fileName).toBe('prism-4-sided.3mf');
  expectSizesClose(prism.measurements.size, cube.measurements.size, 1e-3);
  expectSizesClose(prism.measurements.bounds.min, cube.measurements.bounds.min, 1e-3);
  expect(Math.abs(prism.measurements.volume / cube.measurements.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(prism.measurements.surfaceArea / cube.measurements.surfaceArea - 1)).toBeLessThan(1e-6);
});

test('prism: rapid base and height changes never offer outdated geometry for download', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });
  await expectPreviewOf(page, summary(3, 2));

  // Change the base and read the download button in the same task, before any rebuild can run.
  const disabledRightAfterChange = await baseSelect(page).evaluate(async (select: HTMLSelectElement) => {
    select.selectedIndex = 3;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterChange).toBe(true);

  for (const sides of [5, 3, 4, 6, 5] as const) await chooseBase(page, sides);
  for (const ratio of ['3', '0,25', '1,75']) await heightRatio(page).fill(ratio);
  await chooseBase(page, 3);
  await expectPreviewOf(page, summary(3, 1.75));
  await expectDownloadedPrism(page, 3, 1.75);
});

test('prism: an invalid height is explained, blocks the download and survives base changes until corrected', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });
  await expectPreviewOf(page, summary(3, 2));

  for (const [text, message] of [
    ['', 'Введіть значення.'],
    ['-', 'Введіть число, наприклад 1,5.'],
    ['4,5', 'Допустимі значення — від 0,25 до 4.'],
    ['0,2', 'Допустимі значення — від 0,25 до 4.'],
  ] as const) {
    await heightRatio(page).fill(text);
    await expect(heightRatio(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(message)).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(downloadButton(page)).toBeDisabled();
    await expect(heightSlider(page)).toBeDisabled();
  }

  // Changing the base does not invent a height.
  await chooseBase(page, 6);
  await expect(heightRatio(page)).toHaveValue('0,2');
  await expect(downloadButton(page)).toBeDisabled();

  // The limits are valid: the hexagon is 80 mm wide at h = 0,25a = 10 mm, and h = 4a = 80 mm with a = 20 mm.
  await heightRatio(page).fill('0,25');
  await expectPreviewOf(page, summary(6, 0.25));
  await expect(stepButton(page, 'зменшити')).toBeDisabled();
  await heightSlider(page).press('End');
  await expect(heightRatio(page)).toHaveValue('4');
  await expect(stepButton(page, 'збільшити')).toBeDisabled();
  await expectPreviewOf(page, summary(6, 4));
  await expect(measurementValue(page, 'Сторона основи a')).toHaveText('20 мм');

  expect(errors).toEqual([]);
});

test('prism: switching shapes keeps the prism base and height and the cuboid ratios apart', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });
  await chooseBase(page, 6);
  await heightRatio(page).fill('1,5');
  await expectPreviewOf(page, summary(6, 1.5));

  await shapeSelect(page).selectOption('cuboid');
  await expect(page.getByLabel('Висота c', { exact: true })).toHaveValue('2');
  await expectPreviewOf(page, 'Прямокутний паралелепіпед · 40 × 60 × 80 мм');

  await shapeSelect(page).selectOption({ label: NAME });
  await expect(baseSelect(page).locator('option:checked')).toHaveText(baseNames[6]);
  await expect(heightRatio(page)).toHaveValue('1,5');
  await expectPreviewOf(page, summary(6, 1.5));
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`prism: measurements keep their positions across bases and heights (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough to keep the 3D viewer, which loads only when visible, on screen below the stacked controls.
    await page.setViewportSize({ width, height: 2600 });
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: NAME });
    const values = page.getByRole('definition');
    const footnote = page.getByText('Розміри наведено для файлу друку');

    let reference: { values: Box[]; footnote: Box } | undefined;
    for (const [sides, ratio] of [
      [3, 2],
      [3, 1.1],
      [6, 0.25],
      [5, 1.25],
      [4, 4],
      [6, 1],
      [8, 0.5],
    ] as const) {
      await chooseBase(page, sides);
      await heightRatio(page).fill(String(ratio).replace('.', ','));
      await expectPreviewOf(page, summary(sides, ratio));
      const current = { values: await boxesOf(values), footnote: (await footnote.boundingBox()) as Box };
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}
