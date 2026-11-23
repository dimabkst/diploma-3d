import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, type MeshMeasurements, measureMesh } from '../../packages/engine/src/mesh.ts';
import {
  collectErrors,
  dimensionsLine,
  type ModelViewerElement,
  modelViewer,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const POSITION = 'Точка на осі від основи';
const ANGLE = 'Кут до площини основи';
const DIRECTION = 'Напрям нахилу';
const CUT = 'Тип перерізу';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });
const button = (page: Page, label: string, action: 'збільшити' | 'зменшити') =>
  page.getByRole('button', { name: `${label}: ${action}`, exact: true });

async function chooseCut(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
}

async function chooseApex(page: Page): Promise<void> {
  await chooseCut(page);
  await entry(page, CUT).selectOption({ label: 'Через вершину' });
}

async function expectReady(page: Page, size = '80 × 80 × 80 мм'): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the print file: closed objects on the bed, 5 mm apart along X, in millimetres. */
async function download(page: Page, fileName: string): Promise<{ names: string[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(file.suggestedFilename()).toBe(fileName);
  const { model } = readThreeMf(new Uint8Array(await readFile(await file.path())));
  expect(model.unit).toBe('millimeter');
  const objects = model.objects.map(({ mesh }) => {
    expect(findMeshDefects(mesh)).toEqual([]);
    return measureMesh(mesh);
  });
  objects.forEach((object, index) => {
    expect(object.bounds.min[2]).toBe(0);
    if (index > 0) expect(Math.abs(object.bounds.min[0] - (objects[index - 1]?.bounds.max[0] ?? 0) - 5)).toBeLessThan(1e-3);
  });
  return { names: model.objects.map(({ name }) => name), objects };
}

test('cone: an oblique section passes through a point on the axis; through the apex is a section type of its own', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseCut(page);
  await expectReady(page);
  // No nested choice of what the plane passes through.
  await expect(entry(page, 'Площина проходить через')).toHaveCount(0);
  expect(await entry(page, CUT).locator('option').allTextContents()).toEqual([
    'Без перерізу',
    'Паралельно основі',
    'Вертикальний',
    'Похилий',
    'Через вершину',
  ]);
  await expect(entry(page, POSITION)).toHaveValue('50');
  await expect(entry(page, ANGLE)).toHaveValue('45');
  await expect(entry(page, DIRECTION)).toHaveValue('0');
  await expect(slider(page, ANGLE)).toHaveAttribute('max', '85');
  const { names, objects } = await download(page, 'cone-oblique-section.3mf');
  expect(names).toEqual(['cone-part-1', 'cone-part-2']);
  expect(objects).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('through the apex the position hides, a valid angle starts, and 90° and the dynamic lower end are reachable', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseApex(page);
  await expectReady(page);
  await expect(entry(page, POSITION)).toHaveCount(0);
  // The middle of 68,2–90°, in steps of 5.
  await expect(entry(page, ANGLE)).toHaveValue('80');
  await expect(entry(page, DIRECTION)).toHaveValue('0');
  await expect(slider(page, ANGLE)).toHaveAttribute('min', '68.2');
  await expect(slider(page, ANGLE)).toHaveAttribute('max', '90');
  await slider(page, ANGLE).focus();
  await page.keyboard.press('End');
  await expect(entry(page, ANGLE)).toHaveValue('90');
  await expect(button(page, ANGLE, 'збільшити')).toBeDisabled();
  await expectReady(page);
  await slider(page, ANGLE).focus();
  await page.keyboard.press('Home');
  await expect(entry(page, ANGLE)).toHaveValue('68,2');
  await expect(button(page, ANGLE, 'зменшити')).toBeDisabled();
  await expectReady(page);
  await entry(page, ANGLE).fill('75');
  await expectReady(page);
  const { names, objects } = await download(page, 'cone-apex-section.3mf');
  expect(names).toEqual(['cone-part-1', 'cone-part-2']);
  // Both parts keep the apex: the full height each, standing on what they keep of the base.
  for (const object of objects) expect(object.size[2]).toBeCloseTo(80, 2);
  expect(errors).toEqual([]);
});

test('an angle that only touches the cone keeps its value, explains itself and blocks the export', async ({ page }) => {
  await chooseApex(page);
  await expectReady(page);
  await entry(page, ANGLE).fill('45');
  const error = page.locator('#coneApexInclinationDeg-error');
  await expect(error).toContainText('лише торкається конуса');
  await expect(error).toContainText('від 68,2° до 90°');
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, ANGLE)).toHaveValue('45');
  await entry(page, ANGLE).fill('65');
  await expect(error).toContainText('надто тонкою');
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, ANGLE).fill('91');
  await expect(page.getByText('Кут має бути більшим за 0° і не більшим за 90°.')).toBeVisible();
  await entry(page, ANGLE).fill('70');
  await expectReady(page);
});

test('first entry on an oblique cone takes a valid angle for that cone', async ({ page }) => {
  await chooseCut(page);
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення вершини').fill('1');
  await entry(page, CUT).selectOption({ label: 'Через вершину' });
  await expect(entry(page, ANGLE)).toHaveValue('65');
  await expect(entry(page, DIRECTION)).toHaveValue('0');
  await expectReady(page);
  await expect(slider(page, ANGLE)).toHaveAttribute('max', '84.28');
});

test('a direction against a strong lean has no angle at all: the slider is off, and nothing is changed for the user', async ({
  page,
}) => {
  await chooseApex(page);
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення вершини').fill('1');
  await expectReady(page);
  await expect(entry(page, ANGLE)).toHaveValue('80');
  await entry(page, DIRECTION).fill('180');
  await expect(page.locator('#coneApexDirectionDeg-error')).toContainText('не ділить конус на дві придатні частини');
  await expect(slider(page, ANGLE)).toBeDisabled();
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, DIRECTION)).toHaveValue('180');
  await expect(entry(page, ANGLE)).toHaveValue('80');
  await entry(page, DIRECTION).fill('0');
  await expectReady(page);
  await expect(entry(page, ANGLE)).toHaveValue('80');
});

test('switching between the inclined and the apex section destroys neither’s settings, and a reset starts over with the size kept', async ({
  page,
}) => {
  await chooseCut(page);
  await entry(page, POSITION).fill('30');
  await entry(page, ANGLE).fill('20');
  await entry(page, CUT).selectOption({ label: 'Через вершину' });
  await expect(entry(page, ANGLE)).toHaveValue('80');
  await entry(page, ANGLE).fill('85');
  await entry(page, CUT).selectOption({ label: 'Похилий' });
  await expect(entry(page, POSITION)).toHaveValue('30');
  await expect(entry(page, ANGLE)).toHaveValue('20');
  await entry(page, CUT).selectOption({ label: 'Через вершину' });
  await expect(entry(page, ANGLE)).toHaveValue('85');
  await entry(page, 'Найбільший габарит').fill('160');
  await expectReady(page, '160 × 160 × 160 мм');
  await expect(entry(page, ANGLE)).toHaveValue('85');
  await page.getByRole('button', { name: 'Скинути параметри фігури' }).click();
  await expect(entry(page, 'Найбільший габарит')).toHaveValue('160');
  await expect(entry(page, 'Тип перерізу')).toHaveValue('none');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
  await expect(entry(page, POSITION)).toHaveValue('50');
  await entry(page, CUT).selectOption({ label: 'Через вершину' });
  await expect(entry(page, ANGLE)).toHaveValue('80');
});

test('the plane through a point holds the whole axis at the right angle: the position turns off, with the note', async ({
  page,
}) => {
  await chooseCut(page);
  await entry(page, POSITION).fill('30');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення вершини').fill('2');
  await expectReady(page, '80 × 53,3 × 53,3 мм');
  await expect(
    page.getByText('Площина містить усю вісь конуса, тому положення точки за висотою не змінює переріз.'),
  ).toBeVisible();
  await expect(entry(page, POSITION)).toBeDisabled();
  await expect(entry(page, POSITION)).toHaveValue('30');
});

for (const [connector, count, objectCount] of [
  ['Ластівчин хвіст', undefined, 2],
  ['Виступ і отвір', '1', 2],
  ['Виступ і отвір', '2', 2],
  ['Знімні штифти', '1', 3],
  ['Знімні штифти', '2', 4],
] as const) {
  test(`${connector}${count === undefined ? '' : ` × ${count}`}: separate objects, through the apex and through a point`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await chooseApex(page);
    await entry(page, ANGLE).fill('85');
    await expectReady(page);
    await entry(page, 'Тип кріплення').selectOption({ label: connector });
    if (count !== undefined) await entry(page, 'Кількість').selectOption({ label: count });
    await expectReady(page);
    expect((await download(page, 'cone-apex-section.3mf')).objects).toHaveLength(objectCount);
    await entry(page, CUT).selectOption({ label: 'Похилий' });
    await entry(page, POSITION).fill('40');
    await entry(page, ANGLE).fill('30');
    await expectReady(page);
    expect((await download(page, 'cone-oblique-section.3mf')).objects).toHaveLength(objectCount);
    expect(errors).toEqual([]);
  });
}

test('a hole too deep for the narrowing cone keeps its settings, explains itself and blocks the export', async ({ page }) => {
  await chooseApex(page);
  await entry(page, ANGLE).fill('85');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expectReady(page);
  await entry(page, 'Висота виступу, мм').fill('28');
  await expect(
    parameterSection(page, 'Кріплення')
      .getByText(/змініть кут чи напрям площини/)
      .first(),
  ).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await expect(entry(page, 'Висота виступу, мм')).toHaveValue('28');
  await entry(page, 'Висота виступу, мм').fill('6');
  await expectReady(page);
});

test('separating moves part 2 along the normal, or part 1 uphill past the groove, only in the preview', async ({ page }) => {
  const size = async () => {
    const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
    return [x * 1000, y * 1000, z * 1000] as const;
  };
  await chooseApex(page);
  await entry(page, ANGLE).fill('90');
  await expectReady(page);
  // n = −X at 90°: 80 mm plus the 12 mm gap along glTF X, the height unchanged.
  await expect.poll(async () => (await size())[0], { timeout: 30_000 }).toBeGreaterThan(90);
  expect((await size())[1]).toBeLessThan(82);
  await page.getByRole('checkbox', { name: 'Розсунути частини', exact: true }).uncheck();
  await expect.poll(async () => (await size())[0]).toBeLessThan(82);
  await page.getByRole('checkbox', { name: 'Розсунути частини', exact: true }).check();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expectReady(page);
  // u = +Z at 90°: part 1 rises past the groove.
  await expect.poll(async () => (await size())[1], { timeout: 30_000 }).toBeGreaterThan(100);
  await parameterSection(page, 'Кріплення').getByText('Як працює кріплення?').click();
  await expect(parameterSection(page, 'Кріплення').getByText(/вгору по схилу/)).toBeVisible();
  await expect(parameterSection(page, 'Кріплення').getByText(/помітна виїмка для входу в паз/)).toBeVisible();
});

test('the compass shows the direction of both placements', async ({ page }) => {
  await chooseApex(page);
  await expectReady(page);
  await expect(page.locator('[data-direction]')).toHaveAttribute('data-direction', '0');
  await entry(page, DIRECTION).fill('90');
  await expectReady(page);
  await expect(page.locator('[data-direction]')).toHaveAttribute('data-direction', '90');
});

test('on a narrow phone every field is reachable and the page fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseApex(page);
  await entry(page, ANGLE).fill('85');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await entry(page, 'Кількість').selectOption({ label: '2' });
  await entry(page, CUT).scrollIntoViewIfNeeded();
  await expect(entry(page, CUT)).toBeInViewport();
  for (const label of [
    ANGLE,
    DIRECTION,
    'Діаметр вихідного кола, мм',
    'Від центра до осі кріплення, мм',
    'Повна довжина штифта, мм',
  ]) {
    await slider(page, label).scrollIntoViewIfNeeded();
    await expect(slider(page, label)).toBeInViewport();
    await expect(entry(page, label)).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('through the apex from the main selector: the plane keeps the apex as the cone grows and leans, with its connector and view', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseApex(page);
  await expect(entry(page, 'Площина проходить через')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Осьовий переріз' })).toBeVisible();
  await expect(entry(page, POSITION)).toHaveCount(0);
  await expect(entry(page, ANGLE)).toHaveValue('80');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Виступ і отвір' });
  await expectReady(page);
  const right = await download(page, 'cone-apex-section.3mf');
  expect(right.objects).toHaveLength(2);
  // Taller and leaning: the same kind of plane, through the apex wherever it now is, the connector and separation kept.
  await openSection(page, 'Висота');
  await entry(page, 'Висота h').fill('3');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення вершини').fill('0,5');
  await expectReady(page, '53,3 × 53,3 × 80 мм');
  await expect(entry(page, 'Тип перерізу')).toHaveValue('oblique-apex');
  await expect(entry(page, 'Тип кріплення')).toHaveValue('plug');
  await expect(page.getByRole('checkbox', { name: 'Розсунути частини', exact: true })).toBeChecked();
  expect((await download(page, 'cone-apex-section.3mf')).objects).toHaveLength(2);
  // Back and forth: each type keeps its own fields, and the inclined one has no apex left in it.
  for (let round = 0; round < 2; round += 1) {
    await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
    await expect(entry(page, POSITION)).toHaveValue('50');
    await expect(page.getByRole('checkbox', { name: 'Осьовий переріз' })).toHaveCount(0);
    await entry(page, 'Тип перерізу').selectOption({ label: 'Через вершину' });
    await expect(entry(page, ANGLE)).toBeVisible();
  }
  expect(errors).toEqual([]);
});
