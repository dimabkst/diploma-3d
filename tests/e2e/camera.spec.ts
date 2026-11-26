import { expect, type Page, test } from '@playwright/test';
import { collectErrors, modelViewer, openAllSections, openSection, previewViewport, shapeSelect } from './helpers.ts';

type Camera = {
  target: { x: number; y: number; z: number };
  orbit: { theta: number; phi: number; radius: number };
};

const readCamera = (page: Page): Promise<Camera> =>
  modelViewer(page).evaluate((element) => {
    const viewer = element as unknown as {
      getCameraTarget(): Camera['target'];
      getCameraOrbit(): Camera['orbit'];
    };
    const { x, y, z } = viewer.getCameraTarget();
    const { theta, phi, radius } = viewer.getCameraOrbit();
    return { target: { x, y, z }, orbit: { theta, phi, radius } };
  });

/** The camera once it has stopped moving: model-viewer eases every change, so two reads a moment apart agree. */
async function settledCamera(page: Page): Promise<Camera> {
  let previous = await readCamera(page);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(150);
    const current = await readCamera(page);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  throw new Error('The camera kept moving.');
}

/**
 * Digits to which a view must stay the same. A click alone changes nothing. A pick that completes the section replaces the
 * model, and model-viewer refits its automatic target and distance to the new bounds, which moves them by a fraction of a
 * millimetre in metres; a click that recentred on the clicked point would move the target by centimetres.
 */
const EXACT = 6;
const REFITTED = 3;

function expectSameTarget(actual: Camera, expected: Camera, digits = EXACT): void {
  expect(actual.target.x).toBeCloseTo(expected.target.x, digits);
  expect(actual.target.y).toBeCloseTo(expected.target.y, digits);
  expect(actual.target.z).toBeCloseTo(expected.target.z, digits);
}

function expectSameView(actual: Camera, expected: Camera, digits = EXACT): void {
  expectSameTarget(actual, expected, digits);
  expect(actual.orbit.theta).toBeCloseTo(expected.orbit.theta, EXACT);
  expect(actual.orbit.phi).toBeCloseTo(expected.orbit.phi, EXACT);
  expect(actual.orbit.radius).toBeCloseTo(expected.orbit.radius, digits);
}

async function viewerCenter(page: Page): Promise<{ x: number; y: number }> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  const box = await modelViewer(page).boundingBox();
  if (box === null) throw new Error('No viewer on screen.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function expectLoaded(page: Page): Promise<void> {
  await previewViewport(page).scrollIntoViewIfNeeded();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
}

async function drag(page: Page, from: { x: number; y: number }, by: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * Turn, click the solid off its centre and on its middle, turn, click the empty corner, turn: every turn moves the camera
 * about the same centre, and no click moves the centre, the distance or the direction of view.
 */
async function expectClicksKeepView(page: Page): Promise<void> {
  const center = await viewerCenter(page);
  const box = await modelViewer(page).boundingBox();
  if (box === null) throw new Error('No viewer on screen.');
  const initial = await settledCamera(page);
  for (const point of [
    { x: center.x + 45, y: center.y + 30 },
    { x: center.x - 35, y: center.y - 20 },
    center,
    { x: box.x + 12, y: box.y + 12 },
  ]) {
    await drag(page, center, { x: 70, y: 10 });
    const turned = await settledCamera(page);
    expect(turned.orbit.theta).not.toBeCloseTo(initial.orbit.theta, 3);
    expectSameTarget(turned, initial);
    await page.mouse.click(point.x, point.y);
    expectSameView(await settledCamera(page), turned);
  }
}

async function chooseShape(page: Page, shape: string): Promise<void> {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: shape });
  await openAllSections(page);
  await expectLoaded(page);
}

/** The shape's first section, its parts set apart. */
async function separate(page: Page): Promise<void> {
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ index: 1 });
  await openAllSections(page);
  const separation = page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
  await separation.check();
  await expect(page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await expectLoaded(page);
}

for (const shape of ['Куб', 'Прямокутний паралелепіпед', 'Паралелепіпед', 'Циліндр', 'Куля']) {
  test(`${shape}: a click on the solid or beside it keeps the centre of rotation, whole and in parts`, async ({ page }) => {
    // Eight turns and clicks, each waiting for the camera to settle, and the parts generated between them.
    test.slow();
    const errors = collectErrors(page);
    await chooseShape(page, shape);
    await expectClicksKeepView(page);
    await separate(page);
    await expectClicksKeepView(page);
    expect(errors).toEqual([]);
  });
}

test('the wheel still zooms and a right drag still pans, and a click afterwards keeps the panned centre', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseShape(page, 'Куб');
  const center = await viewerCenter(page);
  const initial = await settledCamera(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -300);
  const zoomed = await settledCamera(page);
  expect(zoomed.orbit.radius).toBeLessThan(initial.orbit.radius);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(center.x + 60, center.y + 40, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  const panned = await settledCamera(page);
  expect(
    Math.hypot(panned.target.x - zoomed.target.x, panned.target.y - zoomed.target.y, panned.target.z - zoomed.target.z),
  ).toBeGreaterThan(1e-3);
  await page.mouse.click(center.x + 40, center.y + 25);
  expectSameView(await settledCamera(page), panned);
  // A new size reframes the solid as before, and clicks still leave that frame alone.
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('60');
  await page.getByLabel('Найбільший габарит', { exact: true }).blur();
  await expectLoaded(page);
  await expectClicksKeepView(page);
  expect(errors).toEqual([]);
});

/** Where model-viewer shows a point of the construction, in page coordinates. */
async function screenPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  await expectLoaded(page);
  await settledCamera(page);
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

const picker = (page: Page, name: RegExp) => page.getByRole('button', { name });

test('picking the construction on the model, turning between picks, never moves the centre of rotation', async ({ page }) => {
  const errors = collectErrors(page);
  await chooseShape(page, 'Куб');
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Через ребро або діагональ' });
  await openAllSections(page);
  await page.getByLabel('Спосіб', { exact: true }).selectOption({ label: 'Через точку ребра' });
  await expectLoaded(page);
  await picker(page, /^Відрізок/).click();
  const initial = await settledCamera(page);
  const center = await viewerCenter(page);

  const a = await screenPoint(page, 'A');
  await page.mouse.click(a.x, a.y);
  await expect(page.getByText(/^Перша вершина — A\./)).toBeVisible();
  expectSameView(await settledCamera(page), initial);
  // A drag that ends on a vertex turns the camera and neither picks it nor moves the centre.
  const c = await screenPoint(page, 'C');
  await drag(page, { x: c.x - 50, y: c.y }, { x: 50, y: 0 });
  await expect(page.getByText(/^Перша вершина — A\./)).toBeVisible();
  const turned = await settledCamera(page);
  expect(turned.orbit.theta).not.toBeCloseTo(initial.orbit.theta, 3);
  expectSameTarget(turned, initial);
  const b1 = await screenPoint(page, 'B1');
  await page.mouse.click(b1.x, b1.y);
  await expect(picker(page, /^Відрізок/)).toContainText('AB₁');
  expectSameView(await settledCamera(page), turned, REFITTED);

  await drag(page, center, { x: -60, y: 15 });
  await picker(page, /^Точка M/).click();
  const beforeEdge = await settledCamera(page);
  const [d, d1] = [await screenPoint(page, 'D'), await screenPoint(page, 'D1')];
  await page.mouse.click((d.x + d1.x) / 2, (d.y + d1.y) / 2);
  await expect(picker(page, /^Точка M/)).toContainText('Середина DD₁');
  expectSameView(await settledCamera(page), beforeEdge, REFITTED);

  // Reopened, the segment field takes another pick, still in place.
  await drag(page, center, { x: 40, y: -10 });
  await picker(page, /^Відрізок/).click();
  const beforeRepick = await settledCamera(page);
  const [b, c1] = [await screenPoint(page, 'B'), await screenPoint(page, 'C1')];
  await page.mouse.click(b.x, b.y);
  await page.mouse.click(c1.x, c1.y);
  await expect(picker(page, /^Відрізок/)).toContainText('BC₁');
  const repicked = await settledCamera(page);
  expectSameView(repicked, beforeRepick, REFITTED);
  // A click on empty space while a field is open picks nothing and keeps the view exactly.
  const box = await modelViewer(page).boundingBox();
  if (box === null) throw new Error('No viewer on screen.');
  await page.mouse.click(box.x + 12, box.y + 12);
  expectSameView(await settledCamera(page), repicked);
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a finger drag turns the solid and a tap keeps the centre of rotation', async ({ page }) => {
    const errors = collectErrors(page);
    await chooseShape(page, 'Циліндр');
    const center = await viewerCenter(page);
    const initial = await settledCamera(page);
    // Chromium's emulated touchscreen cancels a synthetic touch drag as a scroll, so the drag is given to model-viewer's
    // input layer as the touch pointer events a finger produces; the tap below is a real emulated tap.
    await modelViewer(page).evaluate((element, { x, y }) => {
      const input = element.shadowRoot?.querySelector('.userInput');
      if (input == null) throw new Error('No input layer.');
      const send = (type: string, dx: number) =>
        input.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            composed: true,
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x + dx,
            clientY: y,
          }),
        );
      send('pointerdown', 0);
      for (let step = 1; step <= 8; step += 1) send('pointermove', step * 10);
      send('pointerup', 80);
    }, center);
    const turned = await settledCamera(page);
    expect(turned.orbit.theta).not.toBeCloseTo(initial.orbit.theta, 3);
    expectSameTarget(turned, initial);
    await page.touchscreen.tap(center.x + 30, center.y + 20);
    expectSameView(await settledCamera(page), turned);
    expect(errors).toEqual([]);
  });
});
