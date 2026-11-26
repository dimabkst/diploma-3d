import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, measureMesh } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const picker = (page: Page, name: RegExp) => page.getByRole('button', { name });
const list = (page: Page, label = 'Або зі списку') => page.getByLabel(label, { exact: true }).filter({ visible: true });
const done = (page: Page) => page.getByRole('button', { name: 'Готово', exact: true }).click();

async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

/** The regular tetrahedron, or a triangular pyramid leaning where asked, with a section type chosen. */
async function pyramidWith(page: Page, section: string, apexX?: string, polygon = 'Рівносторонній трикутник'): Promise<void> {
  await page.goto('/');
  if (apexX === undefined) {
    await shapeSelect(page).selectOption({ label: 'Правильний тетраедр' });
  } else {
    await shapeSelect(page).selectOption({ label: 'Піраміда' });
    await openSection(page, 'Основа');
    await page.getByLabel('Багатокутник', { exact: true }).selectOption({ label: polygon });
    await openSection(page, 'Вершина');
    await page.getByLabel('Зміщення X', { exact: true }).fill(apexX);
  }
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: section });
  await expectLoaded(page);
}

/** Where a vertex is on the page, from its own label's anchor. */
async function screenPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  await expectLoaded(page);
  await page.waitForTimeout(300);
  const point = await page.evaluate((name) => {
    const viewer = document.querySelector('model-viewer') as unknown as HTMLElement & {
      queryHotspot(name: string): { canvasPosition: { x: number; y: number } } | null;
    };
    const slot = Array.from(viewer.querySelectorAll('[slot]'), (element) => element.getAttribute('slot') ?? '').find(
      (candidate) => candidate.startsWith(`hotspot-${name}-`),
    );
    const hit = slot === undefined ? null : viewer.queryHotspot(slot);
    const box = viewer.getBoundingClientRect();
    return hit === null ? null : { x: box.left + hit.canvasPosition.x, y: box.top + hit.canvasPosition.y };
  }, id);
  if (point === null) throw new Error(`No point ${id} on screen.`);
  return point;
}

async function between(page: Page, from: string, to: string, t = 0.5): Promise<{ x: number; y: number }> {
  const [a, b] = [await screenPoint(page, from), await screenPoint(page, to)];
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

const click = async (page: Page, point: { x: number; y: number }) => page.mouse.click(point.x, point.y);

/** The file's section and the volumes of its parts, connectors aside. */
async function download(page: Page): Promise<{ section: Record<string, unknown>; volumes: number[] }> {
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  const { model } = readThreeMf(bytes);
  for (const { mesh } of model.objects) expect(findMeshDefects(mesh)).toEqual([]);
  return {
    section: JSON.parse(readThreeMfPart(bytes, MODEL_SETTINGS_PATH) as string).sourceModel.section,
    volumes: model.objects.filter(({ name }) => !name.includes('dowel')).map(({ mesh }) => measureMesh(mesh).volume),
  };
}

const share = (volumes: readonly number[]) => Math.min(...volumes) / volumes.reduce((sum, volume) => sum + volume, 0);

test('a tetrahedron: parallel to ABC at 1 : 1 to S, an eighth at the apex; AB and M on CS picked on the model, a third at 1 : 2', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await pyramidWith(page, 'Паралельно грані');
  await picker(page, /^Грань/).click();
  expect(await list(page).locator('option').allTextContents()).toEqual(['ABC', 'SAB', 'SBC', 'SCA']);
  await list(page).selectOption({ label: 'ABC' });
  await picker(page, /^Положення/).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await expect(page.getByLabel('До S', { exact: true })).toBeVisible();
  await expect(page.getByText('до вершини S, протилежної грані')).toBeVisible();
  const eighth = await download(page);
  expect(eighth.section).toMatchObject({ type: 'face-parallel', face: 'ABC', positionPercent: 50 });
  expect(share(eighth.volumes)).toBeCloseTo(1 / 8, 3);
  await done(page);
  // Through the base edge AB, its two vertices clicked; M on CS clicked along it, then 1 : 2 by the arrows.
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через ребро основи' });
  await page.getByLabel('Спосіб', { exact: true }).selectOption({ label: 'Через точку ребра' });
  await picker(page, /^Ребро основи/).click();
  await click(page, await screenPoint(page, 'B'));
  await click(page, await screenPoint(page, 'C'));
  await expect(picker(page, /^Ребро основи/)).toContainText('BC');
  // The named list, the field still open, for AB.
  await list(page).selectOption({ label: 'AB — ребро' });
  await picker(page, /^Точка M/).click();
  await click(page, await between(page, 'C', 'S', 0.4));
  await expect(picker(page, /^Точка M/)).toContainText('Середина CS');
  const half = await download(page);
  expect(share(half.volumes)).toBeCloseTo(1 / 2, 3);
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByRole('button', { name: 'MS: збільшити на 1', exact: true }).click();
  await expect(picker(page, /^Точка M/)).toContainText('CM : MS = 1 : 2');
  const third = await download(page);
  expect(third.section).toMatchObject({ line: ['A', 'B'], pointEdge: ['C', 'S'] });
  expect(share(third.volumes)).toBeCloseTo(1 / 3, 3);
  // M at C: the base itself, said inline, the solid kept as it is.
  await page.getByLabel('CM', { exact: true }).fill('0');
  await expect(page.getByText('Площина збігається з гранню. Оберіть інше ребро або положення точки M.')).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  expect(errors).toEqual([]);
});

test('an oblique pyramid: SA clicked with M on BC at 1 : 2; SB with the height through its actual foot', async ({ page }) => {
  const errors = collectErrors(page);
  await pyramidWith(page, 'Через вершину піраміди', '0,2');
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через бічне ребро й точку' });
  await picker(page, /^Бічне ребро/).click();
  await click(page, await between(page, 'S', 'A', 0.5));
  await expect(picker(page, /^Бічне ребро/)).toContainText('SA');
  await picker(page, /^Точка M/).click();
  await click(page, await between(page, 'B', 'C', 0.5));
  await expect(picker(page, /^Точка M/)).toContainText('Середина BC');
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByRole('button', { name: 'MC: збільшити на 1', exact: true }).click();
  await expect(picker(page, /^Точка M/)).toContainText('BM : MC = 1 : 2');
  const point = (await download(page)).section;
  expect(point).toMatchObject({ type: 'through-apex', trace: 'edge-point', traceVertex: 'A', traceSegment: ['B', 'C'] });
  expect(point.tracePointPercent as number).toBeCloseTo(100 / 3, 9);
  await page.getByLabel('BM', { exact: true }).fill('0');
  await expect(page.getByText(/^Точка M збігається з вершиною B: площина SAB — грань піраміди\./)).toBeVisible();
  await page.getByLabel('BM', { exact: true }).fill('1');
  await done(page);
  // Through SB and the height SH: the foot drawn where the apex projects.
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через висоту піраміди' });
  await picker(page, /^Бічне ребро/).click();
  // A lateral edge offered other than SA, by its vertex in the base.
  const offered = await list(page).locator('option').allTextContents();
  const other = offered.find((name) => name !== 'SA') as string;
  await click(page, await screenPoint(page, other.slice(1)));
  await expect(picker(page, /^Бічне ребро/)).toContainText(other);
  await expect(page.locator('.overlay .height-line')).toHaveCount(1);
  expect((await download(page)).section).toMatchObject({ trace: 'height-edge', traceVertex: other.slice(1) });
  expect(errors).toEqual([]);
});

test('a tetrahedron: parallel to SA and BC by one click on SA, both drawn; then perpendicular to SA, and back to the angles', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await pyramidWith(page, 'Похилий');
  await picker(page, /^Паралельно ребрам/).click();
  await click(page, await between(page, 'S', 'A', 0.5));
  await expect(picker(page, /^Паралельно ребрам/)).toContainText('SA і BC');
  const drawn = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.overlay .offered.selected'), (line) => line.getAttribute('data-line')).sort(),
  );
  expect(drawn).toEqual(['B-C', 'S-A']);
  // BC is the same pair.
  await click(page, await between(page, 'B', 'C', 0.5));
  const pair = await download(page);
  expect(pair.section).toMatchObject({
    type: 'inclined',
    parallelTo: [
      ['S', 'A'],
      ['B', 'C'],
    ],
    positionPercent: 50,
  });
  expect(share(pair.volumes)).toBeCloseTo(1 / 2, 3);
  await done(page);
  await picker(page, /^Перпендикулярно до/).click();
  expect(
    await list(page)
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('label'))),
  ).toEqual(['Ребра']);
  await click(page, await between(page, 'S', 'A', 0.5));
  await expect(page.getByText('Обрано: SA — ребро.')).toBeVisible();
  const normal = await download(page);
  expect([...(normal.section.normalAlong as string[])].sort()).toEqual(['A', 'S']);
  await done(page);
  await page.getByRole('button', { name: 'Змінити нахил', exact: true }).click();
  await expect(page.getByLabel('Кут до площини основи', { exact: true })).toBeVisible();
  const manual = await download(page);
  expect(manual.section.normalAlong).toBeUndefined();
  manual.volumes.forEach((volume, index) => {
    expect(Math.abs(volume / (normal.volumes[index] as number) - 1)).toBeLessThan(1e-6);
  });
  expect(errors).toEqual([]);
});

test('a tetrahedron cut by AB and the midpoint of CS takes dowels; a plane through the apex takes a second, parallel one', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await pyramidWith(page, 'Через ребро основи');
  await page.getByLabel('Спосіб', { exact: true }).selectOption({ label: 'Через точку ребра' });
  await openSection(page, 'Кріплення');
  await page.getByLabel('Тип кріплення', { exact: true }).selectOption({ label: 'Знімні штифти' });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const { model } = readThreeMf(new Uint8Array(await readFile(await file.path())));
  expect(model.objects.map(({ name }) => name)).toEqual(expect.arrayContaining(['tetrahedron-dowel-1']));
  for (const { mesh } of model.objects) expect(findMeshDefects(mesh)).toEqual([]);
  await page.getByLabel('Тип кріплення', { exact: true }).selectOption({ label: 'Без кріплення' });
  // Through the apex and the median from C, then a second plane parallel to it, which does not pass through S.
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через вершину піраміди' });
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через медіану (= висоту)' });
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  const two = await download(page);
  expect(two.section).toMatchObject({ type: 'through-apex', trace: 'median', secondPositionPercent: expect.any(Number) });
  expect(two.volumes).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('a leaning hexagonal pyramid: AC by two clicks cuts off a sixth through S, AD halves it; the apex is no diagonal’s end', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await pyramidWith(page, 'Через вершину піраміди', '0,2', 'Правильний шестикутник');
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через діагональ' });
  await picker(page, /^Діагональ/).click();
  const offered = await list(page).locator('option').allTextContents();
  expect(offered).toHaveLength(9);
  expect(offered).toContain('AC — коротша');
  expect(offered).toContain('AD — довша, через центр');
  await click(page, await screenPoint(page, 'S'));
  await expect(page.getByText('Через S не проходить жодна діагональ основи. Оберіть підсвічену вершину.')).toBeVisible();
  await click(page, await screenPoint(page, 'C'));
  await click(page, await screenPoint(page, 'A'));
  await expect(list(page)).toHaveValue('A-C');
  const short = await download(page);
  expect(short.section).toMatchObject({ type: 'through-apex', trace: 'diagonal', traceSegment: ['A', 'C'] });
  expect(share(short.volumes)).toBeCloseTo(1 / 6, 3);
  await list(page).selectOption({ label: 'AD — довша, через центр' });
  const long = await download(page);
  expect(long.section).toMatchObject({ traceSegment: ['A', 'D'] });
  expect(share(long.volumes)).toBeCloseTo(1 / 2, 3);
  await done(page);
  // A second plane, parallel and displaced, not through S: three parts.
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  const two = await download(page);
  expect(two.section).toMatchObject({ traceSegment: ['A', 'D'], secondPositionPercent: expect.any(Number) });
  expect(two.volumes).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('a square pyramid: SAB to CD at 1 : 1; SA with M at C the diagonal section, at B the face; AB and M on CS', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await pyramidWith(page, 'Паралельно грані', '0', 'Квадрат');
  await picker(page, /^Грань/).click();
  await list(page).selectOption({ label: 'SAB' });
  await picker(page, /^Положення/).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await expect(page.getByLabel('До CD', { exact: true })).toBeVisible();
  expect((await download(page)).section).toMatchObject({ type: 'face-parallel', face: 'SAB', positionPercent: 50 });
  await done(page);
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через вершину піраміди' });
  await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через бічне ребро й точку' });
  await picker(page, /^Бічне ребро/).click();
  await click(page, await screenPoint(page, 'A'));
  await expect(picker(page, /^Бічне ребро/)).toContainText('SA');
  await picker(page, /^Точка M/).click();
  expect(await list(page, 'Ребро зі списку').locator('option').allTextContents()).toEqual(['Ребро BC', 'Ребро CD']);
  await click(page, await between(page, 'B', 'C', 0.5));
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByLabel('MC', { exact: true }).fill('0');
  const diagonal = (await download(page)).section;
  expect(diagonal).toMatchObject({ trace: 'edge-point', traceVertex: 'A', traceSegment: ['B', 'C'], tracePointPercent: 100 });
  await page.getByLabel('MC', { exact: true }).fill('1');
  await page.getByLabel('BM', { exact: true }).fill('0');
  await expect(page.getByText(/^Точка M збігається з вершиною B: площина SAB — грань піраміди\./)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await page.getByLabel('BM', { exact: true }).fill('1');
  await done(page);
  // Through AB and M on a lateral edge off it: CS and DS both offered.
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через ребро основи' });
  await page.getByLabel('Спосіб', { exact: true }).selectOption({ label: 'Через точку ребра' });
  await picker(page, /^Точка M/).click();
  expect(await list(page, 'Ребро зі списку').locator('option').allTextContents()).toEqual(
    expect.arrayContaining(['Ребро CS', 'Ребро DS']),
  );
  await click(page, await between(page, 'C', 'S', 0.5));
  await expect(picker(page, /^Точка M/)).toContainText('Середина CS');
  expect((await download(page)).section).toMatchObject({ type: 'through-line', line: ['A', 'B'], pointEdge: ['C', 'S'] });
  expect(errors).toEqual([]);
});

test('a pentagonal pyramid: perpendicular to the base diagonal AC by two clicks, edges and the base’s diagonals listed', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await pyramidWith(page, 'Похилий', '0,2', 'Правильний п’ятикутник');
  await expect(picker(page, /^Паралельно ребрам/)).toHaveCount(0);
  await picker(page, /^Перпендикулярно до/).click();
  expect(
    await list(page)
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((group) => group.getAttribute('label'))),
  ).toEqual(['Ребра', 'Діагоналі граней']);
  await click(page, await screenPoint(page, 'A'));
  await click(page, await screenPoint(page, 'C'));
  await expect(page.getByText('Обрано: AC — діагональ грані.')).toBeVisible();
  expect((await download(page)).section).toMatchObject({ type: 'inclined', normalAlong: ['A', 'C'] });
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a square pyramid’s diagonal BD by two taps', async ({ page }) => {
    const errors = collectErrors(page);
    await pyramidWith(page, 'Через вершину піраміди', '0', 'Квадрат');
    await page.getByLabel('Слід на основі', { exact: true }).selectOption({ label: 'Через діагональ' });
    await picker(page, /^Діагональ/).click();
    const [b, d] = [await screenPoint(page, 'B'), await screenPoint(page, 'D')];
    await page.touchscreen.tap(b.x, b.y);
    await page.touchscreen.tap(d.x, d.y);
    await expect(list(page)).toHaveValue('B-D');
    expect((await download(page)).section).toMatchObject({ trace: 'diagonal', traceSegment: ['B', 'D'] });
    expect(errors).toEqual([]);
  });

  test('a tetrahedron’s base edge by two taps and a pair by a tap', async ({ page }) => {
    const errors = collectErrors(page);
    await pyramidWith(page, 'Через ребро основи');
    await picker(page, /^Ребро основи/).click();
    const [a, c] = [await screenPoint(page, 'A'), await screenPoint(page, 'C')];
    await page.touchscreen.tap(a.x, a.y);
    await page.touchscreen.tap(c.x, c.y);
    await expect(picker(page, /^Ребро основи/)).toContainText('AC');
    await done(page);
    await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Похилий' });
    await picker(page, /^Паралельно ребрам/).click();
    const edge = await between(page, 'S', 'C', 0.5);
    await page.touchscreen.tap(edge.x, edge.y);
    await expect(picker(page, /^Паралельно ребрам/)).toContainText('SC і AB');
    expect(errors).toEqual([]);
  });
});
