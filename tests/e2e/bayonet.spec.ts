import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, measureMesh } from '../../packages/engine/src/mesh.ts';
import {
  collectErrors,
  type ModelViewerElement,
  modelViewer,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const trialButton = (page: Page) => page.getByRole('button', { name: 'Завантажити пробне з’єднання', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const DIAMETER = 'Діаметр стрижня, мм';
const HEIGHT = 'Висота стрижня над перерізом, мм';

/** A cylinder 100 mm high and 60 mm wide, cut in half. */
async function chooseTallCylinder(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await entry(page, 'Найбільший габарит').fill('100');
  await entry(page, 'Висота h').fill('3,333333');
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
}

async function expectReady(page: Page): Promise<void> {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
}

test('the bayonet takes its dimensions from the section, hides the ordinary controls and exports the model and a trial', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Байонет (пробний)' });
  const group = parameterSection(page, 'Кріплення');
  await expect(entry(page, 'Профіль')).toHaveCount(0);
  await expect(entry(page, 'Кількість')).toHaveCount(0);
  await expect(entry(page, 'Збільшення гнізда Δ, мм')).toHaveValue('0,5');
  await expect(entry(page, 'Осьовий зазор, мм')).toHaveValue('0,2');
  await expect(entry(page, 'Натяг фіксатора, мм')).toHaveValue('0,15');
  await expect(group.getByText(/Δ = 0,5 мм дає зазор 0,25 мм/)).toBeVisible();
  await expectReady(page);
  const diameter = await entry(page, DIAMETER).inputValue();
  const height = await entry(page, HEIGHT).inputValue();

  const [model] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const parts = readThreeMf(new Uint8Array(await readFile(await model.path()))).model.objects;
  expect(parts.map(({ name }) => name)).toEqual(['cylinder-lower-part', 'cylinder-upper-part']);
  for (const { mesh } of parts) {
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(measureMesh(mesh).bounds.min[2]).toBe(0);
  }
  // The stem stands on the lower part, over its own 50 mm; the upper part keeps its 50 mm, its mouth on the bed.
  const [lowerSize, upperSize] = parts.map(({ mesh }) => measureMesh(mesh).size[2]);
  expect(lowerSize).toBeCloseTo(50 + Number(height.replace(',', '.')), 3);
  expect(upperSize).toBeCloseTo(50, 3);

  await expect(trialButton(page)).toBeEnabled();
  const [trial] = await Promise.all([page.waitForEvent('download'), trialButton(page).click()]);
  expect(trial.suggestedFilename()).toBe(
    `bayonet-trial-d${diameter.replace(',', '.')}-H${height.replace(',', '.')}-c0.5-a0.2-i0.15mm.3mf`,
  );
  const holders = readThreeMf(new Uint8Array(await readFile(await trial.path()))).model.objects;
  expect(holders.map(({ name }) => name)).toEqual(['bayonet-trial-male', 'bayonet-trial-female']);
  for (const { mesh } of holders) expect(findMeshDefects(mesh)).toEqual([]);
  const boxes = holders.map(({ mesh }) => measureMesh(mesh).bounds);
  expect(boxes[0]?.max[0] as number).toBeLessThan(boxes[1]?.min[0] as number);
  expect(errors).toEqual([]);
});

test('switching to the bayonet keeps the view, and assembling it brings the withdrawn upper part back', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  const orbit = () =>
    modelViewer(page).evaluate((element) => {
      const { theta, phi } = (element as unknown as ModelViewerElement).getCameraOrbit();
      return { theta, phi };
    });
  const before = await orbit();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Байонет (пробний)' });
  await expectReady(page);
  const after = await orbit();
  expect(after.theta).toBeCloseTo(before.theta, 6);
  expect(after.phi).toBeCloseTo(before.phi, 6);
  // Assembled, it is the model's own height again, as nothing of it stays apart.
  const heightOf = () =>
    modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions().y * 1000);
  const apart = await heightOf();
  await parameterSection(page, 'Переріз').getByLabel('Розсунути частини').uncheck();
  await expect.poll(heightOf, { timeout: 30_000 }).toBeLessThan(apart);
  expect(await heightOf()).toBeLessThan(102);
  expect(errors).toEqual([]);
});

test('a thin part leaves the cut visible with an explanation and the way to no connector', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Байонет (пробний)' });
  await expectReady(page);
  await entry(page, 'Від нижньої основи').fill('90');
  const group = parameterSection(page, 'Кріплення');
  await expect(group.getByRole('alert')).toContainText('Байонет не вміщується');
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeDisabled();
  await group.getByRole('button', { name: 'Обрати «Без кріплення»', exact: true }).click();
  await expect(entry(page, 'Тип кріплення')).toHaveValue('none');
  await expectReady(page);
  expect(errors).toEqual([]);
});

test('other cuts list the bayonet as unavailable, with the reason, and leave the others usable', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  const group = parameterSection(page, 'Кріплення');
  const option = entry(page, 'Тип кріплення').locator('option', { hasText: 'Байонет (пробний)' });
  await expect(option).toBeDisabled();
  await expect(group.getByText('Байонет (пробний) доступний лише для прямого циліндра')).toBeVisible();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('zero interference is stated, and the trial still downloads', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Байонет (пробний)' });
  await expectReady(page);
  await entry(page, 'Натяг фіксатора, мм').fill('0');
  const group = parameterSection(page, 'Кріплення');
  await expect(group.getByText(/фіксатор зворотного повороту вимкнено/)).toBeVisible();
  await expectReady(page);
  await expect(trialButton(page)).toBeEnabled();
  expect(errors).toEqual([]);
});
