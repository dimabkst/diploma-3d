import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  openAllSections,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });
const stepButton = (page: Page, label: string, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${label}: ${action}`, exact: true });
const resetShape = (page: Page) => page.getByRole('button', { name: 'Скинути параметри фігури', exact: true });
const printSize = (page: Page) => entry(page, 'Найбільший габарит');
/** The inscribed regular N-gon of radius r, which the exported circle is; N = 64 for every radius up to 40 mm. */
const polygonArea = (r: number) => (64 * r ** 2 * Math.sin((2 * Math.PI) / 64)) / 2;

test('pyramid: the entry, slider and buttons share 0,25…4, keep values between steps and never widen', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Піраміда' });
  await openAllSections(page);
  const height = entry(page, 'Висота піраміди h');
  const heightSlider = slider(page, 'Висота піраміди h');
  await expect(heightSlider).toHaveAttribute('min', '0.25');
  await expect(heightSlider).toHaveAttribute('max', '4');

  // Both ends are allowed: the square base a = 80 mm with h = a/4 = 20 mm, V = a²h/3.
  await heightSlider.press('Home');
  await expect(height).toHaveValue('0,25');
  await expect(stepButton(page, 'Висота піраміди h', 'зменшити')).toBeDisabled();
  await expectPreviewOf(page, 'Піраміда · 80 × 80 × 20 мм');
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.size, [80, 80, 20], 1e-3);
  expect(Math.abs(measurements.volume / ((80 ** 2 * 20) / 3) - 1)).toBeLessThan(1e-6);
  await height.fill('4');
  await expect(stepButton(page, 'Висота піраміди h', 'збільшити')).toBeDisabled();
  await expectPreviewOf(page, 'Піраміда · 20 × 20 × 80 мм');

  // A typed value between the steps stays as typed.
  await height.fill('2,05');
  await expect(heightSlider).toHaveAttribute('aria-valuetext', '2,05');
  await expect(height).toHaveValue('2,05');

  // Beyond the ends: explained, the last model stays without its download, and the controls keep their range.
  for (const text of ['0,2', '4,5']) {
    await height.fill(text);
    await expect(page.getByText('Допустимі значення — від 0,25 до 4.')).toBeVisible();
    await expect(height).toHaveValue(text);
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(downloadButton(page)).toBeDisabled();
    await expect(heightSlider).toHaveAttribute('min', '0.25');
    await expect(heightSlider).toHaveAttribute('max', '4');
    await expect(stepButton(page, 'Висота піраміди h', 'збільшити')).toBeDisabled();
  }

  // The print size scales the same proportions; the reset restores the figure, not the print size.
  await height.fill('0,5');
  await printSize(page).fill('120');
  await expectPreviewOf(page, 'Піраміда · 120 × 120 × 60 мм');
  await resetShape(page).click();
  await expect(height).toHaveValue('1');
  await expect(printSize(page)).toHaveValue('120');
  await expectPreviewOf(page, 'Піраміда · 120 × 120 × 120 мм');

  expect(errors).toEqual([]);
});

test('cylinder: h/r = 4,8 off the slider steps is kept and exported; beyond 8 is refused', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openAllSections(page);
  const height = entry(page, 'Висота h');
  const heightSlider = slider(page, 'Висота h');
  await expect(heightSlider).toHaveAttribute('min', '0.5');
  await expect(heightSlider).toHaveAttribute('max', '8');

  // h = 4,8r = 80 mm: r = 16,67 mm.
  await height.fill('4,8');
  const r = 80 / 4.8;
  await expectPreviewOf(page, 'Циліндр · 33,3 × 33,3 × 80 мм');
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.size, [2 * r, 2 * r, 80], 1e-3);
  expect(Math.abs(measurements.volume / (polygonArea(r) * 80) - 1)).toBeLessThan(1e-6);

  for (const text of ['8,5', '0,25']) {
    await height.fill(text);
    await expect(page.getByText('Допустимі значення — від 0,5 до 8.')).toBeVisible();
    await expect(downloadButton(page)).toBeDisabled();
    await expect(heightSlider).toHaveAttribute('max', '8');
  }
});
