import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, type MeshMeasurements, measureMesh } from '../../packages/engine/src/mesh.ts';
import {
  collectErrors,
  dimensionsLine,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  type ModelViewerElement,
  modelViewer,
  openAllSections,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const sectionType = (page: Page) => page.getByLabel('Тип перерізу', { exact: true });
const position = (page: Page) => page.getByLabel('Від нижньої основи', { exact: true });
const positionSlider = (page: Page) => page.getByRole('slider', { name: 'Від нижньої основи: повзунок', exact: true });
const separation = (page: Page) => page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
const resetShape = (page: Page) => page.getByRole('button', { name: 'Скинути параметри фігури', exact: true });

/** Waits until the parts of the section are generated and shown, with the assembled size under the preview. */
async function expectPartsPreview(page: Page, size: string): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the parts and checks that they are two separate closed objects in millimetres, each with a build item. */
async function downloadParts(page: Page): Promise<{ fileName: string; bytes: Uint8Array; parts: MeshMeasurements[] }> {
  const [download] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await download.path()));
  const { model } = readThreeMf(bytes);
  expect(model.unit).toBe('millimeter');
  expect(model.objects.map(({ id, name }) => ({ id, name }))).toEqual([
    { id: '1', name: 'cylinder-lower-part' },
    { id: '2', name: 'cylinder-upper-part' },
  ]);
  expect(model.buildItems).toEqual([{ objectId: '1' }, { objectId: '2' }]);
  const parts = model.objects.map(({ mesh }) => {
    expect(findMeshDefects(mesh)).toEqual([]);
    return measureMesh(mesh);
  });
  return { fileName: download.suggestedFilename(), bytes, parts };
}

/** Both parts on the build plate, side by side along X, 5 mm apart, of the given sizes. */
function expectLayout(parts: readonly MeshMeasurements[], sizes: readonly (readonly number[])[]): void {
  const [lower, upper] = parts;
  if (lower === undefined || upper === undefined) throw new Error('Expected two parts');
  parts.forEach((part, index) => {
    expect(part.bounds.min[2]).toBe(0);
    expectSizesClose(part.size, sizes[index] as number[], 1e-3);
  });
  expect(Math.abs(upper.bounds.min[0] - lower.bounds.max[0] - 5)).toBeLessThan(1e-3);
}

/** The height of the shown model in millimetres, glTF Y. */
const viewerHeightMm = async (page: Page) =>
  1000 * (await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions().y));

test('cylinder: a section parallel to the bases is previewed in two parts and exported as two objects', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await expectPreviewOf(page, 'Циліндр · 80 × 80 × 80 мм');

  // Collapsed, with "немає" in its summary.
  const group = parameterSection(page, 'Переріз');
  await expect(group).not.toHaveAttribute('open', '');
  await expect(group.locator('summary')).toContainText('немає');
  await openSection(page, 'Переріз');
  await expect(position(page)).toHaveCount(0);
  await sectionType(page).selectOption({ label: 'Паралельно основам' });
  await openAllSections(page);
  await expect(group.locator('summary')).toContainText('паралельно основам');
  await expect(position(page)).toHaveValue('50');
  await expect(positionSlider(page)).toHaveAttribute('min', '10');
  await expect(positionSlider(page)).toHaveAttribute('max', '90');
  await expect(positionSlider(page)).toHaveAttribute('step', 'any');
  await expect(separation(page)).toBeChecked();
  await expect(downloadButton(page)).toHaveCount(0);
  // The assembled cylinder keeps its size: h/r = 2, so r = 40 mm and h = 80 mm.
  await expectPartsPreview(page, '80 × 80 × 80 мм');

  // The separation moves the upper part by 0,15 × 80 = 12 mm in the preview only.
  const apart = await viewerHeightMm(page);
  const { bytes: apartBytes, parts, fileName } = await downloadParts(page);
  expect(fileName).toBe('cylinder-parallel-section.3mf');
  expectLayout(parts, [
    [80, 80, 40],
    [80, 80, 40],
  ]);
  await separation(page).uncheck();
  await expectPartsPreview(page, '80 × 80 × 80 мм');
  expect(Math.abs(apart - (await viewerHeightMm(page)) - 12)).toBeLessThan(0.05);
  expect((await downloadParts(page)).bytes).toEqual(apartBytes);
  await separation(page).check();
  await expectPartsPreview(page, '80 × 80 × 80 мм');

  // A typed value between the steps is kept: 12,5 % of 80 mm is 10 mm.
  await position(page).fill('12,5');
  await expect(positionSlider(page)).toHaveAttribute('aria-valuetext', '12,5');
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  expectLayout((await downloadParts(page)).parts, [
    [80, 80, 10],
    [80, 80, 70],
  ]);
  await positionSlider(page).press('ArrowUp');
  await expect(position(page)).toHaveValue('15');

  // Outside 10–90 %: explained, nothing is clamped, the last parts stay visible but cannot be downloaded.
  for (const text of ['9', '90,5']) {
    await position(page).fill(text);
    await expect(page.getByText('Допустимі значення — від 10 % до 90 %.')).toBeVisible();
    await expect(position(page)).toHaveValue(text);
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(partsButton(page)).toBeDisabled();
  }

  // The print size describes the assembled cylinder; both parts follow it.
  await position(page).fill('50');
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('120');
  await expectPartsPreview(page, '120 × 120 × 120 мм');
  expectLayout((await downloadParts(page)).parts, [
    [120, 120, 60],
    [120, 120, 60],
  ]);

  // The reset removes the section and restores its defaults; the print size stays.
  await separation(page).uncheck();
  await resetShape(page).click();
  await expect(sectionType(page)).toHaveValue('none');
  await expect(position(page)).toHaveCount(0);
  await expectPreviewOf(page, 'Циліндр · 120 × 120 × 120 мм');
  const whole = await downloadThreeMf(page);
  expect(whole.fileName).toBe('cylinder.3mf');
  expectSizesClose(whole.measurements.size, [120, 120, 120], 1e-3);
  await sectionType(page).selectOption({ label: 'Паралельно основам' });
  await openAllSections(page);
  await expect(position(page)).toHaveValue('50');
  await expect(separation(page)).toBeChecked();

  expect(errors).toEqual([]);
});

test('oblique cylinder: the section stays parallel to the bases and moves with the axis', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openAllSections(page);
  await openSection(page, 'Нахил');
  await page.getByLabel('Зміщення верхньої основи', { exact: true }).fill('1');
  // The box is (2 + 1)r × 2r × 2r: r = 80/3 mm, d = r, h = 2r.
  const r = 80 / 3;
  await expectPreviewOf(page, 'Циліндр · 80 × 53,3 × 53,3 мм');
  await openSection(page, 'Переріз');
  await sectionType(page).selectOption({ label: 'Паралельно основам' });
  await openAllSections(page);

  // At t the cut circle is centred t·d from the lower base's centre: the lower part spans 2r + t·d along X, the upper
  // part 2r + (1 − t)·d.
  for (const [key, t] of [
    ['Home', 0.1],
    ['End', 0.9],
  ] as const) {
    await positionSlider(page).press(key);
    await expect(position(page)).toHaveValue(String(t * 100));
    await expectPartsPreview(page, '80 × 53,3 × 53,3 мм');
    expectLayout((await downloadParts(page)).parts, [
      [2 * r + t * r, 2 * r, 2 * r * t],
      [2 * r + (1 - t) * r, 2 * r, 2 * r * (1 - t)],
    ]);
  }
});
