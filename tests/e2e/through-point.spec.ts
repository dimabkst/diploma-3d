import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { MODEL_SETTINGS_PATH } from '../../packages/engine/src/export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openAllSections, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const picker = (page: Page, name: RegExp) => page.getByRole('button', { name });
const SEGMENT = /^Відрізок/;
const POINT = /^Точка M/;

async function choosePilot(page: Page, shape = 'Куб'): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: shape });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через ребро або діагональ' });
  await openAllSections(page);
  await page.getByLabel('Спосіб', { exact: true }).selectOption({ label: 'Через точку ребра' });
  await expectLoaded(page);
}

/** The preview loads its model while it is in view, which on a phone is above the controls. */
async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

/** Where model-viewer shows a point of the construction, in page coordinates, once the assembled solid is on screen. */
async function screenPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  await expectLoaded(page);
  await page.waitForTimeout(400);
  // The vertex's own label's anchor, which model-viewer keeps in place under the construction view's labels.
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

/** How opaque the solid's own faces are drawn, and where the camera is. */
const look = (page: Page) =>
  page.evaluate(() => {
    const viewer = document.querySelector('model-viewer') as unknown as {
      model?: { materials: { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[] };
      getCameraOrbit(): { theta: number; phi: number };
    };
    const surface = viewer.model?.materials.find(({ name }) => name === 'surface');
    const { theta, phi } = viewer.getCameraOrbit();
    return { alpha: surface?.pbrMetallicRoughness.baseColorFactor[3], theta, phi };
  });

async function downloadSection(page: Page) {
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

test('cube: AB₁ picked on the model and M on DD₁ by ratio, the same as by name, in a translucent view', async ({ page }) => {
  const errors = collectErrors(page);
  await choosePilot(page);
  await picker(page, SEGMENT).click();
  await expect(page.getByText(/^Оберіть ребро або дві вершини однієї грані/)).toBeVisible();
  // A short click picks A; a drag only turns the camera and picks nothing.
  await page.mouse.click(...(Object.values(await screenPoint(page, 'A')) as [number, number]));
  await expect(page.getByText(/^Перша вершина — A\./)).toBeVisible();
  const c = await screenPoint(page, 'C');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 60, c.y + 15, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText(/^Перша вершина — A\./)).toBeVisible();
  await page.mouse.click(...(Object.values(await screenPoint(page, 'B1')) as [number, number]));
  await expect(picker(page, SEGMENT)).toContainText('AB₁');
  const constructing = await look(page);
  expect(constructing.alpha).toBeLessThan(0.5);
  // M: its edge from the list, at the midpoint at once, then a ratio; switching fields keeps the view and the camera.
  await picker(page, POINT).click();
  await expect(page.getByText(/^Оберіть ребро для точки M/)).toBeVisible();
  await page.getByLabel('Ребро зі списку', { exact: true }).selectOption({ label: 'Ребро DD₁' });
  await expect(picker(page, POINT)).toContainText('Середина DD₁');
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByLabel('DM', { exact: true }).fill('2');
  await page.getByLabel('MD₁', { exact: true }).fill('4');
  await expect(picker(page, POINT)).toContainText('DM : MD₁ = 2 : 4');
  await expectLoaded(page);
  const switched = await look(page);
  expect(switched.alpha).toBe(constructing.alpha);
  expect(switched.theta).toBeCloseTo(constructing.theta, 6);
  expect(switched.phi).toBeCloseTo(constructing.phi, 6);
  // Reopening either field shows what it holds.
  await picker(page, SEGMENT).click();
  await expect(page.getByLabel('Або зі списку', { exact: true })).toHaveValue('A-B1');
  await picker(page, POINT).click();
  await expect(page.getByLabel('DM', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('MD₁', { exact: true })).toHaveValue('4');
  // Done: the solid as usual again.
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect.poll(async () => (await look(page)).alpha).toBe(1);
  const picked = await downloadSection(page);
  expect(picked.names).toEqual(['cube-part-1', 'cube-part-2']);
  expect(picked.section).toMatchObject({ type: 'through-line', line: ['A', 'B1'], pointEdge: ['D', 'D1'] });
  expect(picked.section.pointPercent).toBeCloseTo(100 / 3, 9);
  // By name alone, the same construction.
  await picker(page, SEGMENT).click();
  await page.getByLabel('Або зі списку', { exact: true }).selectOption({ label: 'AB — ребро' });
  await page.getByLabel('Або зі списку', { exact: true }).selectOption({ label: 'AB₁ — діагональ грані' });
  await expectLoaded(page);
  expect((await downloadSection(page)).section).toEqual(picked.section);
  expect(errors).toEqual([]);
});

const FACE_WARNING = 'Площина збігається з гранню. Оберіть інше ребро або положення точки M.';
const segmentList = (page: Page) => page.getByLabel('Або зі списку', { exact: true });
const edgeList = (page: Page) => page.getByLabel('Ребро зі списку', { exact: true });
const separation = (page: Page) => page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
const addSecond = (page: Page) => page.getByRole('button', { name: 'Додати паралельний переріз', exact: true });

/** What the preview shows of a section: the materials of the model on screen, and the outline drawn over it. */
const shownSection = (page: Page) =>
  page.evaluate(() => {
    const viewer = document.querySelector('model-viewer') as unknown as { model?: { materials: { name: string }[] } };
    const names = viewer.model?.materials.map(({ name }) => name) ?? [];
    return {
      cut: names.some((name) => name === 'cut' || name.startsWith('plane-')),
      outline: document.querySelectorAll('.overlay .section').length > 0,
      m: document.querySelectorAll('.overlay .m').length > 0,
      ineligibleEdge: document.querySelectorAll('.overlay .point-edge.ineligible').length > 0,
    };
  });

/** A valid construction: its section on screen, outlined while the construction is open, and every action that needs it. */
async function expectSection(page: Page, open = true): Promise<void> {
  await expectLoaded(page);
  await expect(page.getByText(FACE_WARNING)).toHaveCount(0);
  await expect.poll(async () => (await shownSection(page)).cut).toBe(true);
  await expect.poll(async () => (await shownSection(page)).outline).toBe(open);
  await expect(partsButton(page)).toBeEnabled();
  await expect(addSecond(page)).toBeEnabled();
  await expect(separation(page)).toBeEnabled();
}

/** A construction that gives a face: said beneath the fields, the plain solid with the draft on it, and nothing to export. */
async function expectFaceDraft(page: Page): Promise<void> {
  await expect(page.getByText(FACE_WARNING)).toBeVisible();
  await expectLoaded(page);
  await expect(page.getByText('Модель не оновлено')).toHaveCount(0);
  await expect.poll(async () => (await shownSection(page)).cut).toBe(false);
  expect(await shownSection(page)).toMatchObject({ outline: false, m: true });
  await expect(partsButton(page)).toBeDisabled();
  await expect(addSecond(page)).toBeDisabled();
  await expect(separation(page)).toBeDisabled();
  await expect(
    page.getByText('Паралельний переріз, розсування частин і завантаження стануть доступні, щойно побудова дасть переріз.'),
  ).toBeVisible();
  expect((await look(page)).alpha).toBeLessThan(0.5);
}

for (const shape of ['Куб', 'Прямокутний паралелепіпед', 'Паралелепіпед']) {
  test(`${shape}: a segment that gives a face with M keeps both, says so inline, and either change restores a section`, async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await choosePilot(page, shape);
    // A: AB₁ and M at the midpoint of DD₁.
    await picker(page, SEGMENT).click();
    await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
    await picker(page, POINT).click();
    await edgeList(page).selectOption({ label: 'Ребро DD₁' });
    await expect(picker(page, POINT)).toContainText('Середина DD₁');
    await expectSection(page);
    const camera = await look(page);
    // B: A₁D₁ keeps M: the face ADD₁A₁, and M's edge marked as the one that gives none.
    await picker(page, SEGMENT).click();
    await segmentList(page).selectOption({ label: 'A₁D₁ — ребро' });
    await expect(picker(page, SEGMENT)).toContainText('A₁D₁');
    await expect(picker(page, POINT)).toContainText('Середина DD₁');
    await expectFaceDraft(page);
    expect((await shownSection(page)).ineligibleEdge).toBe(true);
    await picker(page, POINT).click();
    await expect(edgeList(page)).toHaveValue('D-D1');
    await expect(edgeList(page).locator('option:checked')).toHaveText('Ребро DD₁ — не дає перерізу');
    // C: back to AB₁, the section at once.
    await picker(page, SEGMENT).click();
    await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
    await expectSection(page);
    // D: A₁D₁ again, with M at the midpoint of BB₁: a section through the interior.
    await segmentList(page).selectOption({ label: 'A₁D₁ — ребро' });
    await expectFaceDraft(page);
    await picker(page, POINT).click();
    await edgeList(page).selectOption({ label: 'Ребро BB₁' });
    await expect(picker(page, POINT)).toContainText('Середина BB₁');
    await expectSection(page);
    // Neither the camera nor the construction view moved meanwhile.
    const after = await look(page);
    expect(after.theta).toBeCloseTo(camera.theta, 6);
    expect(after.phi).toBeCloseTo(camera.phi, 6);
    expect(errors).toEqual([]);
  });
}

test('the ratio’s arrows step each part by 1, keep fractions and the field open, and stop before 0 : 0', async ({ page }) => {
  const errors = collectErrors(page);
  await choosePilot(page);
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await picker(page, POINT).click();
  await edgeList(page).selectOption({ label: 'Ребро DD₁' });
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await expect(picker(page, POINT)).toContainText('DM : MD₁ = 1 : 1');
  const camera = await look(page);
  const arrow = (part: string, direction: 'збільшити' | 'зменшити') =>
    page.getByRole('button', { name: `${part}: ${direction} на 1`, exact: true });
  await arrow('MD₁', 'збільшити').click();
  await expect(picker(page, POINT)).toContainText('DM : MD₁ = 1 : 2');
  await expectSection(page);
  expect((await downloadSection(page)).section.pointPercent).toBeCloseTo(100 / 3, 9);
  await arrow('MD₁', 'зменшити').click();
  await expect(picker(page, POINT)).toContainText('DM : MD₁ = 1 : 1');
  // The field stays open in its mode, and the camera where it was.
  await expect(picker(page, POINT)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('radio', { name: 'За відношенням' })).toBeChecked();
  const after = await look(page);
  expect(after.theta).toBeCloseTo(camera.theta, 6);
  // A typed fraction steps by a whole 1, as typed.
  await page.getByLabel('DM', { exact: true }).fill('1,5');
  await arrow('DM', 'збільшити').click();
  await expect(page.getByLabel('DM', { exact: true })).toHaveValue('2,5');
  // Down to 0 : 1, and no further; and MD₁ cannot then reach 0.
  await page.getByLabel('DM', { exact: true }).fill('1');
  await arrow('DM', 'зменшити').click();
  await expect(page.getByLabel('DM', { exact: true })).toHaveValue('0');
  await expect(arrow('DM', 'зменшити')).toBeDisabled();
  await expect(arrow('MD₁', 'зменшити')).toBeDisabled();
  await expect(picker(page, POINT)).toContainText('DM : MD₁ = 0 : 1');
  await expectSection(page);
  // The arrow keys in an entry do the same.
  await page.getByLabel('DM', { exact: true }).press('ArrowUp');
  await expect(page.getByLabel('DM', { exact: true })).toHaveValue('1');
  // Closed and reopened: the same mode and ratio.
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await picker(page, POINT).click();
  await expect(page.getByRole('radio', { name: 'За відношенням' })).toBeChecked();
  await expect(page.getByLabel('DM', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('MD₁', { exact: true })).toHaveValue('1');
  expect(errors).toEqual([]);
});

test('a ratio not valid, M on the segment’s line and a part too thin are each said at the construction, not over the model', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await choosePilot(page);
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await picker(page, POINT).click();
  await edgeList(page).selectOption({ label: 'Ребро AD' });
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  // A typed draft that is no number: beside the ratio, the entry marked, the model as it was.
  await page.getByLabel('AM', { exact: true }).fill('abc');
  await expect(page.getByLabel('AM', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#cube-through-point-point-error')).toBeVisible();
  await expect(page.getByText('Модель не оновлено')).toHaveCount(0);
  await expect(partsButton(page)).toBeDisabled();
  // 0 : 1 puts M at A, on AB₁.
  await page.getByLabel('AM', { exact: true }).fill('0');
  await expect(
    page.getByText(
      'Точка M лежить на прямій вибраного відрізка, тож площину не визначено. Оберіть інше ребро або положення точки.',
    ),
  ).toBeVisible();
  await expectLoaded(page);
  await expect(page.getByText('Модель не оновлено')).toHaveCount(0);
  // 1 : 0, M at D: the plane AB₁D cuts the cube.
  await page.getByLabel('AM', { exact: true }).fill('1');
  await page.getByLabel('MD', { exact: true }).fill('0');
  await expectSection(page);
  // B₁D₁ with M near A₁ cuts off a corner too thin to print.
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'B₁D₁ — діагональ грані' });
  await picker(page, POINT).click();
  await edgeList(page).selectOption({ label: 'Ребро AA₁' });
  await page.getByLabel('AM', { exact: true }).fill('99');
  await page.getByLabel('MA₁', { exact: true }).fill('1');
  await expect(page.getByText(/^За цього положення M одна з частин була б надто тонкою\./)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await page.getByLabel('AM', { exact: true }).fill('1');
  await expectSection(page);
  expect(errors).toEqual([]);
});

test('a second vertex off the first one’s faces is refused with a reason, and the first stays', async ({ page }) => {
  const errors = collectErrors(page);
  await choosePilot(page);
  await picker(page, SEGMENT).click();
  await page.mouse.click(...(Object.values(await screenPoint(page, 'A')) as [number, number]));
  await expect(page.getByText(/^Перша вершина — A\./)).toBeVisible();
  // C₁ lies in no face with A: AC₁ is a diagonal of the solid.
  await page.mouse.click(...(Object.values(await screenPoint(page, 'C1')) as [number, number]));
  await expect(
    page.getByText('A і C₁ не лежать в одній грані, тож відрізок AC₁ не підходить. Оберіть підсвічену вершину.'),
  ).toBeVisible();
  await expect(page.getByText(/^Перша вершина — A\./)).toBeVisible();
  await page.mouse.click(...(Object.values(await screenPoint(page, 'C')) as [number, number]));
  await expect(picker(page, SEGMENT)).toContainText('AC');
  await expect(page.getByText(/не лежать в одній грані/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a valid construction keeps its second plane, connector, separation and parts download', async ({ page }) => {
  const errors = collectErrors(page);
  await choosePilot(page, 'Прямокутний паралелепіпед');
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await picker(page, POINT).click();
  await edgeList(page).selectOption({ label: 'Ребро DD₁' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expectSection(page, false);
  await openSection(page, 'Кріплення');
  await page.getByLabel('Тип кріплення', { exact: true }).selectOption({ label: 'Знімні штифти' });
  await expectSection(page, false);
  const joined = await downloadSection(page);
  expect(joined.names).toEqual(['cuboid-part-1', 'cuboid-part-2', 'cuboid-dowel-1']);
  expect(joined.section).toMatchObject({ line: ['A', 'B1'], pointEdge: ['D', 'D1'] });
  // A face for a moment: the connector stays chosen, and comes back with the section.
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'A₁D₁ — ребро' });
  await expectFaceDraft(page);
  await expect(page.getByLabel('Тип кріплення', { exact: true })).toHaveValue('dowel');
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expectSection(page, false);
  await addSecond(page).click();
  await expectLoaded(page);
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('a new shape of the solid keeps the drafted segment, M and its ratio, also while they give a face', async ({ page }) => {
  const errors = collectErrors(page);
  await choosePilot(page, 'Прямокутний паралелепіпед');
  await picker(page, POINT).click();
  await edgeList(page).selectOption({ label: 'Ребро DD₁' });
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await page.getByLabel('DM', { exact: true }).fill('1');
  await page.getByLabel('MD₁', { exact: true }).fill('2');
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'A₁D₁ — ребро' });
  await expectFaceDraft(page);
  await openSection(page, 'Розміри');
  await page.getByLabel('Ширина AD', { exact: true }).fill('1,6');
  await expectFaceDraft(page);
  await expect(picker(page, SEGMENT)).toContainText('A₁D₁');
  await expect(picker(page, POINT)).toContainText('DM : MD₁ = 1 : 2');
  // The segment's field is still open.
  await expect(picker(page, SEGMENT)).toHaveAttribute('aria-expanded', 'true');
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await expectSection(page);
  expect((await downloadSection(page)).section).toMatchObject({ line: ['A', 'B1'], pointEdge: ['D', 'D1'] });
  expect(errors).toEqual([]);
});

test('the mouse over an element a tap would choose shows the pointer, and only there', async ({ page }) => {
  await choosePilot(page);
  await picker(page, SEGMENT).click();
  const hovering = () => page.locator('model-viewer').evaluate((viewer) => viewer.hasAttribute('data-construction-hover'));
  const a = await screenPoint(page, 'A');
  await page.mouse.move(a.x, a.y);
  await expect.poll(hovering).toBe(true);
  await expect(page.locator('.overlay .target-vertex.hover')).toHaveCount(1);
  const box = await page.locator('model-viewer').boundingBox();
  if (box === null) throw new Error('No viewer on screen.');
  await page.mouse.move(box.x + 12, box.y + 12);
  await expect.poll(hovering).toBe(false);
});

type Frame = {
  readonly same: boolean;
  readonly surface: number | null;
  readonly hidden: readonly (number | null)[];
  readonly m: string | null;
  readonly outline: string | null;
  readonly labels: number;
  /** The model's own outlines drawn, which the construction replaces with its edges and sections; null without the scene. */
  readonly outlines: number | null;
};

/** Records, every frame, what the preview shows of the construction: the solid's look, M, the first section and the labels. */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewer = document.querySelector('model-viewer') as unknown as HTMLElement & {
      model?: { materials: { name: string; isLoaded: boolean; pbrMetallicRoughness: { baseColorFactor: number[] } }[] };
    };
    const record = window as unknown as { frames: Frame[]; sampling: number };
    record.frames = [];
    const alpha = (material: { isLoaded: boolean; pbrMetallicRoughness: { baseColorFactor: number[] } } | undefined) =>
      material?.isLoaded === true ? (material.pbrMetallicRoughness.baseColorFactor[3] ?? null) : null;
    // model-viewer's three.js scene, private: the outlines are lines there, out of reach of its material API.
    const sceneKey = Object.getOwnPropertySymbols(viewer).find((symbol) => symbol.description === 'scene');
    const scene =
      sceneKey === undefined
        ? undefined
        : (
            viewer as unknown as Record<
              symbol,
              { traverse(visit: (object: { isLineSegments?: boolean; visible: boolean }) => void): void }
            >
          )[sceneKey];
    const outlines = () => {
      if (scene === undefined) return null;
      let shown = 0;
      scene.traverse((object) => {
        if (object.isLineSegments === true && object.visible) shown += 1;
      });
      return shown;
    };
    const step = () => {
      const materials = viewer.model?.materials ?? [];
      const m = document.querySelector('.overlay .m');
      record.frames.push({
        same: document.querySelector('model-viewer') === viewer && viewer.isConnected,
        surface: alpha(materials.find(({ name }) => name === 'surface')),
        hidden: materials.filter(({ name }) => name === 'cut' || /^plane-\d$/.test(name)).map(alpha),
        m: m === null ? null : `${m.getAttribute('cx')},${m.getAttribute('cy')}`,
        outline: document.querySelector('.overlay .section')?.getAttribute('points') ?? null,
        labels: document.querySelectorAll('.labels .point-label').length,
        outlines: outlines(),
      });
      record.sampling = requestAnimationFrame(step);
    };
    step();
  });
}

async function stopSampling(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const record = window as unknown as { frames: Frame[]; sampling: number };
    cancelAnimationFrame(record.sampling);
    return record.frames;
  });
}

test('every frame of an edit shows the translucent solid with its labels, and M moves only with its section', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await choosePilot(page);
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await picker(page, POINT).click();
  await edgeList(page).selectOption({ label: 'Ребро DD₁' });
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await expectSection(page);
  await startSampling(page);
  // Quick steps of the ratio, each built in turn; a turn of the model while they are built.
  const up = page.getByRole('button', { name: 'MD₁: збільшити на 1', exact: true });
  for (let step = 0; step < 4; step += 1) await up.click();
  const box = await page.locator('model-viewer').boundingBox();
  if (box === null) throw new Error('No viewer on screen.');
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect(picker(page, POINT)).toContainText('DM : MD₁ = 1 : 5');
  await expectSection(page);
  // A face, then a section again, and the other field.
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'A₁D₁ — ребро' });
  await expect(page.getByText(FACE_WARNING)).toBeVisible();
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await picker(page, POINT).click();
  await page.getByRole('button', { name: 'MD₁: зменшити на 1', exact: true }).click();
  await expectSection(page);
  const frames = await stopSampling(page);
  expect(frames.length).toBeGreaterThan(30);
  for (const frame of frames) {
    expect(frame.same).toBe(true);
    // The original solid, faint, in every frame: never opaque, never its cut faces.
    expect(frame.surface).toBeCloseTo(0.18, 6);
    for (const hidden of frame.hidden) expect(hidden ?? 0).toBe(0);
    // Nor its outlines, so that a replaced section's rim never shows beside the new one while its model is built.
    expect(frame.outlines).toBe(0);
    expect(frame.labels).toBeGreaterThanOrEqual(8);
  }
  // Wherever M moved, its section moved in that same frame.
  for (const [index, frame] of frames.entries()) {
    const previous = frames[index - 1];
    if (previous === undefined || previous.m === frame.m || frame.outline === null) continue;
    expect(frame.outline).not.toBe(previous.outline);
  }
  expect(new Set(frames.map(({ m }) => m)).size).toBeGreaterThan(4);
  expect(errors).toEqual([]);
});

test('labels stay above the construction, beside their vertices, also behind the solid', async ({ page }) => {
  await choosePilot(page);
  await picker(page, SEGMENT).click();
  await segmentList(page).selectOption({ label: 'AB₁ — діагональ грані' });
  await expectSection(page);
  // The model-viewer labels give way to the construction's own, drawn above its lines: eight vertices and M.
  await expect(page.locator('model-viewer .point-label').first()).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.labels .point-label')).toHaveCount(9);
  for (const orbit of ['35deg 62deg auto', '215deg 118deg auto']) {
    await page.locator('model-viewer').evaluate((viewer, value) => {
      (viewer as unknown as { cameraOrbit: string; jumpCameraToGoal(): void }).cameraOrbit = value;
      (viewer as unknown as { jumpCameraToGoal(): void }).jumpCameraToGoal();
    }, orbit);
    await page.waitForTimeout(300);
    // What is topmost at each label's centre; the labels let the pointer through, so they take it for this check only.
    const placed = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll<HTMLElement>('.labels .point-label'));
      for (const label of labels) label.style.pointerEvents = 'auto';
      const found = labels.map((label) => {
        const box = label.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          text: label.textContent,
          hidden: label.classList.contains('hidden'),
          onTop: top === label || label.contains(top) || top?.classList.contains('point-label') === true,
        };
      });
      for (const label of labels) label.style.pointerEvents = '';
      return found;
    });
    // Some labels in front, some behind, each readable: nothing of the construction drawn over it.
    expect(placed.filter(({ hidden }) => hidden).length).toBeGreaterThan(0);
    expect(placed.filter(({ hidden }) => !hidden).length).toBeGreaterThan(0);
    expect(placed.filter(({ onTop }) => !onTop)).toEqual([]);
    // Each beside its vertex: its centre a little away from the vertex the hotspot marks.
    for (const id of ['A', 'C1']) {
      const vertex = await screenPoint(page, id);
      const label = page.locator('.labels .point-label', { hasText: new RegExp(`^${id.replace('1', '₁')}$`) });
      const box = await label.boundingBox();
      if (box === null) throw new Error(`No label ${id}.`);
      const distance = Math.hypot(box.x + box.width / 2 - vertex.x, box.y + box.height / 2 - vertex.y);
      expect(distance).toBeGreaterThan(10);
      expect(distance).toBeLessThan(26);
    }
  }
});

test('setting the parts apart ends the construction, which reassembles them while it is open', async ({ page }) => {
  const errors = collectErrors(page);
  await choosePilot(page, 'Прямокутний паралелепіпед');
  const separation = page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
  await expect(separation).toBeChecked();
  await picker(page, POINT).click();
  await expect.poll(async () => (await look(page)).alpha).toBeLessThan(0.5);
  // The switch stays as the user set it; the construction shows the assembled solid meanwhile.
  await expect(separation).toBeChecked();
  await separation.uncheck();
  await separation.check();
  await expect(picker(page, POINT)).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await look(page)).alpha).toBe(1);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a tap picks two vertices of a face, and the list offers every segment without a face first', async ({ page }) => {
    const errors = collectErrors(page);
    await choosePilot(page, 'Паралелепіпед');
    await picker(page, SEGMENT).click();
    const options = await page.getByLabel('Або зі списку', { exact: true }).locator('option').allTextContents();
    expect(options).toContain('AB₁ — діагональ грані');
    expect(options.filter((option) => option.endsWith('ребро')).length).toBeGreaterThan(0);
    await page.touchscreen.tap(...(Object.values(await screenPoint(page, 'A')) as [number, number]));
    await page.touchscreen.tap(...(Object.values(await screenPoint(page, 'B1')) as [number, number]));
    await expect(picker(page, SEGMENT)).toContainText('AB₁');
    // The ratio's arrows answer a finger, and keep the field open.
    await picker(page, POINT).click();
    await page.getByRole('radio', { name: 'За відношенням' }).check();
    const up = page.getByRole('button', { name: 'MC₁: збільшити на 1', exact: true });
    const size = await up.boundingBox();
    expect(size?.height ?? 0).toBeGreaterThanOrEqual(27);
    await up.tap();
    await expect(picker(page, POINT)).toContainText('CM : MC₁ = 1 : 2');
    await expect(picker(page, POINT)).toHaveAttribute('aria-expanded', 'true');
    expect(errors).toEqual([]);
  });
});
