import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  previewViewport,
  shapeSelect,
  viewerDimensionsMm,
} from './helpers.ts';

const widthRatio = (page: Page) => page.getByLabel('Ширина, b / a');
const heightRatio = (page: Page) => page.getByLabel('Висота, c / a');
const NAME = 'Прямокутний паралелепіпед';
// Covers the preview's edge lines, which are drawn slightly outside the solid.
const VIEWER_TOLERANCE_MM = 0.5;

test('cuboid: ratios drive the preview and the downloaded 3MF', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await shapeSelect(page).selectOption('cuboid');
  await expect(widthRatio(page)).toHaveValue('1,5');
  await expect(heightRatio(page)).toHaveValue('2');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);
  // Z-up a × b × c becomes glTF X × Y × Z = a × c × b: the height is the viewer's vertical axis.
  expectSizesClose(await viewerDimensionsMm(page), [40, 80, 60], VIEWER_TOLERANCE_MM);

  // L / max(1, 2,5, 0,5) = 32 mm, so a × b × c = 32 × 80 × 16 mm; the width is now the longest edge.
  await widthRatio(page).fill('2,5');
  await heightRatio(page).fill('0,5');
  await expectPreviewOf(page, `${NAME} · 32 × 80 × 16 мм`);
  expectSizesClose(await viewerDimensionsMm(page), [32, 16, 80], VIEWER_TOLERANCE_MM);

  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe('cuboid.3mf');
  expectSizesClose(measurements.size, [32, 80, 16], 1e-4);
  expect(measurements.volume).toBeCloseTo(32 * 80 * 16, 2);

  expect(errors).toEqual([]);
});

test('cuboid: rapid edits never offer outdated geometry for download', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);

  // Edit and read the button in the same task: the model must be invalidated before any timer or rebuild can run.
  const disabledRightAfterEdit = await widthRatio(page).evaluate(async (input: HTMLInputElement) => {
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // One macrotask lets Svelte apply the change while the 150 ms rebuild delay has certainly not elapsed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterEdit).toBe(true);

  for (const value of ['0,75', '4', '1,25', '0,5']) {
    await heightRatio(page).fill(value);
  }
  await widthRatio(page).fill('1');
  // b/a = 1 and c/a = 0,5: a = b = 80 mm and c = 40 mm.
  await expectPreviewOf(page, `${NAME} · 80 × 80 × 40 мм`);
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.size, [80, 80, 40], 1e-4);
});

test('cuboid: invalid ratios are explained and block the download until corrected', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);

  for (const [text, message] of [
    ['', 'Введіть значення.'],
    ['абв', 'Введіть число, наприклад 1,5.'],
    ['4,5', 'Допустимі значення — від 0,25 до 4.'],
    ['0,2', 'Допустимі значення — від 0,25 до 4.'],
  ] as const) {
    await widthRatio(page).fill(text);
    await expect(widthRatio(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(widthRatio(page)).toHaveAccessibleDescription(message);
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(page.getByRole('alert')).toContainText('Модель не оновлено');
    await expect(downloadButton(page)).toBeDisabled();
  }

  // The limits themselves are valid.
  await widthRatio(page).fill('0,25');
  await heightRatio(page).fill('4');
  await expect(widthRatio(page)).not.toHaveAttribute('aria-invalid');
  // L / 4 = 20 mm: a × b × c = 20 × 5 × 80 mm.
  await expectPreviewOf(page, `${NAME} · 20 × 5 × 80 мм`);

  expect(errors).toEqual([]);
});

test('cuboid: switching back to the cube restores equal edges and keeps the cuboid ratios', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await widthRatio(page).fill('2');
  await expectPreviewOf(page, `${NAME} · 40 × 80 × 80 мм`);

  await shapeSelect(page).selectOption('cube');
  await expect(widthRatio(page)).toHaveCount(0);
  await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
  expectSizesClose(await viewerDimensionsMm(page), [80, 80, 80], VIEWER_TOLERANCE_MM);
  const cube = await downloadThreeMf(page);
  expect(cube.fileName).toBe('cube.3mf');
  expect(cube.measurements.size).toEqual([80, 80, 80]);

  await shapeSelect(page).selectOption('cuboid');
  await expect(widthRatio(page)).toHaveValue('2');
  await expectPreviewOf(page, `${NAME} · 40 × 80 × 80 мм`);

  expect(errors).toEqual([]);
});
