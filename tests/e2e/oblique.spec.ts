import { expect, type Page, test } from '@playwright/test';
import {
  type Box,
  boxesOf,
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  measurementValue,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type Field = 'Зміщення X' | 'Зміщення Y' | 'Висота h' | 'Сторона основи b' | 'Кут α';

const entry = (page: Page, field: Field) => page.getByLabel(field, { exact: true });
const slider = (page: Page, field: Field) => page.getByRole('slider', { name: `${field}: повзунок`, exact: true });
const stepButton = (page: Page, field: Field, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${field}: ${action}`, exact: true });
const resetButton = (page: Page) => page.getByRole('button', { name: 'Прибрати нахил', exact: true });
const offsetGroup = (page: Page) => page.getByRole('group', { name: 'Зміщення верхньої основи' });
const status = (page: Page) => offsetGroup(page).getByText(/^Зараз:/);

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const format = (value: number, unit: string) => `${numberFormat.format(value)} ${unit}`;

/**
 * A prism over the parallelogram with a0 = 1, b0 and the angle α (the square: b0 = 1, α = 90°), height h0 and upper
 * base displaced by (dx0, dy0), scaled so that its bounding box is at most 80 mm. Each lateral face spans a base edge
 * e and the lateral edge v = (dx, dy, h), with area |e × v|.
 */
function geometry(b0: number, angleDeg: number, h0: number, dx0: number, dy0: number) {
  const radians = (angleDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  const size0 = [1 + Math.abs(b0 * cos) + Math.abs(dx0), b0 * sin + Math.abs(dy0), h0];
  const s = 80 / Math.max(...size0);
  const v = [dx0 * s, dy0 * s, h0 * s] as const;
  const crossLength = ([ex, ey]: readonly [number, number]) => Math.hypot(ey * v[2], -ex * v[2], ex * v[1] - ey * v[0]);
  const baseArea = s * (b0 * s) * sin;
  const lateralArea = 2 * crossLength([s, 0]) + 2 * crossLength([b0 * s * cos, b0 * s * sin]);
  return {
    a: s,
    h: h0 * s,
    lateralEdge: Math.hypot(...v),
    size: size0.map((value) => value * s),
    volume: baseArea * h0 * s,
    surfaceArea: 2 * baseArea + lateralArea,
  };
}

const summaryOf = (name: string, expected: { size: number[] }) =>
  `${name} · ${expected.size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

async function expectDownload(page: Page, fileName: string, expected: ReturnType<typeof geometry>): Promise<void> {
  const { fileName: actualName, measurements } = await downloadThreeMf(page);
  expect(actualName).toBe(fileName);
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.volume - 1)).toBeLessThan(1e-6);
  expect(Math.abs(measurements.surfaceArea / expected.surfaceArea - 1)).toBeLessThan(1e-6);
}

test('oblique prism: offsets tilt the square prism, change the measurements and the 3MF, and can be removed', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await page.getByLabel('Основа', { exact: true }).selectOption({ label: 'Квадрат' });
  await entry(page, 'Висота h').fill('1');

  // Right by default: both offsets 0, nothing to remove.
  await expect(offsetGroup(page)).toBeVisible();
  await expect(offsetGroup(page).getByText('X — уздовж сторони основи a, Y — перпендикулярно до неї')).toBeVisible();
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('0');
  await expect(status(page)).toHaveText('Зараз: пряма призма');
  await expect(resetButton(page)).toBeDisabled();
  await expectPreviewOf(page, 'Призма · 80 × 80 × 80 мм');
  await expect(measurementValue(page, 'Бічне ребро l')).toHaveText('80 мм');

  // The reference case: h = a and the upper base moved by a along X. The box is 2a × a × a, so a = h = 40 mm, the
  // lateral edge is 40√2 mm and the volume a²h = 64 000 mm³.
  await entry(page, 'Зміщення X').fill('1');
  await expect(status(page)).toHaveText('Зараз: похила призма');
  await expect(resetButton(page)).toBeEnabled();
  const reference = geometry(1, 90, 1, 1, 0);
  await expectPreviewOf(page, 'Призма · 80 × 40 × 40 мм');
  await expect(measurementValue(page, 'Сторона основи a')).toHaveText('40 мм');
  await expect(measurementValue(page, 'Висота h')).toHaveText('40 мм');
  await expect(measurementValue(page, 'Бічне ребро l')).toHaveText(format(40 * Math.SQRT2, 'мм'));
  await expect(measurementValue(page, 'Площа основи')).toHaveText(format(1600, 'мм²'));
  await expect(measurementValue(page, 'Площа поверхні')).toHaveText(format(1600 * (4 + 2 * Math.SQRT2), 'мм²'));
  await expect(measurementValue(page, 'Об’єм')).toHaveText(format(64_000, 'мм³'));
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.bounds.min, [-20, -20, 0], 1e-3);
  expectSizesClose(measurements.bounds.max, [60, 20, 40], 1e-3);
  await expectDownload(page, 'prism-4-sided.3mf', reference);

  // Negative and typed values: from −0,1 the buttons go to −0,25 and 0; from a quarter they move a full step.
  const offsetX = entry(page, 'Зміщення X');
  await offsetX.fill('-0,1');
  await stepButton(page, 'Зміщення X', 'зменшити').click();
  await expect(offsetX).toHaveValue('-0,25');
  await stepButton(page, 'Зміщення X', 'зменшити').click();
  await expect(offsetX).toHaveValue('-0,5');
  await offsetX.fill('-0,1');
  await stepButton(page, 'Зміщення X', 'збільшити').click();
  await expect(offsetX).toHaveValue('0');
  await offsetX.press('ArrowDown');
  await expect(offsetX).toHaveValue('-0,25');
  await slider(page, 'Зміщення X').press('Home');
  await expect(offsetX).toHaveValue('-2');
  await expect(stepButton(page, 'Зміщення X', 'зменшити')).toBeDisabled();
  await offsetX.fill('-1.35');
  await offsetX.blur();
  await expect(offsetX).toHaveValue('-1.35');
  await expect(slider(page, 'Зміщення X')).toHaveAttribute('aria-valuetext', '-1,35');
  await entry(page, 'Зміщення Y').fill('0,6');
  const tilted = geometry(1, 90, 1, -1.35, 0.6);
  await expectPreviewOf(page, summaryOf('Призма', tilted));
  await expect(measurementValue(page, 'Бічне ребро l')).toHaveText(format(tilted.lateralEdge, 'мм'));
  await expectDownload(page, 'prism-4-sided.3mf', tilted);

  // Removing the tilt resets only the offsets: the base and the height stay.
  await resetButton(page).click();
  await expect(offsetX).toHaveValue('0');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('0');
  await expect(entry(page, 'Висота h')).toHaveValue('1');
  await expect(page.getByLabel('Основа', { exact: true }).locator('option:checked')).toHaveText('Квадрат');
  await expect(status(page)).toHaveText('Зараз: пряма призма');
  await expect(resetButton(page)).toBeDisabled();
  await expectPreviewOf(page, 'Призма · 80 × 80 × 80 мм');
  await expectDownload(page, 'prism-4-sided.3mf', geometry(1, 90, 1, 0, 0));

  expect(errors).toEqual([]);
});

test('oblique parallelepiped: offsets over a rectangle and a rhombus, with the reset keeping the base', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Паралелепіпед' });
  await expect(status(page)).toHaveText('Зараз: прямий паралелепіпед');

  // α = 90°: an oblique solid over a 40 × 60 mm rectangle, h = 80 mm, the top moved by (20, −20) mm.
  await entry(page, 'Сторона основи b').fill('1,5');
  await entry(page, 'Висота h').fill('2');
  await entry(page, 'Кут α').fill('90');
  await entry(page, 'Зміщення X').fill('0,5');
  await entry(page, 'Зміщення Y').fill('-0,5');
  await expect(status(page)).toHaveText('Зараз: похилий паралелепіпед');
  const rectangle = geometry(1.5, 90, 2, 0.5, -0.5);
  await expectPreviewOf(page, 'Паралелепіпед · 60 × 80 × 80 мм');
  await expect(measurementValue(page, 'Висота h')).toHaveText('80 мм');
  await expect(measurementValue(page, 'Бічне ребро l')).toHaveText(format(rectangle.lateralEdge, 'мм'));
  await expect(measurementValue(page, 'Об’єм')).toHaveText(format(40 * 60 * 80, 'мм³'));
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.bounds.min, [-20, -50, 0], 1e-3);
  expectSizesClose(measurements.bounds.max, [40, 30, 80], 1e-3);
  await expectDownload(page, 'parallelepiped.3mf', rectangle);

  // A rhombus with α = 60° and the top moved across the base.
  await entry(page, 'Сторона основи b').fill('1');
  await entry(page, 'Висота h').fill('1');
  await entry(page, 'Кут α').fill('60');
  await entry(page, 'Зміщення X').fill('-0,25');
  await entry(page, 'Зміщення Y').fill('1,1');
  const rhombus = geometry(1, 60, 1, -0.25, 1.1);
  await expectPreviewOf(page, summaryOf('Паралелепіпед', rhombus));
  await expectDownload(page, 'parallelepiped.3mf', rhombus);

  await resetButton(page).click();
  await expect(entry(page, 'Кут α')).toHaveValue('60');
  await expect(entry(page, 'Сторона основи b')).toHaveValue('1');
  await expect(status(page)).toHaveText('Зараз: прямий паралелепіпед');
  await expectPreviewOf(page, summaryOf('Паралелепіпед', geometry(1, 60, 1, 0, 0)));
  // Right again: the lateral edge equals the height.
  const right = geometry(1, 60, 1, 0, 0);
  await expect(measurementValue(page, 'Висота h')).toHaveText(format(right.h, 'мм'));
  await expect(measurementValue(page, 'Бічне ребро l')).toHaveText(format(right.h, 'мм'));

  expect(errors).toEqual([]);
});

test('oblique prism: an invalid offset blocks the download, and the reset repairs it', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');

  for (const [text, message] of [
    ['2,5', 'Допустимі значення — від -2 до 2.'],
    ['-', 'Введіть число, наприклад -0,5.'],
    ['', 'Введіть значення.'],
  ] as const) {
    await entry(page, 'Зміщення Y').fill(text);
    await expect(entry(page, 'Зміщення Y')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(message)).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(downloadButton(page)).toBeDisabled();
    // Neither right nor oblique while an offset is invalid.
    await expect(status(page)).toHaveCount(0);
    await expect(resetButton(page)).toBeEnabled();
  }

  await resetButton(page).click();
  await expect(entry(page, 'Зміщення Y')).not.toHaveAttribute('aria-invalid', 'true');
  await expectPreviewOf(page, 'Призма · 40 × 34,6 × 80 мм');
});

test('oblique prism: offsets belong to each shape and a change never offers outdated geometry', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await entry(page, 'Зміщення X').fill('1');
  const prism = geometry(1, 90, 1, 1, 0);
  await page.getByLabel('Основа', { exact: true }).selectOption({ label: 'Квадрат' });
  await entry(page, 'Висота h').fill('1');
  await expectPreviewOf(page, summaryOf('Призма', prism));

  // Edit an offset and read the download button in the same task, before any rebuild can run.
  const disabledRightAfterEdit = await entry(page, 'Зміщення Y').evaluate(async (input: HTMLInputElement) => {
    input.value = '-1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterEdit).toBe(true);
  const moved = geometry(1, 90, 1, 1, -1);
  await expectPreviewOf(page, summaryOf('Призма', moved));

  // The parallelepiped keeps its own, still zero, offsets; the prism gets its offsets back.
  await shapeSelect(page).selectOption({ label: 'Паралелепіпед' });
  await expect(entry(page, 'Зміщення X')).toHaveValue('0');
  await expect(status(page)).toHaveText('Зараз: прямий паралелепіпед');
  await shapeSelect(page).selectOption('cuboid');
  await expect(offsetGroup(page)).toHaveCount(0);
  await shapeSelect(page).selectOption({ label: 'Призма' });
  await expect(entry(page, 'Зміщення X')).toHaveValue('1');
  await expect(entry(page, 'Зміщення Y')).toHaveValue('-1');
  await expectPreviewOf(page, summaryOf('Призма', moved));
  await expectDownload(page, 'prism-4-sided.3mf', moved);
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`oblique prism: measurements keep their positions without horizontal overflow (${layout}, ${width} px)`, async ({
    page,
  }) => {
    // Tall enough to keep the 3D viewer, which loads only when visible, on screen below the stacked controls.
    await page.setViewportSize({ width, height: 3200 });
    await page.goto('/');
    await shapeSelect(page).selectOption({ label: 'Паралелепіпед' });
    const values = page.getByRole('definition');
    const footnote = page.getByText('Розміри наведено для файлу друку');

    let reference: { values: Box[]; footnote: Box } | undefined;
    for (const [x, y, h] of [
      ['0', '0', '1'],
      ['2', '-2', '0,25'],
      ['-2', '2', '4'],
      ['-0,1', '1,35', '1'],
    ] as const) {
      await entry(page, 'Зміщення X').fill(x);
      await entry(page, 'Зміщення Y').fill(y);
      await entry(page, 'Висота h').fill(h);
      const expected = geometry(1, 60, Number(h.replace(',', '.')), Number(x.replace(',', '.')), Number(y.replace(',', '.')));
      await expectPreviewOf(page, summaryOf('Паралелепіпед', expected));
      const current = { values: await boxesOf(values), footnote: (await footnote.boundingBox()) as Box };
      reference ??= current;
      expect(current).toEqual(reference);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}
