import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, type MeshMeasurements, measureMesh } from '../../packages/engine/src/mesh.ts';
import {
  collectErrors,
  dimensionsLine,
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
const OFFSET = 'Зміщення від осі';

async function chooseVertical(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
}

async function expectReady(page: Page, size = '80 × 80 × 80 мм'): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the print file: closed objects on the bed, 5 mm apart along X. */
async function download(page: Page): Promise<{ bytes: Uint8Array; names: string[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(file.suggestedFilename()).toBe('cylinder-vertical-section.3mf');
  const bytes = new Uint8Array(await readFile(await file.path()));
  const { model } = readThreeMf(bytes);
  expect(model.unit).toBe('millimeter');
  const objects = model.objects.map(({ mesh }) => {
    expect(findMeshDefects(mesh)).toEqual([]);
    return measureMesh(mesh);
  });
  objects.forEach((object, index) => {
    expect(object.bounds.min[2]).toBe(0);
    if (index > 0) expect(Math.abs(object.bounds.min[0] - (objects[index - 1]?.bounds.max[0] ?? 0) - 5)).toBeLessThan(1e-3);
  });
  return { bytes, names: model.objects.map(({ name }) => name), objects };
}

/** The shown model's extent in millimetres along glTF X, Y (up) and Z. */
const viewerSize = async (page: Page) => {
  const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  return [x * 1000, y * 1000, z * 1000] as const;
};

test('cylinder: a vertical section starts axial, moves sideways within its limits and exports two upright parts', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseVertical(page);

  // The distance from the axis in percent of r, and the explanation of this cut.
  await expect(entry(page, 'Від нижньої основи')).toHaveCount(0);
  await expect(entry(page, OFFSET)).toHaveValue('0');
  await expect(slider(page, OFFSET)).toHaveAttribute('min', '-80');
  await expect(slider(page, OFFSET)).toHaveAttribute('max', '80');
  await expect(parameterSection(page, 'Переріз').getByText('% r', { exact: true })).toBeVisible();
  await parameterSection(page, 'Переріз').getByRole('button', { name: 'Як задано переріз?' }).click();
  await expect(page.getByText(/0% — осьовий переріз\. Значення 50% зміщує площину на половину радіуса основи\./)).toBeVisible();

  await expectReady(page);
  let file = await download(page);
  expect(file.names).toEqual(['cylinder-part-1', 'cylinder-part-2']);
  for (const object of file.objects) {
    expect(object.size[0]).toBeCloseTo(80, 3);
    expect(object.size[1]).toBeCloseTo(40, 3);
    expect(object.size[2]).toBeCloseTo(80, 3);
  }
  expect(file.objects[0]?.volume).toBeCloseTo(file.objects[1]?.volume ?? 0, 0);

  // A signed offset: +25 % of r = 40 mm is 10 mm, and part 1 takes the larger share.
  await entry(page, OFFSET).fill('25');
  await expectReady(page);
  file = await download(page);
  expect(file.objects[0]?.size[1]).toBeCloseTo(50, 3);
  expect(file.objects[1]?.size[1]).toBeCloseTo(30, 3);
  await entry(page, OFFSET).fill('-25');
  await expectReady(page);
  file = await download(page);
  expect(file.objects[0]?.size[1]).toBeCloseTo(30, 3);

  // Beyond the limit: kept as typed, explained, marked and not downloadable, until it is corrected.
  await entry(page, OFFSET).fill('85');
  await expect(page.getByText(/^Допустимі значення — від -80 % до 80 %/)).toBeVisible();
  await expect(entry(page, OFFSET)).toHaveValue('85');
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, OFFSET).fill('25');
  await expectReady(page);

  // The print size keeps the percentage and its limits, and scales the plane: from 10 to 15 mm at r = 60 mm.
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('120');
  await expect(entry(page, OFFSET)).toHaveValue('25');
  await expect(slider(page, OFFSET)).toHaveAttribute('max', '80');
  await expectReady(page, '120 × 120 × 120 мм');
  file = await download(page);
  expect(file.objects[0]?.size[1]).toBeCloseTo(75, 3);
  expect(file.objects[1]?.size[1]).toBeCloseTo(45, 3);
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('80');
  await expectReady(page);

  // The buttons move in steps of 5, from a typed value to the neighbouring multiple, and stop at the limit.
  await entry(page, OFFSET).fill('12,5');
  await expectReady(page);
  await page.getByRole('button', { name: `${OFFSET}: збільшити`, exact: true }).click();
  await expect(entry(page, OFFSET)).toHaveValue('15');
  await page.getByRole('button', { name: `${OFFSET}: зменшити`, exact: true }).click();
  await expect(entry(page, OFFSET)).toHaveValue('10');
  await entry(page, OFFSET).fill('80');
  await expect(page.getByRole('button', { name: `${OFFSET}: збільшити`, exact: true })).toBeDisabled();
  await expectReady(page);

  // A bound that is no multiple of the step is reachable: at M = 7 mm the wall leaves ±65,71 %.
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('7');
  await expect(slider(page, OFFSET)).toHaveAttribute('max', '65.71');
  await entry(page, OFFSET).fill('65');
  await page.getByRole('button', { name: `${OFFSET}: збільшити`, exact: true }).click();
  await expect(entry(page, OFFSET)).toHaveValue('65,71');
  await expectReady(page, '7 × 7 × 7 мм');
  await slider(page, OFFSET).focus();
  await page.keyboard.press('Home');
  await expect(entry(page, OFFSET)).toHaveValue('-65,71');
  await expectReady(page, '7 × 7 × 7 мм');
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('80');
  await entry(page, OFFSET).fill('25');
  await expectReady(page);

  // The reset leaves the section and returns to the axis, and the print size stays.
  await page.getByRole('button', { name: 'Скинути параметри фігури', exact: true }).click();
  await expect(entry(page, 'Тип перерізу')).toHaveValue('none');
  await expect(entry(page, OFFSET)).toHaveCount(0);
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  await expect(entry(page, OFFSET)).toHaveValue('0');

  // The parallel cut keeps its own field, parts and file.
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await expect(entry(page, 'Від нижньої основи')).toHaveValue('50');
  await expect(entry(page, OFFSET)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('vertical section: plugs and dowels lie along the normal, within bounds that follow the plane', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseVertical(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  const connector = parameterSection(page, 'Кріплення');

  // The depth runs towards the curved surface: √(38,75² − 2,6²) − 0,3 mm on the axis, less as the plane moves away.
  await expect(slider(page, 'Висота виступу, мм')).toHaveAttribute('min', '2.8');
  await expect(slider(page, 'Висота виступу, мм')).toHaveAttribute('max', '38.364');
  await expectReady(page);
  let file = await download(page);
  expect(file.names).toEqual(['cylinder-part-1', 'cylinder-part-2']);
  // The plug stands out sideways from part 1, not upwards: 4 mm across, and the height stays that of the cylinder.
  expect(file.objects[0]?.size[1]).toBeCloseTo(44, 3);
  expect(file.objects[0]?.size[2]).toBeCloseTo(80, 3);
  expect(file.objects[1]?.size[1]).toBeCloseTo(40, 3);
  // Part 2 stands on its base, not turned over.
  expect(file.objects[1]?.size[2]).toBeCloseTo(80, 3);

  // An 8 mm plug fits on the axis; near the side of part 2 the entrance still fits, but the depth does not.
  await entry(page, 'Висота виступу, мм').fill('8');
  await expectReady(page);
  await entry(page, OFFSET).fill('80');
  await expect(page.locator('#cylinderRoundDepth-error')).toHaveText(
    /^Під дном отвору у частині 2 лишається .* Зменште висоту виступу, діаметр виступу або зміщення від осі\./,
  );
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('8');
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, OFFSET).fill('0');
  await expectReady(page);
  await entry(page, 'Висота виступу, мм').fill('4');

  // Two connectors are placed along the height, with the plug and its pair's second diameter.
  await entry(page, 'Кількість').selectOption({ label: '2' });
  await expect(entry(page, 'Від центра до осі кріплення, мм')).toHaveValue('18');
  await expect(slider(page, 'Від центра до осі кріплення, мм')).toHaveAttribute('min', '3.31');
  await expect(slider(page, 'Від центра до осі кріплення, мм')).toHaveAttribute('max', '35.8');
  await expectReady(page);
  expect((await download(page)).names).toHaveLength(2);

  // Removable dowels are separate objects, printed upright; the receiving parts have their own clearances.
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expect(entry(page, 'Збільшення діаметра отворів частини 1, мм')).toHaveValue('0,1');
  await expect(entry(page, 'Збільшення діаметра отворів частини 2, мм')).toHaveValue('0,2');
  await expect(entry(page, 'Збільшення діаметра нижніх отворів, мм')).toHaveCount(0);
  await expectReady(page);
  file = await download(page);
  expect(file.names).toEqual(['cylinder-part-1', 'cylinder-part-2', 'cylinder-dowel-1', 'cylinder-dowel-2']);
  expect(
    file.objects
      .slice(2)
      .map((object) => [object.size[0], object.size[1], object.size[2]].map((value) => Number(value.toFixed(3)))),
  ).toEqual([
    [5, 5, 8],
    [4, 4, 8],
  ]);
  // Display only: the print file is the same with the parts together.
  await separation(page).uncheck();
  await expectReady(page);
  expect((await download(page)).bytes).toEqual(file.bytes);
  await separation(page).check();

  await connector.getByRole('button', { name: 'Як працює кріплення?' }).click();
  await expect(connector.getByText(/Розміри отворів частин 1 і 2 налаштовуються окремо/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('vertical section: part 1 comes off the dovetail upwards in the preview, and part 2 stays', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseVertical(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  const connector = parameterSection(page, 'Кріплення');
  await connector.getByRole('button', { name: 'Як працює кріплення?' }).click();
  await expect(
    connector.getByText(/^Паз відкритий угорі та закінчується упором унизу\. Щоб скласти модель, опустіть половинку з виступом/),
  ).toBeVisible();

  // L = 50 % of the height, up to the stop's wall: 80 − 2·1,2 − 2·0,2 mm.
  await expect(entry(page, 'Довжина виступу, мм')).toHaveValue('40');
  await expect(slider(page, 'Довжина виступу, мм')).toHaveAttribute('max', '77.2');
  await expectReady(page);
  const apart = await viewerSize(page);
  const file = await download(page);
  expect(file.names).toEqual(['cylinder-part-1', 'cylinder-part-2']);
  // The tongue stands out 2 mm from part 1.
  expect(file.objects[0]?.size[1]).toBeCloseTo(42, 3);
  expect(file.objects[1]?.size[1]).toBeCloseTo(40, 3);

  // Lifted by the way out, 80/2 + 40/2 + 0,2 + 1 mm, and the 12 mm gap; not moved sideways.
  await separation(page).uncheck();
  await expectReady(page);
  const together = await viewerSize(page);
  expect(apart[1] - together[1]).toBeCloseTo(73.2, 1);
  expect(Math.abs(apart[0] - together[0])).toBeLessThan(0.05);
  expect(Math.abs(apart[2] - together[2])).toBeLessThan(0.05);
  expect((await download(page)).bytes).toEqual(file.bytes);
  await separation(page).check();

  // A cylinder leaning too far for this tongue is refused rather than tilting the slide.
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення верхньої основи').fill('4');
  await expect(page.getByText(/^Стінка біля паза — /).first()).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await entry(page, 'Зміщення верхньої основи').fill('1');
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

for (const [name, width, height] of [
  ['desktop, 1366 px', 1366, 768],
  ['narrow phone, 320 px', 320, 640],
] as const) {
  test(`vertical section: the controls stay reachable without horizontal overflow (${name})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await chooseVertical(page);
    await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
    await entry(page, 'Кількість').selectOption({ label: '2' });
    await entry(page, OFFSET).fill('85');
    await expect(entry(page, 'Збільшення діаметра отворів частини 2, мм')).toBeVisible();
    await entry(page, 'Збільшення діаметра отворів частини 2, мм').scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    // «Вписати модель» still works on the separated parts.
    await entry(page, OFFSET).fill('0');
    await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
    // model-viewer loads only what is in view.
    await previewViewport(page).scrollIntoViewIfNeeded();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Вписати модель', exact: true }).click();
  });
}
