import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const picker = (page: Page) => page.getByRole('button', { name: /^Перпендикулярно до/ });
const list = (page: Page) => page.getByLabel('Або зі списку', { exact: true });
const done = (page: Page) => page.getByRole('button', { name: 'Готово', exact: true }).click();

async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

async function chooseInclined(page: Page, shape = 'Куб'): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: shape });
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Похилий' });
  await expectLoaded(page);
}

/** Where a vertex is on the page, from its own label's anchor. */
async function screenPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  await expectLoaded(page);
  await page.waitForTimeout(300);
  const point = await page.evaluate(
    (name) => {
      const viewer = document.querySelector('model-viewer') as unknown as HTMLElement & {
        queryHotspot(name: string): { canvasPosition: { x: number; y: number } } | null;
      };
      const slot = Array.from(viewer.querySelectorAll('[slot]'), (element) => element.getAttribute('slot') ?? '').find(
        (candidate) => candidate.startsWith(`hotspot-${name}-`),
      );
      const hit = slot === undefined ? null : viewer.queryHotspot(slot);
      const box = viewer.getBoundingClientRect();
      return hit === null ? null : { x: box.left + hit.canvasPosition.x, y: box.top + hit.canvasPosition.y };
    },
    id.replace('1', '₁'),
  );
  if (point === null) throw new Error(`No point ${id} on screen.`);
  return point;
}

const click = async (page: Page, id: string) => {
  const { x, y } = await screenPoint(page, id);
  await page.mouse.click(x, y);
};

type Inclined = { readonly type: string; readonly normalAlong?: readonly string[]; readonly positionPercent: number };

async function download(page: Page): Promise<Inclined> {
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  for (const { mesh } of readThreeMf(bytes).model.objects) expect(findMeshDefects(mesh)).toEqual([]);
  return JSON.parse(readThreeMfPart(bytes, MODEL_SETTINGS_PATH) as string).sourceModel.section;
}

const drawn = (page: Page) =>
  page.evaluate(() => ({
    lines: Array.from(document.querySelectorAll('.overlay .offered:not(.hover-preview)'), (line) => [
      line.getAttribute('data-line'),
      line.getAttribute('class')?.includes('selected') === true,
    ]),
    preview: document.querySelectorAll('.overlay .hover-preview').length,
  }));

const cameraTarget = (page: Page) =>
  page.locator('model-viewer').evaluate((viewer) => {
    const { x, y, z } = (viewer as unknown as { getCameraTarget(): { x: number; y: number; z: number } }).getCameraTarget();
    return [x, y, z];
  });

test('cube: an edge clicked, then a body diagonal by its two ends either way round, the position kept at the middle', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseInclined(page);
  await picker(page).click();
  await expect(picker(page)).toContainText('не вибрано');
  const target = await cameraTarget(page);
  // AB, clicked along its length: perpendicular to it, x = ½ of the edge from A.
  const [a, b] = [await screenPoint(page, 'A'), await screenPoint(page, 'B')];
  await page.mouse.click(a.x + 0.4 * (b.x - a.x), a.y + 0.4 * (b.y - a.y));
  await expect(picker(page)).toContainText('AB');
  await expect(page.getByText('Обрано: AB — ребро.')).toBeVisible();
  expect(await download(page)).toMatchObject({ type: 'inclined', normalAlong: ['A', 'B'], positionPercent: 50 });
  // A, then C₁ under the pointer: the would-be diagonal drawn, then chosen; only the chosen one stays drawn.
  await click(page, 'A');
  const c1 = await screenPoint(page, 'C1');
  await page.mouse.move(c1.x, c1.y);
  await expect.poll(async () => (await drawn(page)).preview).toBe(1);
  await page.mouse.click(c1.x, c1.y);
  await expect(page.getByText('Обрано: AC₁ — діагональ тіла.')).toBeVisible();
  await expect.poll(async () => (await drawn(page)).lines).toEqual([['A-C1', true]]);
  expect(await download(page)).toMatchObject({ normalAlong: ['A', 'C1'], positionPercent: 50 });
  // C₁ then A: the same.
  await page.getByLabel('Положення', { exact: true }).fill('30');
  await click(page, 'C1');
  await click(page, 'A');
  expect(await download(page)).toMatchObject({ normalAlong: ['A', 'C1'], positionPercent: 30 });
  // Only a new model's own refit of its automatic target moves it, by a hair; a click never re-centres the view.
  for (const [index, value] of (await cameraTarget(page)).entries()) expect(value).toBeCloseTo(target[index] as number, 6);
  // The named list in its three groups, and the segment chosen in it; reopened, the same.
  expect(
    await list(page)
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('label'))),
  ).toEqual(['Ребра', 'Діагоналі граней', 'Діагоналі тіла']);
  await expect(list(page)).toHaveValue('A-C1');
  await done(page);
  await picker(page).click();
  await expect(list(page)).toHaveValue('A-C1');
  // A face's diagonal by name.
  await list(page).selectOption({ label: 'AC' });
  expect(await download(page)).toMatchObject({ normalAlong: ['A', 'C'] });
  expect(errors).toEqual([]);
});

test('an oblique parallelepiped: the lateral edges by name and by a click alike, then given by angles where it is', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseInclined(page, 'Паралелепіпед');
  await openSection(page, 'Нахил');
  await page.getByLabel('Зміщення X', { exact: true }).fill('0,8');
  // No separate shortcut: the lateral edges are one of the segments of «Перпендикулярно до».
  await expect(page.getByRole('button', { name: 'Перпендикулярно бічним ребрам', exact: true })).toHaveCount(0);
  await picker(page).click();
  await list(page).selectOption({ label: 'Бічні ребра (AA₁)' });
  await expect(picker(page)).toContainText('бічні ребра');
  await expect(page.getByText('Площина перпендикулярна до бічних ребер.')).toBeVisible();
  const lateral = await download(page);
  expect(lateral).toMatchObject({ normalAlong: ['A', 'A1'], positionPercent: 50 });
  // BB₁ clicked by its ends: the same lateral direction, the same plane.
  await click(page, 'B');
  await click(page, 'B1');
  expect(await download(page)).toEqual(lateral);
  await done(page);
  // Given by its angles again: the angles appear, read off the plane, and the section stays downloadable.
  await page.getByRole('button', { name: 'Змінити нахил', exact: true }).click();
  await expect(page.getByLabel('Кут до площини основи', { exact: true })).toBeVisible();
  await expect(picker(page)).toContainText('не вибрано');
  const manual = await download(page);
  expect(manual.normalAlong).toBeUndefined();
  expect(manual.type).toBe('inclined');
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('two vertices tapped give the segment, a body diagonal among them', async ({ page }) => {
    const errors = collectErrors(page);
    await chooseInclined(page);
    await picker(page).click();
    const [b, d1] = [await screenPoint(page, 'B'), await screenPoint(page, 'D1')];
    await page.touchscreen.tap(b.x, b.y);
    await page.touchscreen.tap(d1.x, d1.y);
    await expect(page.getByText('Обрано: BD₁ — діагональ тіла.')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
