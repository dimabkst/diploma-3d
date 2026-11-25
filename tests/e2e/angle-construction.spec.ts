import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const picker = (page: Page, name: RegExp) => page.getByRole('button', { name });
const SEGMENT = /^Відрізок/;
// The field itself, not its slider's buttons, whose names go on after a colon.
const ANGLE = /^Кут до [^:]*$/;
const other = (page: Page) => page.getByRole('button', { name: 'Інше положення перерізу', exact: true });
const segmentList = (page: Page) => page.getByLabel('Або зі списку', { exact: true });
const method = (page: Page) => page.getByLabel('Спосіб', { exact: true });

async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

async function chooseThroughSegment(page: Page, shape = 'Куб'): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: shape });
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через ребро або діагональ' });
  await expectLoaded(page);
}

/** The angle typed into its field, the field opened for it. */
async function typeAngle(page: Page, face: string, angle: string): Promise<void> {
  if ((await picker(page, ANGLE).getAttribute('aria-expanded')) !== 'true') await picker(page, ANGLE).click();
  await page.getByLabel(`Кут до ${face}`, { exact: true }).fill(angle);
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

type Line = { readonly face: string; readonly line: readonly string[]; readonly method: string; readonly angleDeg?: number };

async function download(page: Page): Promise<Line> {
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  for (const { mesh } of readThreeMf(bytes).model.objects) expect(findMeshDefects(mesh)).toEqual([]);
  return JSON.parse(readThreeMfPart(bytes, MODEL_SETTINGS_PATH) as string).sourceModel.section;
}

/** The first section's outline as drawn, with the face the angle is measured from where it is highlighted. */
const outline = (page: Page) =>
  page.evaluate(() => ({
    points: document.querySelector('.overlay .section:not(.second)')?.getAttribute('points') ?? null,
    reference: document.querySelector('.overlay .face.reference')?.getAttribute('data-face') ?? null,
  }));

/** Two outlines alike to within a pixel at each corner, whichever corner they start from: the same plane from the same camera. */
function expectSameOutline(actual: string | null, expected: string | null): void {
  const points = (text: string | null) => (text ?? '').split(' ').map((pair) => pair.split(',').map(Number) as [number, number]);
  const [a, b] = [points(actual), points(expected)];
  expect(actual).not.toBeNull();
  expect(a).toHaveLength(b.length);
  for (const [x, y] of a) expect(Math.min(...b.map(([ox, oy]) => Math.hypot(x - ox, y - oy)))).toBeLessThan(1);
}

test('cube A–B: AC at 45° to ABCD has two planes, the other one chosen explicitly; at 90° one plane, through A, C, A₁, C₁', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseThroughSegment(page);
  await expect(method(page)).toHaveValue('angle');
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'AC — діагональ грані' });
  await expect(picker(page, ANGLE)).toContainText('Кут до ABCD');
  await typeAngle(page, 'ABCD', '45');
  // A face's diagonal lies in one face: no other to choose.
  await expect(page.getByText('Відрізок AC лежить лише в грані ABCD: кут відраховано від неї.')).toBeVisible();
  await expectLoaded(page);
  const first = await outline(page);
  expect(first.reference).toBe('ABCD');
  expect(await download(page)).toMatchObject({ face: 'ABCD', line: ['A', 'C'], method: 'angle', angleDeg: 45 });
  await other(page).click();
  await expectLoaded(page);
  expect((await download(page)).angleDeg).toBe(135);
  expect((await outline(page)).points).not.toBe(first.points);
  // At 90° both are one plane: none other offered.
  await typeAngle(page, 'ABCD', '90');
  await expect(other(page)).toHaveCount(0);
  expect((await download(page)).angleDeg).toBe(90);
  // The way back to 45° keeps the plane chosen: the second, as left.
  await typeAngle(page, 'ABCD', '45');
  expect((await download(page)).angleDeg).toBe(135);
  expect(errors).toEqual([]);
});

test('cube C–D: AB at 30° to ABCD reads 60° to ABB₁A₁ clicked on the model, the plane kept; at 90° to ABCD a face, said inline', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseThroughSegment(page);
  await expect(picker(page, SEGMENT)).toContainText('AB');
  await typeAngle(page, 'ABCD', '30');
  await expectLoaded(page);
  // The other plane at 30° only touches the cube along AB: none offered.
  await expect(other(page)).toHaveCount(0);
  const before = await outline(page);
  // The front face ABB₁A₁, clicked, its hover shown first.
  const corners = await Promise.all(['A', 'B', 'B1', 'A1'].map((id) => screenPoint(page, id)));
  const middle = {
    x: corners.reduce((sum, { x }) => sum + x / 4, 0),
    y: corners.reduce((sum, { y }) => sum + y / 4, 0),
  };
  await page.mouse.move(middle.x, middle.y);
  await expect(page.locator('.overlay .face.hover')).toHaveAttribute('data-face', 'ABB1A1');
  await page.mouse.click(middle.x, middle.y);
  await expect(picker(page, ANGLE)).toContainText('Кут до ABB₁A₁');
  await expect(picker(page, ANGLE)).toContainText('60°');
  const after = await outline(page);
  expect(after.reference).toBe('ABB1A1');
  expectSameOutline(after.points, before.points);
  expect(await download(page)).toMatchObject({ face: 'ABB1A1', line: ['A', 'B'] });
  // By name, ABCD again: 30°.
  await page.getByRole('radio', { name: 'ABCD', exact: true }).check();
  await expect(picker(page, ANGLE)).toContainText('30°');
  // D: 90° to ABCD is the face ABB₁A₁.
  await page.getByLabel('Кут до ABCD', { exact: true }).fill('90');
  await expect(page.getByText('Під цим кутом площина збігається з гранню ABB₁A₁. Змініть кут.')).toBeVisible();
  await expectLoaded(page);
  await expect(page.getByText('Модель не оновлено')).toHaveCount(0);
  await expect(partsButton(page)).toBeDisabled();
  expect((await outline(page)).points).toBeNull();
  // The requested angle stays as typed.
  await expect(page.getByLabel('Кут до ABCD', { exact: true })).toHaveValue('90');
  expect(errors).toEqual([]);
});

test('E: AB₁ and the midpoint of DD₁ taken to an angle keep the plane; back to the point keeps M', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseThroughSegment(page);
  await method(page).selectOption({ label: 'Через точку ребра' });
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await page.getByRole('button', { name: /^Точка M/ }).click();
  await page.getByLabel('Ребро зі списку', { exact: true }).selectOption({ label: 'Ребро DD₁' });
  await expectLoaded(page);
  const through = await outline(page);
  await method(page).selectOption({ label: 'За кутом' });
  await expect(picker(page, ANGLE)).toContainText('Кут до ABB₁A₁');
  await picker(page, ANGLE).click();
  await expectLoaded(page);
  expectSameOutline((await outline(page)).points, through.points);
  const angled = await download(page);
  expect(angled).toMatchObject({ face: 'ABB1A1', line: ['A', 'B1'], method: 'angle' });
  await method(page).selectOption({ label: 'Через точку ребра' });
  await expect(page.getByRole('button', { name: /^Точка M/ })).toContainText('Середина DD₁');
  expect(errors).toEqual([]);
});

test('a segment picked from either end, quick steps of the angle, and the other parallelepipeds keep one coherent plane', async ({
  page,
}) => {
  const errors = collectErrors(page);
  for (const shape of ['Прямокутний паралелепіпед', 'Паралелепіпед']) {
    await chooseThroughSegment(page, shape);
    await picker(page, SEGMENT).click();
    // C₁ first, then B: the segment BC₁, as by name.
    await page.mouse.click(...(Object.values(await screenPoint(page, 'C1')) as [number, number]));
    await page.mouse.click(...(Object.values(await screenPoint(page, 'B')) as [number, number]));
    await expect(picker(page, SEGMENT)).toContainText('BC₁');
    await expect(segmentList(page)).toHaveValue('B-C1');
    await expect(picker(page, ANGLE)).toContainText('Кут до BCC₁B₁');
    await typeAngle(page, 'BCC₁B₁', '40');
    const up = page.getByRole('button', { name: 'Кут до BCC₁B₁: збільшити', exact: true });
    for (let step = 0; step < 4; step += 1) await up.click();
    await expect(page.getByLabel('Кут до BCC₁B₁', { exact: true })).toHaveValue('44');
    const section = await download(page);
    expect(section).toMatchObject({ face: 'BCC1B1', line: ['B', 'C1'], method: 'angle' });
    expect(section.angleDeg === 44 || section.angleDeg === 136).toBe(true);
  }
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the angle and its face are set by finger, the other plane by its button', async ({ page }) => {
    const errors = collectErrors(page);
    await chooseThroughSegment(page);
    await picker(page, SEGMENT).click();
    await segmentList(page).selectOption({ label: 'BD — діагональ грані' });
    await picker(page, ANGLE).click();
    await page.getByRole('button', { name: 'Кут до ABCD: збільшити', exact: true }).tap();
    await expect(picker(page, ANGLE)).toContainText('46°');
    await other(page).tap();
    expect((await download(page)).angleDeg).toBe(134);
    expect(errors).toEqual([]);
  });
});
