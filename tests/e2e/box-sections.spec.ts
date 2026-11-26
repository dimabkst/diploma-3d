import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { boxVertices } from '../../packages/engine/src/connectors/box.ts';
import { readThreeMf, readThreeMfPart } from '../../packages/engine/src/export/three-mf.test-helper.ts';
import { measureMesh } from '../../packages/engine/src/mesh.ts';
import { collectErrors, openAllSections, openSection, previewViewport, shapeSelect } from './helpers.ts';

const partsButton = (page: Page) => page.getByRole('button', { name: 'Завантажити частини · 3MF', exact: true });
const entry = (page: Page, label: string) => page.getByLabel(label, { exact: true });

async function download(page: Page) {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  return {
    fileName: file.suggestedFilename(),
    objects: readThreeMf(bytes).model.objects.map((object) => object.name),
    section: JSON.parse(readThreeMfPart(bytes, '3D/Other/model-settings.json') as string).sourceModel.section,
  };
}

test('a cube’s diagonal section, then a plane through an edge and a midpoint, labelled in the preview', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Куб' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Поздовжній' });
  await openAllSections(page);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через діагональ' });
  await expect(page.getByRole('button', { name: /^Діагональ/ })).toContainText('AC');
  await expect(page.getByText('Діагональний переріз: площина проходить через діагональ AC')).toBeVisible();
  const diagonal = await download(page);
  expect(diagonal.fileName).toBe('cube-longitudinal-section.3mf');
  expect(diagonal.objects).toEqual(['cube-part-1', 'cube-part-2']);
  expect(diagonal.section).toEqual({
    type: 'longitudinal',
    trace: 'diagonal',
    traceAngleDeg: 0,
    traceSegment: ['A', 'C'],
    through: true,
    positionPercent: 50,
  });
  // The vertices are named in the preview, as the fields name them; those on the plane, on both parts apart.
  await expect(page.locator('model-viewer .point-label')).toHaveText(
    ['A', 'A', 'B', 'C', 'C', 'D', 'A₁', 'A₁', 'B₁', 'C₁', 'C₁', 'D₁'],
    { timeout: 30_000 },
  );

  await entry(page, 'Тип перерізу').selectOption({ label: 'Через ребро або діагональ' });
  await openAllSections(page);
  // A plane through an edge at an angle, named with the face it is measured from.
  await expect(page.getByRole('button', { name: /^Кут до ABCD/ })).toContainText('45°');
  // Through a point: the segment and M's edge, no face first; M starts at the midpoint.
  await entry(page, 'Спосіб').selectOption({ label: 'Через точку ребра' });
  await expect(page.getByRole('button', { name: /^Відрізок/ })).toContainText('AB');
  await expect(page.getByRole('button', { name: /^Точка M/ })).toContainText('Середина CC₁');
  const edge = await download(page);
  expect(edge.section).toEqual({
    type: 'through-line',
    face: 'ABCD',
    line: ['A', 'B'],
    method: 'point',
    pointEdge: ['C', 'C1'],
    pointPercent: 50,
  });
  // Every point of BB1 gives the face ABB1A1 or lies on AB: that edge is not offered for AB.
  await page.getByRole('button', { name: /^Точка M/ }).click();
  const edges = await entry(page, 'Ребро зі списку').locator('option').allTextContents();
  expect(edges).toEqual(['Не обрано', 'Ребро B₁C₁', 'Ребро C₁D₁', 'Ребро A₁D₁', 'Ребро CC₁', 'Ребро DD₁']);
  // Through the diagonal AC, AA1 is offered; its end A lies on the line: said, and nothing to download.
  await page.getByRole('button', { name: /^Відрізок/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'AC — діагональ грані' });
  await page.getByRole('button', { name: /^Точка M/ }).click();
  await entry(page, 'Ребро зі списку').selectOption({ label: 'Ребро AA₁' });
  await expect(page.getByRole('button', { name: /^Точка M/ })).toContainText('Середина AA₁');
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await entry(page, 'AM').fill('0');
  await entry(page, 'MA₁').fill('1');
  await expect(page.getByText(/^Точка M лежить на прямій вибраного відрізка, тож площину не визначено/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  expect(errors).toEqual([]);
});

/**
 * A plane parallel to a face of a cube or a parallelepiped, built as its construction: a pair of faces by name, if given, and a
 * position by its ratio from the face, the construction closed afterwards.
 */
async function facePlane(
  page: Page,
  pair: string | undefined,
  ratio: readonly [string, string],
  labels: readonly [string, string],
) {
  if (pair !== undefined) {
    await page.getByRole('button', { name: /^Грань/ }).click();
    await entry(page, 'Або зі списку').selectOption({ label: pair });
  }
  await page.getByRole('button', { name: /^Положення/ }).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  await entry(page, labels[0]).fill(ratio[0]);
  await entry(page, labels[1]).fill(ratio[1]);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
}

test('a parallelepiped cut by two parallel planes into three parts, with magnets at both', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Паралелепіпед' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно грані' });
  await openAllSections(page);
  await facePlane(page, undefined, ['3', '7'], ['Від ABCD', 'До A₁B₁C₁D₁']);
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Положення/ })).toContainText('3 : 7');
  await expect(page.getByRole('button', { name: /^Другий переріз/ })).toContainText('3 : 2');
  await entry(page, 'Тип кріплення').selectOption({ label: 'Магнітні гнізда' });
  const three = await download(page);
  expect(three.fileName).toBe('parallelepiped-two-face-parallel-sections.3mf');
  expect(three.objects).toEqual(['parallelepiped-lower-part', 'parallelepiped-middle-part', 'parallelepiped-upper-part']);
  expect(three.section).toEqual({ type: 'face-parallel', face: 'ABCD', positionPercent: 30, secondPositionPercent: 60 });
  // Too close: the second position says so.
  await page.getByRole('button', { name: /^Другий переріз/ }).click();
  await entry(page, 'Другий переріз: Від ABCD').fill('7');
  await entry(page, 'Другий переріз: До A₁B₁C₁D₁').fill('13');
  await expect(page.getByText(/Перерізи надто близько/)).toBeVisible();
  await expect(partsButton(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Прибрати другий переріз', exact: true }).click();
  const two = await download(page);
  expect(two.objects.slice(0, 2)).toEqual(['parallelepiped-lower-part', 'parallelepiped-upper-part']);
  expect(errors).toEqual([]);
});

test('a triangle cut off a corner, perpendicular to a body diagonal', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Прямокутний паралелепіпед' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
  await openAllSections(page);
  await page.getByRole('button', { name: /^Перпендикулярно до/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'AC₁' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(page.getByText(/^Площина перпендикулярна до відрізка AC₁: він задає лише напрям/)).toBeVisible();
  await expect(entry(page, 'Кут до площини основи')).toHaveCount(0);
  await entry(page, 'Положення').fill('15');
  const corner = await download(page);
  expect(corner.section).toEqual({
    type: 'inclined',
    inclinationDeg: 0,
    directionDeg: 0,
    normalAlong: ['A', 'C1'],
    positionPercent: 15,
  });
  expect(errors).toEqual([]);
});

test('the section through the diagonal AC and the midpoint of B₁C₁ of a parallelepiped, with magnets', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Паралелепіпед' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Через ребро або діагональ' });
  await openAllSections(page);
  await entry(page, 'Спосіб').selectOption({ label: 'Через точку ребра' });
  await page.getByRole('button', { name: /^Відрізок/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'AC — діагональ грані' });
  await page.getByRole('button', { name: /^Точка M/ }).click();
  await entry(page, 'Ребро зі списку').selectOption({ label: 'Ребро B₁C₁' });
  // M starts at the midpoint, which this edge allows, as it allows its ends.
  await expect(page.getByRole('button', { name: /^Точка M/ })).toContainText('Середина B₁C₁');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  const smooth = await download(page);
  expect(smooth.section).toEqual({
    type: 'through-line',
    face: 'ABCD',
    line: ['A', 'C'],
    method: 'point',
    pointEdge: ['B1', 'C1'],
    pointPercent: 50,
  });
  expect(smooth.objects).toEqual(['parallelepiped-part-1', 'parallelepiped-part-2']);
  await entry(page, 'Тип кріплення').selectOption({ label: 'Магнітні гнізда' });
  const magnets = await download(page);
  expect(magnets.objects.slice(0, 2)).toEqual(['parallelepiped-part-1', 'parallelepiped-part-2']);
  await page.getByRole('button', { name: /^Точка M/ }).click();
  await page.getByRole('radio', { name: 'За відношенням' }).check();
  for (const [first, second, percent] of [
    ['0', '1', 0],
    ['1', '0', 100],
  ] as const) {
    await entry(page, 'B₁M').fill(first);
    await entry(page, 'MC₁').fill(second);
    expect((await download(page)).section).toMatchObject({ pointPercent: percent });
  }
  expect(errors).toEqual([]);
});

/** Each label in the preview: where it is drawn, its anchor, and its part's geometry as model-viewer's scene has them now. */
type LabelGeometry = {
  readonly name: string;
  readonly parts: readonly string[];
  /** The label's centre on the page, and its anchor projected by the current camera onto the current canvas. */
  readonly drawn: readonly [number, number];
  readonly projected: readonly [number, number];
  /** The anchor in the scene, metres; and per part, its node's world matrix and the distance to the nearest mesh vertex. */
  readonly anchor: readonly [number, number, number];
  readonly onParts: readonly { readonly matrix: readonly number[]; readonly nearestM: number }[];
};

async function labelGeometry(page: Page): Promise<LabelGeometry[]> {
  return page.evaluate(() => {
    type Vector = { x: number; y: number; z: number; set(x: number, y: number, z: number): Vector; clone(): Vector };
    type Node = {
      name: string;
      isMesh?: boolean;
      matrixWorld: { elements: number[] };
      geometry?: {
        attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } };
      };
      children: Node[];
      traverse(visit: (node: Node) => void): void;
      position: Vector;
    };
    const viewer = document.querySelector('model-viewer') as unknown as Record<symbol, unknown> & HTMLElement;
    const symbol = Object.getOwnPropertySymbols(viewer).find((candidate) => candidate.description === 'scene') as symbol;
    const scene = viewer[symbol] as {
      target: Node;
      getCamera(): unknown;
      updateMatrixWorld(force: boolean): void;
    };
    scene.updateMatrixWorld(true);
    const camera = scene.getCamera() as { updateMatrixWorld(): void };
    camera.updateMatrixWorld();
    const box = viewer.getBoundingClientRect();
    const apply = (m: readonly number[], point: readonly number[]) => {
      const [x = 0, y = 0, z = 0] = point;
      return [0, 1, 2].map((row) => (m[row] ?? 0) * x + (m[4 + row] ?? 0) * y + (m[8 + row] ?? 0) * z + (m[12 + row] ?? 0));
    };
    const nodes: Node[] = [];
    scene.target.traverse((node) => {
      if (/-(part-1|part-2|lower-part|middle-part|upper-part)$/.test(node.name)) nodes.push(node);
    });
    const nodeOf = (part: string) => nodes.find((node) => node.name.endsWith(`-${part}`) || node.name.endsWith(`-${part}-part`));
    return [...document.querySelectorAll<HTMLElement>('model-viewer .point-label')].map((label) => {
      const local = (label.dataset.position ?? '').split(' ').map((value) => Number.parseFloat(value));
      const anchor = apply(scene.target.matrixWorld.elements, local) as [number, number, number];
      const point = (
        scene.target.position.clone() as unknown as { set(x: number, y: number, z: number): { project(c: unknown): Vector } }
      )
        .set(...anchor)
        .project(camera);
      const rect = label.getBoundingClientRect();
      const parts = (label.dataset.parts ?? '').split(' ').filter((part) => part !== '');
      return {
        name: label.textContent ?? '',
        parts,
        drawn: [rect.left + rect.width / 2, rect.top + rect.height / 2] as [number, number],
        projected: [box.left + ((point.x + 1) / 2) * box.width, box.top + ((1 - point.y) / 2) * box.height] as [number, number],
        anchor,
        onParts: parts.map((part) => {
          const node = nodeOf(part);
          let nearestM = Number.POSITIVE_INFINITY;
          node?.traverse((child) => {
            const position = child.isMesh === true ? child.geometry?.attributes.position : undefined;
            if (position === undefined) return;
            for (let index = 0; index < position.count; index += 1) {
              const [x = 0, y = 0, z = 0] = apply(child.matrixWorld.elements, [
                position.getX(index),
                position.getY(index),
                position.getZ(index),
              ]);
              nearestM = Math.min(nearestM, Math.hypot(x - anchor[0], y - anchor[1], z - anchor[2]));
            }
          });
          return { matrix: node?.matrixWorld.elements ?? [], nearestM };
        }),
      };
    });
  });
}

const PIXEL_TOLERANCE = 1.5;
const VERTEX_TOLERANCE_M = 1e-6;

/**
 * Every label is drawn over its anchor as the camera projects it onto the canvas, and its anchor is its own vertex: a vertex of
 * each part it names, as that part's node places it, the solid's named corner moved by that very node.
 */
async function expectLabelsOnVertices(page: Page, shape: Parameters<typeof boxVertices>[0]): Promise<LabelGeometry[]> {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  let labels: LabelGeometry[] = [];
  await expect
    .poll(async () => {
      labels = await labelGeometry(page);
      return (
        labels.length > 0 &&
        labels.every(({ drawn, projected }) => Math.hypot(drawn[0] - projected[0], drawn[1] - projected[1]) <= PIXEL_TOLERANCE)
      );
    })
    .toBe(true);
  const corners = boxVertices(shape, { longestDimensionMm: 80 });
  for (const label of labels) {
    expect(label.parts.length).toBeGreaterThan(0);
    const [x, y, z] = corners[label.name.replace('₁', '1') as keyof typeof corners];
    for (const { matrix, nearestM } of label.onParts) {
      expect(nearestM).toBeLessThan(VERTEX_TOLERANCE_M);
      const at = (index: number) => matrix[index] ?? 0;
      const expected = [0, 1, 2].map(
        (row) => (at(row) * x) / 1000 + (at(4 + row) * z) / 1000 - (at(8 + row) * y) / 1000 + at(12 + row),
      );
      expect(Math.hypot(...expected.map((value, axis) => value - (label.anchor[axis] ?? 0)))).toBeLessThan(VERTEX_TOLERANCE_M);
    }
  }
  return labels;
}

const orbit = async (page: Page, value: string) =>
  page.evaluate((orbitValue) => {
    const viewer = document.querySelector('model-viewer') as HTMLElement & { cameraOrbit: string; jumpCameraToGoal(): void };
    viewer.cameraOrbit = orbitValue;
    viewer.jumpCameraToGoal();
  }, value);

test('vertex labels stay on their vertices: unequal edges, both views, the camera turned and the viewport resized', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Прямокутний паралелепіпед' });
  await openAllSections(page);
  await entry(page, 'Ширина AD').fill('0,25');
  await entry(page, 'Висота AA₁').fill('3');
  const shape = { kind: 'cuboid', widthRatio: 0.25, heightRatio: 3 } as const;
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно грані' });
  await openAllSections(page);
  await facePlane(page, 'BCC₁B₁ ∥ DAA₁D₁', ['3', '7'], ['Від BCC₁B₁', 'До DAA₁D₁']);
  // Apart: no vertex lies on the plane, so each is named once, on the part that keeps it.
  const apart = await expectLabelsOnVertices(page, shape);
  expect(apart.map((label) => label.name).sort()).toEqual(['A', 'A₁', 'B', 'B₁', 'C', 'C₁', 'D', 'D₁']);
  await page.getByLabel('Розсунути частини').uncheck();
  await expectLabelsOnVertices(page, shape);
  await orbit(page, '150deg 110deg auto');
  await expectLabelsOnVertices(page, shape);
  await page.setViewportSize({ width: 900, height: 700 });
  await expectLabelsOnVertices(page, shape);
  // The dimensions change: the labels go with the new vertices.
  await entry(page, 'Висота AA₁').fill('1,5');
  await expectLabelsOnVertices(page, { kind: 'cuboid', widthRatio: 0.25, heightRatio: 1.5 });
  expect(errors).toEqual([]);
});

test('vertex labels on a parallelepiped leaning both ways, cut through four vertices and then into three parts', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Паралелепіпед' });
  await openAllSections(page);
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('0,5');
  await entry(page, 'Зміщення Y').fill('-0,4');
  const shape = {
    kind: 'parallelepiped',
    baseSideRatio: 1,
    heightRatio: 1,
    baseAngleDeg: 60,
    offsetXRatio: 0.5,
    offsetYRatio: -0.4,
  } as const;
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Поздовжній' });
  await openAllSections(page);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через діагональ' });
  // Apart, A, C, A1 and C1 on the plane are each shown on both parts, under the same name; assembled, once.
  const apart = await expectLabelsOnVertices(page, shape);
  expect(apart.filter((label) => label.name === 'A').map((label) => label.parts)).toEqual([['part-1'], ['part-2']]);
  await page.getByLabel('Розсунути частини').uncheck();
  const together = await expectLabelsOnVertices(page, shape);
  expect(together.map((label) => label.name)).toEqual(['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁']);
  expect(together.find((label) => label.name === 'A')?.parts).toEqual(['part-1', 'part-2']);
  await page.getByLabel('Розсунути частини').check();
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  const three = await expectLabelsOnVertices(page, shape);
  expect(new Set(three.flatMap((label) => label.parts))).toEqual(new Set(['part-1', 'middle', 'part-2']));
  await orbit(page, '-60deg 40deg auto');
  await expectLabelsOnVertices(page, shape);
  await entry(page, 'Висота').fill('1,6');
  await expectLabelsOnVertices(page, { ...shape, heightRatio: 1.6 });
  expect(errors).toEqual([]);
});

/** Each part's extent along a direction, in millimetres, as model-viewer's scene shows its surface now. */
async function partSpans(page: Page, direction: readonly [number, number, number]) {
  return page.evaluate((along) => {
    type Node = {
      name: string;
      isMesh?: boolean;
      matrixWorld: { elements: number[] };
      geometry?: {
        attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } };
      };
      traverse(visit: (node: Node) => void): void;
    };
    const viewer = document.querySelector('model-viewer') as unknown as Record<symbol, unknown>;
    const symbol = Object.getOwnPropertySymbols(viewer).find((candidate) => candidate.description === 'scene') as symbol;
    const scene = viewer[symbol] as { target: Node; updateMatrixWorld(force: boolean): void };
    scene.updateMatrixWorld(true);
    const spans: Record<string, { min: number; max: number }> = {};
    scene.target.traverse((node) => {
      if (!/-(part-1|part-2|lower-part|middle-part|upper-part)$/.test(node.name)) return;
      let [min, max] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
      node.traverse((child) => {
        const position = child.isMesh === true ? child.geometry?.attributes.position : undefined;
        if (position === undefined) return;
        const m = child.matrixWorld.elements;
        for (let index = 0; index < position.count; index += 1) {
          const [x, y, z] = [position.getX(index), position.getY(index), position.getZ(index)];
          const value = [0, 1, 2].reduce(
            (sum, row) =>
              sum + (along[row] ?? 0) * ((m[row] ?? 0) * x + (m[4 + row] ?? 0) * y + (m[8 + row] ?? 0) * z + (m[12 + row] ?? 0)),
            0,
          );
          min = Math.min(min, value * 1000);
          max = Math.max(max, value * 1000);
        }
      });
      spans[node.name.replace(/^.*?-(part-1|part-2|lower-part|middle-part|upper-part)$/, '$1')] = { min, max };
    });
    return spans;
  }, direction);
}

test('three parts of the cube by two diagonal planes through BD: both interfaces open, the labels go with their parts', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Куб' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Поздовжній' });
  await openAllSections(page);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через діагональ' });
  await page.getByRole('button', { name: /^Діагональ/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'BD (і B₁D₁)' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(entry(page, 'Положення')).toHaveValue('50');
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  // The planes x + y = const, the settled normal (1, 1, 0)/√2 in glTF axes (x, z, −y); the gap is 15 % of 80 mm.
  const normal = [Math.SQRT1_2, 0, -Math.SQRT1_2] as const;
  for (const second of ['70', '30']) {
    await entry(page, 'Другий переріз: положення').fill(second);
    await expectLabelsOnVertices(page, { kind: 'cube' });
    const spans = await partSpans(page, normal);
    const [first, middle, last] = [spans['part-1'], spans['middle-part'], spans['part-2']] as { min: number; max: number }[];
    expect((middle?.min ?? 0) - (first?.max ?? 0)).toBeCloseTo(12, 2);
    expect((last?.min ?? 0) - (middle?.max ?? 0)).toBeCloseTo(12, 2);
  }
  // Assembled again: the parts meet at both planes.
  await page.getByLabel('Розсунути частини').uncheck();
  await expectLabelsOnVertices(page, { kind: 'cube' });
  const together = await partSpans(page, normal);
  expect((together['middle-part']?.min ?? 0) - (together['part-1']?.max ?? 0)).toBeCloseTo(0, 2);
  expect((together['part-2']?.min ?? 0) - (together['middle-part']?.max ?? 0)).toBeCloseTo(0, 2);
  expect(errors).toEqual([]);
});

/**
 * Records every frame until `stop`: for each frame model-viewer drew, each label's distance from the nearest vertex of the
 * mesh drawn in that frame, and from its anchor's projection; and whether any label element was replaced since the start.
 */
async function recordFrames(page: Page) {
  await page.evaluate(() => {
    type Node = {
      isMesh?: boolean;
      matrixWorld: { elements: number[] };
      geometry?: {
        attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } };
      };
      traverse(visit: (node: Node) => void): void;
    };
    const viewer = document.querySelector('model-viewer') as unknown as Record<symbol, unknown> & HTMLElement;
    const symbol = Object.getOwnPropertySymbols(viewer).find((candidate) => candidate.description === 'scene') as symbol;
    const record = {
      frames: [] as { meshMm: number; pixels: number; labels: number }[],
      elements: new Set<Element>(),
      replaced: 0,
      stop: false,
    };
    (window as unknown as { frameRecord: typeof record }).frameRecord = record;
    for (const label of document.querySelectorAll('model-viewer .point-label')) record.elements.add(label);
    const apply = (m: readonly number[], [x = 0, y = 0, z = 0]: readonly number[]) =>
      [0, 1, 2].map((row) => (m[row] ?? 0) * x + (m[4 + row] ?? 0) * y + (m[8 + row] ?? 0) * z + (m[12 + row] ?? 0));
    const sample = () => {
      if (record.stop) return;
      const scene = viewer[symbol] as {
        target: Node & {
          position: { clone(): { set(x: number, y: number, z: number): { project(camera: unknown): { x: number; y: number } } } };
        };
        renderCount: number;
        _models: unknown[];
        getCamera(): unknown;
        updateMatrixWorld(force: boolean): void;
      };
      const labels = [...document.querySelectorAll<HTMLElement>('model-viewer .point-label')];
      for (const label of labels) if (!record.elements.has(label)) record.replaced += 1;
      if (scene._models.length > 0 && scene.renderCount > 0) {
        scene.updateMatrixWorld(true);
        const points: number[][] = [];
        scene.target.traverse((node) => {
          const position = node.isMesh === true ? node.geometry?.attributes.position : undefined;
          if (position === undefined) return;
          for (let index = 0; index < position.count; index += 1) {
            points.push(apply(node.matrixWorld.elements, [position.getX(index), position.getY(index), position.getZ(index)]));
          }
        });
        const box = viewer.getBoundingClientRect();
        let [meshMm, pixels] = [0, 0];
        for (const label of labels) {
          const local = (label.dataset.position ?? '').split(' ').map((value) => Number.parseFloat(value));
          const world = apply(scene.target.matrixWorld.elements, local);
          let nearest = Number.POSITIVE_INFINITY;
          for (const point of points) {
            nearest = Math.min(
              nearest,
              Math.hypot((point[0] ?? 0) - (world[0] ?? 0), (point[1] ?? 0) - (world[1] ?? 0), (point[2] ?? 0) - (world[2] ?? 0)),
            );
          }
          const projected = scene.target.position
            .clone()
            .set(world[0] ?? 0, world[1] ?? 0, world[2] ?? 0)
            .project(scene.getCamera());
          const rect = label.getBoundingClientRect();
          const drawn = [rect.left + rect.width / 2, rect.top + rect.height / 2];
          const expected = [box.left + ((projected.x + 1) / 2) * box.width, box.top + ((1 - projected.y) / 2) * box.height];
          meshMm = Math.max(meshMm, nearest * 1000);
          pixels = Math.max(pixels, Math.hypot((drawn[0] ?? 0) - (expected[0] ?? 0), (drawn[1] ?? 0) - (expected[1] ?? 0)));
        }
        record.frames.push({ meshMm, pixels, labels: labels.length });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return async () =>
    page.evaluate(() => {
      const record = (
        window as unknown as {
          frameRecord: { frames: { meshMm: number; pixels: number; labels: number }[]; replaced: number; stop: boolean };
        }
      ).frameRecord;
      record.stop = true;
      return { frames: record.frames, replaced: record.replaced };
    });
}

async function drag(page: Page, slider: string, from: number, to: number) {
  const box = await page.getByRole('slider', { name: `${slider}: повзунок` }).boundingBox();
  if (box === null) throw new Error(`No slider ${slider}`);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  for (let step = 1; step <= 30; step += 1) {
    await page.mouse.move(box.x + box.width * (from + ((to - from) * step) / 30), y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

test('vertex labels stay on the drawn vertices in every frame while sliders are dragged and values typed in quick succession', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Паралелепіпед' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно грані' });
  await openAllSections(page);
  await facePlane(page, undefined, ['3', '7'], ['Від ABCD', 'До A₁B₁C₁D₁']);
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await openSection(page, 'Нахил');
  await openSection(page, 'Висота');
  for (const apart of [true, false]) {
    if (!apart) await page.getByLabel('Розсунути частини').uncheck();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
    const stop = await recordFrames(page);
    await drag(page, 'Зміщення X', 0.5, 0.75);
    await drag(page, 'Висота AA₁', 0.3, 0.45);
    // Typed in quick succession: only the last one is the model in the end.
    for (const height of ['1,2', '1,3', '1,4', '1,5']) await entry(page, 'Висота AA₁').fill(height);
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
    await page.waitForTimeout(300);
    const { frames, replaced } = await stop();
    expect(frames.length).toBeGreaterThan(20);
    // No plane passes through a vertex here: the same eight labels throughout, none replaced, each on a vertex drawn with it.
    expect(new Set(frames.map((frame) => frame.labels))).toEqual(new Set([8]));
    expect(replaced).toBe(0);
    expect(Math.max(...frames.map((frame) => frame.meshMm))).toBeLessThan(1e-3);
    expect(Math.max(...frames.map((frame) => frame.pixels))).toBeLessThan(PIXEL_TOLERANCE);
    const offset = Number.parseFloat((await entry(page, 'Зміщення X').inputValue()).replace(',', '.'));
    await expectLabelsOnVertices(page, {
      kind: 'parallelepiped',
      baseSideRatio: 1,
      heightRatio: 1.5,
      baseAngleDeg: 60,
      offsetXRatio: offset,
      offsetYRatio: 0,
    });
    await expect(entry(page, 'Висота AA₁')).toHaveValue('1,5');
  }
  expect(errors).toEqual([]);
});

const options = async (page: Page, label: string) => entry(page, label).locator('option').allTextContents();

test('a triangular prism: through a median and a midline of its base, then through AB and the midpoint of CC₁', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  const shape = { kind: 'prism', baseType: 'regular', baseSides: 3, heightRatio: 2, offsetXRatio: 0, offsetYRatio: 0 } as const;
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно грані' });
  await openAllSections(page);
  // The bases as one orientation, and the three lateral faces, no two of which are parallel.
  await page.getByRole('button', { name: /^Грань/ }).click();
  expect(await options(page, 'Або зі списку')).toEqual(['ABC ∥ A₁B₁C₁', 'ABB₁A₁', 'BCC₁B₁', 'CAA₁C₁']);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await entry(page, 'Тип перерізу').selectOption({ label: 'Поздовжній' });
  await openAllSections(page);
  // An equilateral base: its median, altitude and bisector from a vertex are one line, offered once; no diagonals.
  expect(await options(page, 'Слід на основі')).toEqual([
    'Під кутом до ребра AB',
    'Через медіану (= висоту)',
    'Через середню лінію',
  ]);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через медіану (= висоту)' });
  await page.getByRole('button', { name: /^З вершини/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'C' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(
    page.getByText('В основі рівносторонній трикутник: медіана, висота й бісектриса з однієї вершини збігаються.'),
  ).toBeVisible();
  await expect(page.getByText(/Площина проходить через медіану з вершини C/)).toBeVisible();
  const median = await download(page);
  expect(median.fileName).toBe('prism-3-sided-longitudinal-section.3mf');
  expect(median.section).toMatchObject({ type: 'longitudinal', trace: 'median', traceVertex: 'C', through: true });
  await expectLabelsOnVertices(page, shape);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через середню лінію' });
  await page.getByRole('button', { name: /^Паралельно стороні/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'Стороні AB' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  const midline = await download(page);
  expect(midline.section).toMatchObject({ trace: 'midline', traceSegment: ['A', 'B'], through: true });

  await entry(page, 'Тип перерізу').selectOption({ label: 'Через ребро або діагональ' });
  await openAllSections(page);
  await entry(page, 'Спосіб').selectOption({ label: 'Через точку ребра' });
  // The edges and the lateral faces' diagonals, none of the bases, which have none.
  await page.getByRole('button', { name: /^Відрізок/ }).click();
  const segments = await options(page, 'Або зі списку');
  expect(segments).toEqual(expect.arrayContaining(['AB — ребро', 'BC — ребро', 'AC — ребро', 'AB₁ — діагональ грані']));
  expect(segments).toHaveLength(1 + 9 + 6);
  // A1B1 and the lateral edges through A and B give the face ABB1A1 or meet AB: not offered for M.
  await page.getByRole('button', { name: /^Точка M/ }).click();
  expect((await options(page, 'Ребро зі списку')).slice(1).sort()).toEqual(['Ребро A₁C₁', 'Ребро B₁C₁', 'Ребро CC₁']);
  await expect(entry(page, 'Ребро зі списку')).toHaveValue('C-C1');
  await expect(page.getByRole('button', { name: /^Точка M/ })).toContainText('Середина CC₁');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  const edge = await download(page);
  expect(edge.section).toEqual({
    type: 'through-line',
    face: 'ABC',
    line: ['A', 'B'],
    method: 'point',
    pointEdge: ['C', 'C1'],
    pointPercent: 50,
  });
  await expectLabelsOnVertices(page, shape);
  expect(errors).toEqual([]);
});

test('a hexagonal prism: its shorter and longer base diagonals, each a section through two lateral edges', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await openSection(page, 'Основа');
  await entry(page, 'Багатокутник').selectOption({ label: 'Правильний шестикутник' });
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно грані' });
  await openAllSections(page);
  await page.getByRole('button', { name: /^Грань/ }).click();
  expect(await options(page, 'Або зі списку')).toEqual([
    'ABCDEF ∥ A₁B₁C₁D₁E₁F₁',
    'ABB₁A₁ ∥ DEE₁D₁',
    'BCC₁B₁ ∥ EFF₁E₁',
    'CDD₁C₁ ∥ FAA₁F₁',
  ]);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await entry(page, 'Тип перерізу').selectOption({ label: 'Поздовжній' });
  await openAllSections(page);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через діагональ' });
  await page.getByRole('button', { name: /^Діагональ/ }).click();
  const diagonals = await options(page, 'Або зі списку');
  expect(diagonals).toHaveLength(9);
  expect(diagonals).toContain('AC (і A₁C₁) — коротша');
  expect(diagonals).toContain('AD (і A₁D₁) — довша, через центр');
  await entry(page, 'Або зі списку').selectOption({ label: 'AD (і A₁D₁) — довша, через центр' });
  await expect(
    page.getByText('Діагональний переріз: площина проходить через діагональ AD (довша, через центр) і бічні ребра AA₁ та DD₁.'),
  ).toBeVisible();
  await expect(entry(page, 'Положення')).toHaveValue('50');
  const long = await partVolumes(page);
  expect(long.section).toMatchObject({ trace: 'diagonal', traceSegment: ['A', 'D'], through: true });
  expect(long.volumes[0] as number).toBeCloseTo(long.volumes[1] as number, 0);
  // Through AC itself, not moved to the centre: a sixth of the prism on one side, five sixths on the other.
  await entry(page, 'Або зі списку').selectOption({ label: 'AC (і A₁C₁) — коротша' });
  await expect(entry(page, 'Положення')).toHaveValue('75');
  const short = await partVolumes(page);
  expect(short.section).toMatchObject({ trace: 'diagonal', traceSegment: ['A', 'C'], through: true, positionPercent: 75 });
  const [small, large] = [...short.volumes].sort((a, b) => a - b) as [number, number];
  expect(small / (small + large)).toBeCloseTo(1 / 6, 3);
  expect(errors).toEqual([]);
});

test('an oblique pentagonal prism cut perpendicular to its lateral edges, then into three parts with magnets', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await openSection(page, 'Основа');
  await entry(page, 'Багатокутник').selectOption({ label: 'Правильний п’ятикутник' });
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('0,4');
  const shape = { kind: 'prism', baseType: 'regular', baseSides: 5, heightRatio: 2, offsetXRatio: 0.4, offsetYRatio: 0 } as const;
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
  await openAllSections(page);
  // The lateral edges are one of the segments of «Перпендикулярно до», as on every prism: no separate shortcut.
  await expect(page.getByRole('button', { name: 'Перпендикулярно бічним ребрам', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Перпендикулярно до/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'Бічні ребра (AA₁)' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(page.getByText('Площина перпендикулярна до бічних ребер.')).toBeVisible();
  const single = await download(page);
  expect(single.section).toMatchObject({ type: 'inclined', normalAlong: ['A', 'A1'], positionPercent: 50 });
  await expectLabelsOnVertices(page, shape);
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Магнітні гнізда' });
  const three = await download(page);
  expect(three.objects).toEqual(['prism-5-sided-part-1', 'prism-5-sided-middle-part', 'prism-5-sided-part-2']);
  await expectLabelsOnVertices(page, shape);
  expect(errors).toEqual([]);
});

/** The parts' volumes in the downloaded print file, and the section it records. */
async function partVolumes(page: Page) {
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'loaded', { timeout: 30_000 });
  await expect(partsButton(page)).toBeEnabled({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), partsButton(page).click()]);
  const bytes = new Uint8Array(await readFile(await file.path()));
  return {
    volumes: readThreeMf(bytes)
      .model.objects.filter((object) => !object.name.includes('dowel'))
      .map((object) => measureMesh(object.mesh).volume),
    section: JSON.parse(readThreeMfPart(bytes, '3D/Other/model-settings.json') as string).sourceModel.section,
    connector: JSON.parse(readThreeMfPart(bytes, '3D/Other/model-settings.json') as string).sourceModel.connector,
  };
}

const cameraOrbit = (page: Page) =>
  page.evaluate(() =>
    (document.querySelector('model-viewer') as unknown as { getCameraOrbit(): { theta: number; phi: number } }).getCameraOrbit(),
  );

test('a plane perpendicular to the lateral edges goes back to its angles where it is, as often as wanted', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('0,4');
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
  await openAllSections(page);
  await entry(page, 'Кут до площини основи').fill('30');
  await page.getByRole('button', { name: 'Додати паралельний переріз', exact: true }).click();
  await entry(page, 'Тип кріплення').selectOption({ label: 'Магнітні гнізда' });
  // A triangular prism's lateral edges are one of the segments of «Перпендикулярно до»: no separate shortcut.
  await expect(page.getByRole('button', { name: 'Перпендикулярно бічним ребрам', exact: true })).toHaveCount(0);
  const reference = page.getByRole('button', { name: /^Перпендикулярно до/ });
  const manual = page.getByRole('button', { name: 'Змінити нахил', exact: true });
  await expect(reference).toContainText('не вибрано');
  await expect(manual).toHaveCount(0);
  await orbit(page, '70deg 75deg auto');
  for (const lean of ['0,6', '0,2']) {
    await reference.click();
    await entry(page, 'Або зі списку').selectOption({ label: 'Бічні ребра (AA₁)' });
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(entry(page, 'Кут до площини основи')).toHaveCount(0);
    await expect(reference).toContainText('бічні ребра');
    await expect(page.getByText('Площина перпендикулярна до бічних ребер.')).toBeVisible();
    // The solid leans another way meanwhile: the plane stays perpendicular to its lateral edges.
    await entry(page, 'Зміщення X').fill(lean);
    const perpendicular = await partVolumes(page);
    expect(perpendicular.section).toMatchObject({ normalAlong: ['A', 'A1'] });
    expect(perpendicular.volumes).toHaveLength(3);
    const camera = await cameraOrbit(page);
    await manual.click();
    await expect(entry(page, 'Кут до площини основи')).toBeVisible();
    await expect(entry(page, 'Напрям нахилу')).toBeVisible();
    await expect(reference).toContainText('не вибрано');
    await expect(manual).toHaveCount(0);
    const angles = await partVolumes(page);
    expect(angles.section).not.toHaveProperty('normalAlong');
    expect(angles.connector).toMatchObject({ settings: { type: 'magnet' } });
    expect(angles.section.secondPositionPercent).toBeDefined();
    // The same three parts: the planes did not move.
    angles.volumes.forEach((volume, index) => {
      expect(Math.abs(volume / (perpendicular.volumes[index] as number) - 1)).toBeLessThan(1e-6);
    });
    expect(await cameraOrbit(page)).toEqual(camera);
    await expect(page.getByLabel('Розсунути частини')).toBeChecked();
    await expectLabelsOnVertices(page, {
      kind: 'prism',
      baseType: 'regular',
      baseSides: 3,
      heightRatio: 2,
      offsetXRatio: Number.parseFloat(lean.replace(',', '.')),
      offsetYRatio: 0,
    });
    // The angles are the user's again.
    await entry(page, 'Кут до площини основи').fill('25');
    expect((await partVolumes(page)).section).toMatchObject({ inclinationDeg: 25 });
  }
  expect(errors).toEqual([]);
});

test('a tetrahedron through its apex, through a base edge and a lateral edge’s midpoint, and parallel to opposite edges', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Правильний тетраедр' });
  await openAllSections(page);
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Через вершину піраміди' });
  await openAllSections(page);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через медіану (= висоту)' });
  await page.getByRole('button', { name: /^З вершини/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'C' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  const median = await download(page);
  expect(median.fileName).toBe('tetrahedron-apex-section.3mf');
  expect(median.section).toMatchObject({ type: 'through-apex', trace: 'median', traceVertex: 'C' });
  // S and C lie on the plane: each is shown on both parts apart.
  const labels = await expectLabelsOnVertices(page, { kind: 'tetrahedron' });
  expect(labels.filter((label) => label.name === 'S')).toHaveLength(2);

  await entry(page, 'Слід на основі').selectOption({ label: 'Через бічне ребро й точку' });
  await page.getByRole('button', { name: /^Бічне ребро/ }).click();
  await entry(page, 'Або зі списку').selectOption({ label: 'SC' });
  await page.getByRole('button', { name: /^Точка M/ }).click();
  expect(await options(page, 'Ребро зі списку')).toEqual(['Ребро AB']);
  await expect(page.getByRole('button', { name: /^Точка M/ })).toContainText('Середина AB');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  expect((await download(page)).section).toMatchObject({
    trace: 'edge-point',
    traceVertex: 'C',
    traceSegment: ['A', 'B'],
    tracePointPercent: 50,
  });

  await entry(page, 'Тип перерізу').selectOption({ label: 'Через ребро основи' });
  await openAllSections(page);
  await entry(page, 'Спосіб').selectOption({ label: 'Через точку ребра' });
  await expect(page.getByRole('button', { name: /^Ребро основи/ })).toContainText('AB');
  // SA and SB give the face SAB with AB: only CS is offered.
  await page.getByRole('button', { name: /^Точка M/ }).click();
  expect(await options(page, 'Ребро зі списку')).toEqual(['Не обрано', 'Ребро CS']);
  await expect(page.getByRole('button', { name: /^Точка M/ })).toContainText('Середина CS');
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  expect((await download(page)).section).toEqual({
    type: 'through-line',
    face: 'ABC',
    line: ['A', 'B'],
    method: 'point',
    pointEdge: ['C', 'S'],
    pointPercent: 50,
  });
  await expectLabelsOnVertices(page, { kind: 'tetrahedron' });

  await entry(page, 'Тип перерізу').selectOption({ label: 'Похилий' });
  await openAllSections(page);
  await page.getByRole('button', { name: /^Паралельно ребрам/ }).click();
  // The pair's own list, the one its open field shows.
  await entry(page, 'Або зі списку').filter({ visible: true }).selectOption({ label: 'SC і AB' });
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('button', { name: 'Через основу висоти', exact: true }).click();
  const pair = await partVolumes(page);
  expect(pair.section).toMatchObject({
    parallelTo: [
      ['S', 'C'],
      ['A', 'B'],
    ],
  });
  await page.getByRole('button', { name: 'Змінити нахил', exact: true }).click();
  await expect(entry(page, 'Кут до площини основи')).toBeVisible();
  const angles = await partVolumes(page);
  expect(angles.section).not.toHaveProperty('parallelTo');
  angles.volumes.forEach((volume, index) => {
    expect(Math.abs(volume / (pair.volumes[index] as number) - 1)).toBeLessThan(1e-6);
  });
  expect(errors).toEqual([]);
});

test('an oblique square pyramid at half its height, and through its apex and a diagonal of its base', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Піраміда' });
  await openAllSections(page);
  await openSection(page, 'Вершина');
  await entry(page, 'Зміщення X').fill('0,3');
  const shape = { kind: 'pyramid', baseType: 'regular', baseSides: 4, heightRatio: 1, apexXRatio: 0.3, apexYRatio: 0 } as const;
  await openSection(page, 'Переріз');
  await entry(page, 'Тип перерізу').selectOption({ label: 'Паралельно грані' });
  await openAllSections(page);
  // Five faces, each its own orientation, in the construction's list.
  await page.getByRole('button', { name: /^Грань/ }).click();
  expect(await options(page, 'Або зі списку')).toEqual(['ABCD', 'SAB', 'SBC', 'SCD', 'SDA']);
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  const half = await partVolumes(page);
  // The apex's part at half height is an eighth of the pyramid.
  const [lower, upper] = half.volumes as [number, number];
  expect(upper / (lower + upper)).toBeCloseTo(1 / 8, 5);
  await expectLabelsOnVertices(page, shape);
  await entry(page, 'Тип перерізу').selectOption({ label: 'Через вершину піраміди' });
  await openAllSections(page);
  await entry(page, 'Слід на основі').selectOption({ label: 'Через діагональ' });
  await expect(page.getByText(/Діагональний переріз: площина проходить через вершину S і діагональ AC/)).toBeVisible();
  const diagonal = await partVolumes(page);
  expect(diagonal.section).toMatchObject({ type: 'through-apex', trace: 'diagonal', traceSegment: ['A', 'C'] });
  await expectLabelsOnVertices(page, shape);
  expect(errors).toEqual([]);
});
