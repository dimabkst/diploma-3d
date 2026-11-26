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
  parameterSection,
  previewPlace,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type Field =
  | 'Паралельна сторона b'
  | 'Висота трапеції t'
  | 'Зміщення сторони b'
  | 'Висота призми h'
  | 'Висота h'
  | 'Зміщення X'
  | 'Зміщення Y';

const entry = (page: Page, field: Field) => page.getByLabel(field, { exact: true });
const stepButton = (page: Page, field: Field, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${field}: ${action}`, exact: true });
const baseType = (page: Page) => page.getByLabel('Тип основи', { exact: true });
const status = (page: Page) => parameterSection(page, 'Основа').getByText(/^Зараз:/);
const align = (page: Page, label: 'По центру' | 'Вирівняти зліва' | 'Вирівняти справа') =>
  page.getByRole('button', { name: label, exact: true }).click();

async function selectTrapezoid(page: Page): Promise<void> {
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await baseType(page).selectOption({ label: 'Трапеція' });
}

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

/**
 * The prism over P0 = (−1/2, 0), P1 = (1/2, 0), P2 = (δ0 + b0/2, t0), P3 = (δ0 − b0/2, t0) with height h0 and the
 * upper base moved by (dx0, dy0), scaled so that its bounding box is at most 80 mm. Each lateral face spans a base
 * edge e and the lateral edge v = (dx, dy, h), with area |e × v|.
 */
function geometry(b0: number, t0: number, delta0: number, h0: number, dx0 = 0, dy0 = 0) {
  const width0 = Math.max(0.5, delta0 + b0 / 2) - Math.min(-0.5, delta0 - b0 / 2) + Math.abs(dx0);
  const size0 = [width0, t0 + Math.abs(dy0), h0];
  const s = 80 / Math.max(...size0);
  const v = [dx0 * s, dy0 * s, h0 * s] as const;
  const faceArea = ([ex, ey]: readonly [number, number]) => Math.hypot(ey * v[2], -ex * v[2], ex * v[1] - ey * v[0]);
  const edges = [
    [1, 0],
    [delta0 + b0 / 2 - 0.5, t0],
    [-b0, 0],
    [-0.5 - delta0 + b0 / 2, -t0],
  ].map(([x, y]) => [(x as number) * s, (y as number) * s] as const);
  const baseArea = ((1 + b0) * t0 * s * s) / 2;
  return {
    c: s * Math.hypot(t0, delta0 + (b0 - 1) / 2),
    d: s * Math.hypot(t0, delta0 + (1 - b0) / 2),
    lateralEdge: Math.hypot(...v),
    size: size0.map((value) => value * s),
    volume: baseArea * h0 * s,
    surfaceArea: 2 * baseArea + edges.reduce((sum, edge) => sum + faceArea(edge), 0),
  };
}

const summary = (expected: { size: number[] }) =>
  `Призма · ${expected.size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

async function expectDownloadedTrapezoid(page: Page, expected: ReturnType<typeof geometry>): Promise<void> {
  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe('prism-trapezoid.3mf');
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(measurements.surfaceArea / expected.surfaceArea - 1)).toBeLessThan(1e-6);
}

test('trapezoid prism: fields, alignment actions, special cases and the right-trapezoid reference', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await selectTrapezoid(page);

  await page.getByRole('button', { name: 'Як задано трапецію?' }).click();
  await expect(page.getByText('a і b — паралельні сторони; висота трапеції t — відстань між ними.')).toBeVisible();
  await expect(entry(page, 'Паралельна сторона b')).toHaveValue('0,5');
  await expect(entry(page, 'Висота трапеції t')).toHaveValue('0,5');
  await expect(entry(page, 'Зміщення сторони b')).toHaveValue('0');
  // The prism's height is named apart from the trapezoid's own height t.
  await expect(entry(page, 'Висота призми h')).toHaveValue('2');
  await expect(entry(page, 'Висота h')).toHaveCount(0);
  await expect(status(page)).toHaveText('Зараз: рівнобічна трапеція');
  await expectPreviewOf(page, summary(geometry(0.5, 0.5, 0, 2)));

  // The reference right trapezoid: b = a/2, t = 0,375a, side b flush left (δ = −0,25a), h = a/2.
  await entry(page, 'Висота трапеції t').fill('0,375');
  await entry(page, 'Висота призми h').fill('0,5');
  await align(page, 'Вирівняти зліва');
  await expect(entry(page, 'Зміщення сторони b')).toHaveValue('-0,25');
  await expect(status(page)).toHaveText('Зараз: прямокутна трапеція');
  // a = 80, b = 40, t = 30, h = 40 mm: V = 1800 · 40 = 72 000 mm³.
  await expectPreviewOf(page, 'Призма · 80 × 30 × 40 мм');
  await expectDownloadedTrapezoid(page, geometry(0.5, 0.375, -0.25, 0.5));

  // Right alignment mirrors the base.
  await align(page, 'Вирівняти справа');
  await expect(entry(page, 'Зміщення сторони b')).toHaveValue('0,25');
  await expect(status(page)).toHaveText('Зараз: прямокутна трапеція');
  await expectDownloadedTrapezoid(page, geometry(0.5, 0.375, 0.25, 0.5));
  await align(page, 'По центру');
  await expect(entry(page, 'Зміщення сторони b')).toHaveValue('0');
  await expect(status(page)).toHaveText('Зараз: рівнобічна трапеція');

  // The alignment is set once: a later b keeps the shift, which no longer aligns.
  await align(page, 'Вирівняти зліва');
  await entry(page, 'Паралельна сторона b').fill('2');
  await expect(entry(page, 'Зміщення сторони b')).toHaveValue('-0,25');
  await expect(status(page)).toHaveText('Зараз: трапеція');
  await align(page, 'Вирівняти зліва');
  await expect(entry(page, 'Зміщення сторони b')).toHaveValue('0,5');

  // b = a stays valid in the trapezoid controls: a parallelogram, and a rectangle without shift.
  await entry(page, 'Паралельна сторона b').fill('1');
  await expect(status(page)).toHaveText('Зараз: паралелограм (b = a)');
  await align(page, 'По центру');
  await expect(status(page)).toHaveText('Зараз: прямокутник (b = a)');
  await expect(baseType(page).locator('option:checked')).toHaveText('Трапеція');
  await expectPreviewOf(page, summary(geometry(1, 0.375, 0, 0.5)));

  expect(errors).toEqual([]);
});

test('trapezoid prism: negative and typed shifts, separated parallel sides and an oblique prism', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await selectTrapezoid(page);

  const shift = entry(page, 'Зміщення сторони b');
  await shift.fill('-0,1');
  await stepButton(page, 'Зміщення сторони b', 'зменшити').click();
  await expect(shift).toHaveValue('-0,25');
  await shift.fill('-0,1');
  await stepButton(page, 'Зміщення сторони b', 'збільшити').click();
  await expect(shift).toHaveValue('0');
  await shift.fill('1.35');
  await shift.blur();
  await expect(shift).toHaveValue('1.35');

  // b = a/4 shifted by 2a: the parallel sides' projections onto X do not overlap, and the base is still valid.
  await entry(page, 'Паралельна сторона b').fill('0,25');
  await shift.fill('2');
  await entry(page, 'Висота призми h').fill('1');
  await expectPreviewOf(page, summary(geometry(0.25, 0.5, 2, 1)));
  await expectDownloadedTrapezoid(page, geometry(0.25, 0.5, 2, 1));

  // The upper base moves as a whole; the trapezoid itself stays.
  await entry(page, 'Паралельна сторона b').fill('1,5');
  await entry(page, 'Висота трапеції t').fill('0,8');
  await shift.fill('-0,35');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('-1');
  await entry(page, 'Зміщення Y').fill('0,5');
  const oblique = geometry(1.5, 0.8, -0.35, 1, -1, 0.5);
  await expectPreviewOf(page, summary(oblique));
  await expectDownloadedTrapezoid(page, oblique);

  expect(errors).toEqual([]);
});

test('trapezoid prism: base switching keeps the shared height and offsets and validates only the active base', async ({
  page,
}) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await openAllSections(page);
  await entry(page, 'Висота h').fill('1,25');
  await openSection(page, 'Нахил');
  await entry(page, 'Зміщення X').fill('0,5');

  // Switch and read the download button in the same task: the regular prism must not be offered for the trapezoid.
  const disabledRightAfterSwitch = await baseType(page).evaluate(async (select: HTMLSelectElement) => {
    select.value = 'trapezoid';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterSwitch).toBe(true);
  await expect(entry(page, 'Висота призми h')).toHaveValue('1,25');
  await expect(entry(page, 'Зміщення X')).toHaveValue('0,5');
  await expectPreviewOf(page, summary(geometry(0.5, 0.5, 0, 1.25, 0.5)));

  // An invalid trapezoid field blocks only the trapezoid.
  await entry(page, 'Висота трапеції t').fill('5');
  await expect(page.getByText('Допустимі значення — від 0,25 до 4.')).toBeVisible();
  await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
  await expect(downloadButton(page)).toBeDisabled();
  await expect(status(page)).toHaveText('Зараз: рівнобічна трапеція');
  await baseType(page).selectOption({ label: 'Трикутник' });
  await expect(entry(page, 'Висота h')).toHaveValue('1,25');
  await expect(entry(page, 'Висота трапеції t')).toHaveCount(0);
  await expect(downloadButton(page)).toBeEnabled({ timeout: 30_000 });
  expect((await downloadThreeMf(page)).fileName).toBe('prism-triangle.3mf');

  await baseType(page).selectOption({ label: 'Трапеція' });
  await expect(entry(page, 'Висота трапеції t')).toHaveValue('5');
  await entry(page, 'Висота трапеції t').fill('0,75');
  await entry(page, 'Висота призми h').fill('0,5');
  const latest = geometry(0.5, 0.75, 0, 0.5, 0.5);
  await expectPreviewOf(page, summary(latest));
  await expectDownloadedTrapezoid(page, latest);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`trapezoid prism: the preview keeps its place without horizontal overflow (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough on a phone to keep the 3D viewer, which loads models only while visible, on screen above the controls.
    await page.setViewportSize({ width, height: width < 600 ? 2400 : 900 });
    await page.goto('/');
    await selectTrapezoid(page);

    let reference: Awaited<ReturnType<typeof previewPlace>> | undefined;
    // Each special case of the base: isosceles, right, general, parallelogram, rectangle, and separated sides.
    for (const [b, t, delta, h] of [
      [0.5, 0.5, 0, 2],
      [0.5, 0.375, -0.25, 0.5],
      [4, 0.25, -1.5, 0.25],
      [1, 4, 0.6, 1],
      [1, 1, 0, 4],
      [0.25, 0.5, 2, 1],
    ] as const) {
      await entry(page, 'Паралельна сторона b').fill(String(b).replace('.', ','));
      await entry(page, 'Висота трапеції t').fill(String(t).replace('.', ','));
      await entry(page, 'Зміщення сторони b').fill(String(delta).replace('.', ','));
      await entry(page, 'Висота призми h').fill(String(h).replace('.', ','));
      await expectPreviewOf(page, summary(geometry(b, t, delta, h)));
      const current = await previewPlace(page);
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await hasNoHorizontalOverflow(page)).toBe(true);
    }
  });
}
