import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  dimensionsLine,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  type ModelViewerElement,
  modelViewer,
  openAllSections,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const mode = (page: Page, label: 'Зміщення' | 'Кути' | 'Кут') => page.getByRole('radio', { name: label, exact: true });
const inclination = (page: Page) => entry(page, 'Кут до площини основи');
const direction = (page: Page) => entry(page, 'Напрям зміщення');
const resetShape = (page: Page) => page.getByRole('button', { name: 'Скинути параметри фігури', exact: true });
const printSize = (page: Page) => entry(page, 'Найбільший габарит');

/** Waits for the rebuilt model and returns what the preview shows and what the file contains. */
async function exported(page: Page) {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(downloadButton(page)).toBeEnabled();
  const dimensions = await dimensionsLine(page).textContent();
  const viewerBox = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  const file = await downloadThreeMf(page);
  return { dimensions, viewerBox, file };
}

/** The same preview, the same physical dimensions and the same vertices in the file. */
function expectSameModel(actual: Awaited<ReturnType<typeof exported>>, expected: Awaited<ReturnType<typeof exported>>) {
  expect(actual.dimensions).toBe(expected.dimensions);
  expect(actual.viewerBox).toEqual(expected.viewerBox);
  expect(actual.file.measurements.size).toEqual(expected.file.measurements.size);
  expect(actual.file.measurements.volume).toBe(expected.file.measurements.volume);
  expect(Array.from(actual.file.mesh.positions)).toEqual(Array.from(expected.file.mesh.positions));
}

test('prism: angles and the equivalent offsets give the same preview and 3MF at the same print size', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await printSize(page).fill('120');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await openSection(page, 'Нахил');
  await expect(mode(page, 'Зміщення')).toBeChecked();
  await entry(page, 'Висота h').fill('1');

  // A right prism shows 90°; the mode alone neither changes the model nor offers a reset.
  await mode(page, 'Кути').check();
  await expect(inclination(page)).toHaveValue('90');
  await expect(direction(page)).toHaveValue('0');
  await expect(resetShape(page)).toBeEnabled(); // The height was edited.
  await page.getByRole('button', { name: 'Як задано кути?' }).click();
  await expect(page.getByText(/бічним ребром, напрямленим від нижньої основи до верхньої/)).toBeVisible();

  // H = 1, β = 45°, φ = 90°: the upper base moves by (0, 1)·a.
  await inclination(page).fill('45');
  await direction(page).fill('90');
  await expect(parameterSection(page, 'Нахил').locator('summary')).toHaveText(/^Нахил\s*похила\s*$/);
  const fromAngles = await exported(page);

  await mode(page, 'Зміщення').check();
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('1');
  // Typed by hand, the same offsets give the same solid.
  await entry(page, 'Зміщення X').fill('0,0');
  await entry(page, 'Зміщення Y').fill('1,00');
  expectSameModel(await exported(page), fromAngles);

  // In the angle mode a new height keeps the angles: H = 2 moves the upper base to (0, 2).
  await mode(page, 'Кути').check();
  await expect(inclination(page)).toHaveValue('45');
  await expect(direction(page)).toHaveValue('90');
  await entry(page, 'Висота h').fill('2');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  await mode(page, 'Зміщення').check();
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('2');
  // In the offset mode a new height keeps the offsets, so the angle changes.
  await entry(page, 'Висота h').fill('1');
  await mode(page, 'Кути').check();
  await expect(inclination(page)).toHaveValue('26,5651');
  await expect(direction(page)).toHaveValue('90');
  await expect(printSize(page)).toHaveValue('120');

  expect(errors).toEqual([]);
});

test('pyramid and cone: angles give the same solid as the offsets they describe', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Піраміда' });
  await openAllSections(page);
  await openSection(page, 'Вершина');
  await entry(page, 'Висота піраміди h').fill('1');
  await mode(page, 'Кути').check();
  await page.getByRole('button', { name: 'Як задано кути?' }).click();
  await expect(page.getByText(/відрізком від центра мас основи до вершини/)).toBeVisible();
  // 45° towards −X from the centroid: the apex at (−1, 0)·a.
  await inclination(page).fill('45');
  await direction(page).fill('180');
  const pyramidAngles = await exported(page);
  await mode(page, 'Зміщення').check();
  await expect(entry(page, 'Зміщення X')).toHaveValue('-1');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('0');
  await entry(page, 'Зміщення X').fill('-1,0');
  expectSameModel(await exported(page), pyramidAngles);

  // h/r = 2 at 45°: d/r = 2 along +X; a circular base has no direction to enter.
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openAllSections(page);
  await openSection(page, 'Нахил');
  await mode(page, 'Кут').check();
  await expect(direction(page)).toHaveCount(0);
  await expect(inclination(page)).toHaveValue('90');
  await inclination(page).fill('45');
  const coneAngle = await exported(page);
  await mode(page, 'Зміщення').check();
  await expect(entry(page, 'Зміщення вершини')).toHaveValue('2');
  await entry(page, 'Зміщення вершини').fill('2,0');
  expectSameModel(await exported(page), coneAngle);
});

const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });

test('prism: β ≥ 15° in both modes, angles within the offset limits, and both checked after every change', async ({ page }) => {
  await page.goto('/');
  await printSize(page).fill('120');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await openSection(page, 'Нахил');
  await entry(page, 'Висота h').fill('1');

  // Offsets: at h = a the lean reaches 15° at a / tan 15° ≈ 3,732a, so the sliders end there, not at ±4.
  await expect(slider(page, 'Зміщення X')).toHaveAttribute('min', '-3.732');
  await expect(slider(page, 'Зміщення X')).toHaveAttribute('max', '3.732');
  await entry(page, 'Зміщення X').fill('3,8');
  const flatOffset = 'Кут нахилу має бути не менше 15°: за цієї висоти й другого зміщення допустимо від -3,732 до 3,732.';
  await expect(page.getByText(flatOffset)).toBeVisible();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(downloadButton(page)).toBeDisabled();
  await expect(mode(page, 'Кути')).toBeDisabled();

  // (2, 3)·a leans at atan(1/√13) ≈ 15,5°; the Y slider ends at √(3,732² − 2²) ≈ 3,15.
  await entry(page, 'Зміщення X').fill('2');
  await entry(page, 'Зміщення Y').fill('3');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(slider(page, 'Зміщення Y')).toHaveAttribute('max', '3.15');
  // A lower height keeps the offsets, which now lean too flat: both are at fault, the last model stays.
  await entry(page, 'Висота h').fill('0,5');
  await expect(entry(page, 'Зміщення X')).toHaveAttribute('aria-invalid', 'true');
  await expect(entry(page, 'Зміщення Y')).toHaveAttribute('aria-invalid', 'true');
  await expect(downloadButton(page)).toBeDisabled();
  await entry(page, 'Висота h').fill('1');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });

  // Angles: the same 15° floor.
  await mode(page, 'Кути').check();
  await expect(slider(page, 'Кут до площини основи')).toHaveAttribute('min', '15');
  await inclination(page).fill('14');
  await expect(page.getByText('Допустимі значення — від 15° до 90°.')).toBeVisible();
  await expect(downloadButton(page)).toBeDisabled();

  // h/a = 4 at 30° along +X would need X/a = 4√3 ≈ 6,93: the offset limit 4 requires β ≥ 45° there.
  await entry(page, 'Висота h').fill('4');
  await direction(page).fill('0');
  await inclination(page).fill('30');
  await expect(page.getByText('Допустимі значення за цієї висоти й напряму — від 45° до 90°.')).toBeVisible();
  await expect(slider(page, 'Кут до площини основи')).toHaveAttribute('min', '45');
  await expect(downloadButton(page)).toBeDisabled();
  // Along the diagonal the corner (4, 4) is reachable from atan2(4, 4√2) ≈ 35,26°.
  await direction(page).fill('45');
  await expect(page.getByText('Допустимі значення за цієї висоти й напряму — від 35,27° до 90°.')).toBeVisible();
  await inclination(page).fill('36');
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  await mode(page, 'Зміщення').check();
  const [x, y] = await Promise.all(
    ['Зміщення X', 'Зміщення Y'].map(async (label) => Number((await entry(page, label).inputValue()).replace(',', '.'))),
  );
  expect(x).toBe(y);
  expect(x).toBeGreaterThan(3.8);
  expect(x).toBeLessThanOrEqual(4);
  await expect(downloadButton(page)).toBeEnabled();

  // The reset returns the right prism with its default ranges; the print size stays.
  await resetShape(page).click();
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(slider(page, 'Зміщення X')).toHaveAttribute('max', '4');
  await expect(printSize(page)).toHaveValue('120');
});

test('switching modes never changes the model, does not drift, and the reset keeps the mode', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await openSection(page, 'Нахил');

  // The default prism: the mode alone does not offer a reset.
  await mode(page, 'Кути').check();
  await expect(inclination(page)).toHaveValue('90');
  await expect(resetShape(page)).toBeDisabled();
  // Without a displacement the direction changes nothing.
  await direction(page).fill('135');
  await expect(resetShape(page)).toBeDisabled();
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  await mode(page, 'Зміщення').check();
  await expect(resetShape(page)).toBeDisabled();

  await entry(page, 'Висота h').fill('1,37');
  await entry(page, 'Зміщення X').fill('-0,3137');
  await entry(page, 'Зміщення Y').fill('1,2345');
  const original = await exported(page);
  for (let round = 0; round < 3; round += 1) {
    await mode(page, 'Кути').check();
    // The same specification: nothing is rebuilt, the download stays available at once.
    await expect(downloadButton(page)).toBeEnabled({ timeout: 0 });
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded');
    await mode(page, 'Зміщення').check();
    await expect(downloadButton(page)).toBeEnabled({ timeout: 0 });
    await expect(entry(page, 'Зміщення X')).toHaveValue('-0,3137');
    await expect(entry(page, 'Зміщення Y')).toHaveValue('1,2345');
  }
  expectSameModel(await exported(page), original);

  // In the angle mode the reset restores the right prism and shows 90°, staying in that mode.
  await mode(page, 'Кути').check();
  await resetShape(page).click();
  await expect(mode(page, 'Кути')).toBeChecked();
  await expect(inclination(page)).toHaveValue('90');
  await expect(entry(page, 'Висота h')).toHaveValue('2');
  await expect(resetShape(page)).toBeDisabled();
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');
});
