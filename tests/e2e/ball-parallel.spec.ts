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
    fileName: file.suggestedFilename(),
    objects: readThreeMf(bytes).model.objects.map((object) => object.name),
    json: JSON.parse(readThreeMfPart(bytes, '3D/Other/model-settings.json') as string),
  };
}

test('a ball takes a second parallel cut, downloads three parts, and goes back to two without it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Куля' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Горизонтальний' });
  await entry(page, 'Зміщення від центра').fill('-30');
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  // The first plane keeps its position; the second starts halfway to the farther limit.
  await expect(entry(page, 'Перший переріз: зміщення від центра')).toHaveValue('-30');
  await expect(entry(page, 'Другий переріз: зміщення від центра')).toHaveValue('25');
  await expect(page.getByRole('checkbox', { name: 'Січна пластина' })).toBeDisabled();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  const three = await download(page);
  expect(three.fileName).toBe('ball-parallel-horizontal-sections.3mf');
  expect(three.objects.slice(0, 3)).toEqual(['ball-lower-part', 'ball-middle-part', 'ball-upper-part']);
  expect(three.objects.filter((name) => name.startsWith('ball-dowel-'))).toHaveLength(2);
  expect(three.json.sourceModel.section).toEqual({ type: 'horizontal', offsetPercent: -30, secondOffsetPercent: 25 });
  // Planes too close: the second field says so, and nothing is offered for download.
  await entry(page, 'Другий переріз: зміщення від центра').fill('-20');
  await expect(page.getByText(/Перерізи надто близько/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Прибрати другий переріз', exact: true }).click();
  await expect(entry(page, 'Зміщення від центра')).toHaveValue('-30');
  const two = await download(page);
  expect(two.objects.slice(0, 2)).toEqual(['ball-lower-part', 'ball-upper-part']);
  expect(two.json.sourceModel.section).toEqual({ type: 'horizontal', offsetPercent: -30 });
  expect(errors).toEqual([]);
});
