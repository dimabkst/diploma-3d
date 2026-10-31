import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, measureMesh } from '../../packages/engine/src/mesh.ts';

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const viewport = (page: Page) => page.locator('[data-preview-status]');
const downloadButton = (page: Page) => page.getByRole('button', { name: 'Завантажити 3MF' });

test('cube: selection, interactive preview and a valid 80 mm 3MF download', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.getByLabel('Геометричне тіло', { exact: true }).selectOption('cube');
  await expect(viewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  type Orbit = { theta: number; radius: number };
  type ModelViewerElement = { loaded: boolean; getCameraOrbit(): Orbit };
  const viewer = page.locator('model-viewer');
  await expect.poll(() => viewer.evaluate((element) => (element as unknown as ModelViewerElement).loaded)).toBe(true);
  const orbit = () => viewer.evaluate((element) => (element as unknown as ModelViewerElement).getCameraOrbit());
  const initial = await orbit();
  const box = await viewer.boundingBox();
  if (box === null) throw new Error('The 3D viewer is not visible.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await orbit()).theta - initial.theta)).toBeGreaterThan(0.1);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await orbit()).radius).toBeLessThan(initial.radius);

  await expect(page.getByText('Фігура: Куб · 80 × 80 × 80 мм')).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: /^80 мм$/ })).toBeVisible();

  await expect(downloadButton(page)).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
  expect(download.suggestedFilename()).toBe('cube.3mf');

  const { model } = readThreeMf(new Uint8Array(await readFile(await download.path())));
  expect(model.unit).toBe('millimeter');
  expect(model.objects).toHaveLength(1);
  expect(model.buildItems).toEqual([{ objectId: model.objects[0]?.id }]);
  const mesh = model.objects[0]?.mesh;
  if (mesh === undefined) throw new Error('The 3MF file contains no mesh.');
  expect(findMeshDefects(mesh)).toEqual([]);
  const measurements = measureMesh(mesh);
  expect(measurements.size).toEqual([80, 80, 80]);
  expect(measurements.volume).toBeCloseTo(512_000, 3);

  expect(errors).toEqual([]);
});

// Matches the binary only; in development Vite also serves `manifold.wasm?import&url` as a JavaScript module.
const WASM_REQUEST = /manifold\.wasm$/;

test('cube: a failed geometry module download shows an error and can be retried', async ({ page }) => {
  await page.route(WASM_REQUEST, (route) => route.abort());
  await page.goto('/');

  await expect(page.getByRole('alert')).toContainText('Не вдалося завантажити геометричний модуль');
  await expect(downloadButton(page)).toBeDisabled();

  await page.unroute(WASM_REQUEST);
  await page.getByRole('button', { name: 'Спробувати ще раз' }).click();
  await expect(viewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(downloadButton(page)).toBeEnabled();
});
