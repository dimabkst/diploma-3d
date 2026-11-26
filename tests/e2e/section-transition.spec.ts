import { expect, type Page, test } from '@playwright/test';
import { type ModelViewerElement, modelViewer, openAllSections, openSection, previewViewport, shapeSelect } from './helpers.ts';

/** What one animation frame shows: the camera's direction and distance, the model's extent, and the file shown. */
type Frame = {
  readonly theta: number;
  readonly phi: number;
  readonly radius: number;
  readonly size: readonly [number, number, number];
  readonly src: string | null;
};

type Recorder = { frames: Frame[]; recording: boolean };
type RecordingWindow = Window & { __recorder: Recorder };

/** Logs the viewer on every animation frame, which is what the screen shows, from before the page's own scripts run. */
async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recorder: Recorder = { frames: [], recording: false };
    (window as unknown as RecordingWindow).__recorder = recorder;
    const tick = () => {
      const viewer = document.querySelector('model-viewer') as unknown as
        | (ModelViewerElement & { getAttribute(name: string): string | null })
        | null;
      if (recorder.recording && viewer?.getCameraOrbit !== undefined) {
        const { theta, phi, radius } = viewer.getCameraOrbit();
        const { x, y, z } = viewer.getDimensions();
        recorder.frames.push({ theta, phi, radius, size: [x, y, z], src: viewer.getAttribute('src') });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const expectLoaded = (page: Page) =>
  expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });

/** The frames while `action` takes effect and its preview loads. */
async function framesOf(page: Page, action: () => Promise<unknown>): Promise<Frame[]> {
  await page.evaluate(() => {
    const { __recorder } = window as unknown as RecordingWindow;
    __recorder.frames = [];
    __recorder.recording = true;
  });
  await action();
  // The status leaves "loaded" within the same task as the edit, or stays there when nothing changes.
  await page.waitForTimeout(100);
  await expectLoaded(page);
  // A few more frames: a camera reset would follow the load.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250)))),
  );
  return page.evaluate(() => {
    const { __recorder } = window as unknown as RecordingWindow;
    __recorder.recording = false;
    return __recorder.frames;
  });
}

const distinct = <Value>(values: readonly Value[]): Value[] => values.filter((value, index) => value !== values[index - 1]);
const sizeOf = ({ size }: Frame) => size.map((value) => value.toFixed(5)).join(' ');

/** The camera never turned, and the new model replaced the old one once, whole. */
function expectSteadyTransition(frames: readonly Frame[], direction: { theta: number; phi: number }): void {
  expect(frames.length).toBeGreaterThan(3);
  for (const frame of frames) {
    expect(frame.theta).toBeCloseTo(direction.theta, 6);
    expect(frame.phi).toBeCloseTo(direction.phi, 6);
  }
  // One new file; no preview of the old model in another placement on the way.
  expect(distinct(frames.map(({ src }) => src)).length).toBeLessThanOrEqual(2);
  expect(distinct(frames.map(sizeOf)).length).toBeLessThanOrEqual(2);
}

const orbit = (page: Page) =>
  modelViewer(page).evaluate((element) => {
    const { theta, phi } = (element as unknown as ModelViewerElement).getCameraOrbit();
    return { theta, phi };
  });

const cut = (page: Page, label: string) => page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label });
/** Chooses the connector in its group, which a section adds collapsed. */
async function connector(page: Page, label: string): Promise<void> {
  await openSection(page, 'Кріплення');
  await page.getByLabel('Тип кріплення', { exact: true }).selectOption({ label });
}

async function openCylinder(page: Page, oblique = false): Promise<void> {
  await installRecorder(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Циліндр' });
  await openAllSections(page);
  if (oblique) {
    await openSection(page, 'Нахил');
    await page.getByLabel('Зміщення верхньої основи', { exact: true }).fill('1');
  }
  await openSection(page, 'Переріз');
  await expect(page.getByText(/^Габарити: /)).toBeVisible({ timeout: 30_000 });
  await expectLoaded(page);
}

async function turnCamera(page: Page): Promise<void> {
  const box = await modelViewer(page).boundingBox();
  if (box === null) throw new Error('The viewer is not on the page.');
  const before = await orbit(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await orbit(page)).theta - before.theta)).toBeGreaterThan(0.2);
  // The drag's damping settles before the direction is taken as the one to keep.
  await expect
    .poll(async () => {
      const first = await orbit(page);
      await page.waitForTimeout(200);
      return Math.abs((await orbit(page)).theta - first.theta);
    })
    .toBeLessThan(1e-6);
}

for (const [name, oblique] of [
  ['right', false],
  ['oblique', true],
] as const) {
  test(`${name} cylinder: selecting a section never turns the camera, from an uncut model or between sections`, async ({
    page,
  }) => {
    await openCylinder(page, oblique);
    const direction = await orbit(page);
    // The first selection after loading, repeated switching, and back to the uncut model.
    for (const label of [
      'Вертикальний',
      'Паралельно основам',
      'Вертикальний',
      'Похилий',
      'Паралельно основам',
      'Похилий',
      'Вертикальний',
      'Без перерізу',
      'Похилий',
      'Без перерізу',
      'Паралельно основам',
      'Без перерізу',
    ]) {
      const frames = await framesOf(page, () => cut(page, label));
      expectSteadyTransition(frames, direction);
    }
    expect(await orbit(page)).toEqual(direction);
  });

  test(`${name} cylinder: the direction the user turned to stays, assembled and separated, with every connector`, async ({
    page,
  }) => {
    await openCylinder(page, oblique);
    await turnCamera(page);
    const direction = await orbit(page);
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Вертикальний')), direction);
    for (const label of ['Ластівчин хвіст', 'Виступ і отвір', 'Знімні штифти', 'Без кріплення']) {
      expectSteadyTransition(await framesOf(page, () => connector(page, label)), direction);
    }
    const separation = page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
    // Parts together: choosing either section shows them together from the same direction.
    expectSteadyTransition(await framesOf(page, () => separation.uncheck()), direction);
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Паралельно основам')), direction);
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Вертикальний')), direction);
    expectSteadyTransition(await framesOf(page, () => separation.check()), direction);
  });
}

for (const [name, oblique] of [
  ['right', false],
  ['oblique', true],
] as const) {
  test(`${name} cylinder: an oblique plane’s angle, direction and connectors never turn the camera`, async ({ page }) => {
    await openCylinder(page, oblique);
    await turnCamera(page);
    const direction = await orbit(page);
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Похилий')), direction);
    const field = (label: string) => page.getByLabel(label, { exact: true });
    for (const [label, value] of [
      ['Кут до площини основи', '30'],
      ['Напрям нахилу', '120'],
      ['Точка на осі від нижньої основи', '40'],
      ['Кут до площини основи', '70'],
      ['Напрям нахилу', '360'],
    ] as const) {
      expectSteadyTransition(await framesOf(page, () => field(label).fill(value)), direction);
    }
    for (const label of ['Ластівчин хвіст', 'Виступ і отвір', 'Знімні штифти', 'Без кріплення']) {
      expectSteadyTransition(await framesOf(page, () => connector(page, label)), direction);
    }
    const separation = page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
    expectSteadyTransition(await framesOf(page, () => separation.uncheck()), direction);
    expectSteadyTransition(await framesOf(page, () => field('Напрям нахилу').fill('200')), direction);
    expectSteadyTransition(await framesOf(page, () => separation.check()), direction);
  });
}

test('oblique plane: dragging through angles ends on the last one, whatever finished in between', async ({ page }) => {
  await openCylinder(page);
  const direction = await orbit(page);
  await cut(page, 'Похилий');
  await expectLoaded(page);
  await page.waitForTimeout(300);
  await expectLoaded(page);
  const field = page.getByLabel('Напрям нахилу', { exact: true });
  const frames = await framesOf(page, async () => {
    for (const value of ['10', '20', '30', '40', '50', '60', '70', '80', '90']) {
      await field.fill(value);
      await page.waitForTimeout(40);
    }
    await expect(page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true })).toBeEnabled({ timeout: 30_000 });
  });
  for (const frame of frames) {
    expect(frame.theta).toBeCloseTo(direction.theta, 6);
    expect(frame.phi).toBeCloseTo(direction.phi, 6);
  }
  await expect(page.locator('[data-direction]')).toHaveAttribute('data-direction', '90');
  // The plane rises along +Y: part 2 moved along −Y, which is glTF +Z, not along X.
  const size = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  expect(size.z).toBeGreaterThan(0.085);
  expect(size.x).toBeLessThan(0.085);
});

for (const [name, oblique] of [
  ['right', false],
  ['oblique', true],
] as const) {
  test(`${name} cone: its sections, offset and connectors never turn the camera`, async ({ page }) => {
    await installRecorder(page);
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: 'Конус' });
    await openAllSections(page);
    if (oblique) {
      await openSection(page, 'Нахил');
      // A lean that every connector's defaults fit: at 1 × r the default tongue is 1,4 mm too long, and refused.
      await page.getByLabel('Зміщення вершини', { exact: true }).fill('0,5');
    }
    await openSection(page, 'Переріз');
    await expect(page.getByText(/^Габарити: /)).toBeVisible({ timeout: 30_000 });
    await expectLoaded(page);
    await turnCamera(page);
    const direction = await orbit(page);
    for (const label of ['Вертикальний', 'Паралельно основі', 'Вертикальний', 'Без перерізу', 'Вертикальний']) {
      expectSteadyTransition(await framesOf(page, () => cut(page, label)), direction);
    }
    const offset = page.getByLabel('Зміщення від осі', { exact: true });
    for (const value of ['25', '-25', '0']) expectSteadyTransition(await framesOf(page, () => offset.fill(value)), direction);
    for (const label of ['Ластівчин хвіст', 'Виступ і отвір', 'Знімні штифти', 'Без кріплення']) {
      expectSteadyTransition(await framesOf(page, () => connector(page, label)), direction);
    }
    const separation = page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
    expectSteadyTransition(await framesOf(page, () => separation.uncheck()), direction);
    expectSteadyTransition(await framesOf(page, () => separation.check()), direction);
  });
}

for (const [name, oblique] of [
  ['right', false],
  ['oblique', true],
] as const) {
  test(`${name} cone: an oblique plane, also through the apex, never turns the camera`, async ({ page }) => {
    await installRecorder(page);
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: 'Конус' });
    await openAllSections(page);
    if (oblique) {
      await openSection(page, 'Нахил');
      await page.getByLabel('Зміщення вершини', { exact: true }).fill('0,5');
    }
    await openSection(page, 'Переріз');
    await expect(page.getByText(/^Габарити: /)).toBeVisible({ timeout: 30_000 });
    await expectLoaded(page);
    await turnCamera(page);
    const direction = await orbit(page);
    const field = (label: string) => page.getByLabel(label, { exact: true });
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Похилий')), direction);
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Через вершину')), direction);
    expectSteadyTransition(await framesOf(page, () => field('Кут до площини основи').fill('85')), direction);
    expectSteadyTransition(await framesOf(page, () => field('Напрям нахилу').fill('60')), direction);
    for (const label of ['Ластівчин хвіст', 'Виступ і отвір', 'Знімні штифти', 'Без кріплення']) {
      expectSteadyTransition(await framesOf(page, () => connector(page, label)), direction);
    }
    const separation = page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
    expectSteadyTransition(await framesOf(page, () => separation.uncheck()), direction);
    expectSteadyTransition(await framesOf(page, () => separation.check()), direction);
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Похилий')), direction);
    expectSteadyTransition(await framesOf(page, () => cut(page, 'Вертикальний')), direction);
  });
}

test('ball: its section, offset and connectors never turn the camera', async ({ page }) => {
  await installRecorder(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Куля' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await expect(page.getByText(/^Габарити: /)).toBeVisible({ timeout: 30_000 });
  await expectLoaded(page);
  await turnCamera(page);
  const direction = await orbit(page);
  for (const label of ['Горизонтальний', 'Без перерізу', 'Горизонтальний']) {
    expectSteadyTransition(await framesOf(page, () => cut(page, label)), direction);
  }
  const offset = page.getByLabel('Зміщення від центра', { exact: true });
  for (const value of ['25', '-25', '0']) expectSteadyTransition(await framesOf(page, () => offset.fill(value)), direction);
  for (const label of ['Ластівчин хвіст', 'Виступ і отвір', 'Знімні штифти', 'Без кріплення']) {
    expectSteadyTransition(await framesOf(page, () => connector(page, label)), direction);
  }
  const separation = page.getByRole('checkbox', { name: 'Розсунути частини', exact: true });
  expectSteadyTransition(await framesOf(page, () => separation.uncheck()), direction);
  expectSteadyTransition(await framesOf(page, () => separation.check()), direction);
});

test('rapid offsets of a cone end on the last one, whatever finished in between', async ({ page }) => {
  await installRecorder(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Конус' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await expect(page.getByText(/^Габарити: /)).toBeVisible({ timeout: 30_000 });
  await expectLoaded(page);
  await cut(page, 'Вертикальний');
  await page.waitForTimeout(300);
  await expectLoaded(page);
  const direction = await orbit(page);
  const offset = page.getByLabel('Зміщення від осі', { exact: true });
  const frames = await framesOf(page, async () => {
    for (const value of ['10', '20', '30', '40', '50', '60']) {
      await offset.fill(value);
      await page.waitForTimeout(40);
    }
    await expect(page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true })).toBeEnabled({ timeout: 30_000 });
  });
  for (const frame of frames) {
    expect(frame.theta).toBeCloseTo(direction.theta, 6);
    expect(frame.phi).toBeCloseTo(direction.phi, 6);
  }
  await expect(offset).toHaveValue('60');
});

test('section change: the shown parts keep their placement until the new parts arrive together with theirs', async ({ page }) => {
  await openCylinder(page);
  await cut(page, 'Паралельно основам');
  await expect(page.getByText(/^Габарити в зборі: /)).toBeVisible({ timeout: 30_000 });
  await expectLoaded(page);
  const separated = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions().y);
  // To the uncut model: no frame shows the old parts pushed together, an extent between the two models' own.
  const frames = await framesOf(page, () => cut(page, 'Без перерізу'));
  const heights = distinct(frames.map(({ size }) => size[1].toFixed(5)));
  expect(heights).toHaveLength(2);
  expect(heights[0]).toBe(separated.toFixed(5));
});

test('rapid switching: only the latest choice ends up on screen, whatever finished in between, and the camera stays', async ({
  page,
}) => {
  await openCylinder(page);
  const direction = await orbit(page);
  const frames = await framesOf(page, async () => {
    for (const label of [
      'Вертикальний',
      'Паралельно основам',
      'Без перерізу',
      'Вертикальний',
      'Паралельно основам',
      'Вертикальний',
    ]) {
      await cut(page, label);
      await page.waitForTimeout(40);
    }
    await connector(page, 'Виступ і отвір');
    await expect(page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true })).toBeEnabled({ timeout: 30_000 });
  });
  for (const frame of frames) {
    expect(frame.theta).toBeCloseTo(direction.theta, 6);
    expect(frame.phi).toBeCloseTo(direction.phi, 6);
  }
  // The file on screen stays the last one, and is the last choice: a plug of a vertical cut, apart along the normal.
  const last = frames.at(-1) as Frame;
  await page.waitForTimeout(600);
  const after = await modelViewer(page).evaluate((element) => {
    const viewer = element as unknown as ModelViewerElement & { getAttribute(name: string): string | null };
    const { x, y, z } = viewer.getDimensions();
    return { src: viewer.getAttribute('src'), size: [x, y, z] };
  });
  expect(after.src).toBe(last.src);
  // glTF Z is the normal: 80 mm plus the 40 mm gap; X and the height stay 80 mm, with the outlines' small lift.
  expect(after.size[2] as number).toBeGreaterThan(0.115);
  expect(after.size[1] as number).toBeLessThan(0.085);
  expect(after.size[0] as number).toBeLessThan(0.085);
  await expect(page.getByLabel('Тип перерізу', { exact: true })).toHaveValue('vertical');
});

test('narrow phone: selecting a section keeps the direction and the page fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCylinder(page);
  const direction = await orbit(page);
  await previewViewport(page).scrollIntoViewIfNeeded();
  for (const label of ['Вертикальний', 'Похилий', 'Паралельно основам', 'Похилий', 'Без перерізу']) {
    expectSteadyTransition(await framesOf(page, () => cut(page, label)), direction);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
