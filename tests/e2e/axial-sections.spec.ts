import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { collectErrors, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function download(page: Page) {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  return {
    objects: readThreeMf(bytes).model.objects.map((object) => object.name),
    json: JSON.parse(readThreeMfPart(bytes, '3D/Other/model-settings.json') as string),
  };
}

test('a leaning cylinder’s plane parallel to its axis: offset, direction, the axial preset, and both parts downloaded', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення верхньої основи').fill('0,8');
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно осі' });
  await entry(page, 'Зміщення від осі').fill('30');
  await entry(page, 'Напрям зміщення').fill('45');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  const moved = await download(page);
  expect(moved.objects.slice(0, 2)).toEqual(['cylinder-part-1', 'cylinder-part-2']);
  expect(moved.json.sourceModel.section).toEqual({ type: 'axis-parallel', offsetPercent: 30, directionDeg: 45 });
  const axial = page.getByRole('button', { name: 'Осьовий переріз', exact: true });
  await axial.click();
  await expect(entry(page, 'Зміщення від осі')).toHaveValue('0');
  await expect(entry(page, 'Напрям зміщення')).toHaveValue('45');
  await expect(axial).toBeDisabled();
  const onAxis = await download(page);
  expect(onAxis.json.sourceModel.section).toEqual({ type: 'axis-parallel', offsetPercent: 0, directionDeg: 45 });
  expect(errors).toEqual([]);
});

test('a cone’s plane through the apex held to its axis follows the cone, and downloads both parts', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення вершини').fill('0,7');
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Через вершину' });
  await page.getByRole('checkbox', { name: 'Осьовий переріз' }).check();
  await expect(entry(page, 'Кут до площини основи')).toHaveCount(0);
  await expect(page.getByText(/^Площина проходить через вершину й центр основи/)).toBeVisible();
  const first = await download(page);
  expect(first.objects).toEqual(['cone-part-1', 'cone-part-2']);
  expect(first.json.sourceModel.section).toMatchObject({ type: 'oblique-apex', axial: true });
  // A taller cone keeps the plane on its axis: the angle changes with it.
  await openSection(page, 'Висота');
  await entry(page, 'Висота h').fill('3');
  const taller = await download(page);
  expect(taller.json.sourceModel.section.axial).toBe(true);
  expect(taller.json.sourceModel.section.inclinationDeg).toBeGreaterThan(first.json.sourceModel.section.inclinationDeg);
  expect(errors).toEqual([]);
});
