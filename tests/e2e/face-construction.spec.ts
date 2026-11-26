import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const picker = (page: Page, name: RegExp) => page.getByRole('button', { name });
const FACE = /^Грань/;
const POSITION = /^Положення/;
const SECOND = /^Другий переріз/;
const done = (page: Page) => page.getByRole('button', { name: 'Готово', exact: true }).click();

async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

async function chooseFaceParallel(page: Page, shape = 'Куб'): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: shape });
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Паралельно грані' });
  await expectLoaded(page);
}

const orbit = (page: Page, value: string) =>
  page.locator('model-viewer').evaluate((viewer, next) => {
    const element = viewer as unknown as { cameraOrbit: string; jumpCameraToGoal(): void };
    element.cameraOrbit = next;
    element.jumpCameraToGoal();
  }, value);

/** Where a vertex is on the page: its own label's anchor, which model-viewer keeps in place under the construction's labels. */
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

/** The middle of a face on the page, from its four corners. */
async function faceMiddle(page: Page, corners: readonly string[]): Promise<{ x: number; y: number }> {
  const points = await Promise.all(corners.map((corner) => screenPoint(page, corner)));
  return {
    x: points.reduce((sum, { x }) => sum + x / points.length, 0),
    y: points.reduce((sum, { y }) => sum + y / points.length, 0),
  };
}

type Plane = { readonly face: string; readonly positionPercent: number; readonly secondPositionPercent?: number };

async function download(page: Page): Promise<{ names: string[]; section: Plane }> {
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  const { model } = readThreeMf(bytes);
  for (const { mesh } of model.objects) expect(findMeshDefects(mesh)).toEqual([]);
  return {
    names: model.objects.map(({ name }) => name),
    section: JSON.parse(readThreeMfPart(bytes, MODEL_SETTINGS_PATH) as string).sourceModel.section,
  };
}

/** The outlines the construction view draws: the first section's and the second's, as their points on screen. */
const outlines = (page: Page) =>
  page.evaluate(() => ({
    first: document.querySelector('.overlay .section:not(.second)')?.getAttribute('points') ?? null,
    second: document.querySelector('.overlay .section.second')?.getAttribute('points') ?? null,
    reference: document.querySelector('.overlay .face.reference')?.getAttribute('data-face') ?? null,
  }));

/** Two outlines alike to within a pixel at each corner: the same plane drawn from the same camera. */
function expectSameOutline(actual: string | null, expected: string | null): void {
  expect(actual).not.toBeNull();
  const points = (outline: string | null) => (outline ?? '').split(' ').map((pair) => pair.split(',').map(Number));
  const [a, b] = [points(actual), points(expected)];
  expect(a).toHaveLength(b.length);
  for (const [index, [x, y]] of a.entries()) {
    const [ox, oy] = b[index] as number[];
    expect(Math.hypot((x as number) - (ox as number), (y as number) - (oy as number))).toBeLessThan(1);
  }
}

test('cube: the bases at the midpoint and at 1 : 2, the top face clicked keeps the plane at 2 : 1, a second plane keeps its own', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseFaceParallel(page);
  // A: ABCD at the midpoint, as the construction starts.
  await expect(picker(page, FACE)).toContainText('ABCD');
  await expect(picker(page, POSITION)).toContainText('Посередині');
  expect((await download(page)).section).toMatchObject({ face: 'ABCD', positionPercent: 50 });
  // B: 1 : 2 from ABCD, a third of the height.
  await picker(page, POSITION).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByLabel('Від ABCD', { exact: true }).fill('1');
  await page.getByLabel('До A₁B₁C₁D₁', { exact: true }).fill('2');
  await expect(picker(page, POSITION)).toContainText('1 : 2');
  const third = (await download(page)).section;
  expect(third.face).toBe('ABCD');
  expect(third.positionPercent).toBeCloseTo(100 / 3, 9);
  // C: the top face, clicked on the model, the pointer over it first: the plane stays, read 2 : 1 from there.
  await picker(page, FACE).click();
  const top = await faceMiddle(page, ['A1', 'B1', 'C1', 'D1']);
  await page.mouse.move(top.x, top.y);
  await expect(page.locator('.overlay .face.hover')).toHaveAttribute('data-face', 'A1B1C1D1');
  const before = await outlines(page);
  expect(before.reference).toBe('ABCD');
  await page.mouse.click(top.x, top.y);
  await expect(picker(page, FACE)).toContainText('A₁B₁C₁D₁');
  await expect(picker(page, POSITION)).toContainText('2 : 1');
  const after = await outlines(page);
  expect(after.reference).toBe('A1B1C1D1');
  expectSameOutline(after.first, before.first);
  const fromTop = (await download(page)).section;
  expect(fromTop.face).toBe('A1B1C1D1');
  expect(fromTop.positionPercent).toBeCloseTo(200 / 3, 9);
  // D: a second plane from the same face, then the bottom face clicked from below: both planes stay, each in its own colour.
  await done(page);
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await expect(picker(page, SECOND)).toContainText('2 : 3');
  const two = (await download(page)).section;
  expect(two).toMatchObject({ face: 'A1B1C1D1', secondPositionPercent: 40 });
  expect((await download(page)).names).toEqual(['cube-lower-part', 'cube-middle-part', 'cube-upper-part']);
  await picker(page, FACE).click();
  await orbit(page, '35deg 125deg auto');
  await expectLoaded(page);
  const bottom = await faceMiddle(page, ['A', 'B', 'C', 'D']);
  const planes = await outlines(page);
  await page.mouse.click(bottom.x, bottom.y);
  await expect(picker(page, FACE)).toContainText('ABCD');
  await expect(picker(page, POSITION)).toContainText('1 : 2');
  await expect(picker(page, SECOND)).toContainText('3 : 2');
  const swapped = await outlines(page);
  expectSameOutline(swapped.first, planes.first);
  expectSameOutline(swapped.second, planes.second);
  const fromBottom = (await download(page)).section;
  expect(fromBottom.face).toBe('ABCD');
  expect(fromBottom.positionPercent).toBeCloseTo(100 / 3, 9);
  expect(fromBottom.secondPositionPercent).toBeCloseTo(60, 9);
  expect(errors).toEqual([]);
});

test('a drag that starts on a face turns the model and chooses nothing; the list and the model choose alike', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseFaceParallel(page, 'Прямокутний паралелепіпед');
  await picker(page, FACE).click();
  const top = await faceMiddle(page, ['A1', 'B1', 'C1', 'D1']);
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(top.x + 70, top.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(picker(page, FACE)).toContainText('ABCD');
  // The side face ABB₁A₁ by name: the list shows its pair, and the model highlights the face itself.
  await page.getByLabel('Або зі списку', { exact: true }).selectOption({ label: 'ABB₁A₁ ∥ CDD₁C₁' });
  await expect(picker(page, FACE)).toContainText('ABB₁A₁');
  expect((await outlines(page)).reference).toBe('ABB1A1');
  // Its own pair again: the face stays.
  await page.getByLabel('Або зі списку', { exact: true }).selectOption({ label: 'ABCD ∥ A₁B₁C₁D₁' });
  await page.getByLabel('Або зі списку', { exact: true }).selectOption({ label: 'ABB₁A₁ ∥ CDD₁C₁' });
  await expect(picker(page, FACE)).toContainText('ABB₁A₁');
  // The same face clicked on the model: the same as by name.
  await page.getByLabel('Або зі списку', { exact: true }).selectOption({ label: 'ABCD ∥ A₁B₁C₁D₁' });
  const side = await faceMiddle(page, ['A', 'B', 'B1', 'A1']);
  await page.mouse.click(side.x, side.y);
  await expect(picker(page, FACE)).toContainText('ABB₁A₁');
  await expect(page.getByLabel('Або зі списку', { exact: true })).toHaveValue('ABB1A1');
  // Reopened, both fields show what they hold.
  await picker(page, POSITION).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByLabel('Від ABB₁A₁', { exact: true }).fill('2');
  await page.getByLabel('До CDD₁C₁', { exact: true }).fill('3');
  await done(page);
  await picker(page, POSITION).click();
  await expect(page.getByLabel('Від ABB₁A₁', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('До CDD₁C₁', { exact: true })).toHaveValue('3');
  expect((await download(page)).section).toMatchObject({ face: 'ABB1A1', positionPercent: 40 });
  expect(errors).toEqual([]);
});

test('a ratio not valid, a plane on a face and one too near it are said beside the position, never over the model', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseFaceParallel(page);
  await picker(page, POSITION).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  const [first, second] = [page.getByLabel('Від ABCD', { exact: true }), page.getByLabel('До A₁B₁C₁D₁', { exact: true })];
  await first.fill('абв');
  await expect(first).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#cube-face-construction-first-error')).toBeVisible();
  await expect(page.getByText('Модель не оновлено')).toHaveCount(0);
  await expect(partsButton(page)).toBeDisabled();
  await first.fill('0');
  await expect(page.getByText('Переріз збігається з гранню ABCD. Оберіть положення строго між ABCD і A₁B₁C₁D₁.')).toBeVisible();
  await first.fill('1');
  await second.fill('99');
  await expect(page.getByText(/^Переріз надто близько до грані/)).toBeVisible();
  await expectLoaded(page);
  await expect(page.getByText('Модель не оновлено')).toHaveCount(0);
  // The arrows step as elsewhere; a valid ratio gives the section back.
  await second.fill('2');
  await page.getByRole('button', { name: 'До A₁B₁C₁D₁: зменшити на 1', exact: true }).click();
  await expect(picker(page, POSITION)).toContainText('1 : 1');
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('an oblique parallelepiped: a lateral face clicked, the plane parallel to it, and its pair named alike', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseFaceParallel(page, 'Паралелепіпед');
  await picker(page, FACE).click();
  const side = await faceMiddle(page, ['B', 'C', 'C1', 'B1']);
  await page.mouse.click(side.x, side.y);
  await expect(picker(page, FACE)).toContainText('BCC₁B₁');
  await expect(page.getByLabel('Або зі списку', { exact: true })).toHaveValue('BCC1B1');
  await picker(page, POSITION).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByLabel('Від BCC₁B₁', { exact: true }).fill('1');
  await page.getByLabel('До DAA₁D₁', { exact: true }).fill('3');
  await done(page);
  expect((await download(page)).section).toMatchObject({ face: 'BCC1B1', positionPercent: 25 });
  // Leaning the other way keeps the face and the ratio.
  await openSection(page, 'Нахил');
  await page.getByLabel('Зміщення X', { exact: true }).fill('-0,4');
  expect((await download(page)).section).toMatchObject({ face: 'BCC1B1', positionPercent: 25 });
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a tap chooses a face, and the position’s arrows answer a finger', async ({ page }) => {
    const errors = collectErrors(page);
    await chooseFaceParallel(page);
    await picker(page, FACE).click();
    const top = await faceMiddle(page, ['A1', 'B1', 'C1', 'D1']);
    await page.touchscreen.tap(top.x, top.y);
    await expect(picker(page, FACE)).toContainText('A₁B₁C₁D₁');
    await picker(page, POSITION).click();
    await page.getByRole('radio', { name: 'За відношенням' }).check();
    await page.getByRole('button', { name: 'До ABCD: збільшити на 1', exact: true }).tap();
    await expect(picker(page, POSITION)).toContainText('1 : 2');
    expect(errors).toEqual([]);
  });
});
