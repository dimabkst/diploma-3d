import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { readThreeMf } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { findMeshDefects, type MeshMeasurements, measureMesh } from '../../packages/engine/src/mesh.ts';

export type ModelViewerElement = {
  loaded: boolean;
  getCameraOrbit(): { theta: number; radius: number };
  getDimensions(): { x: number; y: number; z: number };
};

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export const shapeSelect = (page: Page) => page.getByLabel('Геометричне тіло', { exact: true });
export const previewViewport = (page: Page) => page.locator('[data-preview-status]');
export const downloadButton = (page: Page) => page.getByRole('button', { name: 'Завантажити 3MF' });
export const modelViewer = (page: Page) => page.locator('model-viewer');

/** Waits until the model described by `summary` (e.g. "Куб · 80 × 80 × 80 мм") is generated and shown in the viewer. */
export async function expectPreviewOf(page: Page, summary: string): Promise<void> {
  await expect(page.getByText(`Фігура: ${summary}`)).toBeVisible({ timeout: 30_000 });
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(downloadButton(page)).toBeEnabled();
}

/**
 * Bounding box of the model shown by model-viewer, in its Y-up frame and in millimetres. The preview's edge lines sit
 * 0.2% of the diagonal outside the solid, so callers should allow about half a millimetre.
 */
export async function viewerDimensionsMm(page: Page): Promise<[number, number, number]> {
  const { x, y, z } = await modelViewer(page).evaluate((element) => (element as unknown as ModelViewerElement).getDimensions());
  return [x * 1000, y * 1000, z * 1000];
}

/** Downloads the print file and returns its name with the measurements of its only, verified closed object. */
export async function downloadThreeMf(page: Page): Promise<{ fileName: string; measurements: MeshMeasurements }> {
  const [download] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
  const { model } = readThreeMf(new Uint8Array(await readFile(await download.path())));
  expect(model.unit).toBe('millimeter');
  expect(model.objects).toHaveLength(1);
  expect(model.buildItems).toEqual([{ objectId: model.objects[0]?.id }]);
  const mesh = model.objects[0]?.mesh;
  if (mesh === undefined) throw new Error('The 3MF file contains no mesh.');
  expect(findMeshDefects(mesh)).toEqual([]);
  return { fileName: download.suggestedFilename(), measurements: measureMesh(mesh) };
}

export function expectSizesClose(actual: readonly number[], expected: readonly number[], toleranceMm: number): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(Math.abs(value - (expected[index] as number))).toBeLessThan(toleranceMm);
  });
}
