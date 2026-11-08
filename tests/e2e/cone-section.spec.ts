import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import {
  findMeshDefects,
  type MeshMeasurements,
  measureMesh,
  type TriangleMesh,
  vertexAt,
  vertexCount,
} from '../../packages/engine/src/mesh.ts';
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

const POSITION = 'Від основи';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });
const separation = (page: Page) => page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });

async function chooseCut(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основі' });
}

async function expectReady(page: Page, size = '80 × 80 × 80 мм'): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the print file: closed objects on the bed, 5 mm apart along X, in millimetres. */
async function download(page: Page): Promise<{ names: string[]; meshes: TriangleMesh[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(file.suggestedFilename()).toBe('cone-parallel-section.3mf');
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
  return { names: model.objects.map(({ name }) => name), meshes: model.objects.map(({ mesh }) => mesh), objects };
}

const viewerSize = async (page: Page) => {
  const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  return [x * 1000, y * 1000, z * 1000] as const;
};

test('cone: a section parallel to the base gives a frustum on its base and a smaller cone standing on the cut', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseCut(page);
  await expectReady(page);
  const options = await entry(page, 'Тип перерізу').locator('option').allTextContents();
  expect(options).toEqual(['Без перерізу', 'Паралельно основі']);
  await expect(entry(page, POSITION)).toHaveValue('50');
  await expect(parameterSection(page, 'Переріз').locator('summary')).toContainText('паралельно основі');
  const { names, objects, meshes } = await download(page);
  expect(names).toEqual(['cone-lower-part', 'cone-upper-part']);
  const [lower, upper] = objects as [MeshMeasurements, MeshMeasurements];
  expect(lower.size).toEqual([expect.closeTo(80, 1), expect.closeTo(80, 1), expect.closeTo(40, 1)]);
  expect(upper.size).toEqual([expect.closeTo(40, 1), expect.closeTo(40, 1), expect.closeTo(40, 1)]);
  expect(upper.volume / (lower.volume + upper.volume)).toBeCloseTo(1 / 8, 4);
  // Apex up: one vertex at the top of the upper part.
  const top = meshes[1] as TriangleMesh;
  const atTop = Array.from({ length: vertexCount(top) }, (_, vertex) => vertexAt(top, vertex)).filter(
    ([, , z]) => Math.abs(z - upper.bounds.max[2]) < 1e-3,
  );
  expect(atTop).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('its position moves in steps of 5 within 10–90 %, and a typed value stays within the same bounds', async ({ page }) => {
  await chooseCut(page);
  await expectReady(page);
  await page.getByRole('button', { name: `${POSITION}: збільшити`, exact: true }).click();
  await expect(entry(page, POSITION)).toHaveValue('55');
  await slider(page, POSITION).focus();
  await page.keyboard.press('End');
  await expect(entry(page, POSITION)).toHaveValue('90');
  await page.keyboard.press('Home');
  await expect(entry(page, POSITION)).toHaveValue('10');
  await entry(page, POSITION).fill('9');
  await expect(page.getByText('Допустимі значення — від 10 % до 90 %.')).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, POSITION).fill('37,5');
  await expectReady(page);
  const { objects } = await download(page);
  expect(objects[0]?.size[2]).toBeCloseTo(30, 1);
});

for (const [connector, count, objectCount] of [
  ['Ластівчин хвіст', undefined, 2],
  ['Виступ і отвір', '1', 2],
  ['Виступ і отвір', '2', 2],
  ['Знімні штифти', '1', 3],
  ['Знімні штифти', '2', 4],
] as const) {
  test(`${connector}${count === undefined ? '' : ` × ${count}`}: separate objects, also on an oblique cone`, async ({ page }) => {
    const errors = collectErrors(page);
    await chooseCut(page);
    await expectReady(page);
    await entry(page, 'Тип кріплення').selectOption({ label: connector });
    if (count !== undefined) await entry(page, 'Кількість').selectOption({ label: count });
    await expectReady(page);
    expect((await download(page)).objects).toHaveLength(objectCount);
    await openSection(page, 'Нахил');
    // So strong a lean takes some of these connectors only lower down, where the section stays over their holes.
    await entry(page, POSITION).fill('25');
    await entry(page, 'Зміщення вершини').fill('2');
    await expectReady(page, '80 × 53,3 × 53,3 мм');
    expect((await download(page)).objects).toHaveLength(objectCount);
    expect(errors).toEqual([]);
  });
}

test('a hole that fits at the section but not deeper in keeps its settings, explains itself and blocks the export', async ({
  page,
}) => {
  await chooseCut(page);
  await expectReady(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await entry(page, POSITION).fill('80');
  await expectReady(page);
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('4');
  await entry(page, 'Висота виступу, мм').fill('12');
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/конус звужується/)
      .first(),
  ).toBeVisible();
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/Зараз допустимо/)
      .first(),
  ).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('12');
  await expect(entry(page, 'Тип кріплення')).toHaveValue('plug');
  // Lowering the cut repairs it.
  await entry(page, POSITION).fill('50');
  await expectReady(page);
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('12');
});

test('near the apex no connector value may fit: the controls say so and smooth surfaces remain', async ({ page }) => {
  await chooseCut(page);
  await expectReady(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await entry(page, POSITION).fill('90');
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/жодне значення/)
      .first(),
  ).toBeVisible();
  await expect(slider(page, 'Діаметр виступу, мм')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Діаметр виступу, мм: збільшити', exact: true })).toBeDisabled();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Без кріплення' });
  await expectReady(page);
  const { objects } = await download(page);
  expect(objects).toHaveLength(2);
});

test('a new maximum dimension scales the parts together, and a reset keeps it', async ({ page }) => {
  await chooseCut(page);
  await entry(page, POSITION).fill('25');
  await expectReady(page);
  const { objects: small } = await download(page);
  await entry(page, 'Найбільший габарит').fill('160');
  await expectReady(page, '160 × 160 × 160 мм');
  await expect(entry(page, POSITION)).toHaveValue('25');
  const { objects: large } = await download(page);
  expect(large[1]?.size[2]).toBeCloseTo(2 * (small[1]?.size[2] ?? 0), 1);
  await page.getByRole('button', { name: 'Скинути параметри фігури' }).click();
  await expect(entry(page, 'Найбільший габарит')).toHaveValue('160');
  await expect(entry(page, 'Тип перерізу')).toHaveValue('none');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основі' });
  await expect(entry(page, POSITION)).toHaveValue('50');
});

test('separating lifts the upper part, or slides it off the tongue, only in the preview', async ({ page }) => {
  await chooseCut(page);
  await expectReady(page);
  // glTF Y is up: 80 mm plus the 12 mm gap, and the outlines' small lift.
  const lifted = await viewerSize(page);
  expect(lifted[1]).toBeGreaterThan(90);
  expect(lifted[1]).toBeLessThan(93);
  expect(lifted[2]).toBeLessThan(82);
  await separation(page).uncheck();
  await expect.poll(async () => (await viewerSize(page))[1]).toBeLessThan(82);
  await separation(page).check();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expectReady(page);
  // The upper part moves along +Y, which is glTF −Z: past the tongue, in the plane.
  await expect.poll(async () => (await viewerSize(page))[2], { timeout: 30_000 }).toBeGreaterThan(90);
  expect((await viewerSize(page))[1]).toBeLessThan(82);
});

test('a strong lean refuses a connector with an explanation at a position where its section has moved away', async ({ page }) => {
  await chooseCut(page);
  await expectReady(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expectReady(page);
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення вершини').fill('2');
  await expect(parameterSection(page, 'Кріплення').locator('.field-error').first()).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, 'Тип кріплення')).toHaveValue('dovetail');
  await entry(page, POSITION).fill('25');
  await expectReady(page, '80 × 53,3 × 53,3 мм');
});

test('selecting the cut turns neither the cone nor the camera', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Переріз');
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  const orbit = () =>
    modelViewer(page).evaluate((element) => {
      const { theta, phi } = (element as unknown as ModelViewerElement).getCameraOrbit();
      return { theta, phi };
    });
  const direction = await orbit();
  for (const label of ['Паралельно основі', 'Без перерізу', 'Паралельно основі']) {
    await entry(page, 'Тип перерізу').selectOption({ label });
    await page.waitForTimeout(250);
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
    expect(await orbit()).toEqual(direction);
  }
  // Choosing another position, connector, then leaving keeps it too.
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await entry(page, POSITION).fill('30');
  await page.waitForTimeout(250);
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  expect(await orbit()).toEqual(direction);
});

test('the cone keeps its own section settings, apart from the cylinder’s', async ({ page }) => {
  await chooseCut(page);
  await entry(page, POSITION).fill('30');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await expect(entry(page, 'Тип перерізу')).toHaveValue('none');
  await expect(entry(page, 'Тип перерізу').locator('option')).toHaveCount(4);
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await expect(entry(page, 'Тип перерізу')).toHaveValue('parallel-to-bases');
  await expect(entry(page, POSITION)).toHaveValue('30');
});

test('on a narrow phone every field is reachable and the page fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseCut(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await entry(page, 'Кількість').selectOption({ label: '2' });
  for (const label of [
    POSITION,
    'Діаметр штифта, мм',
    'Від центра до осі кріплення, мм',
    'Повна довжина штифта, мм',
    'Збільшення діаметра нижніх отворів, мм',
    'Збільшення діаметра верхніх отворів, мм',
  ]) {
    await slider(page, label).scrollIntoViewIfNeeded();
    await expect(slider(page, label)).toBeInViewport();
    await expect(entry(page, label)).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
