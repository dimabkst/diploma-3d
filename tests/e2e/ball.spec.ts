import { expect, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  measurementValue,
  shapeSelect,
} from './helpers.ts';

const BALL = 'Куля';
const BALL_SUMMARY = `${BALL} · 80 × 80 × 80 мм`;

test('ball: a fixed 80 mm ball with ideal measurements and no parameter controls', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: BALL });

  await expect(page.getByText('усі точки поверхні рівновіддалені від центра')).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByLabel('Висота h', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Основа', { exact: true })).toHaveCount(0);
  await expectPreviewOf(page, BALL_SUMMARY);

  // r = 40 mm: 4πr² ≈ 20 106,2 mm² and 4πr³/3 ≈ 268 082,6 mm³.
  await expect(page.getByRole('term')).toHaveText(['Радіус r', 'Діаметр d', 'Площа поверхні', 'Об’єм']);
  await expect(measurementValue(page, 'Радіус r')).toHaveText('40 мм');
  await expect(measurementValue(page, 'Діаметр d')).toHaveText('80 мм');
  await expect(measurementValue(page, 'Площа поверхні')).toHaveText('20 106,2 мм²');
  await expect(measurementValue(page, 'Об’єм')).toHaveText('268 082,6 мм³');

  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe('ball.3mf');
  expectSizesClose(measurements.size, [80, 80, 80], 1e-3);
  expectSizesClose(measurements.bounds.min, [-40, -40, 0], 1e-3);
  // The inscribed polyhedron lies between the balls of radius 39,95 and 40 mm.
  expect(measurements.volume).toBeLessThan((4 / 3) * Math.PI * 40 ** 3);
  expect(measurements.volume).toBeGreaterThan((4 / 3) * Math.PI * 39.95 ** 3);

  expect(errors).toEqual([]);
});

test('ball: switching to and from parameterised shapes shows their own controls and downloads the current geometry', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');

  // A cone with h = r: 80 × 80 × 40 mm.
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await page.getByLabel('Висота h', { exact: true }).fill('1');
  await expectPreviewOf(page, 'Конус · 80 × 80 × 40 мм');

  // Switch and read the download button in the same task: the cone must not be offered for the ball.
  const disabledRightAfterSwitch = await shapeSelect(page).evaluate(async (select: HTMLSelectElement) => {
    select.value = 'ball';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterSwitch).toBe(true);
  await expectPreviewOf(page, BALL_SUMMARY);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByRole('term')).toHaveText(['Радіус r', 'Діаметр d', 'Площа поверхні', 'Об’єм']);
  expect((await downloadThreeMf(page)).fileName).toBe('ball.3mf');

  // Rapid switches end on a prism, whose own controls and file return.
  for (const label of ['Куб', BALL, 'Циліндр', BALL]) await shapeSelect(page).selectOption({ label });
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expect(page.getByLabel('Основа', { exact: true })).toBeVisible();
  // The height and the two offsets of the upper base.
  await expect(page.getByRole('slider')).toHaveCount(3);
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');
  await expect(downloadButton(page)).toBeEnabled();
  expect((await downloadThreeMf(page)).fileName).toBe('prism-3-sided.3mf');

  // Back to the ball, then to the cone, whose ratio was kept.
  await shapeSelect(page).selectOption({ label: BALL });
  await expectPreviewOf(page, BALL_SUMMARY);
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await expect(page.getByLabel('Висота h', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('term')).toHaveCount(7);
  await expectPreviewOf(page, 'Конус · 80 × 80 × 40 мм');
  expect((await downloadThreeMf(page)).fileName).toBe('cone.3mf');

  expect(errors).toEqual([]);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`ball: the sidebar fits without horizontal scrolling (${layout}, ${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 2000 });
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: BALL });
    await expectPreviewOf(page, BALL_SUMMARY);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const value of await page.getByRole('definition').all()) {
      expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  });
}
