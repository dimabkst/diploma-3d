import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects } from '../../packages/engine/src/mesh.ts';
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
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const ENTRANCE = 'Вхід у паз';

async function expectReady(page: Page): Promise<void> {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
}

async function partsFile(page: Page): Promise<Uint8Array> {
  const [download] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  return new Uint8Array(await readFile(await download.path()));
}

test('a cone’s axial cut: the groove opens at the top or towards the base, with the view kept', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expect(entry(page, ENTRANCE).locator('option')).toHaveText(['Зверху', 'Знизу']);
  await expect(entry(page, ENTRANCE)).toHaveValue('standard');
  await expectReady(page);
  const top = await partsFile(page);

  const orbit = () =>
    modelViewer(page).evaluate((element) => {
      const { theta, phi } = (element as unknown as ModelViewerElement).getCameraOrbit();
      return { theta, phi };
    });
  const before = await orbit();
  await entry(page, ENTRANCE).selectOption({ label: 'Знизу' });
  await expectReady(page);
  const after = await orbit();
  expect(after.theta).toBeCloseTo(before.theta, 6);
  expect(after.phi).toBeCloseTo(before.phi, 6);
  await expect(parameterSection(page, 'Кріплення').getByText(/Паз відкритий унизу, біля основи/)).toBeAttached();
  const bottom = await partsFile(page);
  const [topParts, bottomParts] = [top, bottom].map((bytes) => readThreeMf(bytes).model.objects);
  expect(bottomParts?.map(({ name }) => name)).toEqual(topParts?.map(({ name }) => name));
  for (const { mesh } of bottomParts ?? []) expect(findMeshDefects(mesh)).toEqual([]);
  expect(Buffer.from(bottom).equals(Buffer.from(top))).toBe(false);

  // Back and forth: the same files as before, the last choice wins.
  await entry(page, ENTRANCE).selectOption({ label: 'Зверху' });
  await entry(page, ENTRANCE).selectOption({ label: 'Знизу' });
  await entry(page, ENTRANCE).selectOption({ label: 'Зверху' });
  await expectReady(page);
  await expect(entry(page, ENTRANCE)).toHaveValue('standard');
  expect(Buffer.from(await partsFile(page)).equals(Buffer.from(top))).toBe(true);
  // A new size keeps the choice.
  await entry(page, ENTRANCE).selectOption({ label: 'Знизу' });
  await entry(page, 'Найбільший габарит').fill('120');
  await expectReady(page);
  await expect(entry(page, ENTRANCE)).toHaveValue('opposite');
  expect(errors).toEqual([]);
});

test('a horizontal cut names the two lateral sides', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expect(entry(page, ENTRANCE).locator('option')).toHaveText(['З одного боку', 'З протилежного боку']);
  await entry(page, ENTRANCE).selectOption({ label: 'З протилежного боку' });
  await expectReady(page);
  expect(errors).toEqual([]);
});
