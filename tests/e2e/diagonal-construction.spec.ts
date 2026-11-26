import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const picker = (page: Page) => page.getByRole('button', { name: /^Діагональ/ });
const done = (page: Page) => page.getByRole('button', { name: 'Готово', exact: true }).click();

async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

async function chooseDiagonalSection(page: Page, shape = 'Куб'): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: shape });
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Поздовжній' });
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через діагональ' });
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

/** A point a quarter of the way along a diagonal, off the other diagonal that crosses it in the middle. */
async function onDiagonal(page: Page, from: string, to: string): Promise<{ x: number; y: number }> {
  const [a, b] = [await screenPoint(page, from), await screenPoint(page, to)];
  return { x: a.x + 0.25 * (b.x - a.x), y: a.y + 0.25 * (b.y - a.y) };
}

const click = async (page: Page, point: { x: number; y: number }) => page.mouse.click(point.x, point.y);

type Longitudinal = {
  readonly trace: string;
  readonly traceSegment?: readonly string[];
  readonly through?: boolean;
  readonly positionPercent: number;
};

async function download(page: Page): Promise<{ names: string[]; section: Longitudinal & { secondPositionPercent?: number } }> {
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

const offered = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('.overlay .offered'), (line) => [
        line.getAttribute('data-line'),
        line
          .getAttribute('class')
          ?.split(' ')
          .filter((name) => ['candidate', 'selected', 'in-plane', 'hover'].includes(name)),
      ]),
    ),
  );

const cameraTarget = (page: Page) =>
  page.locator('model-viewer').evaluate((viewer) => {
    const { x, y, z } = (viewer as unknown as { getCameraTarget(): { x: number; y: number; z: number } }).getCameraTarget();
    return [x, y, z];
  });

test('cube: a diagonal clicked, two opposite vertices of either base, and the named list choose alike, the camera untouched', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseDiagonalSection(page);
  await expect(picker(page)).toContainText('AC');
  // Opening the field alone changes nothing, and shows all four base diagonals, AC's in the plane.
  await picker(page).click();
  await expect
    .poll(() => offered(page))
    .toEqual({
      'A-C': ['in-plane'],
      'A1-C1': ['in-plane'],
      'B-D': ['candidate'],
      'B1-D1': ['candidate'],
    });
  expect((await download(page)).section).toMatchObject({ trace: 'diagonal', traceSegment: ['A', 'C'], through: true });
  const target = await cameraTarget(page);
  // BD, clicked on the lower base, the pointer over it first.
  const bd = await onDiagonal(page, 'B', 'D');
  await page.mouse.move(bd.x, bd.y);
  await expect.poll(async () => (await offered(page))['B-D']).toEqual(['candidate', 'hover']);
  await click(page, bd);
  await expect(picker(page)).toContainText('BD');
  await expect(page.getByLabel('Або зі списку', { exact: true })).toHaveValue('B-D');
  expect((await download(page)).section).toMatchObject({ traceSegment: ['B', 'D'], through: true, positionPercent: 50 });
  // C₁ then A₁, upper base: AC, the same family as A and C.
  await click(page, await screenPoint(page, 'C1'));
  await expect(page.getByText(/^Перша вершина — C₁\./)).toBeVisible();
  await click(page, await screenPoint(page, 'A1'));
  await expect(picker(page)).toContainText('AC');
  await expect(page.getByLabel('Або зі списку', { exact: true })).toHaveValue('A-C');
  // A, then B beside it: refused, A kept; then C completes it.
  await page.getByLabel('Або зі списку', { exact: true }).selectOption({ label: 'BD (і B₁D₁)' });
  await click(page, await screenPoint(page, 'A'));
  await click(page, await screenPoint(page, 'B'));
  await expect(
    page.getByText('A і B — сусідні вершини основи, тож AB — її сторона, а не діагональ. Оберіть підсвічену вершину.'),
  ).toBeVisible();
  await expect(page.getByText(/^Перша вершина — A\./)).toBeVisible();
  await click(page, await screenPoint(page, 'C1'));
  await expect(page.getByText(/^A і C₁ лежать у різних основах/)).toBeVisible();
  await click(page, await screenPoint(page, 'C'));
  await expect(picker(page)).toContainText('AC');
  expect(await cameraTarget(page)).toEqual(target);
  // Reopened: the same choice.
  await done(page);
  await picker(page).click();
  await expect(page.getByLabel('Або зі списку', { exact: true })).toHaveValue('A-C');
  expect(errors).toEqual([]);
});

test('a plane moved off its diagonal stays where it is when the upper diagonal is clicked, and is said to be parallel', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseDiagonalSection(page, 'Прямокутний паралелепіпед');
  await page.getByLabel('Положення', { exact: true }).fill('65');
  await expect(
    page.getByText('Площина паралельна діагональному перерізу через AC, але не проходить через діагональ.'),
  ).toBeVisible();
  const moved = (await download(page)).section;
  expect(moved).toMatchObject({ traceSegment: ['A', 'C'], positionPercent: 65 });
  expect(moved.through ?? false).toBe(false);
  await picker(page).click();
  await click(page, await onDiagonal(page, 'A1', 'C1'));
  await expect(page.getByLabel('Положення', { exact: true })).toHaveValue('65');
  expect((await download(page)).section).toEqual(moved);
  // Through the diagonal again, by the existing action.
  await done(page);
  await page.getByRole('button', { name: 'Провести через цю лінію', exact: true }).click();
  await expect(page.getByText(/^Діагональний переріз: площина проходить через діагональ AC/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('an oblique parallelepiped: a second plane parallel to the first, kept when the family changes; the angle trace as before', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await chooseDiagonalSection(page, 'Паралелепіпед');
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  const two = await download(page);
  expect(two.names).toContain('parallelepiped-middle-part');
  const second = two.section.secondPositionPercent;
  expect(second).toBeDefined();
  await picker(page).click();
  await click(page, await screenPoint(page, 'B'));
  await click(page, await screenPoint(page, 'D'));
  await expect(picker(page)).toContainText('BD');
  await done(page);
  const turned = await download(page);
  expect(turned.section).toMatchObject({ traceSegment: ['B', 'D'], secondPositionPercent: second });
  expect(turned.names).toContain('parallelepiped-middle-part');
  // The trace at an angle to AB, by its own field.
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Під кутом до ребра AB' });
  await page.getByLabel('Кут сліду до AB', { exact: true }).fill('30');
  expect((await download(page)).section).toMatchObject({ trace: 'angle', traceAngleDeg: 30 });
  await expect(picker(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('two opposite vertices tapped choose the diagonal', async ({ page }) => {
    const errors = collectErrors(page);
    await chooseDiagonalSection(page);
    await picker(page).click();
    const [b, d] = [await screenPoint(page, 'B1'), await screenPoint(page, 'D1')];
    await page.touchscreen.tap(b.x, b.y);
    await page.touchscreen.tap(d.x, d.y);
    await expect(picker(page)).toContainText('BD');
    expect(errors).toEqual([]);
  });
});
