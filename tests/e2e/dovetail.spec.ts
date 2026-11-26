import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, type MeshMeasurements, measureMesh } from '../../packages/engine/src/mesh.ts';
import {
  collectErrors,
  dimensionsLine,
  type ModelViewerElement,
  modelViewer,
  openAllSections,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });
const separation = (page: Page) => page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });

async function expectPartsPreview(page: Page, size: string): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

async function downloadParts(page: Page): Promise<{ bytes: Uint8Array; parts: MeshMeasurements[] }> {
  const [download] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await download.path()));
  const { model } = readThreeMf(bytes);
  expect(model.unit).toBe('millimeter');
  expect(model.objects.map(({ name }) => name)).toEqual(['cylinder-lower-part', 'cylinder-upper-part']);
  expect(model.buildItems).toEqual([{ objectId: '1' }, { objectId: '2' }]);
  const parts = model.objects.map(({ mesh }) => {
    expect(findMeshDefects(mesh)).toEqual([]);
    return measureMesh(mesh);
  });
  for (const part of parts) expect(part.bounds.min[2]).toBe(0);
  const [lower, upper] = parts as [MeshMeasurements, MeshMeasurements];
  expect(Math.abs(upper.bounds.min[0] - lower.bounds.max[0] - 5)).toBeLessThan(1e-3);
  return { bytes, parts };
}

/** The shown model's extent in millimetres along glTF X, Y (up) and Z. */
const viewerSize = async (page: Page) => {
  const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  return [x * 1000, y * 1000, z * 1000] as const;
};

async function chooseDovetail(page: Page): Promise<void> {
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await openAllSections(page);
  await expect(entry(page, 'Тип кріплення')).toHaveValue('none');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
}

test('cylinder: a sliding dovetail joins the parts, previews them slid apart and exports both connector faces up', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openAllSections(page);
  await chooseDovetail(page);

  // The settings in millimetres at M = 80 mm and r = 40 mm, with the ranges the cylinder allows for the other settings;
  // entry, slider and buttons share them.
  await expect(parameterSection(page, 'Кріплення')).toHaveAttribute('open', '');
  for (const [label, value, min, max] of [
    ['Висота виступу, мм', '2', '1.2', '13.035'],
    ['Довжина виступу, мм', '40', '1.7', '76.323'],
    ['Зазор між поверхнями, мм', '0,2', '0.1', '0.4'],
  ] as const) {
    await expect(entry(page, label)).toHaveValue(value);
    await expect(slider(page, label)).toHaveAttribute('min', min);
    await expect(slider(page, label)).toHaveAttribute('max', max);
  }
  await expect(page.getByText('Ширина виступу: біля основи 6 мм, угорі 10 мм.')).toBeVisible();
  // The assembled cylinder keeps its size: 80 × 80 × 80 mm, M = 80 mm.
  await expectPartsPreview(page, '80 × 80 × 80 мм');

  // Slid apart along the cut, not lifted: the shown height stays, the extent along the slide grows.
  const apart = await viewerSize(page);
  await separation(page).uncheck();
  await expectPartsPreview(page, '80 × 80 × 80 мм');
  const assembled = await viewerSize(page);
  expect(Math.abs(apart[1] - assembled[1])).toBeLessThan(0.05);
  expect(apart[2] - assembled[2]).toBeGreaterThan(40);

  // h = 2 mm: the lower part is 40 + 2 mm high with its tongue, the upper part 40 mm, flipped onto its upper base.
  const { bytes, parts } = await downloadParts(page);
  expect(parts[0]?.size[2]).toBeCloseTo(42, 3);
  expect(parts[1]?.size[2]).toBeCloseTo(40, 3);
  await separation(page).check();
  await expectPartsPreview(page, '80 × 80 × 80 мм');
  expect((await downloadParts(page)).bytes).toEqual(bytes);

  // A height between the steps is kept: 2,2 mm, with the widths linked to it.
  const height = entry(page, 'Висота виступу, мм');
  await height.fill('2,2');
  await expect(slider(page, 'Висота виступу, мм')).toHaveAttribute('aria-valuetext', '2,2');
  await expect(page.getByText('Ширина виступу: біля основи 6,6 мм, угорі 11 мм.')).toBeVisible();
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  expect((await downloadParts(page)).parts[0]?.size[2]).toBeCloseTo(42.2, 3);
  // What is typed stays as typed while the entry has focus, and is shown as the stored value afterwards.
  await height.fill('2,20');
  await expect(height).toHaveValue('2,20');
  await height.press('Tab');
  await expect(height).toHaveValue('2,2');
  // Beyond the former 3 mm limit: a 5 mm tongue builds, and a longer one narrows the height's range.
  await height.fill('5');
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  expect((await downloadParts(page)).parts[0]?.size[2]).toBeCloseTo(45, 3);
  await entry(page, 'Довжина виступу, мм').fill('70');
  await expect(slider(page, 'Висота виступу, мм')).toHaveAttribute('max', '6.289');
  await entry(page, 'Довжина виступу, мм').fill('40');
  await height.fill('2,2');

  // Outside the range: refused as typed.
  await entry(page, 'Зазор між поверхнями, мм').fill('0,45');
  await expect(page.getByText('Допустимі значення — від 0,1 мм до 0,4 мм.')).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, 'Зазор між поверхнями, мм').fill('0,2');
  await height.fill('14');
  await expect(page.getByText(/^Стінка біля закритого кінця паза — .* Зараз допустимо від 1,2 мм до 13,035 мм\.$/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await height.fill('2');

  // The print size scales the connector with the model: at M = 60 mm the same setting is 1,5 mm high, and the cylinder
  // allows 1,2–9,574 mm.
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('60');
  await expect(height).toHaveValue('1,5');
  await expect(slider(page, 'Висота виступу, мм')).toHaveAttribute('min', '1.2');
  await expect(slider(page, 'Висота виступу, мм')).toHaveAttribute('max', '9.574');
  await expect(entry(page, 'Довжина виступу, мм')).toHaveValue('30');
  // A combination that cannot carry the connector is explained; the stale preview is marked and cannot be downloaded.
  await height.fill('1,125');
  await expect(
    page.getByText(
      'Виступ заввишки 1,12 мм, потрібно щонайменше 1,2 мм. Збільште висоту виступу. Зараз допустимо від 1,2 мм до 9,574 мм.',
    ),
  ).toBeVisible();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(page.getByText('Модель не оновлено')).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await height.fill('1,5');
  await expectPartsPreview(page, '60 × 60 × 60 мм');

  // The reset removes the cut and its connector and keeps the print size.
  await page.getByRole('button', { name: 'Скинути параметри фігури', exact: true }).click();
  await expect(entry(page, 'Тип перерізу')).toHaveValue('none');
  await expect(entry(page, 'Тип кріплення')).toHaveCount(0);
  await expect(parameterSection(page, 'Кріплення')).toHaveCount(0);
  await expect(page.getByLabel('Найбільший габарит', { exact: true })).toHaveValue('60');
  await chooseDovetail(page);
  await expect(height).toHaveValue('1,5');
  await expect(entry(page, 'Зазор між поверхнями, мм')).toHaveValue('0,2');

  expect(errors).toEqual([]);
});

test('oblique cylinder: the dovetail follows the displaced section; a thin upper part is refused', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openAllSections(page);
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення верхньої основи').fill('1');
  await chooseDovetail(page);
  await entry(page, 'Від нижньої основи').fill('30');
  // r = 80/3 mm, H = 160/3 mm: at 30 % the lower part is 16 mm high and the tongue 2 mm more.
  await expectPartsPreview(page, '80 × 53,3 × 53,3 мм');
  const { parts } = await downloadParts(page);
  expect(parts[0]?.size[2]).toBeCloseTo(16 + 2, 3);
  expect(parts[1]?.size[2]).toBeCloseTo((0.7 * 160) / 3, 3);

  // At 90 % of a flat cylinder only 2 mm remain above the cut: too little over a 2,2 mm groove.
  await entry(page, 'Зміщення верхньої основи').fill('0');
  await entry(page, 'Висота h').fill('0,5');
  await entry(page, 'Від нижньої основи').fill('90');
  // Both the height and the clearance explain it; no height fits, so its slider offers none.
  await expect(page.getByText(/^Над пазом лишається 0 мм, потрібно щонайменше 1,2 мм верхньої частини\./)).toHaveCount(2);
  await expect(slider(page, 'Висота виступу, мм')).toBeDisabled();
  await expect(slider(page, 'Висота виступу, мм')).toHaveAttribute('aria-valuetext', 'немає допустимих значень');
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('2');
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, 'Від нижньої основи').fill('50');
  await expectPartsPreview(page, '80 × 80 × 20 мм');
});
