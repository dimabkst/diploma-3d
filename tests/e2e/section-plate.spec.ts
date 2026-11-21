import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { collectErrors, openSection, previewViewport, shapeSelect } from './helpers.ts';

const SETTINGS = '3D/Other/model-settings.json';
const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function download(page: Page, button: ReturnType<Page['getByRole']>) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  return {
    fileName: file.suggestedFilename(),
    objects: readThreeMf(bytes).model.objects.map((object) => object.name),
    json: JSON.parse(readThreeMfPart(bytes, SETTINGS) as string),
  };
}

async function coneWithParallelCut(page: Page) {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основі' });
}

test('a plate with dowels downloads as three parts and dowels, and the dowels alone with the plate in their length', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await coneWithParallelCut(page);
  const plate = page.getByRole('checkbox', { name: 'Січна пластина' });
  await expect(plate).not.toBeChecked();
  await plate.check();
  await expect(entry(page, 'Товщина пластини, мм')).toHaveValue('1,6');
  await expect(entry(page, 'Виступ за межі фігури, мм')).toHaveValue('10');
  await entry(page, 'Товщина пластини, мм').fill('2');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const parts = await download(page, partsButton(page));
  expect(parts.fileName).toBe('cone-parallel-section-plate.3mf');
  expect(parts.objects).toEqual(['cone-lower-part', 'cone-upper-part', 'cone-section-plate', 'cone-dowel-1']);
  expect(parts.json.sourceModel.section).toEqual({
    type: 'parallel-to-bases',
    positionPercent: 50,
    plate: { thicknessMm: 2, marginMm: 10 },
  });
  const dimensions = parts.json.sourceModel.connector.dimensions;
  expect(dimensions.dowelLengthMm).toBeCloseTo(2 * dimensions.engagementMm + 2, 9);
  const pins = await download(page, page.getByRole('button', { name: 'Завантажити лише штифти', exact: true }));
  expect(pins.objects).toEqual(['cone-dowel-1']);
  expect(pins.fileName).toMatch(new RegExp(`-L${Number(dimensions.dowelLengthMm.toFixed(3))}mm\\.3mf$`));
  expect(pins.json.exportedParts.pins[0].lengthMm).toBe(dimensions.dowelLengthMm);
  expect(errors).toEqual([]);
});

test('a thickness beyond what the cone leaves is the field’s error and blocks the download', async ({ page }) => {
  const errors = collectErrors(page);
  await coneWithParallelCut(page);
  await page.getByRole('checkbox', { name: 'Січна пластина' }).check();
  await entry(page, 'Найбільший габарит').fill('20');
  await entry(page, 'Висота h').fill('0,5');
  await entry(page, 'Товщина пластини, мм').fill('3');
  await expect(page.getByText('За цього положення перерізу допустимо від 1,2 мм до 2,6 мм')).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, 'Товщина пластини, мм').fill('2,6');
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  // Turned off, the cut is the plain one again, whatever the plate's fields hold.
  await page.getByRole('checkbox', { name: 'Січна пластина' }).uncheck();
  await expect(entry(page, 'Товщина пластини, мм')).toHaveCount(0);
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  expect((await download(page, partsButton(page))).objects).toEqual(['cone-lower-part', 'cone-upper-part']);
  expect(errors).toEqual([]);
});

test('a vertical cut keeps its plate and connector when the cut changes, and downloads both numbered parts with it', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await coneWithParallelCut(page);
  await page.getByRole('checkbox', { name: 'Січна пластина' }).check();
  await entry(page, 'Товщина пластини, мм').fill('2');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  // The plate, its thickness and the connector stay; the groove may open at the bottom, away from the apex.
  await expect(page.getByRole('checkbox', { name: 'Січна пластина' })).toBeChecked();
  await expect(entry(page, 'Товщина пластини, мм')).toHaveValue('2');
  await expect(entry(page, 'Тип кріплення')).toHaveValue('dovetail');
  await entry(page, 'Вхід у паз').selectOption({ label: 'Знизу' });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const parts = await download(page, partsButton(page));
  expect(parts.fileName).toBe('cone-vertical-section-plate.3mf');
  expect(parts.objects).toEqual(['cone-part-1', 'cone-part-2', 'cone-section-plate']);
  expect(parts.json.sourceModel.section).toEqual({
    type: 'vertical',
    offsetPercent: 0,
    plate: { thicknessMm: 2, marginMm: 10 },
  });
  expect(parts.json.sourceModel.connector.settings).toMatchObject({ type: 'dovetail', entrance: 'opposite' });
  expect(errors).toEqual([]);
});

test('a ball’s horizontal cut takes a plate with plugs, and downloads both parts with it', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Куля' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Горизонтальний' });
  await page.getByRole('checkbox', { name: 'Січна пластина' }).check();
  await entry(page, 'Товщина пластини, мм').fill('2,4');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const parts = await download(page, partsButton(page));
  expect(parts.fileName).toBe('ball-horizontal-section-plate.3mf');
  expect(parts.objects).toEqual(['ball-lower-part', 'ball-upper-part', 'ball-section-plate']);
  expect(parts.json.sourceModel.section).toEqual({
    type: 'horizontal',
    offsetPercent: 0,
    plate: { thicknessMm: 2.4, marginMm: 10 },
  });
  const dimensions = parts.json.sourceModel.connector.dimensions;
  expect(dimensions.plugHeightMm).toBeCloseTo(dimensions.engagementMm + 2.4, 9);
  expect(errors).toEqual([]);
});

test('a cylinder’s vertical cut takes a plate with dowels, which turns the twist connector off, and downloads parts, plate and dowels', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  // A twist connector chosen before the plate gives way to none, said so.
  await entry(page, 'Тип кріплення').selectOption({ label: 'Поворотне з’єднання' });
  await page.getByRole('checkbox', { name: 'Січна пластина' }).check();
  await expect(entry(page, 'Тип кріплення')).toHaveValue('none');
  await expect(page.getByText('Поворотне з’єднання не працює із січною пластиною, тому обрано «Без кріплення».')).toBeVisible();
  await expect(entry(page, 'Тип кріплення').locator('option[value="twist"]')).toBeDisabled();
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  await expect(page.getByRole('checkbox', { name: 'Січна пластина' })).toBeChecked();
  await entry(page, 'Товщина пластини, мм').fill('2');
  await expect(page.getByText('Знизу пластина обрізається по рівню основи фігури.')).toBeVisible();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const parts = await download(page, partsButton(page));
  expect(parts.fileName).toBe('cylinder-vertical-section-plate.3mf');
  expect(parts.objects).toEqual(['cylinder-part-1', 'cylinder-part-2', 'cylinder-section-plate', 'cylinder-dowel-1']);
  expect(parts.json.sourceModel.section).toEqual({ type: 'vertical', offsetPercent: 0, plate: { thicknessMm: 2, marginMm: 10 } });
  const dimensions = parts.json.sourceModel.connector.dimensions;
  expect(dimensions.dowelLengthMm).toBeCloseTo(2 * dimensions.engagementMm + 2, 9);
  const pins = await download(page, page.getByRole('button', { name: 'Завантажити лише штифти', exact: true }));
  expect(pins.objects).toEqual(['cylinder-dowel-1']);
  expect(pins.json.exportedParts.pins[0].lengthMm).toBe(dimensions.dowelLengthMm);
  expect(errors).toEqual([]);
});
