import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, type MeshMeasurements, measureMesh } from '../../packages/engine/src/mesh.ts';
import { collectErrors, dimensionsLine, openSection, parameterSection, previewViewport, shapeSelect } from './helpers.ts';

const GENERATRIX = 'Положення спільної твірної';
const PAIR = 'Повернути обидва перерізи';
const ALTERNATIVE = 'Інше положення другої площини';
const DIHEDRAL = 'Кут між площинами';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const checkbox = (page: Page, label: string) => page.getByRole('checkbox', { name: label, exact: true });
const labels = (page: Page) => page.locator('model-viewer .point-label');
const action = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });
const diagram = (page: Page) => page.getByRole('figure').filter({ hasText: 'Нижня основа згори' });

async function chooseLinked(page: Page, leaning = false): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  if (leaning) {
    await openSection(page, 'Нахил');
    await entry(page, 'Зміщення верхньої основи').fill('0,8');
  }
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Через спільну твірну' });
}

async function expectReady(page: Page): Promise<void> {
  await expect(dimensionsLine(page)).toContainText('Габарити в зборі:', { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
}

/** Downloads the print file: closed objects on the bed, in millimetres. */
async function download(page: Page, fileName: string): Promise<{ names: string[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(file.suggestedFilename()).toBe(fileName);
  const { model } = readThreeMf(new Uint8Array(await readFile(await file.path())));
  expect(model.unit).toBe('millimeter');
  const objects = model.objects.map(({ mesh }) => {
    expect(findMeshDefects(mesh)).toEqual([]);
    return measureMesh(mesh);
  });
  for (const object of objects) expect(object.bounds.min[2]).toBe(0);
  return { names: model.objects.map(({ name }) => name), objects };
}

test('cylinder: two planes through a shared generatrix, then a third through the other two, exported as separate parts', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseLinked(page);
  await expectReady(page);
  await expect(entry(page, PAIR)).toHaveValue(/^[-−]30$/);
  await expect(entry(page, DIHEDRAL)).toHaveValue('60');
  await expect(parameterSection(page, 'Переріз').locator('summary')).toContainText('два перерізи');
  // The generatrix waits among the further settings.
  await expect(entry(page, GENERATRIX)).toBeHidden();
  await page.getByText('Додаткові налаштування', { exact: true }).click();
  await expect(entry(page, GENERATRIX)).toHaveValue('0');
  // The lower base: A, B and C, AB and AC, no BC without the third plane.
  await expect(diagram(page).locator('text')).toHaveText(['A', 'B', 'C']);
  await expect(diagram(page).locator('line')).toHaveCount(2);
  // From −30° by 60° the other way would be the tangent plane: no alternative to offer. No parallel second cut either.
  await expect(action(page, ALTERNATIVE)).toHaveCount(0);
  await expect(checkbox(page, 'Інший бік')).toHaveCount(0);
  await expect(checkbox(page, 'Додати паралельний переріз')).toHaveCount(0);
  await expect(page.getByText('Третя площина проходить через дві інші твірні.')).toBeVisible();
  // Apart, the shared generatrix AA₁ is on three parts, BB₁ and CC₁ on two each.
  await expect(labels(page)).toHaveText(['A', 'A', 'A', 'A₁', 'A₁', 'A₁', 'B', 'B', 'B₁', 'B₁', 'C', 'C', 'C₁', 'C₁'], {
    timeout: 30_000,
  });
  const two = await download(page, 'cylinder-two-shared-generatrix-sections.3mf');
  expect(two.names).toEqual(['cylinder-middle-part', 'cylinder-part-1', 'cylinder-part-2']);
  const whole = Math.PI * 40 ** 2 * 80;
  expect(two.objects.reduce((sum, object) => sum + object.volume, 0) / whole).toBeCloseTo(1, 2);
  // Assembled, each generatrix is one label.
  await checkbox(page, 'Розсунути частини').uncheck();
  await expect(labels(page)).toHaveText(['A', 'A₁', 'B', 'B₁', 'C', 'C₁'], { timeout: 30_000 });
  await checkbox(page, 'Розсунути частини').check();

  await checkbox(page, 'Додати третій переріз').check();
  await expect(parameterSection(page, 'Переріз').locator('summary')).toContainText('три перерізи');
  await expect(diagram(page).locator('line')).toHaveCount(3);
  await expectReady(page);
  const three = await download(page, 'cylinder-three-shared-generatrix-sections.3mf');
  expect(three.names).toEqual(['cylinder-middle-part', 'cylinder-part-1', 'cylinder-part-2', 'cylinder-part-3']);
  expect(three.objects.reduce((sum, object) => sum + object.volume, 0) / whole).toBeCloseTo(1, 2);
  // The middle part is the equilateral triangular prism inscribed in the base circle.
  expect((three.objects[0]?.volume ?? 0) / (((3 * Math.sqrt(3)) / 4) * 40 ** 2 * 80)).toBeCloseTo(1, 2);

  // One connector setting joins every outer part to the middle one at its own plane.
  await openSection(page, 'Кріплення');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expectReady(page);
  const joined = await download(page, 'cylinder-three-shared-generatrix-sections.3mf');
  expect(joined.names).toEqual(['cylinder-middle-part', 'cylinder-part-1', 'cylinder-part-2', 'cylinder-part-3']);
  expect(errors).toEqual([]);
});

test('cylinder: the pair turns with its button over the second plane’s tangent position, its solution kept', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseLinked(page);
  await expectReady(page);
  const raise = page.getByRole('button', { name: `${PAIR}: збільшити`, exact: true });
  // At 30° the second plane, 60° from the first, would be tangent: the buttons pass over the narrow gap about it.
  for (const expected of ['-25', '-20', '-15', '-10', '-5', '0', '5', '10', '15', '20', '25', /^33[,.]\d+$/, '35']) {
    await raise.click();
    await expect(entry(page, PAIR)).toHaveValue(expected);
  }
  await expect(entry(page, DIHEDRAL)).toHaveValue('60');
  await expectReady(page);
  const { names } = await download(page, 'cylinder-two-shared-generatrix-sections.3mf');
  expect(names).toEqual(['cylinder-middle-part', 'cylinder-part-1', 'cylinder-part-2']);
  // Typed at the tangent position: refused there, nothing else changed, the last valid model kept on screen.
  await entry(page, PAIR).fill('30');
  await expect(page.getByText(/^За цього повороту одна з площин лише торкається циліндра/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, DIHEDRAL)).toHaveValue('60');
  await expect(diagram(page).locator('text')).toHaveText(['A', 'B', 'C']);
  expect(errors).toEqual([]);
});

test('cylinder: the other second plane is an explicit action, previewed while hovered, and changes nothing else', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseLinked(page);
  await expectReady(page);
  await action(page, 'Перший переріз — осьовий').click();
  await expect(entry(page, PAIR)).toHaveValue('0');
  await entry(page, DIHEDRAL).fill('40');
  await expectReady(page);
  const alternative = action(page, ALTERNATIVE);
  await expect(diagram(page).locator('.alternative')).toHaveCount(0);
  await alternative.hover();
  await expect(diagram(page).locator('.alternative')).toHaveCount(2);
  await alternative.click();
  await expectReady(page);
  await expect(entry(page, PAIR)).toHaveValue('0');
  await expect(entry(page, DIHEDRAL)).toHaveValue('40');
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const settings = JSON.parse(readThreeMfPart(new Uint8Array(await readFile(await file.path())), MODEL_SETTINGS_PATH) as string);
  expect(settings.sourceModel.section).toMatchObject({ firstPlaneDeg: 0, dihedralDeg: 40, otherSide: true });
  // At 90° both second planes are one: nothing to offer. With the first plane axial, that one would be tangent: the problem is
  // said at the angle just typed.
  await entry(page, DIHEDRAL).fill('90');
  await expect(page.getByText(/^За цього кута друга площина лише торкається циліндра/)).toBeVisible();
  await entry(page, PAIR).fill('-45');
  await expectReady(page);
  await expect(alternative).toHaveCount(0);
  // Focusing the generatrix highlights AA₁ in the preview.
  await page.getByText('Додаткові налаштування', { exact: true }).click();
  await entry(page, GENERATRIX).focus();
  await expect(page.locator('model-viewer .point-label.highlighted').first()).toBeVisible();
  const highlighted = await page.locator('model-viewer .point-label.highlighted').allTextContents();
  expect(new Set(highlighted)).toEqual(new Set(['A', 'A₁']));
  expect(errors).toEqual([]);
});

test('cylinder: the planes through a shared generatrix of a leaning cylinder start from its own generatrices', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseLinked(page, true);
  await expectReady(page);
  // A lean changes the angles of the planes through the same generatrices 120° apart.
  await expect(entry(page, DIHEDRAL)).not.toHaveValue('60');
  // A small angle between the planes is a valid section: built, with a warning about the thin part.
  await entry(page, DIHEDRAL).fill('1');
  await expectReady(page);
  await expect(page.getByText(/має завтовшки лише .* мм — її може не вдатися надрукувати/)).toBeVisible();
  await entry(page, DIHEDRAL).fill('50');
  await expectReady(page);
  const { names } = await download(page, 'cylinder-two-shared-generatrix-sections.3mf');
  expect(names).toEqual(['cylinder-middle-part', 'cylinder-part-1', 'cylinder-part-2']);
  expect(errors).toEqual([]);
});
