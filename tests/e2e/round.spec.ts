import { expect, type Page, test } from '@playwright/test';
import {
  type Box,
  boxesOf,
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  measurementValue,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type Kind = 'cylinder' | 'cone';

const NAMES: Readonly<Record<Kind, string>> = { cylinder: 'Циліндр', cone: 'Конус' };
const heightRatio = (page: Page) => page.getByLabel('Висота h', { exact: true });
const heightSlider = (page: Page) => page.getByRole('slider', { name: 'Висота h: повзунок', exact: true });
const stepButton = (page: Page, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `Висота h: ${action}`, exact: true });

/** r = L / max(2, h/r) and h = (h/r)·r at L = 80 mm. */
function dimensions(ratio: number) {
  const r = 80 / Math.max(2, ratio);
  return { r, h: ratio * r };
}

const sizeFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const summary = (kind: Kind, ratio: number) => {
  const { r, h } = dimensions(ratio);
  return `${NAMES[kind]} · ${[2 * r, 2 * r, h].map((value) => sizeFormat.format(value)).join(' × ')} мм`;
};

/** The download is the inscribed 64-sided approximation of the latest r and h. */
async function expectDownloaded(page: Page, kind: Kind, ratio: number): Promise<void> {
  const { r, h } = dimensions(ratio);
  const polygonBase = (64 * r ** 2 * Math.sin((2 * Math.PI) / 64)) / 2;
  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe(`${kind}.3mf`);
  expectSizesClose(measurements.size, [2 * r, 2 * r, h], 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  const volume = kind === 'cylinder' ? polygonBase * h : (polygonBase * h) / 3;
  expect(Math.abs(measurements.volume / volume - 1)).toBeLessThan(1e-6);
}

test('cylinder: h/r drives the ideal measurements, the preview and the downloaded 3MF', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });

  // Default h = 2r: r = 40 mm and h = 80 mm.
  await expect(heightRatio(page)).toHaveValue('2');
  // Both the height and the displacement are given in multiples of r.
  await expect(page.getByText('× r', { exact: true })).toHaveCount(2);
  await expectPreviewOf(page, summary('cylinder', 2));
  await expect(page.getByRole('term')).toHaveText([
    'Радіус r',
    'Діаметр d',
    'Висота h',
    'Твірна l',
    'Площа основи',
    'Площа поверхні',
    'Об’єм',
  ]);
  // πr² = 5 026,5; 2πr² + 2πrh = 30 159,3; πr²h = 402 123,9.
  await expect(measurementValue(page, 'Радіус r')).toHaveText('40 мм');
  await expect(measurementValue(page, 'Діаметр d')).toHaveText('80 мм');
  await expect(measurementValue(page, 'Площа основи')).toHaveText('5 026,5 мм²');
  await expect(measurementValue(page, 'Площа поверхні')).toHaveText('30 159,3 мм²');
  await expect(measurementValue(page, 'Об’єм')).toHaveText('402 123,9 мм³');
  await expectDownloaded(page, 'cylinder', 2);

  // A precise typed value is kept; the buttons then move to the neighbouring quarters.
  await heightRatio(page).fill('2.05');
  await heightRatio(page).blur();
  await expect(heightRatio(page)).toHaveValue('2.05');
  await expect(heightSlider(page)).toHaveValue('2.05');
  await expectPreviewOf(page, summary('cylinder', 2.05));
  await expectDownloaded(page, 'cylinder', 2.05);
  await stepButton(page, 'зменшити').click();
  await expect(heightRatio(page)).toHaveValue('2');
  await stepButton(page, 'збільшити').click();
  await expect(heightRatio(page)).toHaveValue('2,25');
  await expectPreviewOf(page, summary('cylinder', 2.25));

  // The limits: h = 4r gives r = 20 mm; h = r gives a squat 80 × 80 × 40 mm cylinder.
  await heightSlider(page).press('End');
  await expect(heightRatio(page)).toHaveValue('4');
  await expect(stepButton(page, 'збільшити')).toBeDisabled();
  await expectPreviewOf(page, summary('cylinder', 4));
  await expect(measurementValue(page, 'Радіус r')).toHaveText('20 мм');
  await expectDownloaded(page, 'cylinder', 4);
  await heightRatio(page).fill('1');
  await expectPreviewOf(page, `${NAMES.cylinder} · 80 × 80 × 40 мм`);
  await expectDownloaded(page, 'cylinder', 1);

  expect(errors).toEqual([]);
});

test('cone: h/r drives the slant height, the preview and the downloaded 3MF', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cone });

  await expect(heightRatio(page)).toHaveValue('2');
  await expectPreviewOf(page, summary('cone', 2));
  await expect(page.getByRole('term')).toHaveText([
    'Радіус r',
    'Діаметр d',
    'Висота h',
    'Твірні',
    'Площа основи',
    'Площа поверхні',
    'Об’єм',
  ]);
  // l = √(80² + 40²) ≈ 89,4; πr² + πrl ≈ 16 266,3; πr²h / 3 ≈ 134 041,3.
  // A right cone: all generatrices are equal, √(80² + 40²) ≈ 89,4 mm.
  await expect(measurementValue(page, 'Твірні')).toHaveText('89,4 мм');
  await expect(measurementValue(page, 'Площа поверхні')).toHaveText('16 266,3 мм²');
  await expect(measurementValue(page, 'Об’єм')).toHaveText('134 041,3 мм³');
  await expectDownloaded(page, 'cone', 2);

  await heightRatio(page).fill('1,1');
  await expectPreviewOf(page, summary('cone', 1.1));
  await expect(measurementValue(page, 'Висота h')).toHaveText('44 мм');
  await expectDownloaded(page, 'cone', 1.1);

  await heightSlider(page).press('Home');
  await expect(heightRatio(page)).toHaveValue('0,25');
  await expect(stepButton(page, 'зменшити')).toBeDisabled();
  await expectPreviewOf(page, summary('cone', 0.25));
  await expectDownloaded(page, 'cone', 0.25);

  expect(errors).toEqual([]);
});

test('cylinder and cone: rapid changes never offer outdated geometry, and invalid ratios block the download', async ({
  page,
}) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });
  await expectPreviewOf(page, summary('cylinder', 2));

  const disabledRightAfterEdit = await heightRatio(page).evaluate(async (input: HTMLInputElement) => {
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterEdit).toBe(true);

  for (const [text, message] of [
    ['', 'Введіть значення.'],
    ['абв', 'Введіть число, наприклад 1,5.'],
    ['0,2', 'Допустимі значення — від 0,25 до 4.'],
  ] as const) {
    await heightRatio(page).fill(text);
    await expect(heightRatio(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(message)).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(downloadButton(page)).toBeDisabled();
    await expect(heightSlider(page)).toBeDisabled();
  }

  for (const value of ['1', '3,5', '0,75']) await heightRatio(page).fill(value);
  await shapeSelect(page).selectOption({ label: NAMES.cone });
  await heightRatio(page).fill('1,5');
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });
  await expect(heightRatio(page)).toHaveValue('0,75');
  await expectPreviewOf(page, summary('cylinder', 0.75));
  await expectDownloaded(page, 'cylinder', 0.75);

  await shapeSelect(page).selectOption({ label: NAMES.cone });
  await expect(heightRatio(page)).toHaveValue('1,5');
  await expectPreviewOf(page, summary('cone', 1.5));
  await expectDownloaded(page, 'cone', 1.5);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`cylinder and cone: measurements keep their positions while h/r changes (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough to keep the 3D viewer, which loads only when visible, on screen below the stacked controls.
    await page.setViewportSize({ width, height: 2600 });
    await page.goto('/');
    for (const kind of ['cylinder', 'cone'] as const) {
      await shapeSelect(page).selectOption({ label: NAMES[kind] });
      let reference: Box[] | undefined;
      for (const ratio of [2, 1, 1.1, 0.25, 4, 2.05]) {
        await heightRatio(page).fill(String(ratio).replace('.', ','));
        await expectPreviewOf(page, summary(kind, ratio));
        const current = await boxesOf(page.getByRole('definition'));
        reference ??= current;
        expect(current).toEqual(reference);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
  });
}
