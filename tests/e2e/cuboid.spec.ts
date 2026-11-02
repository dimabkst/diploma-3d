import { expect, type Page, test } from '@playwright/test';
import {
  type Box,
  boxesOf,
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  expectViewerBox,
  previewViewport,
  shapeSelect,
} from './helpers.ts';

type RatioField = 'Ширина b' | 'Висота c';

const entry = (page: Page, field: RatioField) => page.getByLabel(field, { exact: true });
const widthRatio = (page: Page) => entry(page, 'Ширина b');
const heightRatio = (page: Page) => entry(page, 'Висота c');
const slider = (page: Page, field: RatioField) => page.getByRole('slider', { name: `${field}: повзунок`, exact: true });
const stepButton = (page: Page, field: RatioField, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${field}: ${action}`, exact: true });
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME = 'Прямокутний паралелепіпед';

const sizeFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

/** Edges a × b × c in millimetres for b = width × a and c = height × a, with the longest edge at 80 mm. */
function cuboidEdges(width: number, height: number): [number, number, number] {
  const a = 80 / Math.max(1, width, height);
  return [a, width * a, height * a];
}

const cuboidSummary = (width: number, height: number) =>
  `${NAME} · ${cuboidEdges(width, height)
    .map((edge) => sizeFormat.format(edge))
    .join(' × ')} мм`;

/** The entry text, the slider position and its spoken value must all describe the same number. */
async function expectSynchronized(page: Page, field: RatioField, text: string): Promise<void> {
  await expect(entry(page, field)).toHaveValue(text);
  await expect(slider(page, field)).toHaveValue(text.replace(',', '.'));
  await expect(slider(page, field)).toHaveAttribute('aria-valuetext', text.replace('.', ','));
}

test('cuboid: ratios drive the preview and the downloaded 3MF', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await shapeSelect(page).selectOption('cuboid');
  await expectSynchronized(page, 'Ширина b', '1,5');
  await expectSynchronized(page, 'Висота c', '2');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);
  // Z-up a × b × c becomes glTF X × Y × Z = a × c × b: the height is the viewer's vertical axis.
  await expectViewerBox(page, [40, 60, 80]);

  // L / max(1, 2,5, 0,5) = 32 mm, so a × b × c = 32 × 80 × 16 mm; the width is now the longest edge.
  await widthRatio(page).fill('2,5');
  await heightRatio(page).fill('0,5');
  await expectPreviewOf(page, `${NAME} · 32 × 80 × 16 мм`);
  await expectViewerBox(page, [32, 80, 16]);

  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe('cuboid.3mf');
  expectSizesClose(measurements.size, [32, 80, 16], 1e-4);
  expect(measurements.volume).toBeCloseTo(32 * 80 * 16, 2);

  expect(errors).toEqual([]);
});

test('cuboid: rapid edits never offer outdated geometry for download', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);

  // Edit and read the button in the same task: the model must be invalidated before any timer or rebuild can run.
  const disabledRightAfterEdit = await widthRatio(page).evaluate(async (input: HTMLInputElement) => {
    input.value = '3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // One macrotask lets Svelte apply the change while the 150 ms rebuild delay has certainly not elapsed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterEdit).toBe(true);
  // b = 3 × a and c = 2 × a: a = 80 / 3 mm.
  await expectPreviewOf(page, `${NAME} · 26,7 × 80 × 53,3 мм`);

  // The same holds for a stepping button and for the slider.
  const disabledRightAfterStep = await stepButton(page, 'Ширина b', 'зменшити').evaluate(async (button: HTMLButtonElement) => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const download = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return download?.disabled;
  });
  expect(disabledRightAfterStep).toBe(true);
  await expectSynchronized(page, 'Ширина b', '2,75');
  await expectPreviewOf(page, cuboidSummary(2.75, 2));

  const disabledRightAfterDrag = await slider(page, 'Ширина b').evaluate(async (input: HTMLInputElement) => {
    input.value = '1.3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const download = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return download?.disabled;
  });
  expect(disabledRightAfterDrag).toBe(true);
  await expectSynchronized(page, 'Ширина b', '1,25');

  for (const value of ['0,75', '4', '1,25', '0,5']) {
    await heightRatio(page).fill(value);
  }
  await widthRatio(page).fill('1');
  // b = 1 × a and c = 0,5 × a: a = b = 80 mm and c = 40 mm.
  await expectPreviewOf(page, `${NAME} · 80 × 80 × 40 мм`);
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.size, [80, 80, 40], 1e-4);
});

test('cuboid: typed values are kept exactly until the user steps or drags', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);

  // A typed value between the quarters is kept as typed, also after leaving the field, and the slider shows it
  // exactly instead of a value rounded to its grid.
  await widthRatio(page).fill('2.05');
  await widthRatio(page).blur();
  await expectSynchronized(page, 'Ширина b', '2.05');
  await expectPreviewOf(page, cuboidSummary(2.05, 2));
  await heightRatio(page).fill('1,1');
  await heightRatio(page).blur();
  await expectSynchronized(page, 'Висота c', '1,1');
  await expectPreviewOf(page, cuboidSummary(2.05, 1.1));
  await expect(widthRatio(page)).toHaveValue('2.05');

  // Buttons move to the neighbouring quarters.
  await stepButton(page, 'Ширина b', 'зменшити').click();
  await expectSynchronized(page, 'Ширина b', '2');
  await stepButton(page, 'Ширина b', 'збільшити').click();
  await expectSynchronized(page, 'Ширина b', '2,25');
  await expectPreviewOf(page, cuboidSummary(2.25, 1.1));

  // Arrow keys in the entry: one press is exactly one step.
  await heightRatio(page).focus();
  await page.keyboard.press('ArrowUp');
  await expectSynchronized(page, 'Висота c', '1,25');
  await page.keyboard.press('ArrowDown');
  await expectSynchronized(page, 'Висота c', '1');
  await page.keyboard.press('ArrowDown');
  await expectSynchronized(page, 'Висота c', '0,75');

  // The buttons work from the keyboard; the tab order is entry, decrease, slider, increase.
  await stepButton(page, 'Висота c', 'збільшити').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expectSynchronized(page, 'Висота c', '1,25');
  await page.keyboard.press('Shift+Tab');
  await expect(slider(page, 'Висота c')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Space');
  await expectSynchronized(page, 'Висота c', '1');

  // Slider keys: arrows move by one quarter per press, Home and End jump to the limits.
  await slider(page, 'Висота c').focus();
  await page.keyboard.press('ArrowRight');
  await expectSynchronized(page, 'Висота c', '1,25');
  await page.keyboard.press('ArrowUp');
  await expectSynchronized(page, 'Висота c', '1,5');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await expectSynchronized(page, 'Висота c', '1');
  await page.keyboard.press('End');
  await expectSynchronized(page, 'Висота c', '4');
  await page.keyboard.press('ArrowRight');
  await expectSynchronized(page, 'Висота c', '4');
  await expect(stepButton(page, 'Висота c', 'збільшити')).toBeDisabled();
  await page.keyboard.press('Home');
  await expectSynchronized(page, 'Висота c', '0,25');
  await expect(stepButton(page, 'Висота c', 'зменшити')).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expectSynchronized(page, 'Висота c', '0,25');
  await page.keyboard.press('ArrowUp');
  await expectSynchronized(page, 'Висота c', '0,5');

  // An off-grid value stays until a slider key changes it explicitly.
  await heightRatio(page).fill('1.1');
  await expectSynchronized(page, 'Висота c', '1.1');
  await slider(page, 'Висота c').press('ArrowLeft');
  await expectSynchronized(page, 'Висота c', '1');

  // The geometry and the download follow the last selected values: b = 2,25 × a and c = 1 × a.
  await expectPreviewOf(page, cuboidSummary(2.25, 1));
  const [a, b, c] = cuboidEdges(2.25, 1);
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.size, [a, b, c], 1e-4);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / (a * b * c) - 1)).toBeLessThan(1e-6);

  expect(errors).toEqual([]);
});

test('cuboid: dragging the slider selects the nearest quarter and updates the model', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);

  // The off-grid value is shown exactly until the drag starts.
  await widthRatio(page).fill('2,05');
  await expectSynchronized(page, 'Ширина b', '2,05');

  const track = await slider(page, 'Ширина b').boundingBox();
  if (track === null) throw new Error('The width slider is not visible.');
  const y = track.y + track.height / 2;
  const readWidth = async () => Number((await widthRatio(page).inputValue()).replace(',', '.'));

  // Press at the right end and drag across the track with the mouse; every intermediate value is a quarter.
  await page.mouse.move(track.x + track.width - 2, y);
  await page.mouse.down();
  await expectSynchronized(page, 'Ширина b', '4');
  const seen = new Set<number>();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(track.x + track.width * (1 - step / 8), y, { steps: 3 });
    const value = await readWidth();
    expect(Number.isInteger(value * 4)).toBe(true);
    seen.add(value);
  }
  await page.mouse.up();
  expect(seen.size).toBeGreaterThan(3);
  const dropped = await readWidth();
  expect(dropped).toBeGreaterThan(0.25);
  expect(dropped).toBeLessThan(2);
  await expectSynchronized(page, 'Ширина b', String(dropped).replace('.', ','));

  // Dragging beyond the left end selects the lower limit.
  await page.mouse.move(track.x + track.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x - 20, y, { steps: 4 });
  await page.mouse.up();
  await expectSynchronized(page, 'Ширина b', '0,25');
  await expect(stepButton(page, 'Ширина b', 'зменшити')).toBeDisabled();

  // Positions between the quarters, as a drag produces them, select the nearest quarter.
  for (const [position, text] of [
    ['1.62', '1,5'],
    ['1.63', '1,75'],
    ['3.88', '4'],
    ['0.3', '0,25'],
  ] as const) {
    await slider(page, 'Ширина b').evaluate((input: HTMLInputElement, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, position);
    await expectSynchronized(page, 'Ширина b', text);
  }

  await slider(page, 'Ширина b').evaluate((input: HTMLInputElement) => {
    input.value = '2.6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectSynchronized(page, 'Ширина b', '2,5');
  await expectPreviewOf(page, cuboidSummary(2.5, 2));
  const { measurements } = await downloadThreeMf(page);
  expectSizesClose(measurements.size, cuboidEdges(2.5, 2), 1e-4);

  expect(errors).toEqual([]);
});

test('cuboid: invalid ratios are explained and block stepping and the download until corrected', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await expectPreviewOf(page, `${NAME} · 40 × 60 × 80 мм`);

  for (const [text, message] of [
    ['', 'Введіть значення.'],
    ['-', 'Введіть число, наприклад 1,5.'],
    ['абв', 'Введіть число, наприклад 1,5.'],
    ['4,5', 'Допустимі значення — від 0,25 до 4.'],
    ['0,2', 'Допустимі значення — від 0,25 до 4.'],
  ] as const) {
    await widthRatio(page).fill(text);
    await expect(widthRatio(page)).toHaveAttribute('aria-invalid', 'true');
    // The error is announced first, followed by the general explanation of the multipliers.
    await expect(widthRatio(page)).toHaveAccessibleDescription(new RegExp(`^${escapeRegExp(message)} Множники задають`));
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(page.getByRole('alert')).toContainText('Модель не оновлено');
    await expect(downloadButton(page)).toBeDisabled();
    // Nothing invents a value: stepping waits until the text is valid, and the slider stays at the last valid value.
    await expect(stepButton(page, 'Ширина b', 'зменшити')).toBeDisabled();
    await expect(stepButton(page, 'Ширина b', 'збільшити')).toBeDisabled();
    await expect(slider(page, 'Ширина b')).toBeDisabled();
    await expect(slider(page, 'Ширина b')).toHaveValue('1.5');
    await widthRatio(page).press('ArrowUp');
    await expect(widthRatio(page)).toHaveValue(text);
  }

  // The limits themselves are valid.
  await widthRatio(page).fill('0,25');
  await heightRatio(page).fill('4');
  await expect(widthRatio(page)).not.toHaveAttribute('aria-invalid');
  await expect(slider(page, 'Ширина b')).toBeEnabled();
  // L / 4 = 20 mm: a × b × c = 20 × 5 × 80 mm.
  await expectPreviewOf(page, `${NAME} · 20 × 5 × 80 мм`);

  expect(errors).toEqual([]);
});

test('cuboid: switching back to the cube restores equal edges and keeps the cuboid ratios', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption('cuboid');
  await widthRatio(page).fill('2');
  await expectPreviewOf(page, `${NAME} · 40 × 80 × 80 мм`);

  await shapeSelect(page).selectOption('cube');
  await expect(widthRatio(page)).toHaveCount(0);
  await expectPreviewOf(page, 'Куб · 80 × 80 × 80 мм');
  await expectViewerBox(page, [80, 80, 80]);
  const cube = await downloadThreeMf(page);
  expect(cube.fileName).toBe('cube.3mf');
  expect(cube.measurements.size).toEqual([80, 80, 80]);

  await shapeSelect(page).selectOption('cuboid');
  await expect(widthRatio(page)).toHaveValue('2');
  await expectPreviewOf(page, `${NAME} · 40 × 80 × 80 мм`);

  expect(errors).toEqual([]);
});

for (const [layout, width, stacked] of [
  ['desktop', 1440, false],
  ['phone', 390, false],
  ['narrow phone', 320, true],
] as const) {
  test(`cuboid: measurements keep their positions while the ratios change (${layout}, ${width} px)`, async ({ page }) => {
    // Tall enough to keep the 3D viewer, which loads only when visible, on screen below the stacked controls.
    await page.setViewportSize({ width, height: 2400 });
    await page.goto('/');
    await shapeSelect(page).selectOption('cuboid');
    const labels = page.getByRole('term');
    const values = page.getByRole('definition');
    const footnote = page.getByText('Розміри наведено для файлу друку');
    await expect(labels).toHaveText(['Довжина a', 'Ширина b', 'Висота c', 'Площа поверхні', 'Об’єм']);

    let reference: { labels: Box[]; values: Box[]; footnote: Box } | undefined;
    // Integer, fractional and boundary ratios give values of very different lengths, e.g. "5 мм" and "26,7 мм".
    for (const [widthRatioValue, heightRatioValue] of [
      [1, 1],
      [1.1, 1],
      [1.25, 1.1],
      [0.25, 0.25],
      [4, 0.25],
      [0.25, 4],
      [4, 4],
      [1.1, 2.05],
    ] as const) {
      await widthRatio(page).fill(String(widthRatioValue).replace('.', ','));
      await heightRatio(page).fill(String(heightRatioValue).replace('.', ','));
      await expectPreviewOf(page, cuboidSummary(widthRatioValue, heightRatioValue));
      await expect(values.last()).not.toHaveText('—');

      const current = {
        labels: await boxesOf(labels),
        values: await boxesOf(values),
        footnote: (await footnote.boundingBox()) as Box,
      };
      reference ??= current;
      expect(current).toEqual(reference);

      // Every value fits completely on a single line, and the page never scrolls sideways.
      for (const value of await values.all()) {
        expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    // Two columns where there is room; below a fixed container width each value sits under its label.
    const [firstLabel] = await boxesOf(labels);
    const [firstValue] = await boxesOf(values);
    if (firstLabel === undefined || firstValue === undefined) throw new Error('The measurements are missing.');
    if (stacked) {
      expect(firstValue.y).toBeGreaterThanOrEqual(firstLabel.y + firstLabel.height - 1);
      expect(Math.abs(firstValue.x - firstLabel.x)).toBeLessThan(1);
    } else {
      expect(Math.abs(firstValue.y - firstLabel.y)).toBeLessThan(firstLabel.height);
      expect(firstValue.x).toBeGreaterThan(firstLabel.x + firstLabel.width);
    }
  });
}
