import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { collectErrors, downloadButton, openSection, previewViewport, shapeSelect } from './helpers.ts';

const SETTINGS = '3D/Other/model-settings.json';
const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function settingsOf(page: Page, button: ReturnType<Page['getByRole']>) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const text = readThreeMfPart(new Uint8Array(await readFile(await download.path())), SETTINGS);
  expect(text).toBeDefined();
  return { fileName: download.suggestedFilename(), json: JSON.parse(text as string) };
}

test('a plain body’s file records the figure and the size it was generated at', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  const { fileName, json } = await settingsOf(page, downloadButton(page));
  expect(fileName).toBe('cube.3mf');
  expect(json).toMatchObject({ schemaVersion: 2, export: { kind: 'model' }, sourceModel: { shape: { kind: 'cube' } } });
  expect(json.sourceModel.bodyDimensions).toEqual({ edgeMm: 80 });
  expect(errors).toEqual([]);
});

test('the parts and the dowels record the latest generated model, never an earlier request', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  // Two sizes in quick succession: the first generation, if it finishes at all, is outdated.
  await entry(page, 'Найбільший габарит').fill('100');
  await entry(page, 'Найбільший габарит').fill('120');
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const parts = await settingsOf(page, partsButton(page));
  expect(parts.fileName).toBe('cylinder-parallel-section.3mf');
  expect(parts.json.export.kind).toBe('model');
  expect(parts.json.sourceModel.longestDimensionMm).toBe(120);
  expect(parts.json.sourceModel.connector).toMatchObject({ settings: { type: 'dowel' } });
  expect(parts.json.sourceModel.connector.dimensions.dowelLengthMm).toBeGreaterThan(0);
  const pins = await settingsOf(page, page.getByRole('button', { name: 'Завантажити лише штифти', exact: true }));
  expect(pins.fileName).toMatch(/^dowels-flatted-circle-d[\d.]+-L[\d.]+mm\.3mf$/);
  expect(pins.json.export.kind).toBe('pins');
  expect(pins.json.sourceModel).toEqual(parts.json.sourceModel);
  expect(errors).toEqual([]);
});
