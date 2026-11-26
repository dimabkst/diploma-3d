import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { collectErrors, openAllSections, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const further = (page: Page) => page.getByRole('button', { name: 'Додаткові налаштування', exact: true });

async function download(page: Page) {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  return { bytes, json: JSON.parse(readThreeMfPart(bytes, '3D/Other/model-settings.json') as string) };
}

test('magnet pockets: three controls, the fit allowances behind a disclosure with their own reset, and the download', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await openAllSections(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Магнітні гнізда' });
  await expect(entry(page, 'Кількість пар магнітів')).toHaveValue('3');
  await expect(entry(page, 'Діаметр магніту, мм')).toHaveValue('6');
  await expect(entry(page, 'Товщина магніту, мм')).toHaveValue('2');
  await expect(page.getByText('Одна пара — два магніти, по одному в кожній частині.')).toBeVisible();
  // The allowances start collapsed; opening the disclosure shows them and the hole they give, and changes nothing else.
  await expect(further(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(entry(page, 'Запас за діаметром, мм')).toBeHidden();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await further(page).click();
  await expect(further(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(entry(page, 'Запас за діаметром, мм')).toHaveValue('0,2');
  await expect(entry(page, 'Запас за глибиною, мм')).toHaveValue('0,1');
  await expect(page.getByText('Розмір отвору: Ø6,20 × 2,10 мм')).toBeVisible();
  const restore = page.getByRole('button', { name: 'Відновити стандартні значення', exact: true });
  await expect(restore).toBeDisabled();
  await entry(page, 'Запас за діаметром, мм').fill('0,35');
  await entry(page, 'Кількість пар магнітів').fill('4');
  await expect(page.getByText('Розмір отвору: Ø6,35 × 2,10 мм')).toBeVisible();
  // The reset takes the two allowances back alone: the count stays as chosen.
  await restore.click();
  await expect(entry(page, 'Запас за діаметром, мм')).toHaveValue('0,2');
  await expect(entry(page, 'Кількість пар магнітів')).toHaveValue('4');
  await expect(restore).toBeDisabled();
  await further(page).click();
  await expect(entry(page, 'Запас за діаметром, мм')).toBeHidden();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const { bytes, json } = await download(page);
  expect(readThreeMf(bytes).model.objects.map((object) => object.name)).toEqual(['cylinder-lower-part', 'cylinder-upper-part']);
  expect(json.sourceModel.connector.settings).toEqual({
    type: 'magnet',
    count: 4,
    magnetDiameterMm: 6,
    magnetThicknessMm: 2,
    diameterAllowanceMm: 0.2,
    depthAllowanceMm: 0.1,
  });
  expect(json.sourceModel.connector.dimensions).toMatchObject({ holeDiameterMm: 6.2, holeDepthMm: 2.1, magnetsTotal: 8 });
  // A smaller model keeps the magnets' millimetres: 8 mm thick magnets no longer fit, which is said, kept, and not downloadable.
  await entry(page, 'Товщина магніту, мм').fill('8');
  await entry(page, 'Найбільший габарит').fill('20');
  await expect(page.getByText(/^Магніти задовгі для цього перерізу: нижня частина і верхня частина мають/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(entry(page, 'Товщина магніту, мм')).toHaveValue('8');
  await expect(entry(page, 'Кількість пар магнітів')).toHaveValue('4');
  await expect(partsButton(page)).toBeDisabled();
  expect(errors).toEqual([]);
});
