import { expect, type Page, test } from '@playwright/test';
import { MAX_CIRCLE_DEVIATION_MM } from '../../packages/engine/src/shapes/round.ts';
import {
  collectErrors,
  dimensionsLine,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  type ModelViewerElement,
  modelViewer,
  openSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const STORAGE_KEY = 'diploma-3d.print-size-mm';
const sizeField = (page: Page) => page.getByLabel('Найбільший габарит', { exact: true });
const resetButton = (page: Page) => page.getByRole('button', { name: 'Скинути параметри фігури', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const storedSize = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);

/** The default triangular prism, a = 40 mm and h = 2a, scaled so that its height is the requested size. */
const defaultPrism = (size: number) => [size / 2, (size / 2) * (Math.sqrt(3) / 2), size] as const;
const sizeFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const formatSize = (size: readonly number[]) => `${size.map((value) => sizeFormat.format(value)).join(' × ')} мм`;

test('print size: a 120 mm cube is shown and exported at 120 mm, and the size is kept across shapes and visits', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(sizeField(page)).toHaveValue('80');
  await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');

  await sizeField(page).fill('120');
  await expectPreviewOf(page, 'Куб · 120 × 120 × 120 мм');
  const cube = await downloadThreeMf(page);
  expect(cube.fileName).toBe('cube.3mf');
  expectSizesClose(cube.measurements.size, [120, 120, 120], 1e-4);
  expect(cube.measurements.volume).toBeCloseTo(120 ** 3, 1);
  expect(await storedSize(page)).toBe('120');

  // Another shape keeps the shared size and only its proportions: 40 × 60 × 80 becomes 60 × 90 × 120 mm.
  await shapeSelect(page).selectOption({ label: 'Прямокутний паралелепіпед' });
  await expect(sizeField(page)).toHaveValue('120');
  await expectPreviewOf(page, 'Прямокутний паралелепіпед · 60 × 90 × 120 мм');
  expectSizesClose((await downloadThreeMf(page)).measurements.size, [60, 90, 120], 1e-4);

  // A new visit starts with the remembered size.
  await page.reload();
  await expect(sizeField(page)).toHaveValue('120');
  await expectPreviewOf(page, 'Куб · 120 × 120 × 120 мм');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await expectPreviewOf(page, 'Конус · 120 × 120 × 120 мм');

  expect(errors).toEqual([]);
});

test('print size: incomplete or invalid input blocks the model and is never remembered', async ({ page }) => {
  await page.goto('/');
  await sizeField(page).fill('150');
  await expectPreviewOf(page, 'Куб · 150 × 150 × 150 мм');

  for (const [text, message] of [
    ['', 'Введіть значення.'],
    ['-', 'Введіть число, наприклад 80.'],
    ['0,5', 'Допустимі значення — від 1 мм до 1000 мм.'],
    ['1500', 'Допустимі значення — від 1 мм до 1000 мм.'],
  ] as const) {
    await sizeField(page).fill(text);
    await expect(sizeField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(message)).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(dimensionsLine(page)).toHaveText('Габарити: — мм');
    await expect(downloadButton(page)).toBeDisabled();
    expect(await storedSize(page)).toBe('150');
  }

  // The preview names the field and leads back to it.
  await previewViewport(page).getByRole('button', { name: 'Найбільший габарит', exact: true }).click();
  await expect(sizeField(page)).toBeFocused();

  // Reloading with the invalid draft returns to the last valid size; an invalid stored value falls back to 80 mm.
  await page.reload();
  await expect(sizeField(page)).toHaveValue('150');
  await page.evaluate((key) => window.localStorage.setItem(key, 'abc'), STORAGE_KEY);
  await page.reload();
  await expect(sizeField(page)).toHaveValue('80');
  await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
});

test('print size: an oblique prism keeps its proportions and its longest dimension is the requested size', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await page.getByLabel('Багатокутник', { exact: true }).selectOption({ label: 'Квадрат' });
  await entry(page, 'Висота h').fill('1');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('1');
  await entry(page, 'Зміщення Y').fill('0,5');
  // The box is 2a × 1,5a × a: 80 × 60 × 40 mm at 80 mm.
  await expectPreviewOf(page, 'Призма · 80 × 60 × 40 мм');
  const at80 = await downloadThreeMf(page);

  await sizeField(page).fill('150');
  await expectPreviewOf(page, 'Призма · 150 × 112,5 × 75 мм');
  const at150 = await downloadThreeMf(page);
  expect(Math.max(...at150.measurements.size)).toBeCloseTo(150, 4);
  at150.measurements.size.forEach((value, axis) => {
    expect(value / (at80.measurements.size[axis] as number)).toBeCloseTo(150 / 80, 6);
  });
  expect(at150.measurements.volume / at80.measurements.volume).toBeCloseTo((150 / 80) ** 3, 5);
});

test('print size: a 300 mm cylinder is subdivided finely enough to stay within the approximation tolerance', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await sizeField(page).fill('300');
  // h = 2r: r = 150 mm.
  await expectPreviewOf(page, 'Циліндр · 300 × 300 × 300 мм');
  const { mesh, measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.size, [300, 300, 300], 1e-3);

  // The base polygon: its vertices lie on the circle of r = 150 mm, and the distance from the circle to the polygon,
  // r·(1 − cos(π/N)), stays within the tolerance; 64 segments, enough at 80 mm, would deviate by 0,18 mm here.
  const base: [number, number][] = [];
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
    const [x, y, z] = [mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]];
    if (z === 0) base.push([x as number, y as number]);
  }
  const r = 150;
  for (const [x, y] of base) expect(Math.abs(Math.hypot(x, y) - r)).toBeLessThan(1e-3);
  expect(base.length).toBeGreaterThan(64);
  expect(r * (1 - Math.cos(Math.PI / base.length))).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
});

test('reset: a changed prism at 120 mm returns to a default prism at 120 mm, keeping the size, the view and other shapes', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await sizeField(page).fill('120');

  // A fresh default prism at 120 mm, for comparison. Changing the size alone leaves nothing of the prism to reset.
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expectPreviewOf(page, `Призма · ${formatSize(defaultPrism(120))}`);
  await expect(resetButton(page)).toBeDisabled();
  // No permanent explanation: the heading names the scope and the button its action.
  await expect(page.getByRole('heading', { name: 'Параметри фігури' })).toBeVisible();
  await expect(resetButton(page)).toHaveText('Скинути');
  const fresh = await downloadThreeMf(page);

  // Another shape's own value, which the prism's reset must keep.
  await shapeSelect(page).selectOption({ label: 'Прямокутний паралелепіпед' });
  await entry(page, 'Ширина b').fill('3');
  await shapeSelect(page).selectOption({ label: 'Призма' });

  // Edit the triangle variant, then the trapezoid, the height and the inclination.
  await entry(page, 'Тип основи').selectOption({ label: 'Трикутник' });
  await expect(resetButton(page)).toBeEnabled();
  await entry(page, 'Сторона основи b').fill('2');
  await entry(page, 'Кут α').fill('97,5');
  await entry(page, 'Тип основи').selectOption({ label: 'Трапеція' });
  await entry(page, 'Паралельна сторона b').fill('1,5');
  await entry(page, 'Висота трапеції t').fill('0,8');
  await entry(page, 'Висота призми h').fill('1,25');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('0,5');
  await entry(page, 'Зміщення Y').fill('-1');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });

  // Turn the view; the reset keeps the direction.
  const viewer = modelViewer(page);
  const orbit = () => viewer.evaluate((element) => (element as unknown as ModelViewerElement).getCameraOrbit());
  const box = await previewViewport(page).boundingBox();
  if (box === null) throw new Error('No preview.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const turned = await orbit();

  await resetButton(page).click();
  await expect(shapeSelect(page).locator('option:checked')).toHaveText('Призма');
  await expect(entry(page, 'Тип основи').locator('option:checked')).toHaveText('Правильний багатокутник');
  await expect(page.getByLabel('Багатокутник', { exact: true }).locator('option:checked')).toHaveText('Рівносторонній трикутник');
  await expect(entry(page, 'Висота h')).toHaveValue('2');
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('0');
  // The shared size is not part of the figure.
  await expect(sizeField(page)).toHaveValue('120');
  expect(await storedSize(page)).toBe('120');
  await expectPreviewOf(page, `Призма · ${formatSize(defaultPrism(120))}`);
  await expect(resetButton(page)).toBeDisabled();
  const reset = await downloadThreeMf(page);
  expect(reset.fileName).toBe(fresh.fileName);
  expect(reset.mesh).toEqual(fresh.mesh);
  await expect.poll(async () => (await orbit()).theta).toBeCloseTo(turned.theta, 3);

  // The inactive base variants were reset too: their old edits do not reappear.
  await entry(page, 'Тип основи').selectOption({ label: 'Трикутник' });
  await expect(entry(page, 'Сторона основи b')).toHaveValue('1');
  await expect(entry(page, 'Кут α')).toHaveValue('60');
  await entry(page, 'Тип основи').selectOption({ label: 'Трапеція' });
  await expect(entry(page, 'Паралельна сторона b')).toHaveValue('0,5');
  await expect(entry(page, 'Висота трапеції t')).toHaveValue('0,5');

  // The cuboid kept its own value, and the size stays across shapes and a new visit.
  await shapeSelect(page).selectOption({ label: 'Прямокутний паралелепіпед' });
  await expect(entry(page, 'Ширина b')).toHaveValue('3');
  await expect(sizeField(page)).toHaveValue('120');
  await page.reload();
  await expect(sizeField(page)).toHaveValue('120');
  await expectPreviewOf(page, 'Куб · 120 × 120 × 120 мм');

  expect(errors).toEqual([]);
});

test('reset: one click recovers from an invalid draft in a prism field and leaves the size as it is', async ({ page }) => {
  await page.goto('/');
  await sizeField(page).fill('120');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expectPreviewOf(page, `Призма · ${formatSize(defaultPrism(120))}`);

  await entry(page, 'Висота h').fill('');
  await expect(page.getByText('Введіть значення.')).toBeVisible();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(downloadButton(page)).toBeDisabled();

  await expect(resetButton(page)).toBeEnabled();
  await resetButton(page).click();
  await expect(entry(page, 'Висота h')).toHaveValue('2');
  await expect(entry(page, 'Висота h')).not.toHaveAttribute('aria-invalid');
  await expect(page.getByText('Введіть значення.')).toHaveCount(0);
  await expect(sizeField(page)).toHaveValue('120');
  await expectPreviewOf(page, `Призма · ${formatSize(defaultPrism(120))}`);
  expectSizesClose((await downloadThreeMf(page)).measurements.size, defaultPrism(120), 1e-3);

  // A draft of the size is the size field's own: the figure's reset neither offers itself for it nor clears it.
  await sizeField(page).fill('-');
  await expect(resetButton(page)).toBeDisabled();
  await expect(sizeField(page)).toHaveAttribute('aria-invalid', 'true');
});

test('reset: solids without parameters of their own offer no reset, whatever the size', async ({ page }) => {
  await page.goto('/');
  for (const label of ['Додекаедр', 'Ікосаедр']) {
    await shapeSelect(page).selectOption({ label });
    await expect(sizeField(page)).toBeVisible();
    await expect(resetButton(page)).toHaveCount(0);
  }
  await sizeField(page).fill('40');
  await expect(sizeField(page)).toHaveValue('40');
  await expect(resetButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Скинути/ })).toHaveCount(0);
  // The cube and the tetrahedron have a section of their own to reset, but a new size alone is nothing to reset.
  await shapeSelect(page).selectOption({ label: 'Куб' });
  await expectPreviewOf(page, 'Куб · 40 × 40 × 40 мм');
  await expect(resetButton(page)).toBeDisabled();
  await shapeSelect(page).selectOption({ label: 'Правильний тетраедр' });
  await expect(resetButton(page)).toBeDisabled();
});

test('print size in the header: 90 mm survives a prism reset in the field and in the export', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');

  // The field sits in the header, right before the download, and not in the shape's sidebar; "мм" is beside it.
  const header = page.getByRole('banner');
  await expect(header.getByLabel('Найбільший габарит', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Налаштування моделі' }).getByRole('textbox')).toHaveCount(0);
  const order = await header.evaluate((element) =>
    [...element.querySelectorAll('input, button')].map((control) => control.id || control.textContent?.trim()),
  );
  expect(order.slice(-2)).toEqual(['printSizeMm', 'Завантажити 3MF']);
  await expect(header.getByText('мм', { exact: true })).toBeVisible();

  // A validation message appears next to the field and leaves the workspace where it is.
  const workspace = await previewViewport(page).boundingBox();
  await sizeField(page).fill('5000');
  await expect(header.getByText('Допустимі значення — від 1 мм до 1000 мм.')).toBeVisible();
  expect(await previewViewport(page).boundingBox()).toEqual(workspace);

  await sizeField(page).fill('90');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expectPreviewOf(page, `Призма · ${formatSize(defaultPrism(90))}`);
  await entry(page, 'Тип основи').selectOption({ label: 'Трапеція' });
  await entry(page, 'Висота призми h').fill('1');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('0,75');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });

  await resetButton(page).click();
  await expect(entry(page, 'Тип основи').locator('option:checked')).toHaveText('Правильний багатокутник');
  await expect(entry(page, 'Висота h')).toHaveValue('2');
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(sizeField(page)).toHaveValue('90');
  await expectPreviewOf(page, `Призма · ${formatSize(defaultPrism(90))}`);
  const { measurements } = await downloadThreeMf(page);
  expect(Math.max(...measurements.size)).toBeCloseTo(90, 4);
  expectSizesClose(measurements.size, defaultPrism(90), 1e-3);

  expect(errors).toEqual([]);
});
