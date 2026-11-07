import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, type MeshMeasurements, measureMesh } from '../../packages/engine/src/mesh.ts';
import {
  collectErrors,
  dimensionsLine,
  documentBox,
  type ModelViewerElement,
  modelViewer,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });
const separation = (page: Page) => page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });

async function expectPartsPreview(page: Page): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText('Габарити в зборі: 80 × 80 × 80 мм', { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the print file: every object closed, on the bed and 5 mm after the previous one along X. */
async function download(page: Page): Promise<{ names: string[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const { model } = readThreeMf(new Uint8Array(await readFile(await file.path())));
  expect(model.unit).toBe('millimeter');
  expect(model.buildItems).toEqual(model.objects.map(({ id }) => ({ objectId: id })));
  const objects = model.objects.map(({ mesh }) => {
    expect(findMeshDefects(mesh)).toEqual([]);
    return measureMesh(mesh);
  });
  objects.forEach((object, index) => {
    expect(object.bounds.min[2]).toBe(0);
    if (index > 0) expect(Math.abs(object.bounds.min[0] - (objects[index - 1]?.bounds.max[0] ?? 0) - 5)).toBeLessThan(1e-3);
  });
  return { names: model.objects.map(({ name }) => name), objects };
}

const viewerHeightMm = async (page: Page) =>
  1000 * (await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions().y));

test('cylinder: plugs and dowels sit in their own group under the section and export as independent objects', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });

  // The connector's selector and settings form one group, after the section's explanation.
  const cut = parameterSection(page, 'Переріз');
  const connector = parameterSection(page, 'Кріплення');
  await expect(cut.getByLabel('Тип кріплення', { exact: true })).toHaveCount(0);
  await expect(connector.getByLabel('Тип кріплення', { exact: true })).toHaveValue('none');
  const explanation = await documentBox(cut.getByRole('button', { name: 'Як задано переріз?' }));
  const selector = await documentBox(entry(page, 'Тип кріплення'));
  expect(selector.y).toBeGreaterThan(explanation.y + explanation.height);

  // One plug, in millimetres at M = 80 mm: d = 5 mm, 4 mm above the cut.
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(entry(page, 'Кількість')).toHaveValue('1');
  await expect(
    connector.getByText(
      'Одне кругле кріплення дозволяє повертати половинки. Два кріплення різного діаметра задають їхнє взаємне положення.',
    ),
  ).toBeVisible();
  await expect(connector.getByText(/^Показано фактичні розміри для поточного масштабу моделі\./)).toBeVisible();
  await expect(entry(page, 'Від центра до осі кріплення, мм')).toHaveCount(0);
  for (const [label, value, min, max] of [
    ['Діаметр виступу, мм', '5', '3.75', '7.5'],
    ['Висота виступу, мм', '4', '3', '6'],
    ['Збільшення діаметра отвору, мм', '0,2', '0', '0.4'],
  ] as const) {
    await expect(entry(page, label)).toHaveValue(value);
    await expect(slider(page, label)).toHaveAttribute('min', min);
    await expect(slider(page, label)).toHaveAttribute('max', max);
  }
  await expectPartsPreview(page);
  let file = await download(page);
  expect(file.names).toEqual(['cylinder-lower-part', 'cylinder-upper-part']);
  expect(file.objects[0]?.size[2]).toBeCloseTo(44, 3);
  expect(file.objects[1]?.size[2]).toBeCloseTo(40, 3);

  // Plugs come apart along the cut's normal: the separated preview is 0,5 × 80 = 40 mm taller.
  const apart = await viewerHeightMm(page);
  await separation(page).uncheck();
  await expectPartsPreview(page);
  expect(Math.abs(apart - (await viewerHeightMm(page)) - 40)).toBeLessThan(0.05);
  await separation(page).check();

  // A pair adds its second diameter and the distance of its axes from the centre: 0,45 × 40 = 18 mm.
  await entry(page, 'Кількість').selectOption({ label: '2' });
  await expect(connector.getByText('Друге кріплення: діаметр 4 мм.')).toBeVisible();
  await expect(entry(page, 'Від центра до осі кріплення, мм')).toHaveValue('18');
  await expect(slider(page, 'Від центра до осі кріплення, мм')).toHaveAttribute('min', '10');
  await expect(slider(page, 'Від центра до осі кріплення, мм')).toHaveAttribute('max', '26');
  await expectPartsPreview(page);
  expect((await download(page)).names).toHaveLength(2);

  // Dowels: separate objects, upright, 8 mm long, d and 0,8d wide; their own hole sizes.
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expect(entry(page, 'Діаметр штифта, мм')).toHaveValue('5');
  await expect(entry(page, 'Повна довжина штифта, мм')).toHaveValue('8');
  await expect(connector.getByText('У кожну половинку штифт входить на 4 мм.')).toBeVisible();
  await expect(entry(page, 'Збільшення діаметра нижніх отворів, мм')).toHaveValue('0,1');
  await expect(entry(page, 'Збільшення діаметра верхніх отворів, мм')).toHaveValue('0,2');
  await expect(entry(page, 'Збільшення діаметра отвору, мм')).toHaveCount(0);
  await expectPartsPreview(page);
  file = await download(page);
  // Visiting every field without changing it changes nothing: the file is the same, byte for byte.
  const untouched = await (async () => {
    const [saved] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
    return readFile(await saved.path());
  })();
  for (const label of ['Діаметр штифта, мм', 'Від центра до осі кріплення, мм', 'Повна довжина штифта, мм']) {
    await entry(page, label).focus();
    await entry(page, label).press('Tab');
  }
  await expectPartsPreview(page);
  const [revisited] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(await readFile(await revisited.path())).toEqual(untouched);
  expect(file.names).toEqual(['cylinder-lower-part', 'cylinder-upper-part', 'cylinder-dowel-1', 'cylinder-dowel-2']);
  expect(file.objects[0]?.size[2]).toBeCloseTo(40, 3);
  expect(
    file.objects.slice(2).map((object) => [object.size[0], object.size[2]].map((value) => Number(value.toFixed(3)))),
  ).toEqual([
    [5, 8],
    [4, 8],
  ]);
  // The length field is the whole dowel: 10 mm puts 5 mm into each part.
  await entry(page, 'Повна довжина штифта, мм').fill('10');
  await expect(connector.getByText('У кожну половинку штифт входить на 5 мм.')).toBeVisible();
  await expectPartsPreview(page);
  expect((await download(page)).objects[2]?.size[2]).toBeCloseTo(10, 3);
  // A larger print size scales the connector with the model: at M = 120 mm the same settings are 7,5 mm and 15 mm.
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('120');
  await expect(entry(page, 'Діаметр штифта, мм')).toHaveValue('7,5');
  await expect(entry(page, 'Повна довжина штифта, мм')).toHaveValue('15');
  await expect(entry(page, 'Збільшення діаметра верхніх отворів, мм')).toHaveValue('0,2');
  await expect(dimensionsLine(page)).toHaveText('Габарити в зборі: 120 × 120 × 120 мм', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const scaled = await download(page);
  expect(
    scaled.objects.slice(2).map((object) => [object.size[0], object.size[2]].map((value) => Number(value.toFixed(3)))),
  ).toEqual([
    [7.5, 15],
    [6, 15],
  ]);
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('80');
  await entry(page, 'Повна довжина штифта, мм').fill('8');
  await entry(page, 'Кількість').selectOption({ label: '1' });
  await expectPartsPreview(page);
  expect((await download(page)).names).toEqual(['cylinder-lower-part', 'cylinder-upper-part', 'cylinder-dowel-1']);

  // A clearance that no longer keys the pair is explained; export is blocked until it is corrected.
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await entry(page, 'Кількість').selectOption({ label: '2' });
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('60');
  await entry(page, 'Збільшення діаметра отвору, мм').fill('0,4');
  await expect(page.getByText(/^Більший виступ ширший за менший отвір на 0,35 мм/)).toBeVisible();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, 'Збільшення діаметра отвору, мм').fill('0,2');
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });

  // The reset returns to no connector and its defaults and keeps the print size.
  await page.getByRole('button', { name: 'Скинути параметри фігури', exact: true }).click();
  await expect(page.getByLabel('Найбільший габарит', { exact: true })).toHaveValue('60');
  await expect(entry(page, 'Тип кріплення')).toHaveCount(0);
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await expect(entry(page, 'Тип кріплення')).toHaveValue('none');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expect(entry(page, 'Кількість')).toHaveValue('1');
  await expect(entry(page, 'Діаметр штифта, мм')).toHaveValue('3,75');

  expect(errors).toEqual([]);
});
