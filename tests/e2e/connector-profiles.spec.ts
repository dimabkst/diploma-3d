import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, measureMesh } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openSection, parameterSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const pinsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити лише штифти', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const SIZE = 'Діаметр вихідного кола, мм';

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

test('a new connector takes its dimensions from the section, for plugs and for dowels', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(entry(page, 'Профіль')).toHaveValue('flatted-circle');
  await expect(entry(page, SIZE)).toHaveValue('13,9');
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('24,25');
  await expect(entry(page, 'Збільшення отвору, мм')).toHaveValue('0,5');
  await expect(parameterSection(page, 'Кріплення').getByText('Значення 0,4 мм дає зазор 0,2 мм з кожного боку.')).toBeVisible();

  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expect(entry(page, 'Повна довжина штифта, мм')).toHaveValue('48,5');
  await expect(entry(page, 'Збільшення нижніх отворів, мм')).toHaveValue('0,4');
  await expect(entry(page, 'Збільшення верхніх отворів, мм')).toHaveValue('0,5');

  // Other proportions leave other room, whatever the longest dimension is.
  await entry(page, 'Висота h').fill('8');
  await expect(entry(page, SIZE)).not.toHaveValue('13,9');
  expect(errors).toEqual([]);
});

test('each profile says what its size measures, and is built', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  const group = parameterSection(page, 'Кріплення');
  await expect(entry(page, 'Профіль').locator('option')).toHaveText([
    'Круг',
    'Трикутник',
    'Квадрат',
    'Шестикутник',
    'Круг зі зрізаним боком',
  ]);
  for (const [label, size, note] of [
    ['Квадрат', 'Діаметр описаного кола, мм', 'Розмір — діаметр описаного кола, тобто діагональ квадрата.'],
    ['Трикутник', 'Діаметр описаного кола, мм', 'Розмір — діаметр описаного кола, а не довжина сторони.'],
    ['Шестикутник', 'Діаметр описаного кола, мм', 'Розмір — діаметр описаного кола, а не довжина сторони.'],
    ['Круг зі зрізаним боком', SIZE, 'Розмір — діаметр вихідного кола, з якого зрізано один бік.'],
  ] as const) {
    await entry(page, 'Профіль').selectOption({ label });
    await expect(entry(page, size)).toBeVisible();
    await expect(group.getByText(note)).toBeVisible();
    await expect(entry(page, 'Збільшення отвору, мм')).toBeVisible();
    await expectReady(page);
  }
  await entry(page, 'Профіль').selectOption({ label: 'Круг' });
  await expect(entry(page, 'Діаметр виступу, мм')).toBeVisible();
  await expect(entry(page, 'Збільшення діаметра отвору, мм')).toBeVisible();
  await expectReady(page);
  expect(errors).toEqual([]);
});

test('the size steps by 0,1 mm to the next grid value', async ({ page }) => {
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await entry(page, SIZE).fill('15,05');
  await entry(page, SIZE).blur();
  await expect(entry(page, SIZE)).toHaveValue('15,05');
  await page.getByRole('button', { name: `${SIZE}: зменшити`, exact: true }).click();
  await expect(entry(page, SIZE)).toHaveValue('15');
  await entry(page, SIZE).fill('15,05');
  await entry(page, SIZE).blur();
  await page.getByRole('button', { name: `${SIZE}: збільшити`, exact: true }).click();
  await expect(entry(page, SIZE)).toHaveValue('15,1');
  await page.getByRole('button', { name: `${SIZE}: збільшити`, exact: true }).click();
  await expect(entry(page, SIZE)).toHaveValue('15,2');
});

test('a value edited by hand is kept while it fits, corrected with a note when it does not, and returns', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  const group = parameterSection(page, 'Кріплення');
  await entry(page, 'Повна довжина штифта, мм').fill('60');
  await expectReady(page);

  await entry(page, 'Від нижньої основи').fill('60');
  await expect(entry(page, 'Повна довжина штифта, мм')).toHaveValue('60');
  await expect(group.getByRole('status')).toHaveCount(0);

  await entry(page, 'Від нижньої основи').fill('90');
  await expect(group.getByText(/^Довжину штифта зменшено до 17 мм через товщину частини\.$/)).toBeVisible();
  await expect(entry(page, 'Повна довжина штифта, мм')).toHaveValue('17');
  await expectReady(page);

  await entry(page, 'Від нижньої основи').fill('50');
  await expect(entry(page, 'Повна довжина штифта, мм')).toHaveValue('60');
  await expect(group.getByRole('status')).toHaveCount(0);
  await expectReady(page);
  expect(errors).toEqual([]);
});

test('the dowels alone are the assembly’s own, in a file named after them', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseTallCylinder(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await entry(page, 'Кількість').selectOption({ label: '2' });
  await expectReady(page);
  await expect(pinsButton(page)).toBeEnabled();

  const [assemblyFile] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const assembly = readThreeMf(new Uint8Array(await readFile(await assemblyFile.path()))).model.objects.slice(2);
  const [pinsFile] = await Promise.all([page.waitForEvent('download'), pinsButton(page).click()]);
  expect(pinsFile.suggestedFilename()).toMatch(/^dowels-flatted-circle-d[\d.]+-d[\d.]+-L[\d.]+mm\.3mf$/);
  const { model } = readThreeMf(new Uint8Array(await readFile(await pinsFile.path())));
  expect(model.unit).toBe('millimeter');
  expect(model.objects).toHaveLength(2);
  model.objects.forEach((pin, index) => {
    expect(findMeshDefects(pin.mesh)).toEqual([]);
    const same = assembly[index];
    if (same === undefined) throw new Error('The assembly has fewer pins.');
    expect(measureMesh(pin.mesh).size.map((size) => size.toFixed(3))).toEqual(
      measureMesh(same.mesh).size.map((size) => size.toFixed(3)),
    );
    expect(Array.from(pin.mesh.triangles)).toEqual(Array.from(same.mesh.triangles));
  });

  // Not while a newer model is on its way, and not for plugs, which belong to their part.
  await entry(page, 'Від нижньої основи').fill('45');
  await expect(pinsButton(page)).toBeDisabled();
  await expectReady(page);
  await expect(pinsButton(page)).toBeEnabled();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expect(pinsButton(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
