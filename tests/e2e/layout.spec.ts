import { type CDPSession, devices, expect, type Locator, type Page, test } from '@playwright/test';
import {
  type Box,
  collectErrors,
  dimensionsLine,
  documentBox,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  hasNoHorizontalOverflow,
  type ModelViewerElement,
  modelViewer,
  openAllSections,
  openSection,
  parameterSection,
  previewPlace,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Налаштування моделі' });
/** The element inside the rounded outline that scrolls the controls in the two-column layout. */
const sidebarScroller = (page: Page) => sidebar(page).locator('.controls-scroll');

/** Whether the element can scroll its content: overflow other than visible or clip makes it a scroll container. */
const isScrollContainer = (locator: Locator) =>
  locator.evaluate((element) => ['auto', 'scroll', 'hidden'].includes(getComputedStyle(element).overflowY));
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const fitButton = (page: Page) => page.getByRole('button', { name: 'Вписати модель', exact: true });
const TRAPEZOID_PRISM = 'Призма · 40 × 20 × 80 мм';

const orbit = (page: Page) =>
  modelViewer(page).evaluate((element) => {
    const { theta, phi, radius } = (element as unknown as ModelViewerElement).getCameraOrbit();
    return { theta, phi, radius };
  });

/** The element's box in the window, as the user sees it now. */
const windowBox = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });

const insideWindow = (page: Page, box: Box) => {
  const size = page.viewportSize();
  if (size === null) throw new Error('No viewport size.');
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 0.5 && box.y + box.height <= size.height + 0.5;
};

/**
 * The distances in CSS pixels from each side of the preview to the nearest pixel of the model, found on a screenshot: the
 * pixels far from the background's brightness, the most common one. On the dark theme that is the light solid and its white
 * edges, on the light one its dark edges and shaded faces; the grid and the axes stay close to the background on either.
 * Decoding happens in the page, so no image library is needed.
 */
async function modelMargins(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const image = (await previewViewport(page).screenshot({ animations: 'disabled' })).toString('base64');
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No 2D context.');
    context.drawImage(bitmap, 0, 0);
    const { data: pixels, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const luminanceAt = (offset: number) =>
      0.2126 * (pixels[offset] ?? 0) + 0.7152 * (pixels[offset + 1] ?? 0) + 0.0722 * (pixels[offset + 2] ?? 0);
    const counts = new Map<number, number>();
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const level = Math.round(luminanceAt(offset));
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    const background = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
    let [minX, minY, maxX, maxY] = [width, height, -1, -1];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (Math.abs(luminanceAt((y * width + x) * 4) - background) > 90) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < 0) throw new Error('The model is not visible in the preview.');
    const scale = window.devicePixelRatio;
    return { left: minX / scale, top: minY / scale, right: (width - 1 - maxX) / scale, bottom: (height - 1 - maxY) / scale };
  }, image);
}

/** The whole model is on screen with a visible margin on every side. */
async function expectWholeModel(page: Page): Promise<void> {
  const margins = await modelMargins(page);
  for (const side of Object.values(margins)) expect(side).toBeGreaterThanOrEqual(8);
}

async function selectTrapezoidPrism(page: Page): Promise<void> {
  await shapeSelect(page).selectOption({ label: 'Куб' });
  await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openSection(page, 'Основа');
  await entry(page, 'Тип основи').selectOption({ label: 'Трапеція' });
  // In one column, opening the group may scroll the preview away; model-viewer loads a model only while it is on screen.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectPreviewOf(page, TRAPEZOID_PRISM);
}

/**
 * Scrolls the sidebar, or in one column the page, until the control lies beneath the sticky header of the sidebar, 8 px below
 * its top.
 */
const scrollBeneathHeader = (control: Locator) =>
  control.evaluate(async (element) => {
    const header = document.querySelector('.panel-header') as HTMLElement;
    let scroller: HTMLElement | null = element.parentElement;
    while (scroller !== null && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const scrolling = scroller ?? (document.scrollingElement as HTMLElement);
    for (let step = 0; step < 3; step += 1) {
      scrolling.scrollTop += element.getBoundingClientRect().top - (header.getBoundingClientRect().top + 8);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });

/**
 * What is drawn topmost on the focus outline of the focused control (2px wide, 2px off it) and at both sides of the header,
 * across the whole area the controls scroll in, its scrollbar excluded.
 */
const coverOfFocus = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector('.panel-header') as HTMLElement;
    const focused = document.activeElement as HTMLElement;
    const control = focused.getBoundingClientRect();
    const bar = header.getBoundingClientRect();
    const area = header.parentElement as HTMLElement;
    const left = area.getBoundingClientRect().left + area.clientLeft;
    const right = left + area.clientWidth;
    const owner = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y);
      return element !== null && header.contains(element) ? 'header' : (element?.tagName ?? 'none');
    };
    const middle = control.top + Math.min(control.height, bar.bottom - control.top) / 2;
    return {
      outline: [owner(control.left - 3, middle), owner(control.right + 3, middle), owner(control.left + 6, control.top - 3)],
      padding: [owner(left + 1, bar.top + 2), owner(right - 1, bar.bottom - 2)],
      focusVisible: focused.matches(':focus-visible'),
    };
  });

/**
 * A focused control scrolled beneath the header keeps its focus outline, but the header covers it and takes the clicks there.
 * Moving the focus by keyboard to a control hidden beneath the header brings that control into view below the header.
 */
async function expectHeaderCoversFocus(page: Page, control: Locator, next: Locator): Promise<void> {
  await control.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  await scrollBeneathHeader(control);
  expect(await coverOfFocus(page)).toEqual({
    outline: ['header', 'header', 'header'],
    padding: ['header', 'header'],
    focusVisible: true,
  });
  const reset = sidebar(page).getByRole('button', { name: 'Скинути параметри фігури' });
  await expect(reset).toBeEnabled();
  await reset.click({ trial: true });

  const header = sidebar(page).locator('.panel-header');
  await scrollBeneathHeader(next);
  const hidden = await windowBox(next);
  const bar = await windowBox(header);
  expect(hidden.y + hidden.height).toBeLessThanOrEqual(bar.y + bar.height);
  await page.keyboard.press('Tab');
  await expect(next).toBeFocused();
  const shown = await windowBox(next);
  expect(shown.y).toBeGreaterThanOrEqual((await windowBox(header)).y + bar.height - 0.5);
  expect((await coverOfFocus(page)).outline).not.toContain('header');
}

test.describe('desktop workspace at 1366 × 768', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the long trapezoid prism form scrolls in the sidebar while the model, its dimensions and the download stay in view', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await selectTrapezoidPrism(page);

    const reference = await windowBox(previewViewport(page));
    // The sidebar is about 300–340 px wide, and the preview takes the rest of the width.
    const sidebarBox = await windowBox(sidebar(page));
    expect(sidebarBox.width).toBeGreaterThanOrEqual(300);
    expect(sidebarBox.width).toBeLessThanOrEqual(340);
    expect(reference.width).toBeGreaterThan(900);

    await openAllSections(page);
    expect(await windowBox(previewViewport(page))).toEqual(reference);
    // The form is now longer than the window; only the sidebar scrolls, never the page.
    expect(await sidebarScroller(page).evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

    await entry(page, 'Зміщення Y').scrollIntoViewIfNeeded();
    expect(await sidebarScroller(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await windowBox(previewViewport(page))).toEqual(reference);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // The scrolling element, and with it the scrollbar track and its arrow buttons, runs along the straight part of
    // the rounded outline: it starts and ends at least one corner radius from the outline's top and bottom and reaches
    // its inner right edge.
    const outline = await windowBox(sidebar(page));
    const scroller = await windowBox(sidebarScroller(page));
    const radius = await sidebar(page).evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopRightRadius));
    expect(radius).toBeGreaterThan(0);
    expect(scroller.y).toBeGreaterThanOrEqual(outline.y + radius);
    expect(scroller.y + scroller.height).toBeLessThanOrEqual(outline.y + outline.height - radius);
    expect(Math.abs(outline.x + outline.width - 1 - (scroller.x + scroller.width))).toBeLessThan(0.5);
    await sidebarScroller(page).evaluate((element) => element.scrollTo(0, element.scrollHeight));
    expect(await windowBox(previewViewport(page))).toEqual(reference);
    await sidebarScroller(page).evaluate((element) => element.scrollTo(0, 0));
    expect(await windowBox(previewViewport(page))).toEqual(reference);

    // The model at its default framing, its dimensions and the download are all visible.
    expect(insideWindow(page, reference)).toBe(true);
    await expectWholeModel(page);
    expect(insideWindow(page, await windowBox(dimensionsLine(page)))).toBe(true);
    await expect(dimensionsLine(page)).toHaveText('Габарити: 40 × 20 × 80 мм');
    expect(insideWindow(page, await windowBox(downloadButton(page)))).toBe(true);
    await expect(downloadButton(page)).toBeEnabled();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    expect(errors).toEqual([]);
  });

  test('an invalid value, its correction, a tilt and the switch back to the cube keep the layout and the current model', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await selectTrapezoidPrism(page);
    await openAllSections(page);
    const reference = await previewPlace(page);

    // An invalid height: the old model is dimmed, no dimensions or download are offered, and the field is named.
    await entry(page, 'Висота AA₁').fill('5');
    await expect(page.getByText('Допустимі значення — від 0,25 до 4.')).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(dimensionsLine(page)).toHaveText('Габарити: — мм');
    await expect(downloadButton(page)).toBeDisabled();
    await expect(previewViewport(page).getByRole('button', { name: 'Висота AA₁' })).toBeVisible();
    expect(await previewPlace(page)).toEqual(reference);

    // Corrected: h = a with b = t = a/2 gives a = h = 80 mm, a box of 80 × 40 × 80 mm.
    await entry(page, 'Висота AA₁').fill('1');
    await expectPreviewOf(page, 'Призма · 80 × 40 × 80 мм');
    expect(await previewPlace(page)).toEqual(reference);

    // The tilt widens the box to 1,5a: a = 160/3 mm.
    await entry(page, 'Зміщення X').fill('0,5');
    await expect(parameterSection(page, 'Нахил').locator('summary')).toContainText('похила');
    await expectPreviewOf(page, 'Призма · 80 × 26,7 × 53,3 мм');
    expect(await previewPlace(page)).toEqual(reference);
    const tilted = await downloadThreeMf(page);
    expect(tilted.fileName).toBe('prism-trapezoid.3mf');
    expectSizesClose(tilted.measurements.size, [80, 80 / 3, 160 / 3], 1e-3);

    // Back to the cube: one short line replaces the groups but its optional section, and everything describes the cube.
    await shapeSelect(page).selectOption({ label: 'Куб' });
    await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
    await expect(sidebar(page).locator('summary')).toHaveText([/^Переріз\s*немає/]);
    expect(await previewPlace(page)).toEqual(reference);
    await expectWholeModel(page);
    const cube = await downloadThreeMf(page);
    expect(cube.fileName).toBe('cube.3mf');
    expect(cube.measurements.size).toEqual([80, 80, 80]);

    expect(errors).toEqual([]);
  });

  test('the camera keeps the viewing direction while editing, refits on request and starts afresh for another shape', async ({
    page,
  }) => {
    await page.goto('/');
    await selectTrapezoidPrism(page);
    const fitted = await orbit(page);

    // Turn the model and zoom in.
    const box = await windowBox(previewViewport(page));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, -500);
    await expect.poll(async () => (await orbit(page)).radius).toBeLessThan(fitted.radius * 0.9);
    await expect.poll(async () => Math.abs((await orbit(page)).theta - fitted.theta)).toBeGreaterThan(0.1);
    // The camera eases towards its goal; compare only once it has come to rest.
    let previous = await orbit(page);
    await expect
      .poll(async () => {
        const current = await orbit(page);
        const resting = current.radius === previous.radius && current.theta === previous.theta;
        previous = current;
        return resting;
      })
      .toBe(true);
    const turned = await orbit(page);

    // Opening and scrolling the sidebar leaves the camera alone.
    await openAllSections(page);
    await entry(page, 'Зміщення Y').scrollIntoViewIfNeeded();
    const afterSidebar = await orbit(page);
    expect(afterSidebar.theta).toBeCloseTo(turned.theta, 6);
    expect(afterSidebar.phi).toBeCloseTo(turned.phi, 6);
    expect(afterSidebar.radius).toBeCloseTo(turned.radius, 6);

    // Editing a parameter keeps the direction.
    await entry(page, 'Висота AA₁').fill('1,5');
    // h = 1,5a: a = 160/3 mm.
    await expectPreviewOf(page, 'Призма · 53,3 × 26,7 × 80 мм');
    await expect.poll(async () => (await orbit(page)).theta).toBeCloseTo(turned.theta, 3);
    expect((await orbit(page)).phi).toBeCloseTo(turned.phi, 3);

    // "Вписати модель" shows the whole model again from the same direction.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -800);
    await fitButton(page).click();
    await expect.poll(async () => (await orbit(page)).theta).toBeCloseTo(turned.theta, 3);
    await page.waitForTimeout(500);
    await expectWholeModel(page);

    // Another shape starts from the default direction.
    await shapeSelect(page).selectOption({ label: 'Конус' });
    await expectPreviewOf(page, 'Конус · 80 × 80 × 80 мм');
    await expect.poll(async () => (await orbit(page)).theta).toBeCloseTo(fitted.theta, 3);
    await page.waitForTimeout(500);
    await expectWholeModel(page);
  });

  test('every group starts collapsed on load and with each figure chosen; one opened stays open while editing', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const openGroups = sidebar(page).locator('details[open] > summary');
    await page.goto('/');
    await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
    await expect(sidebar(page).locator('summary')).toHaveText([/^Переріз\s*немає/]);
    await expect(openGroups).toHaveCount(0);

    // Headings and their summaries stay in view.
    await shapeSelect(page).selectOption({ label: 'Призма' });
    await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');
    await expect(sidebar(page).locator('summary')).toHaveText([/^Основа/, /^Висота/, /^Нахил\s*пряма/, /^Переріз\s*немає/]);
    await expect(openGroups).toHaveCount(0);

    // An opened group stays open while its values change, the model is rebuilt, the camera turns and other controls are used.
    await openSection(page, 'Нахил');
    await entry(page, 'Зміщення X').fill('0,5');
    await expect(parameterSection(page, 'Нахил').locator('summary')).toContainText('похила');
    await expect(dimensionsLine(page)).not.toHaveText('Габарити: 40 × 34,6 × 80 мм');
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
    await openSection(page, 'Основа');
    await entry(page, 'Тип основи').selectOption({ label: 'Трапеція' });
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
    const box = await windowBox(previewViewport(page));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    await fitButton(page).click();
    await expect(openGroups).toHaveText([/^Основа/, /^Нахил/]);

    // A section's own group starts collapsed too, the others stay as they are. Its construction picks on the model until
    // the group is collapsed, which keeps the choice.
    const overlay = previewViewport(page).locator('svg.overlay');
    await openSection(page, 'Переріз');
    await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно грані' });
    await expect(parameterSection(page, 'Кріплення')).toHaveCount(1);
    await expect(openGroups).toHaveText([/^Основа/, /^Нахил/, /^Переріз/]);
    await sidebar(page)
      .getByRole('button', { name: /^Грань/ })
      .click();
    await expect(overlay).toHaveCount(1);
    await parameterSection(page, 'Переріз').locator('summary').click();
    await expect(overlay).toHaveCount(0);
    await expect(parameterSection(page, 'Переріз').locator('summary')).toContainText('паралельно грані');
    await openSection(page, 'Переріз');
    await sidebar(page)
      .getByRole('button', { name: /^Грань/ })
      .click();
    await expect(overlay).toHaveCount(1);
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });

    // Another figure, and back to this one: every group collapsed again, with the values and choices kept. A construction
    // being edited ends.
    await shapeSelect(page).selectOption({ label: 'Піраміда' });
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
    await expect(openGroups).toHaveCount(0);
    await expect(overlay).toHaveCount(0);
    await shapeSelect(page).selectOption({ label: 'Призма' });
    await expect(sidebar(page).locator('summary')).toHaveText([
      /^Основа/,
      /^Висота/,
      /^Нахил\s*похила/,
      /^Переріз/,
      /^Кріплення/,
    ]);
    await expect(openGroups).toHaveCount(0);
    await openSection(page, 'Основа');
    await expect(entry(page, 'Тип основи')).toHaveValue('trapezoid');
    await openSection(page, 'Переріз');
    await expect(entry(page, 'Тип перерізу')).toHaveValue('face-parallel');
    await expect(overlay).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('the sidebar header covers the controls scrolled beneath it, focus outlines included, and keeps its reset', async ({
    page,
  }) => {
    await page.goto('/');
    await selectTrapezoidPrism(page);
    await openAllSections(page);
    await expectHeaderCoversFocus(
      page,
      entry(page, 'Відстань між AB і CD'),
      page.getByRole('button', { name: 'Відстань між AB і CD: зменшити', exact: true }),
    );
  });
});

for (const [layout, viewport, deviceScaleFactor] of [
  // 1366 × 768 at 200 % browser zoom leaves 683 × 384 CSS pixels.
  ['200 % zoom', { width: 683, height: 384 }, 2],
  ['phone', { width: 360, height: 740 }, 2],
] as const) {
  test.describe(`one column (${layout})`, () => {
    test.use({ viewport, deviceScaleFactor });

    test('the preview sits above the controls, the page scrolls normally and every control stays reachable', async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto('/');
      await selectTrapezoidPrism(page);

      const preview = await previewPlace(page);
      expect(preview.preview.y + preview.preview.height).toBeLessThanOrEqual((await documentBox(sidebar(page))).y);
      expect(preview.preview.height).toBeGreaterThanOrEqual(250);

      // Opening every group and going to the last control scrolls the page, not a nested panel.
      await openAllSections(page);
      expect(await previewPlace(page)).toEqual(preview);
      await entry(page, 'Зміщення Y').fill('0,25');
      await expect(entry(page, 'Зміщення Y')).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      // Neither the panel nor its inner element scrolls on its own here: a touch that starts on the controls must
      // reach the page.
      expect(await isScrollContainer(sidebar(page))).toBe(false);
      expect(await isScrollContainer(sidebarScroller(page))).toBe(false);
      expect(await hasNoHorizontalOverflow(page)).toBe(true);

      // Back at the top, the download, the dimensions and the updated model are there. model-viewer loads a model only
      // while it is on screen.
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(downloadButton(page)).toBeInViewport();
      // The export controls wrap below the shape picker, inside the window.
      const picker = await windowBox(shapeSelect(page));
      const size = await windowBox(page.getByRole('banner').getByLabel('Найбільший габарит', { exact: true }));
      expect(size.y).toBeGreaterThanOrEqual(picker.y + picker.height);
      expect(size.x + size.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
      await expectPreviewOf(page, 'Призма · 40 × 30 × 80 мм');
      expect(await previewPlace(page)).toEqual(preview);
      expect((await downloadThreeMf(page)).fileName).toBe('prism-trapezoid.3mf');

      expect(errors).toEqual([]);
    });

    test('the sticky sidebar header covers the controls scrolled beneath it, focus outlines included', async ({ page }) => {
      await page.goto('/');
      await selectTrapezoidPrism(page);
      await openAllSections(page);
      await expectHeaderCoversFocus(
        page,
        entry(page, 'Відстань між AB і CD'),
        page.getByRole('button', { name: 'Відстань між AB і CD: зменшити', exact: true }),
      );
    });
  });
}

/**
 * A one-finger drag through Chromium's touch input pipeline, which scrolls whatever the browser routes the gesture to;
 * a mouse wheel takes another path and would not reveal a blocked touch scroll.
 */
async function drag(page: Page, cdp: CDPSession, [x, y]: readonly [number, number], [dx, dy]: readonly [number, number]) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  const steps = 15;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (step * dx) / steps, y: y + (step * dy) / steps }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Let a fling settle.
  await page.waitForTimeout(400);
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe('touch scrolling on a phone (Chromium mobile emulation)', () => {
  // The Pixel 7 profile without its browser choice, which only a whole file may set: Chromium is the configured browser.
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  test('a downward swipe that starts on the controls scrolls the page back to the model; sliders still drag', async ({
    page,
    context,
  }) => {
    const errors = collectErrors(page);
    const cdp = await context.newCDPSession(page);
    await page.goto('/');
    await selectTrapezoidPrism(page);
    await openSection(page, 'Висота');
    await openSection(page, 'Нахил');

    // On a label, far from the page margins.
    await entry(page, 'Відстань між AB і CD').scrollIntoViewIfNeeded();
    const label = await windowBox(page.getByText('Відстань між AB і CD', { exact: true }));
    let before = await scrollY(page);
    expect(before).toBeGreaterThan(300);
    await drag(page, cdp, [label.x + 10, label.y + label.height / 2], [0, 300]);
    expect(await scrollY(page)).toBeLessThan(before - 150);

    // In the empty space between two fields.
    await entry(page, 'Зміщення Y').scrollIntoViewIfNeeded();
    const fieldOf = (label: string) => entry(page, label).locator('xpath=ancestor::div[contains(@class, "field ")][1]');
    const upper = await windowBox(fieldOf('Зміщення X'));
    const lower = await windowBox(fieldOf('Зміщення Y'));
    const gap: [number, number] = [upper.x + upper.width / 2, (upper.y + upper.height + lower.y) / 2];
    expect(lower.y - (upper.y + upper.height)).toBeGreaterThan(8);
    // The point hits the group's own body, not a control.
    expect(
      await page.evaluate(
        ([x, y]) => document.elementFromPoint(x as number, y as number)?.classList.contains('section-body'),
        gap,
      ),
    ).toBe(true);
    before = await scrollY(page);
    await drag(page, cdp, gap, [0, 300]);
    expect(await scrollY(page)).toBeLessThan(before - 150);

    // A horizontal drag on a slider changes its value and leaves the page where it is.
    const slider = page.getByRole('slider', { name: 'Висота AA₁: повзунок' });
    await slider.scrollIntoViewIfNeeded();
    const track = await windowBox(slider);
    before = await scrollY(page);
    await drag(page, cdp, [track.x + track.width * 0.45, track.y + track.height / 2], [track.width * 0.4, 0]);
    await expect(entry(page, 'Висота AA₁')).not.toHaveValue('2');
    expect(await scrollY(page)).toBe(before);

    // The shape picker: open it, choose a shape, open it again and dismiss it; the page still scrolls by touch.
    await page.evaluate(() => window.scrollTo(0, 0));
    await shapeSelect(page).tap();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(shapeSelect(page)).toHaveValue('parallelepiped');
    await shapeSelect(page).tap();
    await page.keyboard.press('Escape');
    await expect(shapeSelect(page)).toHaveValue('parallelepiped');
    await expectPreviewOf(page, 'Паралелепіпед · 80 × 46,2 × 53,3 мм');
    await openSection(page, 'Висота');
    await entry(page, 'Висота AA₁').scrollIntoViewIfNeeded();
    const height = await windowBox(page.getByText('Висота AA₁', { exact: true }));
    before = await scrollY(page);
    expect(before).toBeGreaterThan(150);
    await drag(page, cdp, [height.x + 10, height.y + height.height / 2], [0, 250]);
    expect(await scrollY(page)).toBeLessThan(before - 100);

    expect(errors).toEqual([]);
  });
});

for (const [layout, viewport] of [
  ['desktop', { width: 1366, height: 768 }],
  // The export controls wrap below the shape picker here.
  ['narrow phone', { width: 360, height: 740 }],
] as const) {
  test(`the toolbar keeps its controls in place while the model regenerates (${layout})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: 'Призма' });
    await expectPreviewOf(page, `Призма · ${['40', '34,6', '80'].join(' × ')} мм`);

    /** Sets the height and measures the toolbar in the same task, while the download is busy, then once it is ready. */
    const measure = (height: string) =>
      page.evaluate(async (text) => {
        const box = (element: Element | null) => {
          const rect = element?.getBoundingClientRect();
          return rect === undefined ? undefined : [rect.x, rect.y, rect.width, rect.height];
        };
        const download = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('3MF')) ?? null;
        const toolbar = () => ({
          download: box(download),
          size: box(document.getElementById('printSizeMm')),
          shape: box(document.getElementById('shape')),
        });
        const input = document.getElementById('prismHeightRatio') as HTMLInputElement;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { busy: download?.getAttribute('aria-busy') ?? null, ...toolbar() };
      }, height);
    const ready = () =>
      page.evaluate(() => {
        const box = (element: Element | null) => {
          const rect = element?.getBoundingClientRect();
          return rect === undefined ? undefined : [rect.x, rect.y, rect.width, rect.height];
        };
        const download = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('3MF')) ?? null;
        return {
          busy: download?.getAttribute('aria-busy') ?? null,
          download: box(download),
          size: box(document.getElementById('printSizeMm')),
          shape: box(document.getElementById('shape')),
        };
      });

    const reference = await ready();
    expect(reference.busy).toBeNull();
    for (const height of ['1', '1,5', '3', '0,25', '2']) {
      const busy = await measure(height);
      expect(busy.busy).toBe('true');
      expect({ ...busy, busy: null }).toEqual(reference);
      await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
      expect(await ready()).toEqual(reference);
    }
  });
}
