import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, measureMesh } from '../../packages/engine/src/mesh.ts';
import {
  collectErrors,
  type ModelViewerElement,
  modelViewer,
  openAllSections,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const trialButton = (page: Page) => page.getByRole('button', { name: 'Завантажити пробне з’єднання', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const SIZE = 'Розмір кріплення, мм';

/** A cylinder 100 mm high and 60 mm wide, cut in half. */
async function chooseTallCylinder(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openAllSections(page);
  await entry(page, 'Найбільший габарит').fill('100');
  await entry(page, 'Висота h').fill('3,333333');
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await openAllSections(page);
}

async function expectReady(page: Page): Promise<void> {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
}

test('the twist connector takes its size from the section, shows three controls and exports the model and a trial', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Поворотне з’єднання' });
  const group = parameterSection(page, 'Кріплення');
  await expect(entry(page, 'Профіль')).toHaveCount(0);
  await expect(entry(page, 'Кількість')).toHaveCount(0);
  await expect(entry(page, SIZE)).toHaveValue('16');
  await expect(entry(page, 'Збільшення гнізда Δ, мм')).toHaveValue('0,5');
  await expect(entry(page, 'Осьовий зазор, мм')).toHaveValue('0,2');
  await expect(group.getByText(/^Значення 0,5 мм дає зазор 0,25 мм з кожного боку\./)).toBeVisible();
  await expectReady(page);

  const [model] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const parts = readThreeMf(new Uint8Array(await readFile(await model.path()))).model.objects;
  expect(parts.map(({ name }) => name)).toEqual(['cylinder-lower-part', 'cylinder-upper-part']);
  for (const { mesh } of parts) {
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(measureMesh(mesh).bounds.min[2]).toBe(0);
  }
  // The lower part on its base with the 4 mm head on top; the upper part on its cut face, 50 mm high.
  const [lowerHeight, upperHeight] = parts.map(({ mesh }) => measureMesh(mesh).size[2]);
  expect(lowerHeight).toBeCloseTo(54, 3);
  expect(upperHeight).toBeCloseTo(50, 3);

  // A larger size and other clearances are kept and name the trial file.
  await entry(page, SIZE).fill('18,3');
  await entry(page, 'Збільшення гнізда Δ, мм').fill('0,45');
  await entry(page, 'Осьовий зазор, мм').fill('0,25');
  await expectReady(page);
  await expect(trialButton(page)).toBeEnabled();
  const [trial] = await Promise.all([page.waitForEvent('download'), trialButton(page).click()]);
  expect(trial.suggestedFilename()).toBe('twist-trial-S18.3-d0.45-a0.25mm.3mf');
  const holders = readThreeMf(new Uint8Array(await readFile(await trial.path()))).model.objects;
  expect(holders.map(({ name }) => name)).toEqual(['twist-trial-male', 'twist-trial-female']);
  for (const { mesh } of holders) {
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(measureMesh(mesh).size[2]).toBeLessThan(20);
  }
  const boxes = holders.map(({ mesh }) => measureMesh(mesh).bounds);
  expect(boxes[0]?.max[0] as number).toBeLessThan(boxes[1]?.min[0] as number);
  expect(errors).toEqual([]);
});

test('switching to it keeps the view, and the separated upper part comes back when assembled', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  const orbit = () =>
    modelViewer(page).evaluate((element) => {
      const { theta, phi } = (element as unknown as ModelViewerElement).getCameraOrbit();
      return { theta, phi };
    });
  const before = await orbit();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Поворотне з’єднання' });
  await expectReady(page);
  const after = await orbit();
  expect(after.theta).toBeCloseTo(before.theta, 6);
  expect(after.phi).toBeCloseTo(before.phi, 6);
  const heightOf = () =>
    modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions().y * 1000);
  const apart = await heightOf();
  await parameterSection(page, 'Переріз').getByLabel('Розсунути частини').uncheck();
  await expect.poll(heightOf, { timeout: 30_000 }).toBeLessThan(apart);
  expect(await heightOf()).toBeLessThan(102);
  expect(errors).toEqual([]);
});

test('a part too thin keeps the cut visible, explains it and offers no connector', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Поворотне з’єднання' });
  await expectReady(page);
  await entry(page, 'Найбільший габарит').fill('40');
  await entry(page, 'Від нижньої основи').fill('90');
  const group = parameterSection(page, 'Кріплення');
  await expect(group.getByRole('alert')).toContainText('Поворотне з’єднання не вміщується');
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeDisabled();
  await group.getByRole('button', { name: 'Обрати «Без кріплення»', exact: true }).click();
  await expect(entry(page, 'Тип кріплення')).toHaveValue('none');
  await expectReady(page);
  expect(errors).toEqual([]);
});

test('other cuts list it as unavailable, with the reason, and leave the other connectors usable', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  await openAllSections(page);
  const option = entry(page, 'Тип кріплення').locator('option', { hasText: 'Поворотне з’єднання' });
  await expect(option).toBeDisabled();
  await expect(parameterSection(page, 'Кріплення').getByText('Поворотне з’єднання поки доступне лише')).toBeVisible();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  expect(errors).toEqual([]);
});
