import { expect, test } from '@playwright/test';
import {
  collectErrors,
  dimensionsLine,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  type ModelViewerElement,
  modelViewer,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

test('cube: selection, interactive preview and a valid 80 mm 3MF download', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await shapeSelect(page).selectOption('cube');
  await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
  const viewer = modelViewer(page);
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

  // The dimensions describe the exported mesh, not the view: rotating and zooming leave them unchanged.
  await expect(dimensionsLine(page)).toHaveText('Габарити: 80 × 80 × 80 мм');
  // Fixed proportions need no groups of their own: one line instead of parameters or a measurements table, and only the
  // optional section, collapsed.
  await expect(page.getByText('Усі ребра рівні, грані — квадрати. Пропорції фіксовані.')).toBeVisible();
  await expect(page.locator('summary')).toHaveText([/^Переріз\s*немає/]);
  await expect(page.getByRole('slider')).toHaveCount(0);

  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe('cube.3mf');
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
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(downloadButton(page)).toBeEnabled();
});
