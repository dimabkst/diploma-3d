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

type Kind = 'cylinder' | 'cone';

const NAMES: Readonly<Record<Kind, string>> = { cylinder: 'Циліндр', cone: 'Конус' };
const OFFSET_LABELS: Readonly<Record<Kind, string>> = { cylinder: 'Зміщення верхньої основи', cone: 'Зміщення вершини' };
const heightRatio = (page: Page) => page.getByLabel('Висота h', { exact: true });
const offset = (page: Page, kind: Kind) => page.getByLabel(OFFSET_LABELS[kind], { exact: true });
const offsetSlider = (page: Page, kind: Kind) =>
  page.getByRole('slider', { name: `${OFFSET_LABELS[kind]}: повзунок`, exact: true });
const stepButton = (page: Page, kind: Kind, action: 'зменшити' | 'збільшити') =>
  page.getByRole('button', { name: `${OFFSET_LABELS[kind]}: ${action}`, exact: true });
const tiltGroup = (page: Page) => page.getByRole('group', { name: 'Нахил' });
const status = (page: Page) => tiltGroup(page).getByText(/^Зараз:/);
const removeTilt = (page: Page) => page.getByRole('button', { name: 'Прибрати нахил', exact: true });

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const format = (value: number, unit: string) => `${numberFormat.format(value)} ${unit}`;

/**
 * The ideal solid with h = h0·r and the upper base or apex displaced by d = d0·r, scaled so that its bounding box is at
 * most 80 mm. The lateral area integrals are evaluated by the trapezoid rule with many panels, which is spectrally
 * accurate for these smooth periodic integrands.
 */
function geometry(kind: Kind, h0: number, d0: number) {
  const width0 = kind === 'cylinder' ? 2 + d0 : Math.max(2, 1 + d0);
  const r = 80 / Math.max(width0, 2, h0);
  const [h, d] = [h0 * r, d0 * r];
  const n = 4096;
  let lateral = 0;
  for (let index = 0; index < n; index += 1) {
    const theta = (2 * Math.PI * index) / n;
    lateral += kind === 'cylinder' ? r * Math.hypot(h, d * Math.cos(theta)) : (r / 2) * Math.hypot(h, r - d * Math.cos(theta));
  }
  lateral *= (2 * Math.PI) / n;
  const baseArea = Math.PI * r ** 2;
  // The exported mesh inscribes 64-gons: its volume uses the polygon's area N·r²·sin(2π/N)/2.
  const polygonBase = (64 * r ** 2 * Math.sin((2 * Math.PI) / 64)) / 2;
  return {
    r,
    h,
    size: [width0 * r, 2 * r, h],
    generatrix: kind === 'cylinder' ? [Math.hypot(h, d)] : [Math.hypot(h, r - d), Math.hypot(h, r + d)],
    surfaceArea: (kind === 'cylinder' ? 2 : 1) * baseArea + lateral,
    volume: (baseArea * h) / (kind === 'cylinder' ? 1 : 3),
    meshVolume: (polygonBase * h) / (kind === 'cylinder' ? 1 : 3),
  };
}

const summary = (kind: Kind, expected: { size: number[] }) =>
  `${NAMES[kind]} · ${expected.size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

const generatrixText = (values: readonly number[]) => {
  const [low, high] = [numberFormat.format(Math.min(...values)), numberFormat.format(Math.max(...values))];
  return low === high ? `${low} мм` : `${low}–${high} мм`;
};

async function expectMeasurements(page: Page, kind: Kind, expected: ReturnType<typeof geometry>, oblique: boolean) {
  await expect(measurementValue(page, 'Радіус r')).toHaveText(format(expected.r, 'мм'));
  await expect(measurementValue(page, 'Висота h')).toHaveText(format(expected.h, 'мм'));
  await expect(measurementValue(page, kind === 'cylinder' ? 'Твірна l' : 'Твірні')).toHaveText(
    generatrixText(expected.generatrix),
  );
  // The integrated area of an oblique solid is marked "≈"; the mark is not part of the number's text.
  await expect(measurementValue(page, 'Площа поверхні')).toHaveText(format(expected.surfaceArea, 'мм²'));
  await expect(measurementValue(page, 'Площа поверхні')).toHaveAttribute('data-approximate', String(oblique));
  await expect(measurementValue(page, 'Об’єм')).toHaveText(format(expected.volume, 'мм³'));
}

async function expectDownloaded(page: Page, kind: Kind, expected: ReturnType<typeof geometry>): Promise<void> {
  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe(`${kind}.3mf`);
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.meshVolume - 1)).toBeLessThan(1e-6);
}

test('oblique cylinder: the upper base moves along X, the measurements follow and the tilt can be removed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });
  await expect(offset(page, 'cylinder')).toHaveValue('0');
  await expect(status(page)).toHaveText('Зараз: прямий циліндр');
  await expect(removeTilt(page)).toBeDisabled();
  await expect(tiltGroup(page).getByText('Зміщення відкладається вздовж осі X')).toBeVisible();
  await expectMeasurements(page, 'cylinder', geometry('cylinder', 2, 0), false);

  // h = r and d = r: the box is 3r × 2r × r, so r = h = d = 80/3 mm and the generatrix is r·√2.
  await heightRatio(page).fill('1');
  await offset(page, 'cylinder').fill('1');
  await expect(status(page)).toHaveText('Зараз: похилий циліндр');
  const leaning = geometry('cylinder', 1, 1);
  await expectPreviewOf(page, 'Циліндр · 80 × 53,3 × 26,7 мм');
  await expectMeasurements(page, 'cylinder', leaning, true);
  await expect(page.getByText('обчислено чисельним інтегруванням')).toBeVisible();
  await expectDownloaded(page, 'cylinder', leaning);

  // Steps from off-step values, the upper limit and a precise typed value.
  const field = offset(page, 'cylinder');
  await field.fill('0,1');
  await stepButton(page, 'cylinder', 'зменшити').click();
  await expect(field).toHaveValue('0');
  await expect(stepButton(page, 'cylinder', 'зменшити')).toBeDisabled();
  await stepButton(page, 'cylinder', 'збільшити').click();
  await expect(field).toHaveValue('0,25');
  await offsetSlider(page, 'cylinder').press('End');
  await expect(field).toHaveValue('4');
  await expect(stepButton(page, 'cylinder', 'збільшити')).toBeDisabled();
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 1, 4)));
  await field.fill('1.35');
  await field.blur();
  await expect(field).toHaveValue('1.35');
  const typed = geometry('cylinder', 1, 1.35);
  await expectPreviewOf(page, summary('cylinder', typed));
  await expectMeasurements(page, 'cylinder', typed, true);
  await expectDownloaded(page, 'cylinder', typed);

  // Removing the tilt keeps the height.
  await removeTilt(page).click();
  await expect(field).toHaveValue('0');
  await expect(heightRatio(page)).toHaveValue('1');
  await expect(status(page)).toHaveText('Зараз: прямий циліндр');
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 1, 0)));
  await expectMeasurements(page, 'cylinder', geometry('cylinder', 1, 0), false);

  expect(errors).toEqual([]);
});

test('oblique cone: the apex moves beyond the base, the generatrices spread and the tilt can be removed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cone });
  await expect(status(page)).toHaveText('Зараз: прямий конус');

  // h = r and the apex at 3r, outside the base: the box is 4r wide, so r = h = 20 mm; the generatrices run from
  // √(20² + 40²) ≈ 44,7 to √(20² + 80²) ≈ 82,5 mm.
  await heightRatio(page).fill('1');
  await offset(page, 'cone').fill('3');
  await expect(status(page)).toHaveText('Зараз: похилий конус');
  const outside = geometry('cone', 1, 3);
  await expectPreviewOf(page, 'Конус · 80 × 40 × 20 мм');
  await expect(measurementValue(page, 'Твірні')).toHaveText('44,7–82,5 мм');
  await expectMeasurements(page, 'cone', outside, true);
  await expectDownloaded(page, 'cone', outside);

  // A small height with the apex inside the base outline.
  await heightRatio(page).fill('0,25');
  await offset(page, 'cone').fill('0,75');
  const flat = geometry('cone', 0.25, 0.75);
  await expectPreviewOf(page, summary('cone', flat));
  await expectMeasurements(page, 'cone', flat, true);
  await expectDownloaded(page, 'cone', flat);

  await removeTilt(page).click();
  await expect(offset(page, 'cone')).toHaveValue('0');
  await expect(heightRatio(page)).toHaveValue('0,25');
  // A right cone: one generatrix length.
  await expectMeasurements(page, 'cone', geometry('cone', 0.25, 0), false);

  expect(errors).toEqual([]);
});

test('oblique cylinder and cone: invalid displacements, separate values and no outdated download', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 2, 0)));

  for (const [text, message] of [
    ['-0,5', 'Допустимі значення — від 0 до 4.'],
    ['4,5', 'Допустимі значення — від 0 до 4.'],
    ['', 'Введіть значення.'],
  ] as const) {
    await offset(page, 'cylinder').fill(text);
    await expect(offset(page, 'cylinder')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(message)).toBeVisible();
    await expect(previewViewport(page)).toHaveAttribute('data-preview-status', 'invalid');
    await expect(downloadButton(page)).toBeDisabled();
    await expect(status(page)).toHaveCount(0);
  }
  await removeTilt(page).click();
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 2, 0)));

  // Edit the displacement and read the download button in the same task, before any rebuild can run.
  const disabledRightAfterEdit = await offset(page, 'cylinder').evaluate(async (input: HTMLInputElement) => {
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('3MF'));
    return button?.disabled;
  });
  expect(disabledRightAfterEdit).toBe(true);
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 2, 2)));

  // The cone keeps its own, still zero, displacement; the cylinder gets its own back.
  await shapeSelect(page).selectOption({ label: NAMES.cone });
  await expect(offset(page, 'cone')).toHaveValue('0');
  await expectPreviewOf(page, summary('cone', geometry('cone', 2, 0)));
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });
  await expect(offset(page, 'cylinder')).toHaveValue('2');
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 2, 2)));
  await expectDownloaded(page, 'cylinder', geometry('cylinder', 2, 2));
});

for (const [layout, width] of [
  ['desktop', 1440],
  ['narrow phone', 320],
] as const) {
  test(`oblique cylinder and cone: measurements keep their positions without horizontal overflow (${layout}, ${width} px)`, async ({
    page,
  }) => {
    // Tall enough to keep the 3D viewer, which loads only when visible, on screen below the stacked controls.
    await page.setViewportSize({ width, height: 3000 });
    await page.goto('/');
    for (const kind of ['cylinder', 'cone'] as const) {
      await shapeSelect(page).selectOption({ label: NAMES[kind] });
      const values = page.getByRole('definition');
      const footnote = page.getByText('Розміри наведено для файлу друку');
      let reference: { values: Box[]; footnote: Box } | undefined;
      // Right and oblique: the "≈" mark and a generatrix range must not move the rows.
      for (const [h, d] of [
        ['2', '0'],
        ['1', '1'],
        ['0,25', '4'],
        ['4', '0,5'],
        ['1', '0'],
      ] as const) {
        await heightRatio(page).fill(h);
        await offset(page, kind).fill(d);
        await expectPreviewOf(page, summary(kind, geometry(kind, Number(h.replace(',', '.')), Number(d.replace(',', '.')))));
        const current = { values: await boxesOf(values), footnote: (await footnote.boundingBox()) as Box };
        reference ??= current;
        expect(current).toEqual(reference);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
  });
}
