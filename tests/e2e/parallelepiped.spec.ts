import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  expectViewerBox,
  hasNoHorizontalOverflow,
  openAllSections,
  openSection,
  previewPlace,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type Field = 'Сторона AD' | 'Висота AA₁' | 'Висота' | 'Кут BAD';

const NAME = 'Паралелепіпед';
const entry = (page: Page, field: Field) => page.getByLabel(field, { exact: true });
const slider = (page: Page, field: Field) => page.getByRole('slider', { name: `${field}: повзунок`, exact: true });
const stepButton = (page: Page, field: Field, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${field}: ${action}`, exact: true });

/** Edges, bounding box, base area, volume and surface area for b = b0·a, h = h0·a and the angle α between a and b. */
function geometry(b0: number, h0: number, angleDeg: number) {
  const radians = (angleDeg * Math.PI) / 180;
  const width0 = 1 + Math.abs(b0 * Math.cos(radians));
  const depth0 = b0 * Math.sin(radians);
  const a = 80 / Math.max(width0, depth0, h0);
  const [b, h] = [b0 * a, h0 * a];
  const baseArea = a * b * Math.sin(radians);
  return {
    a,
    b,
    h,
    baseArea,
    size: [width0 * a, depth0 * a, h] as const,
    volume: baseArea * h,
    surfaceArea: 2 * baseArea + 2 * (a + b) * h,
  };
}

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const summary = (b0: number, h0: number, angleDeg: number) =>
  `${NAME} · ${geometry(b0, h0, angleDeg)
    .size.map((value) => numberFormat.format(value))
    .join(' × ')} мм`;

async function setFields(page: Page, b: string, h: string, angle: string): Promise<void> {
  await entry(page, 'Сторона AD').fill(b);
  await entry(page, 'Висота AA₁').fill(h);
  await entry(page, 'Кут BAD').fill(angle);
}

async function expectDownloadedParallelepiped(page: Page, b0: number, h0: number, angleDeg: number): Promise<void> {
  const expected = geometry(b0, h0, angleDeg);
  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe('parallelepiped.3mf');
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Centred in XY: the parallelogram is symmetric about its centre.
  expect(Math.abs(measurements.bounds.min[0] + measurements.bounds.max[0])).toBeLessThan(1e-3);
  expect(Math.abs(measurements.bounds.min[1] + measurements.bounds.max[1])).toBeLessThan(1e-3);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(measurements.surfaceArea / expected.surfaceArea - 1)).toBeLessThan(1e-6);
}

test('parallelepiped: side ratio, height and angle drive the preview, its dimensions and the downloaded 3MF', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });
  await openAllSections(page);

  // Defaults: a rhombus with α = 60° and h = a. The base is 1,5a wide, so a = b = h = 80 / 1,5 ≈ 53,3 mm.
  await expect(entry(page, 'Сторона AD')).toHaveValue('1');
  await expect(entry(page, 'Висота AA₁')).toHaveValue('1');
  await expect(entry(page, 'Кут BAD')).toHaveValue('60');
  // Groups: the base and the height open, the optional tilt collapsed; the base explains itself on demand.
  await expect(page.locator('summary')).toHaveText([/^Основа/, /^Висота/, /^Нахил/, /^Переріз/]);
  await page.getByRole('button', { name: 'Як задано паралелограм?' }).click();
  await expect(page.getByText('Сторонами AB і AD та кутом BAD між ними')).toBeVisible();
  await expect(page.getByRole('term')).toHaveCount(0);
  await expectPreviewOf(page, summary(1, 1, 60));
  await expectDownloadedParallelepiped(page, 1, 1, 60);

  // b = 2a and α = 120°: the base is 1 + 2·0,5 = 2 edges wide, so a = 40 mm, b = 80 mm and h = 0,5a = 20 mm.
  await setFields(page, '2', '0,5', '120');
  await expectPreviewOf(page, summary(2, 0.5, 120));
  await expectDownloadedParallelepiped(page, 2, 0.5, 120);

  expect(errors).toEqual([]);
});

test('parallelepiped: the controls keep typed values between steps and step to the next boundary', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });
  await openAllSections(page);
  await expectPreviewOf(page, summary(1, 1, 60));

  // The angle moves in 5° steps: 62° steps down to 60° and up to 65°, and a typed 62° is kept as typed.
  const angle = entry(page, 'Кут BAD');
  await angle.fill('62');
  await angle.blur();
  await expect(angle).toHaveValue('62');
  await expect(slider(page, 'Кут BAD')).toHaveValue('62');
  await expectPreviewOf(page, summary(1, 1, 62));
  await stepButton(page, 'Кут BAD', 'зменшити').click();
  await expect(angle).toHaveValue('60');
  await angle.fill('62');
  await stepButton(page, 'Кут BAD', 'збільшити').click();
  await expect(angle).toHaveValue('65');
  await angle.press('ArrowUp');
  await expect(angle).toHaveValue('70');
  await slider(page, 'Кут BAD').press('ArrowLeft');
  await expect(angle).toHaveValue('65');
  await angle.fill('72.5');
  await angle.blur();
  await expect(angle).toHaveValue('72.5');
  await expect(slider(page, 'Кут BAD')).toHaveAttribute('aria-valuetext', '72,5');

  // The limits 15° and 165° are reachable and stop stepping.
  await slider(page, 'Кут BAD').press('Home');
  await expect(angle).toHaveValue('15');
  await expect(stepButton(page, 'Кут BAD', 'зменшити')).toBeDisabled();
  await expectPreviewOf(page, summary(1, 1, 15));
  await slider(page, 'Кут BAD').press('End');
  await expect(angle).toHaveValue('165');
  await expect(stepButton(page, 'Кут BAD', 'збільшити')).toBeDisabled();
  await expectPreviewOf(page, summary(1, 1, 165));

  // Both ratios use the 0,25 grid with the decimal comma or point.
  const side = entry(page, 'Сторона AD');
  await side.fill('2.05');
  await stepButton(page, 'Сторона AD', 'зменшити').click();
  await expect(side).toHaveValue('2');
  await stepButton(page, 'Висота AA₁', 'збільшити').click();
  await expect(entry(page, 'Висота AA₁')).toHaveValue('1,25');
  await slider(page, 'Висота AA₁').press('ArrowRight');
  await expect(entry(page, 'Висота AA₁')).toHaveValue('1,5');
  await angle.fill('62');

  // The download carries the latest values.
  await expectPreviewOf(page, summary(2, 1.5, 62));
  await expectDownloadedParallelepiped(page, 2, 1.5, 62);

  expect(errors).toEqual([]);
});

test('parallelepiped: an invalid angle is explained and blocks the download until corrected', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });
  await openAllSections(page);
  await expectPreviewOf(page, summary(1, 1, 60));

  for (const [text, message] of [
    ['', 'Введіть значення.'],
    ['60°', 'Введіть число, наприклад 60.'],
    ['170', 'Допустимі значення — від 15° до 165°.'],
    ['14,9', 'Допустимі значення — від 15° до 165°.'],
  ] as const) {
    await entry(page, 'Кут BAD').fill(text);
    await expect(entry(page, 'Кут BAD')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(message)).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(downloadButton(page)).toBeDisabled();
    await expect(slider(page, 'Кут BAD')).toBeDisabled();
    // The other fields stay editable and valid.
    await expect(entry(page, 'Висота AA₁')).not.toHaveAttribute('aria-invalid', 'true');
  }

  await entry(page, 'Кут BAD').fill('45');
  await expectPreviewOf(page, summary(1, 1, 45));
  expect(errors).toEqual([]);
});

test('parallelepiped: α = 90° gives the same box as the rectangular cuboid', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await openAllSections(page);
  await expectPreviewOf(page, 'Прямокутний паралелепіпед · 40 × 60 × 80 мм');
  const cuboid = await downloadThreeMf(page);

  await shapeSelect(page).selectOption({ label: NAME });
  await openAllSections(page);
  await setFields(page, '1,5', '2', '90');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);
  await expectViewerBox(page, [40, 60, 80]);
  const parallelepiped = await downloadThreeMf(page);
  expect(parallelepiped.fileName).toBe('parallelepiped.3mf');
  expectSizesClose(parallelepiped.measurements.bounds.min, cuboid.measurements.bounds.min, 1e-3);
  expectSizesClose(parallelepiped.measurements.bounds.max, cuboid.measurements.bounds.max, 1e-3);
  expect(Math.abs(parallelepiped.measurements.volume / cuboid.measurements.volume - 1)).toBeLessThan(1e-6);
});

test('parallelepiped: switching shapes keeps its values apart and never offers outdated geometry', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAME });
  await openAllSections(page);
  await setFields(page, '1,75', '0,75', '50');
  await expectPreviewOf(page, summary(1.75, 0.75, 50));

  // Edit the angle and read the download button in the same task, before any rebuild can run.
  const disabledRightAfterEdit = await entry(page, 'Кут BAD').evaluate(async (input: HTMLInputElement) => {
    input.value = '130';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterEdit).toBe(true);
  await expectPreviewOf(page, summary(1.75, 0.75, 130));

  // The cuboid and prism keep their own ratios; the same label "Висота h" belongs to each shape separately.
  await shapeSelect(page).selectOption('cuboid');
  await openAllSections(page);
  await expect(page.getByLabel('Ширина AD', { exact: true })).toHaveValue('1,5');
  await expectPreviewOf(page, 'Прямокутний паралелепіпед · 40 × 60 × 80 мм');
  await shapeSelect(page).selectOption('prism');
  await openAllSections(page);
  await expect(entry(page, 'Висота AA₁')).toHaveValue('2');
  await expect(entry(page, 'Кут BAD')).toHaveCount(0);
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');

  // Rapid switches end on the parallelepiped with its last values.
  for (const kind of ['cube', 'parallelepiped', 'ball', 'cuboid', 'parallelepiped']) await shapeSelect(page).selectOption(kind);
  await expect(entry(page, 'Сторона AD')).toHaveValue('1,75');
  await expect(entry(page, 'Висота AA₁')).toHaveValue('0,75');
  await expect(entry(page, 'Кут BAD')).toHaveValue('130');
  await expectPreviewOf(page, summary(1.75, 0.75, 130));
  await expectDownloadedParallelepiped(page, 1.75, 0.75, 130);
});

for (const [layout, width, height] of [
  ['desktop', 1440, 900],
  // Tall enough to keep the 3D viewer, which loads models only while visible, on screen above the controls.
  ['narrow phone', 320, 2400],
] as const) {
  test(`parallelepiped: the preview keeps its place without horizontal overflow (${layout}, ${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: NAME });
    await openAllSections(page);
    await openSection(page, 'Нахил');
    await expectPreviewOf(page, summary(1, 1, 60));
    const reference = await previewPlace(page);
    for (const [b, h, angle] of [
      [4, 0.25, 15],
      [0.25, 4, 165],
      // b ≈ 1,22·L: the longest side, beyond the 80 mm bounding box.
      [4, 0.25, 55],
      [2.05, 1.1, 62],
    ] as const) {
      await setFields(page, String(b).replace('.', ','), String(h).replace('.', ','), String(angle));
      await expectPreviewOf(page, summary(b, h, angle));
      expect(await previewPlace(page)).toEqual(reference);
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    }
  });
}
