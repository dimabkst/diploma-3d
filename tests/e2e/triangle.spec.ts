import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  hasNoHorizontalOverflow,
  openAllSections,
  openSection,
  previewPlace,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type Field = 'Сторона основи b' | 'Кут α' | 'Висота h' | 'Зміщення X' | 'Зміщення Y';

const entry = (page: Page, field: Field) => page.getByLabel(field, { exact: true });
const slider = (page: Page, field: Field) => page.getByRole('slider', { name: `${field}: повзунок`, exact: true });
const stepButton = (page: Page, field: Field, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${field}: ${action}`, exact: true });
const baseType = (page: Page) => page.getByLabel('Тип основи', { exact: true });
const polygonSelect = (page: Page) => page.getByLabel('Багатокутник', { exact: true });
const chooseBaseType = (page: Page, label: 'Правильний багатокутник' | 'Трикутник') => baseType(page).selectOption({ label });

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

/**
 * The prism over the triangle P0 = (0, 0), P1 = (1, 0), P2 = b0·(cos α, sin α), with height h0 and the upper base moved
 * by (dx0, dy0), scaled so that its bounding box is at most 80 mm. Each lateral face spans a base edge e and the lateral
 * edge v = (dx, dy, h), with area |e × v|.
 */
function geometry(b0: number, angleDeg: number, h0: number, dx0 = 0, dy0 = 0) {
  const radians = (angleDeg * Math.PI) / 180;
  const [p2x, p2y] = [b0 * Math.cos(radians), b0 * Math.sin(radians)];
  const size0 = [Math.max(1, p2x) - Math.min(0, p2x) + Math.abs(dx0), p2y + Math.abs(dy0), h0];
  const s = 80 / Math.max(...size0);
  const v = [dx0 * s, dy0 * s, h0 * s] as const;
  const faceArea = ([ex, ey]: readonly [number, number]) => Math.hypot(ey * v[2], -ex * v[2], ex * v[1] - ey * v[0]);
  const edges = [
    [s, 0],
    [(p2x - 1) * s, p2y * s],
    [-p2x * s, -p2y * s],
  ] as const;
  const baseArea = (s * s * p2y) / 2;
  return {
    a: s,
    b: b0 * s,
    c: s * Math.hypot(1 - p2x, p2y),
    h: h0 * s,
    lateralEdge: Math.hypot(...v),
    baseArea,
    size: size0.map((value) => value * s),
    volume: baseArea * h0 * s,
    surfaceArea: 2 * baseArea + edges.reduce((sum, edge) => sum + faceArea(edge), 0),
  };
}

const summary = (expected: { size: number[] }) =>
  `Призма · ${expected.size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

async function expectDownloadedTriangle(page: Page, expected: ReturnType<typeof geometry>): Promise<void> {
  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe('prism-triangle.3mf');
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(measurements.surfaceArea / expected.surfaceArea - 1)).toBeLessThan(1e-6);
}

test('triangle prism: the base type shows its own fields and help, and the right triangle is exported', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await expect(baseType(page).locator('option:checked')).toHaveText('Правильний багатокутник');
  await expect(entry(page, 'Кут α')).toHaveCount(0);

  await chooseBaseType(page, 'Трикутник');
  await expect(polygonSelect(page)).toHaveCount(0);
  await expect(entry(page, 'Сторона основи b')).toHaveValue('1');
  await expect(entry(page, 'Кут α')).toHaveValue('60');
  await page.getByRole('button', { name: 'Як задано трикутник?' }).click();
  await expect(page.getByText('Сторонами a і b та кутом α між ними; третя сторона обчислюється автоматично.')).toBeVisible();
  // The default b = a, α = 60° with the prism's h = 2a: the equilateral triangle, a = b = c = 40 mm.
  await expectPreviewOf(page, summary(geometry(1, 60, 2)));
  await expectDownloadedTriangle(page, geometry(1, 60, 2));

  // The right-triangle reference: a = 80, b = 60, c = 100, h = 80 mm.
  await entry(page, 'Сторона основи b').fill('0,75');
  await entry(page, 'Кут α').fill('90');
  await entry(page, 'Висота h').fill('1');
  // V = 2400 · 80 = 192 000 mm³ and S = 2 · 2400 + (80 + 60 + 100) · 80 = 24 000 mm².
  await expectPreviewOf(page, 'Призма · 80 × 60 × 80 мм');
  await expectDownloadedTriangle(page, geometry(0.75, 90, 1));

  expect(errors).toEqual([]);
});

test('triangle prism: side, angle and displacement controls step and keep typed values', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await chooseBaseType(page, 'Трикутник');

  const angle = entry(page, 'Кут α');
  await angle.fill('62');
  await stepButton(page, 'Кут α', 'зменшити').click();
  await expect(angle).toHaveValue('60');
  await angle.fill('62');
  await stepButton(page, 'Кут α', 'збільшити').click();
  await expect(angle).toHaveValue('65');
  await slider(page, 'Кут α').press('End');
  await expect(angle).toHaveValue('165');
  await angle.fill('97,5');
  await angle.blur();
  await expect(angle).toHaveValue('97,5');

  const side = entry(page, 'Сторона основи b');
  await side.fill('2.05');
  await stepButton(page, 'Сторона основи b', 'зменшити').click();
  await expect(side).toHaveValue('2');
  await side.press('ArrowUp');
  await expect(side).toHaveValue('2,25');
  await side.fill('1.3');
  await side.blur();
  await expect(side).toHaveValue('1.3');

  // An obtuse oblique prism: the base is wider than a, and the upper base moves by (−0,5a, 0,75a).
  await entry(page, 'Висота h').fill('1');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('-0,5');
  await entry(page, 'Зміщення Y').fill('0,75');
  const oblique = geometry(1.3, 97.5, 1, -0.5, 0.75);
  await expectPreviewOf(page, summary(oblique));
  await expectDownloadedTriangle(page, oblique);

  await page.getByRole('button', { name: 'Прибрати нахил', exact: true }).click();
  await expectPreviewOf(page, summary(geometry(1.3, 97.5, 1)));
  await expectDownloadedTriangle(page, geometry(1.3, 97.5, 1));

  expect(errors).toEqual([]);
});

test('triangle prism: switching base types keeps the shared height and displacement and validates only the active base', async ({
  page,
}) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await polygonSelect(page).selectOption({ label: 'Правильний шестикутник' });
  await entry(page, 'Висота h').fill('1,5');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('0,5');
  // The hexagon is 2a wide and √3·a deep; with dx = 0,5a and h = 1,5a the box is 2,5a × √3·a × 1,5a, so a = 32 mm.
  await expectPreviewOf(page, `Призма · 80 × ${numberFormat.format(32 * Math.sqrt(3))} × 48 мм`);

  // Switch and read the download button in the same task: the hexagonal prism must not be offered for the triangle.
  const disabledRightAfterSwitch = await baseType(page).evaluate(async (select: HTMLSelectElement) => {
    select.value = 'triangle';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterSwitch).toBe(true);
  await expect(entry(page, 'Висота h')).toHaveValue('1,5');
  await expect(entry(page, 'Зміщення X')).toHaveValue('0,5');
  await expectPreviewOf(page, summary(geometry(1, 60, 1.5, 0.5)));

  // An invalid triangle angle blocks only the triangle base.
  await entry(page, 'Кут α').fill('170');
  await expect(page.getByText('Допустимі значення — від 15° до 165°.')).toBeVisible();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(downloadButton(page)).toBeDisabled();
  await chooseBaseType(page, 'Правильний багатокутник');
  await expect(polygonSelect(page).locator('option:checked')).toHaveText('Правильний шестикутник');
  await expect(entry(page, 'Висота h')).toHaveValue('1,5');
  await expect(page.getByText('Допустимі значення — від 15° до 165°.')).toHaveCount(0);
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  expect((await downloadThreeMf(page)).fileName).toBe('prism-6-sided.3mf');

  // Back to the triangle: its typed angle is still there, and fixing it builds the latest geometry.
  await chooseBaseType(page, 'Трикутник');
  await expect(entry(page, 'Кут α')).toHaveValue('170');
  await entry(page, 'Кут α').fill('120');
  await entry(page, 'Зміщення Y').fill('-1');
  const latest = geometry(1, 120, 1.5, 0.5, -1);
  await expectPreviewOf(page, summary(latest));
  await expectDownloadedTriangle(page, latest);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`triangle prism: the preview keeps its place without horizontal overflow (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough on a phone to keep the 3D viewer, which loads models only while visible, on screen above the controls.
    await page.setViewportSize({ width, height: width < 600 ? 2400 : 900 });
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: 'Призма' });
    await openAllSections(page);
    await chooseBaseType(page, 'Трикутник');
    await openSection(page, 'Нахил');

    let reference: Awaited<ReturnType<typeof previewPlace>> | undefined;
    for (const [b, angle, h, x] of [
      [1, 60, 2, 0],
      [0.75, 90, 1, 0],
      [4, 15, 0.25, 0.75],
      [0.25, 165, 4, -2],
      [4, 60, 1, 0],
    ] as const) {
      await entry(page, 'Сторона основи b').fill(String(b).replace('.', ','));
      await entry(page, 'Кут α').fill(String(angle));
      await entry(page, 'Висота h').fill(String(h).replace('.', ','));
      await entry(page, 'Зміщення X').fill(String(x));
      await expectPreviewOf(page, summary(geometry(b, angle, h, x)));
      const current = await previewPlace(page);
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    }
  });
}
