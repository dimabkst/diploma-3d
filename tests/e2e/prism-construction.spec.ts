import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openAllSections, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const picker = (page: Page, name: RegExp) => page.getByRole('button', { name });
const list = (page: Page, label = 'Або зі списку') => page.getByLabel(label, { exact: true });
const done = (page: Page) => page.getByRole('button', { name: 'Готово', exact: true }).click();

async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

/** The triangular prism, or one over another regular polygon, leaning where asked, with a section type chosen. */
async function prismWith(page: Page, section: string, lean?: string, polygon?: string): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  if (polygon !== undefined) {
    await openSection(page, 'Основа');
    await page.getByLabel('Багатокутник', { exact: true }).selectOption({ label: polygon });
  }
  if (lean !== undefined) {
    await openSection(page, 'Нахил');
    await page.getByLabel('Зміщення X', { exact: true }).fill(lean);
  }
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: section });
  await openAllSections(page);
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

/** A point of the screen along a segment between two vertices, at its share t from the first. */
async function between(page: Page, from: string, to: string, t = 0.5): Promise<{ x: number; y: number }> {
  const [a, b] = [await screenPoint(page, from), await screenPoint(page, to)];
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

async function middleOf(page: Page, corners: readonly string[]): Promise<{ x: number; y: number }> {
  const points = await Promise.all(corners.map((corner) => screenPoint(page, corner)));
  return {
    x: points.reduce((sum, { x }) => sum + x / points.length, 0),
    y: points.reduce((sum, { y }) => sum + y / points.length, 0),
  };
}

const click = async (page: Page, point: { x: number; y: number }) => page.mouse.click(point.x, point.y);

async function download(page: Page): Promise<{ names: string[]; section: Record<string, unknown> }> {
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

test('AB and M on CC₁, picked on the model: the triangle ABM at 1 : 2, the base refused inline at C, ABC₁ at C₁', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await prismWith(page, 'Через ребро або діагональ');
  await page.getByLabel('Спосіб', { exact: true }).selectOption({ label: 'Через точку ребра' });
  await picker(page, /^Відрізок/).click();
  await click(page, await screenPoint(page, 'A'));
  await click(page, await screenPoint(page, 'B'));
  await expect(picker(page, /^Відрізок/)).toContainText('AB');
  await picker(page, /^Точка M/).click();
  await click(page, await between(page, 'C', 'C1', 0.6));
  await expect(picker(page, /^Точка M/)).toContainText('Середина CC₁');
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByRole('button', { name: 'MC₁: збільшити на 1', exact: true }).click();
  await expect(picker(page, /^Точка M/)).toContainText('CM : MC₁ = 1 : 2');
  const third = (await download(page)).section;
  expect(third).toMatchObject({ type: 'through-line', line: ['A', 'B'], method: 'point', pointEdge: ['C', 'C1'] });
  expect(third.pointPercent as number).toBeCloseTo(100 / 3, 9);
  await page.getByLabel('CM', { exact: true }).fill('0');
  await expect(page.getByText('Площина збігається з гранню. Оберіть інше ребро або положення точки M.')).toBeVisible();
  await expect(page.getByText('Модель не оновлено')).toHaveCount(0);
  await page.getByLabel('CM', { exact: true }).fill('1');
  await page.getByLabel('MC₁', { exact: true }).fill('0');
  expect((await download(page)).section).toMatchObject({ pointEdge: ['C', 'C1'], pointPercent: 100 });
  expect(errors).toEqual([]);
});

test('parallel to a lateral face up to the edge CC₁, then to the bases from the top face clicked; two planes and a connector', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await prismWith(page, 'Паралельно грані');
  await picker(page, /^Грань/).click();
  await click(page, await middleOf(page, ['A', 'B', 'B1', 'A1']));
  await expect(picker(page, /^Грань/)).toContainText('ABB₁A₁');
  await expect(list(page)).toHaveValue('ABB1A1');
  await picker(page, /^Положення/).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await expect(page.getByText('до ребра CC₁, найдальшого від грані')).toBeVisible();
  await expect(page.getByLabel('До CC₁', { exact: true })).toBeVisible();
  await page.getByLabel('Від ABB₁A₁', { exact: true }).fill('1');
  await page.getByLabel('До CC₁', { exact: true }).fill('1');
  expect((await download(page)).section).toMatchObject({ type: 'face-parallel', face: 'ABB1A1', positionPercent: 50 });
  // The bases, from ABC at 1 : 2, then the top face clicked: the same plane, read 2 : 1.
  await picker(page, /^Грань/).click();
  await list(page).selectOption({ label: 'ABC ∥ A₁B₁C₁' });
  await picker(page, /^Положення/).click();
  await page.getByLabel('Від ABC', { exact: true }).fill('1');
  await page.getByLabel('До A₁B₁C₁', { exact: true }).fill('2');
  await picker(page, /^Грань/).click();
  await click(page, await middleOf(page, ['A1', 'B1', 'C1']));
  await expect(picker(page, /^Грань/)).toContainText('A₁B₁C₁');
  await expect(picker(page, /^Положення/)).toContainText('2 : 1');
  const top = (await download(page)).section;
  expect(top.face).toBe('A1B1C1');
  expect(top.positionPercent as number).toBeCloseTo(200 / 3, 9);
  await done(page);
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await openSection(page, 'Кріплення');
  await page.getByLabel('Тип кріплення', { exact: true }).selectOption({ label: 'Знімні штифти' });
  const two = await download(page);
  expect(two.section).toMatchObject({ face: 'A1B1C1', secondPositionPercent: expect.any(Number) });
  expect(two.names).toEqual(
    expect.arrayContaining(['prism-3-sided-lower-part', 'prism-3-sided-middle-part', 'prism-3-sided-upper-part']),
  );
  expect(errors).toEqual([]);
});

test('an oblique prism: a median by an upper vertex, its trace drawn; the lateral edges by a click', async ({ page }) => {
  const errors = collectErrors(page);
  await prismWith(page, 'Поздовжній', '0,5');
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через медіану (= висоту)' });
  await picker(page, /^З вершини/).click();
  await click(page, await screenPoint(page, 'B1'));
  await expect(picker(page, /^З вершини/)).toContainText('B');
  await expect(list(page)).toHaveValue('B');
  await expect(page.locator('.overlay .trace-line.in-plane')).toHaveCount(1);
  expect((await download(page)).section).toMatchObject({ trace: 'median', traceVertex: 'B', through: true });
  await done(page);
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Похилий' });
  await openAllSections(page);
  await expect(page.getByRole('button', { name: 'Перпендикулярно бічним ребрам', exact: true })).toHaveCount(0);
  await picker(page, /^Перпендикулярно до/).click();
  await click(page, await between(page, 'C', 'C1', 0.4));
  await expect(picker(page, /^Перпендикулярно до/)).toContainText('бічні ребра');
  expect((await download(page)).section).toMatchObject({ type: 'inclined', normalAlong: ['A', 'A1'] });
  // No body diagonals to offer.
  const groups = await list(page)
    .locator('optgroup')
    .evaluateAll((found) => found.map((group) => group.getAttribute('label')));
  expect(groups).toEqual(['Ребра', 'Діагоналі граней']);
  expect(errors).toEqual([]);
});

/** The overlay's section outlines, the first plane's and the second's, as screen points. */
const outlines = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.overlay polygon.section'), (polygon) => {
      const frame = ((polygon as SVGPolygonElement).ownerSVGElement as SVGSVGElement).getBoundingClientRect();
      return {
        second: polygon.classList.contains('second'),
        points: (polygon.getAttribute('points') ?? '')
          .trim()
          .split(/\s+/)
          .map((pair) => {
            const [x, y] = pair.split(',').map(Number) as [number, number];
            return [frame.left + x, frame.top + y] as [number, number];
          }),
      };
    }),
  );
const near = (points: readonly [number, number][], { x, y }: { x: number; y: number }) =>
  points.some(([px, py]) => Math.hypot(px - x, py - y) < 3);

test('an oblique pentagonal prism: its five base diagonals, one by two vertices across a turn; a lateral face up to DD₁', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await prismWith(page, 'Поздовжній', '0,4', 'Правильний п’ятикутник');
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через діагональ' });
  await picker(page, /^Діагональ/).click();
  expect(await list(page).locator('option').allTextContents()).toEqual([
    'AC (і A₁C₁)',
    'AD (і A₁D₁)',
    'BD (і B₁D₁)',
    'BE (і B₁E₁)',
    'CE (і C₁E₁)',
  ]);
  // At first only the chosen family, AC and A₁C₁, is drawn, not every diagonal of both bases; after A, its own two diagonals.
  const drawnLines = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.overlay .offered:not(.hover-preview)'), (line) =>
        line.getAttribute('data-line'),
      ).sort(),
    );
  await expect.poll(drawnLines).toEqual(['A-C', 'A1-C1']);
  await click(page, await screenPoint(page, 'A'));
  await expect(page.getByText('Перша вершина — A.', { exact: false })).toBeVisible();
  await expect.poll(drawnLines).toEqual(['A-C', 'A-D', 'A1-C1']);
  // B is refused with the reason, and A stays.
  await click(page, await screenPoint(page, 'B'));
  await expect(
    page.getByText('A і B — сусідні вершини основи, тож AB — її сторона, а не діагональ.', { exact: false }),
  ).toBeVisible();
  // Turned by a drag in between, which picks nothing; then D.
  const box = await previewViewport(page).boundingBox();
  if (box === null) throw new Error('No preview.');
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85 - 80, box.y + box.height * 0.8 - 15, { steps: 8 });
  await page.mouse.up();
  await click(page, await screenPoint(page, 'D'));
  await expect(picker(page, /^Діагональ/)).toContainText('AD');
  await expect(list(page)).toHaveValue('A-D');
  const section = (await download(page)).section;
  expect(section).toMatchObject({ type: 'longitudinal', trace: 'diagonal', traceSegment: ['A', 'D'], through: true });
  // The upper base's copy, clicked by its ends: the same section.
  await click(page, await screenPoint(page, 'D1'));
  await click(page, await screenPoint(page, 'A1'));
  expect((await download(page)).section).toEqual(section);
  await done(page);
  // A lateral face has no parallel one: its far side is the lateral edge DD₁.
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Паралельно грані' });
  await openAllSections(page);
  await picker(page, /^Грань/).click();
  expect(await list(page).locator('option').count()).toBe(6);
  // The model was turned away from ABB₁A₁ above: by name.
  await list(page).selectOption({ label: 'ABB₁A₁' });
  await expect(picker(page, /^Грань/)).toContainText('ABB₁A₁');
  await picker(page, /^Положення/).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await expect(page.getByLabel('До DD₁', { exact: true })).toBeVisible();
  await page.getByLabel('До DD₁', { exact: true }).fill('2');
  const parallel = (await download(page)).section;
  expect(parallel).toMatchObject({ type: 'face-parallel', face: 'ABB1A1' });
  expect(parallel.positionPercent as number).toBeCloseTo(100 / 3, 9);
  expect(errors).toEqual([]);
});

test('a hexagonal prism: the short diagonal AC with a second plane, the first kept through AC; the square prism’s AC and M', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await prismWith(page, 'Поздовжній', undefined, 'Правильний шестикутник');
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через діагональ' });
  await picker(page, /^Діагональ/).click();
  await click(page, await screenPoint(page, 'C'));
  await click(page, await screenPoint(page, 'A'));
  await expect(list(page)).toHaveValue('A-C');
  const first = (await download(page)).section;
  expect(first).toMatchObject({ traceSegment: ['A', 'C'], through: true });
  await done(page);
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await openSection(page, 'Кріплення');
  await page.getByLabel('Тип кріплення', { exact: true }).selectOption({ label: 'Знімні штифти' });
  const two = await download(page);
  expect(two.section).toMatchObject({ traceSegment: ['A', 'C'], through: true, positionPercent: first.positionPercent });
  expect(two.section.secondPositionPercent).toEqual(expect.any(Number));
  expect(two.names.filter((name) => !name.includes('dowel'))).toHaveLength(3);
  // In the construction view, the first plane's outline, orange, runs through A and C; the second's, green, does not.
  await picker(page, /^Діагональ/).click();
  await expect.poll(async () => (await outlines(page)).length).toBe(2);
  const [a, c] = [await screenPoint(page, 'A'), await screenPoint(page, 'C')];
  const drawn = await outlines(page);
  const orange = drawn.find(({ second }) => !second)?.points ?? [];
  const green = drawn.find(({ second }) => second)?.points ?? [];
  expect(near(orange, a) && near(orange, c)).toBe(true);
  expect(near(green, a) || near(green, c)).toBe(false);
  await done(page);
  // A square prism: its base diagonal AC by two vertices, and M on a lateral edge at 1 : 2.
  await prismWith(page, 'Через ребро або діагональ', '0,3', 'Квадрат');
  await page.getByLabel('Спосіб', { exact: true }).selectOption({ label: 'Через точку ребра' });
  await picker(page, /^Відрізок/).click();
  await click(page, await screenPoint(page, 'A'));
  await click(page, await screenPoint(page, 'C'));
  await expect(picker(page, /^Відрізок/)).toContainText('AC');
  await picker(page, /^Точка M/).click();
  await click(page, await between(page, 'B', 'B1', 0.6));
  await expect(picker(page, /^Точка M/)).toContainText('Середина BB₁');
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByRole('button', { name: 'MB₁: збільшити на 1', exact: true }).click();
  await expect(picker(page, /^Точка M/)).toContainText('BM : MB₁ = 1 : 2');
  const point = (await download(page)).section;
  expect(point).toMatchObject({ type: 'through-line', line: ['A', 'C'], method: 'point', pointEdge: ['B', 'B1'] });
  expect(point.pointPercent as number).toBeCloseTo(100 / 3, 9);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a lateral face tapped and two vertices of a lateral face tapped', async ({ page }) => {
    const errors = collectErrors(page);
    await prismWith(page, 'Паралельно грані');
    await picker(page, /^Грань/).click();
    const face = await middleOf(page, ['A', 'B', 'B1', 'A1']);
    await page.touchscreen.tap(face.x, face.y);
    await expect(picker(page, /^Грань/)).toContainText('ABB₁A₁');
    await done(page);
    await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через ребро або діагональ' });
    await openAllSections(page);
    await picker(page, /^Відрізок/).click();
    const [a, b1] = [await screenPoint(page, 'A'), await screenPoint(page, 'B1')];
    await page.touchscreen.tap(a.x, a.y);
    await page.touchscreen.tap(b1.x, b1.y);
    await expect(picker(page, /^Відрізок/)).toContainText('AB₁');
    expect(errors).toEqual([]);
  });

  test('a hexagonal prism’s long diagonal tapped by its two ends', async ({ page }) => {
    const errors = collectErrors(page);
    await prismWith(page, 'Поздовжній', '0,3', 'Правильний шестикутник');
    await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через діагональ' });
    await picker(page, /^Діагональ/).click();
    const [b, e] = [await screenPoint(page, 'B'), await screenPoint(page, 'E')];
    await page.touchscreen.tap(b.x, b.y);
    await page.touchscreen.tap(e.x, e.y);
    await expect(list(page)).toHaveValue('B-E');
    expect((await download(page)).section).toMatchObject({ traceSegment: ['B', 'E'], through: true, positionPercent: 50 });
    expect(errors).toEqual([]);
  });
});
