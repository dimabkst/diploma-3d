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

const OFFSET = 'Зміщення від осі';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });
const separation = (page: Page) => page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });

async function chooseCut(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
}

async function expectReady(page: Page, size = '80 × 80 × 80 мм'): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the print file: closed objects on the bed, 5 mm apart along X, in millimetres. */
async function download(page: Page): Promise<{ names: string[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(file.suggestedFilename()).toBe('cone-vertical-section.3mf');
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

const viewerSize = async (page: Page) => {
  const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  return [x * 1000, y * 1000, z * 1000] as const;
};

test('cone: a vertical section starts axial, gives two equal halves standing on the base, and moves sideways in % of r', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseCut(page);
  await expectReady(page);
  expect(await entry(page, 'Тип перерізу').locator('option').allTextContents()).toEqual([
    'Без перерізу',
    'Паралельно основі',
    'Вертикальний',
  ]);
  await expect(entry(page, OFFSET)).toHaveValue('0');
  const { names, objects } = await download(page);
  expect(names).toEqual(['cone-part-1', 'cone-part-2']);
  const [a, b] = objects as [MeshMeasurements, MeshMeasurements];
  expect(a.volume / b.volume).toBeCloseTo(1, 4);
  for (const part of [a, b]) {
    expect(part.size).toEqual([expect.closeTo(80, 1), expect.closeTo(40, 1), expect.closeTo(80, 1)]);
  }
  await entry(page, OFFSET).fill('50');
  await expectReady(page);
  const off = await download(page);
  const [larger, smaller] = off.objects as [MeshMeasurements, MeshMeasurements];
  expect(larger.volume).toBeGreaterThan(smaller.volume);
  // Part 2 stops below the apex, where the circle's radius is the plane's distance.
  expect(smaller.size[2]).toBeCloseTo(40, 0);
  expect(larger.size[2]).toBeCloseTo(80, 1);
  expect(errors).toEqual([]);
});

test('its offset moves in steps of 5 up to ±80 %, and a typed value stays within the same bounds', async ({ page }) => {
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
  await entry(page, OFFSET).fill('-12,5');
  await expectReady(page);
});

for (const [connector, count, objectCount] of [
  ['Ластівчин хвіст', undefined, 2],
  ['Виступ і отвір', '1', 2],
  ['Виступ і отвір', '2', 2],
  ['Знімні штифти', '1', 3],
  ['Знімні штифти', '2', 4],
] as const) {
  test(`${connector}${count === undefined ? '' : ` × ${count}`}: separate objects, centred, off the axis and on an oblique cone`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await chooseCut(page);
    await expectReady(page);
    await entry(page, 'Тип кріплення').selectOption({ label: connector });
    if (count !== undefined) await entry(page, 'Кількість').selectOption({ label: count });
    await expectReady(page);
    expect((await download(page)).objects).toHaveLength(objectCount);
    await entry(page, OFFSET).fill('25');
    await expectReady(page);
    expect((await download(page)).objects).toHaveLength(objectCount);
    await openSection(page, 'Нахил');
    await entry(page, 'Зміщення вершини').fill('1');
    await entry(page, OFFSET).fill('-10');
    await expectReady(page);
    expect((await download(page)).objects).toHaveLength(objectCount);
    expect(errors).toEqual([]);
  });
}

test('a hole too deep for the curved side keeps its settings, explains itself and blocks the export', async ({ page }) => {
  await chooseCut(page);
  await expectReady(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expectReady(page);
  await entry(page, 'Висота виступу, мм').fill('28');
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/Під дном отвору у частині 2/)
      .first(),
  ).toBeVisible();
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/Зараз допустимо/)
      .first(),
  ).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('28');
  await expect(entry(page, 'Тип кріплення')).toHaveValue('plug');
  await entry(page, 'Висота виступу, мм').fill('10');
  await expectReady(page);
});

test('where no value fits the controls say so, and smooth surfaces remain', async ({ page }) => {
  await chooseCut(page);
  await entry(page, 'Найбільший габарит').fill('20');
  await entry(page, OFFSET).fill('80');
  await expectReady(page, '20 × 20 × 20 мм');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/жодне значення/)
      .first(),
  ).toBeVisible();
  await expect(slider(page, 'Висота виступу, мм')).toBeDisabled();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Без кріплення' });
  await expectReady(page, '20 × 20 × 20 мм');
  expect((await download(page)).objects).toHaveLength(2);
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
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  await expect(entry(page, OFFSET)).toHaveValue('0');
});

test('separating moves part 2 along the normal, or lifts the tongue’s part straight up past the groove, only in the preview', async ({
  page,
}) => {
  await chooseCut(page);
  await expectReady(page);
  // glTF Z is −Y: 80 mm plus the 12 mm gap, with the outlines' small lift; the height stays.
  const apart = await viewerSize(page);
  expect(apart[2]).toBeGreaterThan(90);
  expect(apart[1]).toBeLessThan(82);
  await separation(page).uncheck();
  await expect.poll(async () => (await viewerSize(page))[2]).toBeLessThan(82);
  await separation(page).check();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expectReady(page);
  await expect.poll(async () => (await viewerSize(page))[1], { timeout: 30_000 }).toBeGreaterThan(100);
  expect((await viewerSize(page))[2]).toBeLessThan(82);
  await parameterSection(page, 'Кріплення').getByText('Як працює кріплення?').click();
  await expect(parameterSection(page, 'Кріплення').getByText(/Щоб скласти модель, опустіть частину з виступом/)).toBeVisible();
  await expect(parameterSection(page, 'Кріплення').getByText(/помітна виїмка для входу в паз/)).toBeVisible();
  expect((await download(page)).objects).toHaveLength(2);
});

test('on a narrow phone every field is reachable and the page fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseCut(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await entry(page, 'Кількість').selectOption({ label: '2' });
  for (const label of [
    OFFSET,
    'Діаметр штифта, мм',
    'Від центра до осі кріплення, мм',
    'Повна довжина штифта, мм',
    'Збільшення діаметра отворів частини 1, мм',
    'Збільшення діаметра отворів частини 2, мм',
  ]) {
    await slider(page, label).scrollIntoViewIfNeeded();
    await expect(slider(page, label)).toBeInViewport();
    await expect(entry(page, label)).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
