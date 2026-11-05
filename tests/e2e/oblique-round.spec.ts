import { expect, type Page, test } from '@playwright/test';
import {
  collectErrors,
  downloadButton,
  downloadThreeMf,
  expectPreviewOf,
  expectSizesClose,
  hasNoHorizontalOverflow,
  openSection,
  parameterSection,
  previewPlace,
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
/** The summary of the "Нахил" group, which reports the tilt also while collapsed. */
const status = (page: Page) => parameterSection(page, 'Нахил').locator('summary');
const tiltState = (state: string) => new RegExp(`^Нахил\\s*${state}\\s*$`);
const removeTilt = (page: Page) => page.getByRole('button', { name: 'Прибрати нахил', exact: true });

const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

/**
 * The solid with h = h0·r and the upper base or apex displaced by d = d0·r, scaled so that its bounding box is at most
 * 80 mm. The exported mesh inscribes 64-gons, so its volume uses the polygon's area N·r²·sin(2π/N)/2; shearing keeps it.
 */
function geometry(kind: Kind, h0: number, d0: number) {
  const width0 = kind === 'cylinder' ? 2 + d0 : Math.max(2, 1 + d0);
  const r = 80 / Math.max(width0, 2, h0);
  const h = h0 * r;
  const polygonBase = (64 * r ** 2 * Math.sin((2 * Math.PI) / 64)) / 2;
  return { size: [width0 * r, 2 * r, h], meshVolume: (polygonBase * h) / (kind === 'cylinder' ? 1 : 3) };
}

const summary = (kind: Kind, expected: { size: number[] }) =>
  `${NAMES[kind]} · ${expected.size.map((value) => numberFormat.format(value)).join(' × ')} мм`;

async function expectDownloaded(page: Page, kind: Kind, expected: ReturnType<typeof geometry>): Promise<void> {
  const { fileName, measurements } = await downloadThreeMf(page);
  expect(fileName).toBe(`${kind}.3mf`);
  expectSizesClose(measurements.size, expected.size, 1e-3);
  expect(measurements.bounds.min[2]).toBe(0);
  // Relative: 3MF coordinates are written with nine significant digits.
  expect(Math.abs(measurements.volume / expected.meshVolume - 1)).toBeLessThan(1e-6);
}

test('oblique cylinder: the upper base moves along X, the dimensions and file follow and the tilt can be removed', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });
  await expect(status(page)).toHaveText(tiltState('прямий'));
  await openSection(page, 'Нахил');
  await expect(offset(page, 'cylinder')).toHaveValue('0');
  await expect(removeTilt(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Як працює зміщення?' }).click();
  await expect(page.getByText('Центр верхньої основи зсувається вздовж осі X')).toBeVisible();
  await expectDownloaded(page, 'cylinder', geometry('cylinder', 2, 0));

  // h = r and d = r: the box is 3r × 2r × r, so r = h = d = 80/3 mm and the generatrix is r·√2.
  await heightRatio(page).fill('1');
  await offset(page, 'cylinder').fill('1');
  await expect(status(page)).toHaveText(tiltState('похилий'));
  const leaning = geometry('cylinder', 1, 1);
  await expectPreviewOf(page, 'Циліндр · 80 × 53,3 × 26,7 мм');
  await expectDownloaded(page, 'cylinder', leaning);

  // Steps from off-step values, the upper limit and a precise typed value.
  const field = offset(page, 'cylinder');
  await field.fill('0,1');
  await stepButton(page, 'cylinder', 'зменшити').click();
  await expect(field).toHaveValue('0');
  await expect(stepButton(page, 'cylinder', 'зменшити')).toBeDisabled();
  await stepButton(page, 'cylinder', 'збільшити').click();
  await expect(field).toHaveValue('0,25');
  // At h = r the slider ends where the lean reaches 15°: d = r / tan 15° ≈ 3,732r, short of the limit 4.
  await expect(offsetSlider(page, 'cylinder')).toHaveAttribute('max', '3.732');
  await offsetSlider(page, 'cylinder').press('End');
  await expect(field).toHaveValue('3,732');
  await expect(stepButton(page, 'cylinder', 'збільшити')).toBeDisabled();
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 1, 3.732)));
  await field.fill('3,8');
  await expect(page.getByText('Кут нахилу має бути не менше 15°: за цієї висоти допустимо від 0 до 3,732.')).toBeVisible();
  await expect(downloadButton(page)).toBeDisabled();
  await field.fill('1.35');
  await field.blur();
  await expect(field).toHaveValue('1.35');
  const typed = geometry('cylinder', 1, 1.35);
  await expectPreviewOf(page, summary('cylinder', typed));
  await expectDownloaded(page, 'cylinder', typed);

  // Removing the tilt keeps the height.
  await removeTilt(page).click();
  await expect(field).toHaveValue('0');
  await expect(heightRatio(page)).toHaveValue('1');
  await expect(status(page)).toHaveText(tiltState('прямий'));
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 1, 0)));
  await expectDownloaded(page, 'cylinder', geometry('cylinder', 1, 0));

  expect(errors).toEqual([]);
});

test('oblique cone: the apex moves beyond the base and the tilt can be removed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cone });
  await expect(status(page)).toHaveText(tiltState('прямий'));
  await openSection(page, 'Нахил');

  // h = r and the apex at 3r, outside the base: the box is 4r wide, so r = h = 20 mm.
  await heightRatio(page).fill('1');
  await offset(page, 'cone').fill('3');
  await expect(status(page)).toHaveText(tiltState('похилий'));
  const outside = geometry('cone', 1, 3);
  await expectPreviewOf(page, 'Конус · 80 × 40 × 20 мм');
  await expectDownloaded(page, 'cone', outside);

  // A small height with the apex inside the base outline.
  await heightRatio(page).fill('0,5');
  await offset(page, 'cone').fill('0,75');
  const flat = geometry('cone', 0.5, 0.75);
  await expectPreviewOf(page, summary('cone', flat));
  await expectDownloaded(page, 'cone', flat);

  await removeTilt(page).click();
  await expect(offset(page, 'cone')).toHaveValue('0');
  await expect(heightRatio(page)).toHaveValue('0,5');
  await expect(status(page)).toHaveText(tiltState('прямий'));
  await expectPreviewOf(page, summary('cone', geometry('cone', 0.5, 0)));
  await expectDownloaded(page, 'cone', geometry('cone', 0.5, 0));

  expect(errors).toEqual([]);
});

test('oblique cylinder and cone: invalid displacements, separate values and no outdated download', async ({ page }) => {
  await page.goto('/');
  await shapeSelect(page).selectOption({ label: NAMES.cylinder });
  await expectPreviewOf(page, summary('cylinder', geometry('cylinder', 2, 0)));
  await openSection(page, 'Нахил');

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
    await expect(status(page)).toHaveText(tiltState('помилка'));
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
  await openSection(page, 'Нахил');
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
  test(`oblique cylinder and cone: the preview keeps its place without horizontal overflow (${layout}, ${width} px)`, async ({
    page,
  }) => {
    // Tall enough on a phone to keep the 3D viewer, which loads models only while visible, on screen above the controls.
    await page.setViewportSize({ width, height: width < 600 ? 2400 : 900 });
    await page.goto('/');
    for (const kind of ['cylinder', 'cone'] as const) {
      await shapeSelect(page).selectOption({ label: NAMES[kind] });
      await openSection(page, 'Нахил');
      let reference: Awaited<ReturnType<typeof previewPlace>> | undefined;
      for (const [h, d] of [
        ['2', '0'],
        ['1', '1'],
        ['0,5', '1,5'],
        ['4', '4'],
        ['4', '0,5'],
        ['1', '0'],
      ] as const) {
        await heightRatio(page).fill(h);
        await offset(page, kind).fill(d);
        await expectPreviewOf(page, summary(kind, geometry(kind, Number(h.replace(',', '.')), Number(d.replace(',', '.')))));
        const current = await previewPlace(page);
        reference ??= current;
        expect(current).toEqual(reference);
        expect(await hasNoHorizontalOverflow(page)).toBe(true);
      }
    }
  });
}
