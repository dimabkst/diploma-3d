import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  type ModelViewerElement,
  modelViewer,
  openSection,
  parameterSection,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

const toggle = (page: Page) => page.getByRole('button', { name: /^(Темна|Світла) тема$/ });
const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? 'light');
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('diploma-3d.theme'));
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const loaded = (page: Page) =>
  expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });

/** The colour model-viewer draws the model's outlines in, from its three.js scene, as `#rrggbb`. */
const outlineColor = (page: Page) =>
  modelViewer(page).evaluate((element) => {
    type Scene = {
      traverse(visit: (object: { isLineSegments?: boolean; material: { color: { getHexString(): string } } }) => void): void;
    };
    const key = Object.getOwnPropertySymbols(element).find((symbol) => symbol.description === 'scene');
    const scene = key === undefined ? undefined : (element as unknown as Record<symbol, Scene | undefined>)[key];
    if (scene === undefined) throw new Error('model-viewer has no scene to read.');
    const colors = new Set<string>();
    scene.traverse((object) => {
      if (object.isLineSegments === true) colors.add(`#${object.material.color.getHexString()}`);
    });
    return [...colors];
  });

test('the first visit is light whatever the system prefers, and a choice survives reloads, other shapes and the reset', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await loaded(page);
  expect(await themeOf(page)).toBe('light');
  expect(await stored(page)).toBeNull();
  await expect(toggle(page)).toHaveAccessibleName('Темна тема');
  expect(await background(page)).toBe('rgb(242, 243, 245)');

  // The print size is kept apart: both are remembered, each under its own key.
  await page.getByLabel('Найбільший габарит', { exact: true }).fill('120');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAccessibleName('Світла тема');
  expect(await themeOf(page)).toBe('dark');
  expect(await stored(page)).toBe('dark');
  expect(await background(page)).toBe('rgb(20, 20, 20)');

  await page.reload();
  // Set by index.html before the application starts.
  expect(await themeOf(page)).toBe('dark');
  await expect(toggle(page)).toHaveAccessibleName('Світла тема');
  await expect(page.getByLabel('Найбільший габарит', { exact: true })).toHaveValue('120');

  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openSection(page, 'Висота');
  await page.getByLabel('Висота AA₁', { exact: true }).fill('1,5');
  await page.getByRole('button', { name: 'Скинути параметри фігури' }).click();
  await expect(page.getByLabel('Висота AA₁', { exact: true })).toHaveValue('2');
  expect(await themeOf(page)).toBe('dark');

  // By keyboard back to light, which is then what the next visit starts with.
  await toggle(page).focus();
  await page.keyboard.press('Enter');
  expect(await themeOf(page)).toBe('light');
  await page.reload();
  expect(await themeOf(page)).toBe('light');
  await expect(page.getByLabel('Найбільший габарит', { exact: true })).toHaveValue('120');
  expect(errors).toEqual([]);
});

test('without storage the editor starts light and still switches', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  await page.goto('/');
  await loaded(page);
  expect(await themeOf(page)).toBe('light');
  await toggle(page).click();
  expect(await themeOf(page)).toBe('dark');
  expect(errors).toEqual([]);
});

test('on a phone the button shows its icon, named and titled for what it does', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expect(toggle(page)).toHaveAccessibleName('Темна тема');
  await expect(toggle(page)).toHaveAttribute('title', 'Темна тема');
  const box = await toggle(page).boundingBox();
  expect(box?.width).toBeLessThanOrEqual(56);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('switching the theme recolours the outlines and keeps the model, the camera, the construction and the open groups', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await openSection(page, 'Переріз');
  await page.getByLabel('Тип перерізу', { exact: true }).selectOption({ label: 'Паралельно грані' });
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await loaded(page);
  // Dark outlines on the light theme.
  expect(await outlineColor(page)).toEqual(['#23272e']);
  await page.getByRole('button', { name: /^Грань/ }).click();
  await expect(previewViewport(page).locator('svg.overlay')).toHaveCount(1);
  await loaded(page);
  await modelViewer(page).evaluate((element) => {
    const viewer = element as unknown as { cameraOrbit: string; jumpCameraToGoal(): void };
    viewer.cameraOrbit = '120deg 70deg auto';
    viewer.jumpCameraToGoal();
  });
  const orbit = () => modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getCameraOrbit());
  const before = { orbit: await orbit(), src: await modelViewer(page).getAttribute('src') };

  await toggle(page).click();
  await expect(toggle(page)).toHaveAccessibleName('Світла тема');
  await page.waitForTimeout(300);
  // The same model file, not rebuilt; the same direction; the construction and its group still open.
  expect(await modelViewer(page).getAttribute('src')).toBe(before.src);
  const after = await orbit();
  expect(after.theta).toBeCloseTo(before.orbit.theta, 6);
  expect(after.phi).toBeCloseTo(before.orbit.phi, 6);
  await expect(previewViewport(page).locator('svg.overlay')).toHaveCount(1);
  await expect(previewViewport(page).locator('svg.overlay .section')).toHaveCount(2);
  await expect(parameterSection(page, 'Переріз')).toHaveAttribute('open', '');
  await expect(page.getByLabel('Або зі списку', { exact: true })).toBeVisible();

  // Done with the construction: the outlines are back, light on the dark theme.
  await page.getByRole('button', { name: 'Готово', exact: true }).first().click();
  await expect(previewViewport(page).locator('svg.overlay')).toHaveCount(0);
  expect(await outlineColor(page)).toEqual(['#f3f5f9']);
  expect(errors).toEqual([]);
});

for (const [layout, viewport] of [
  ['desktop', { width: 1366, height: 768 }],
  ['narrow phone', { width: 360, height: 740 }],
] as const) {
  test(`switching the theme moves nothing in the header (${layout})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const header = page.getByRole('banner');
    const controls = [
      toggle(page),
      header.getByRole('button', { name: /^Завантажити/ }),
      header.getByLabel('Найбільший габарит', { exact: true }),
      shapeSelect(page),
    ];
    const boxes = () => Promise.all(controls.map((control) => control.boundingBox()));
    const reference = await boxes();
    for (const name of ['Світла тема', 'Темна тема', 'Світла тема', 'Темна тема']) {
      await toggle(page).click();
      // Only the theme's own label is read out; the other one only keeps the width.
      await expect(toggle(page)).toHaveAccessibleName(name);
      expect(await boxes()).toEqual(reference);
    }
    expect(await themeOf(page)).toBe('light');
  });
}
