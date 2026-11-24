import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, measureMesh } from '../../packages/engine/src/mesh.ts';
import { collectErrors, dimensionsLine, openSection, parameterSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const action = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });
const SECOND = 'Другий переріз: положення';

async function expectReady(page: Page, size = '80 × 80 × 80 мм'): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
}

/** The print file's object names, each closed, and the section it records. */
async function download(page: Page) {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  const { model } = readThreeMf(bytes);
  for (const { mesh } of model.objects) expect(findMeshDefects(mesh)).toEqual([]);
  const settings = JSON.parse(readThreeMfPart(bytes, MODEL_SETTINGS_PATH) as string);
  return {
    fileName: file.suggestedFilename(),
    names: model.objects.map(({ name }) => name),
    volumes: model.objects.map(({ mesh }) => measureMesh(mesh).volume),
    section: settings.sourceModel.section,
  };
}

test('cylinder: a second plane parallel to the bases, on either side of the first, then removed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно основам' });
  await entry(page, 'Від нижньої основи').fill('30');
  await expectReady(page);
  await action(page, 'Додати паралельний переріз').click();
  await expect(entry(page, SECOND)).toHaveValue('60');
  await expect(entry(page, 'Від нижньої основи')).toHaveValue('30');
  await expect(parameterSection(page, 'Переріз').locator('summary')).toContainText('два перерізи');
  await expect(page.getByText('Перший переріз', { exact: true })).toBeVisible();
  await expectReady(page);
  const two = await download(page);
  expect(two.fileName).toBe('cylinder-two-parallel-sections.3mf');
  expect(two.names).toEqual(['cylinder-lower-part', 'cylinder-middle-part', 'cylinder-upper-part']);
  expect(two.section).toEqual({ type: 'parallel-to-bases', positionPercent: 30, secondPositionPercent: 60 });
  const whole = Math.PI * 40 ** 2 * 80;
  expect(two.volumes.reduce((sum, volume) => sum + volume, 0) / whole).toBeCloseTo(1, 2);
  // Below the first plane too: the parts are ordered along the normal, the section keeps its planes.
  await entry(page, SECOND).fill('15');
  await expectReady(page);
  const below = await download(page);
  expect(below.section).toEqual({ type: 'parallel-to-bases', positionPercent: 30, secondPositionPercent: 15 });
  // Too close to the first plane: said at the second plane's field, nothing built from it.
  await entry(page, SECOND).fill('32');
  await expect(page.getByText(/^Одна з частин біля другого перерізу була б завтовшки лише/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, SECOND).fill('60');
  await expectReady(page);
  await action(page, 'Прибрати другий переріз').click();
  await expect(entry(page, SECOND)).toHaveCount(0);
  await expect(entry(page, 'Від нижньої основи')).toHaveValue('30');
  await expectReady(page);
  const one = await download(page);
  expect(one.names).toEqual(['cylinder-lower-part', 'cylinder-upper-part']);
  expect(one.section).toEqual({ type: 'parallel-to-bases', positionPercent: 30 });
  expect(errors).toEqual([]);
});

test('cone: a plane through the apex and a parallel second plane off it, joined by dowels at both', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Через вершину' });
  await expectReady(page);
  const angle = await entry(page, 'Кут до площини основи').inputValue();
  await action(page, 'Додати паралельний переріз').click();
  await expectReady(page);
  await expect(entry(page, 'Кут до площини основи')).toHaveValue(angle);
  await openSection(page, 'Кріплення');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expectReady(page);
  const joined = await download(page);
  expect(joined.fileName).toBe('cone-two-apex-sections.3mf');
  expect(joined.names.slice(0, 3)).toEqual(['cone-part-1', 'cone-middle-part', 'cone-part-2']);
  expect(joined.names.filter((name) => name.includes('dowel'))).toHaveLength(2);
  expect(joined.section).toMatchObject({ type: 'oblique-apex', secondPositionPercent: expect.any(Number) });
  expect(errors).toEqual([]);
});
