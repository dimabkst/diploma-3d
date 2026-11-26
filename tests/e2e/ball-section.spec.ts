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

const OFFSET = 'Зміщення від центра';
const SUPPORT_NOTE =
  'Частина з виступом розміщена перерізом догори. Перед друком налаштуйте підтримки під її округлою поверхнею.';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });

async function chooseCut(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Куля' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Горизонтальний' });
  await openAllSections(page);
}

async function expectReady(page: Page, size = '80 × 80 × 80 мм'): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the print file: closed objects on the bed, 5 mm apart along X, in millimetres. */
async function download(page: Page): Promise<{ names: string[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(file.suggestedFilename()).toBe('ball-horizontal-section.3mf');
  const { model } = readThreeMf(new Uint8Array(await readFile(await file.path())));
  expect(model.unit).toBe('millimeter');
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

test('ball: a horizontal section starts through the centre, as two equal halves on their cut faces', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseCut(page);
  await expectReady(page);
  expect(await entry(page, 'Тип перерізу').locator('option').allTextContents()).toEqual(['Без перерізу', 'Горизонтальний']);
  await expect(entry(page, OFFSET)).toHaveValue('0');
  await expect(parameterSection(page, 'Переріз').locator('summary')).toContainText('горизонтальний');
  const { names, objects } = await download(page);
  expect(names).toEqual(['ball-lower-part', 'ball-upper-part']);
  const [lower, upper] = objects as [MeshMeasurements, MeshMeasurements];
  expect(lower.volume / upper.volume).toBeCloseTo(1, 4);
  for (const part of [lower, upper]) expect(part.size[2]).toBeCloseTo(40, 2);
  await expect(page.getByText(SUPPORT_NOTE)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('its offset moves in steps of 5 up to ±80 %, a typed value stays within the same bounds, and the volumes follow', async ({
  page,
}) => {
  await chooseCut(page);
  await expectReady(page);
  await page.getByRole('button', { name: `${OFFSET}: збільшити`, exact: true }).click();
  await expect(entry(page, OFFSET)).toHaveValue('5');
  await slider(page, OFFSET).focus();
  await page.keyboard.press('End');
  await expect(entry(page, OFFSET)).toHaveValue('80');
  await page.keyboard.press('Home');
  await expect(entry(page, OFFSET)).toHaveValue('-80');
  await entry(page, OFFSET).fill('81');
  await expect(page.getByText(/від -80 % до 80 %/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, OFFSET).fill('50');
  await expectReady(page);
  const { objects } = await download(page);
  const [lower, upper] = objects as [MeshMeasurements, MeshMeasurements];
  expect(upper.volume / (lower.volume + upper.volume)).toBeCloseTo(5 / 32, 3);
  expect(lower.size[2]).toBeCloseTo(60, 2);
  expect(upper.size[2]).toBeCloseTo(20, 2);
});

for (const [connector, count, objectCount, note] of [
  ['Ластівчин хвіст', undefined, 2, true],
  ['Виступ і отвір', '1', 2, true],
  ['Виступ і отвір', '2', 2, true],
  ['Знімні штифти', '1', 3, false],
  ['Знімні штифти', '2', 4, false],
] as const) {
  test(`${connector}${count === undefined ? '' : ` × ${count}`}: separate objects, centred and off the centre, with the support note as needed`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await chooseCut(page);
    await expectReady(page);
    await entry(page, 'Тип кріплення').selectOption({ label: connector });
    if (count !== undefined) await entry(page, 'Кількість').selectOption({ label: count });
    await expectReady(page);
    await expect(page.getByText(SUPPORT_NOTE)).toHaveCount(note ? 1 : 0);
    const { objects } = await download(page);
    expect(objects).toHaveLength(objectCount);
    // With a plug or tongue the lower part keeps it up, on its curved side; the upper one rests on its cut face.
    if (note) expect(objects[0]?.size[2]).toBeGreaterThan(40);
    else expect(objects[0]?.size[2]).toBeCloseTo(40, 2);
    await entry(page, OFFSET).fill('25');
    await expectReady(page);
    expect((await download(page)).objects).toHaveLength(objectCount);
    expect(errors).toEqual([]);
  });
}

test('a hole too deep for the curving sphere keeps its settings, explains itself and blocks the export', async ({ page }) => {
  await chooseCut(page);
  await expectReady(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await entry(page, OFFSET).fill('70');
  await expectReady(page);
  await entry(page, 'Висота виступу, мм').fill('12');
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/куля звужується/)
      .first(),
  ).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('12');
  await expect(entry(page, 'Тип кріплення')).toHaveValue('plug');
  await entry(page, OFFSET).fill('0');
  await expectReady(page);
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('12');
});

test('where no value fits the controls say so, and smooth surfaces remain', async ({ page }) => {
  await chooseCut(page);
  await entry(page, 'Найбільший габарит').fill('20');
  await entry(page, OFFSET).fill('80');
  await expectReady(page, '20 × 20 × 20 мм');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(parameterSection(page, 'Кріплення').getByText(/^Кріплення не вміщується/)).toBeVisible();
  // The cut stays in view, but the file would not hold what the group promises.
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(entry(page, 'Висота виступу, мм')).toHaveCount(0);
  await expect(partsButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Обрати «Без кріплення»', exact: true }).click();
  await expect(entry(page, 'Тип кріплення')).toHaveValue('none');
  await expectReady(page, '20 × 20 × 20 мм');
});

test('a new maximum dimension keeps the percentage; a reset restores 0 and keeps the size', async ({ page }) => {
  await chooseCut(page);
  await entry(page, OFFSET).fill('25');
  await expectReady(page);
  await entry(page, 'Найбільший габарит').fill('160');
  await expectReady(page, '160 × 160 × 160 мм');
  await expect(entry(page, OFFSET)).toHaveValue('25');
  await page.getByRole('button', { name: 'Скинути параметри фігури' }).click();
  await expect(entry(page, 'Найбільший габарит')).toHaveValue('160');
  await expect(entry(page, 'Тип перерізу')).toHaveValue('none');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Горизонтальний' });
  await openAllSections(page);
  await expect(entry(page, OFFSET)).toHaveValue('0');
});

test('separating lifts the upper part, or slides it off the tongue, only in the preview', async ({ page }) => {
  const size = async () => {
    const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
    return [x * 1000, y * 1000, z * 1000] as const;
  };
  await chooseCut(page);
  await expectReady(page);
  expect((await size())[1]).toBeGreaterThan(90);
  expect((await size())[2]).toBeLessThan(82);
  await page.getByRole('checkbox', { name: 'Розсунути частини', exact: true }).uncheck();
  await expect.poll(async () => (await size())[1]).toBeLessThan(82);
  await page.getByRole('checkbox', { name: 'Розсунути частини', exact: true }).check();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expectReady(page);
  await expect.poll(async () => (await size())[2], { timeout: 30_000 }).toBeGreaterThan(90);
  expect((await size())[1]).toBeLessThan(82);
});

test('on a narrow phone every field is reachable and the page fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseCut(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await entry(page, 'Кількість').selectOption({ label: '2' });
  for (const label of [
    OFFSET,
    'Діаметр вихідного кола, мм',
    'Від центра до осі кріплення, мм',
    'Повна довжина штифта, мм',
    'Збільшення нижніх отворів, мм',
    'Збільшення верхніх отворів, мм',
  ]) {
    await slider(page, label).scrollIntoViewIfNeeded();
    await expect(slider(page, label)).toBeInViewport();
    await expect(entry(page, label)).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
