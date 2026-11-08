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

const POSITION = 'Точка на осі від нижньої основи';
const ANGLE = 'Кут до площини основи';
const DIRECTION = 'Напрям нахилу';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const slider = (page: Page, label: string) => page.getByRole('slider', { name: `${label}: повзунок`, exact: true });
const separation = (page: Page) => page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
const compass = (page: Page) => page.locator('[data-direction]');

async function chooseOblique(page: Page): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
}

async function expectReady(page: Page, size = '80 × 80 × 80 мм'): Promise<void> {
  await expect(dimensionsLine(page)).toHaveText(`Габарити в зборі: ${size}`, { timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled();
}

/** Downloads the print file: closed objects on the bed, 5 mm apart along X. */
async function download(page: Page): Promise<{ names: string[]; objects: MeshMeasurements[] }> {
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  expect(file.suggestedFilename()).toBe('cylinder-oblique-section.3mf');
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

const viewerSize = async (page: Page) => {
  const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  return [x * 1000, y * 1000, z * 1000] as const;
};

test('cylinder: an oblique section starts at the default plane and exports two parts at their own size', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseOblique(page);
  await expectReady(page);
  await expect(entry(page, POSITION)).toHaveValue('50');
  await expect(entry(page, ANGLE)).toHaveValue('45');
  await expect(entry(page, DIRECTION)).toHaveValue('0');
  await expect(parameterSection(page, 'Переріз').locator('summary')).toContainText('похилий');
  const options = await entry(page, 'Тип перерізу').locator('option').allTextContents();
  expect(options).toEqual(['Без перерізу', 'Паралельно основам', 'Вертикальний', 'Похилий']);
  const { names, objects } = await download(page);
  expect(names).toEqual(['cylinder-part-1', 'cylinder-part-2']);
  // Each part stands on the base it kept: 80 mm wide and deep, and the cut's ends rise to the whole height.
  for (const object of objects) {
    expect(object.size[0]).toBeCloseTo(80, 1);
    expect(object.size[1]).toBeCloseTo(80, 1);
    expect(object.size[2]).toBeCloseTo(80, 1);
  }
  const whole = Math.PI * 40 ** 2 * 80;
  expect(((objects[0]?.volume ?? 0) + (objects[1]?.volume ?? 0)) / whole).toBeCloseTo(1, 2);
  expect(errors).toEqual([]);
});

test('its fields keep the slider’s bounds and steps, and typed values within them', async ({ page }) => {
  await chooseOblique(page);
  await expectReady(page);
  await page.getByRole('button', { name: `${ANGLE}: збільшити`, exact: true }).click();
  await expect(entry(page, ANGLE)).toHaveValue('50');
  await page.getByRole('button', { name: `${POSITION}: зменшити`, exact: true }).click();
  await expect(entry(page, POSITION)).toHaveValue('45');
  await entry(page, ANGLE).fill('47,5');
  await expectReady(page);
  await page.getByRole('button', { name: `${ANGLE}: збільшити`, exact: true }).click();
  await expect(entry(page, ANGLE)).toHaveValue('50');
  await slider(page, ANGLE).focus();
  await page.keyboard.press('End');
  await expect(entry(page, ANGLE)).toHaveValue('85');
  await expect(page.getByRole('button', { name: `${ANGLE}: збільшити`, exact: true })).toBeDisabled();
  await page.keyboard.press('Home');
  await expect(entry(page, ANGLE)).toHaveValue('5');
  await expect(page.getByRole('button', { name: `${ANGLE}: зменшити`, exact: true })).toBeDisabled();
  await entry(page, ANGLE).fill('86');
  await expect(page.getByText('Допустимі значення — від 5° до 85°.')).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await entry(page, ANGLE).fill('85');
  await entry(page, POSITION).fill('9');
  await expect(page.getByText('Допустимі значення — від 10 % до 90 %.')).toBeVisible();
  await entry(page, POSITION).fill('90');
  await entry(page, DIRECTION).fill('361');
  await expect(page.getByText('Допустимі значення — від 0° до 360°.')).toBeVisible();
  await entry(page, DIRECTION).fill('360');
  await expectReady(page);
});

test('the direction: 360° stays on the slider, its model is the one of 0°, and the camera does not change the plane', async ({
  page,
}) => {
  await chooseOblique(page);
  await expectReady(page);
  const { objects: start } = await download(page);
  await slider(page, DIRECTION).focus();
  await page.keyboard.press('End');
  await expect(entry(page, DIRECTION)).toHaveValue('360');
  await expect(slider(page, DIRECTION)).toHaveValue('360');
  // The same model: it stays ready, and the file is the same one.
  await expectReady(page);
  await expect(entry(page, DIRECTION)).toHaveValue('360');
  await expect(slider(page, DIRECTION)).toHaveValue('360');
  const { objects: end } = await download(page);
  expect(end.map(({ volume }) => volume)).toEqual(start.map(({ volume }) => volume));
  await slider(page, DIRECTION).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(entry(page, DIRECTION)).toHaveValue('355');
  await expectReady(page);
});

test('the compass shows the plane’s rise in the preview only, and follows the camera', async ({ page }) => {
  await chooseOblique(page);
  await expectReady(page);
  await expect(compass(page)).toHaveAttribute('data-direction', '0');
  await expect(compass(page).getByRole('img')).toHaveAccessibleName('Площина піднімається в напрямі 0° від осі X до осі Y');
  const arrowBefore = await compass(page).locator('polygon').getAttribute('points');
  await entry(page, DIRECTION).fill('90');
  await expectReady(page);
  await expect(compass(page)).toHaveAttribute('data-direction', '90');
  const turned = await compass(page).locator('polygon').getAttribute('points');
  expect(turned).not.toBe(arrowBefore);
  const box = await modelViewer(page).boundingBox();
  if (box === null) throw new Error('The viewer is not on the page.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => compass(page).locator('polygon').getAttribute('points')).not.toBe(turned);
  // It lets the drag through, and it is not part of the print file.
  await expect(compass(page)).toHaveCSS('pointer-events', 'none');
  const { names } = await download(page);
  expect(names).toHaveLength(2);
  // Only an oblique plane has one.
  await entry(page, 'Тип перерізу').selectOption({ label: 'Вертикальний' });
  await expectReady(page);
  await expect(compass(page)).toHaveCount(0);
});

test('a plane that contains the whole axis disables the position, explains why and keeps its value', async ({ page }) => {
  await chooseOblique(page);
  await entry(page, POSITION).fill('30');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення верхньої основи').fill('2');
  await expectReady(page, '80 × 40 × 40 мм');
  const note = 'Площина містить усю вісь циліндра, тому положення точки за висотою не змінює переріз.';
  await expect(page.getByText(note)).toBeVisible();
  await expect(entry(page, POSITION)).toBeDisabled();
  await expect(entry(page, POSITION)).toHaveValue('30');
  await expect(slider(page, POSITION)).toBeDisabled();
  await expect(page.getByRole('button', { name: `${POSITION}: збільшити`, exact: true })).toBeDisabled();
  await expect(slider(page, POSITION)).toHaveAccessibleDescription(note);
  // The parts are valid, and two equal halves.
  const { objects } = await download(page);
  expect((objects[0]?.volume ?? 0) / (objects[1]?.volume ?? 1)).toBeCloseTo(1, 3);
  await entry(page, ANGLE).fill('50');
  await expect(page.getByText(note)).toHaveCount(0);
  await expect(entry(page, POSITION)).toBeEnabled();
  await expect(entry(page, POSITION)).toHaveValue('30');
});

for (const [connector, count, objectCount] of [
  ['Ластівчин хвіст', undefined, 2],
  ['Виступ і отвір', '1', 2],
  ['Виступ і отвір', '2', 2],
  ['Знімні штифти', '1', 3],
  ['Знімні штифти', '2', 4],
] as const) {
  test(`${connector}${count === undefined ? '' : ` × ${count}`}: separate objects in a turned plane`, async ({ page }) => {
    const errors = collectErrors(page);
    await chooseOblique(page);
    await entry(page, DIRECTION).fill('60');
    await expectReady(page);
    await entry(page, 'Тип кріплення').selectOption({ label: connector });
    if (count !== undefined) await entry(page, 'Кількість').selectOption({ label: count });
    await expectReady(page);
    const { objects, names } = await download(page);
    expect(objects).toHaveLength(objectCount);
    expect(names.slice(0, 2)).toEqual(['cylinder-part-1', 'cylinder-part-2']);
    expect(errors).toEqual([]);
  });
}

test('the connector’s fields are in millimetres of the actual section, and name the parts by number', async ({ page }) => {
  await chooseOblique(page);
  await expectReady(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  // 50 % of the section's 113,137 mm along the plane.
  await expect(entry(page, 'Довжина виступу, мм')).toHaveValue('56,569');
  await expect(parameterSection(page, 'Кріплення').getByText('Як працює кріплення?')).toBeVisible();
  await parameterSection(page, 'Кріплення').getByText('Як працює кріплення?').click();
  await expect(parameterSection(page, 'Кріплення').getByText(/вниз по схилу до упора/)).toBeVisible();
  // A flatter plane has a shorter section: the stored percentage keeps the tongue's share.
  await entry(page, ANGLE).fill('30');
  await expectReady(page);
  await expect(entry(page, 'Довжина виступу, мм')).toHaveValue('46,188');
  await entry(page, 'Довжина виступу, мм').fill('300');
  await expect(parameterSection(page, 'Кріплення').getByText(/Зараз допустимо від/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
});

test('a new maximum dimension keeps the plane, and a reset restores its defaults with the size kept', async ({ page }) => {
  await chooseOblique(page);
  await entry(page, POSITION).fill('35');
  await entry(page, ANGLE).fill('55');
  await entry(page, DIRECTION).fill('120');
  await expectReady(page);
  const { objects: small } = await download(page);
  await entry(page, 'Найбільший габарит').fill('160');
  await expectReady(page, '160 × 160 × 160 мм');
  await expect(entry(page, POSITION)).toHaveValue('35');
  await expect(entry(page, ANGLE)).toHaveValue('55');
  await expect(entry(page, DIRECTION)).toHaveValue('120');
  const { objects: large } = await download(page);
  // Twice the size holds eight times the volume, within what the finer circle adds.
  expect((large[0]?.volume ?? 0) / (small[0]?.volume ?? 1)).toBeCloseTo(8, 1);
  await page.getByRole('button', { name: 'Скинути параметри фігури' }).click();
  await expect(entry(page, 'Найбільший габарит')).toHaveValue('160');
  await expect(entry(page, 'Тип перерізу')).toHaveValue('none');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
  await expect(entry(page, POSITION)).toHaveValue('50');
  await expect(entry(page, ANGLE)).toHaveValue('45');
  await expect(entry(page, DIRECTION)).toHaveValue('0');
});

test('separating moves part 2 along the normal, or the tongue’s part uphill, and only in the preview', async ({ page }) => {
  await chooseOblique(page);
  await expectReady(page);
  // glTF X and up are the plane's q and Z: n = (−sin 45°, 0, cos 45°) moves part 2 by the 12 mm gap along both.
  const gap = 0.15 * 80 * Math.SQRT1_2;
  const lift = 0.002 * Math.hypot(80, 80, 80) * 2;
  const separated = await viewerSize(page);
  expect(separated[0]).toBeCloseTo(80 + gap + lift, 0);
  expect(separated[1]).toBeCloseTo(80 + gap + lift, 0);
  await separation(page).uncheck();
  await expect.poll(async () => (await viewerSize(page))[0]).toBeLessThan(85);
  await separation(page).check();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Ластівчин хвіст' });
  await expectReady(page);
  // Uphill along (cos 45°, 0, sin 45°), past the end of the groove: far beyond the normal's gap, both ways up.
  await expect.poll(async () => (await viewerSize(page))[0], { timeout: 30_000 }).toBeGreaterThan(110);
  expect((await viewerSize(page))[1]).toBeGreaterThan(110);
  const { names } = await download(page);
  expect(names).toHaveLength(2);
});

test('on a narrow phone every field is reachable and the page fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseOblique(page);
  await expectReady(page);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Знімні штифти' });
  await expectReady(page);
  for (const label of [POSITION, ANGLE, DIRECTION]) {
    await entry(page, label).scrollIntoViewIfNeeded();
    await expect(entry(page, label)).toBeInViewport();
    await slider(page, label).scrollIntoViewIfNeeded();
    await expect(slider(page, label)).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const [box, viewport] = [await compass(page).boundingBox(), await previewViewport(page).boundingBox()];
  if (box === null || viewport === null) throw new Error('The compass or the preview is not on the page.');
  // The compass stays inside the preview, and small next to it.
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width);
  expect(box.width * box.height).toBeLessThan(0.1 * viewport.width * viewport.height);
});
