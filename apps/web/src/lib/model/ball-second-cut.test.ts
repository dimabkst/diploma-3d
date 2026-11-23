import { describe, expect, it } from 'vitest';
import { shapePanel } from '../shapes.ts';
import {
  addSecondCut,
  canResetShapeParameters,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  removeSecondCut,
  resetShapeParameters,
  resolveModelRequest,
} from './parameters.ts';

const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({
  ...initialParameterChoices(),
  ballSection: 'horizontal',
  ...overrides,
});
const request = (overrides: Partial<ParameterTexts> = {}, chosen: Partial<ParameterChoices> = {}) =>
  resolveModelRequest('ball', texts(overrides), choices(chosen), { connectorEdits: {} });
const groupOf = (title: string, overrides: Partial<ParameterTexts> = {}, chosen: Partial<ParameterChoices> = {}) => {
  const { values, sectionRanges, connectorStatus } = request(overrides, chosen);
  const panel = shapePanel('ball', choices(chosen), { values, sectionRanges, connectorStatus });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === title) : undefined;
  if (found === undefined) throw new Error(`No ${title}`);
  return found;
};
const labels = (group: ReturnType<typeof groupOf>) =>
  group.fields.map((field) => ('label' in field ? field.label : 'text' in field ? field.text : field.key));

describe('a second parallel plane of the ball', () => {
  it('is offered beside a single plane, which stays as it was', () => {
    expect(initialParameterChoices().ballSecondCut).toBe(false);
    expect(request({ ballSectionOffsetPercent: '30' }).spec?.section).toEqual({ type: 'horizontal', offsetPercent: 30 });
    expect(labels(groupOf('Переріз'))).toEqual([
      'Тип перерізу',
      'Зміщення від центра',
      'Додати паралельний переріз',
      'Розсунути частини',
      'Січна пластина',
    ]);
  });

  it('starts halfway between the first plane and the farther limit, keeping the first plane as it is', () => {
    const at = (first: number) => {
      const state: ParameterState = { texts: texts({ ballSectionOffsetPercent: String(first) }), choices: choices() };
      const added = addSecondCut('ball', state, { printSizeMm: 80, ballSectionOffsetPercent: first });
      expect(added.texts.ballSectionOffsetPercent).toBe(String(first));
      expect(added.choices.ballSecondCut).toBe(true);
      return added.texts.ballSectionSecondOffsetPercent;
    };
    // The limit at 80 mm is ±80 %.
    expect(at(0)).toBe('40');
    expect(at(30)).toBe('-25');
    expect(at(-50)).toBe('15');
    expect(at(80)).toBe('0');
  });

  it('shows both planes by their identity, the way back, and three parts in the specification', () => {
    const group = groupOf('Переріз', { ballSectionSecondOffsetPercent: '40' }, { ballSecondCut: true });
    expect(labels(group)).toEqual([
      'Тип перерізу',
      'Перший переріз: зміщення від центра',
      'Другий переріз: зміщення від центра',
      'Прибрати другий переріз',
      'Розсунути частини',
      'Січна пластина',
      'Січна пластина доступна лише з одним перерізом.',
    ]);
    expect(group.fields.find((field) => field.key === 'ballPlate')).toMatchObject({ disabled: true });
    expect(group.status).toEqual({ text: 'два перерізи', highlighted: true });
    expect(group.help?.text).toContain('Другий переріз паралельний першому');
    const result = request({ ballSectionOffsetPercent: '40', ballSectionSecondOffsetPercent: '-30' }, { ballSecondCut: true });
    expect(result.errors).toEqual({});
    // The planes keep their identity: nothing is sorted or swapped in the specification.
    expect(result.spec?.section).toEqual({ type: 'horizontal', offsetPercent: 40, secondOffsetPercent: -30 });
  });

  it('removing it brings back the single plane with the first plane’s settings', () => {
    const state: ParameterState = {
      texts: texts({ ballSectionOffsetPercent: '25', ballSectionSecondOffsetPercent: '-40' }),
      choices: choices({ ballSecondCut: true }),
    };
    const removed = removeSecondCut('ball', state);
    expect(removed.texts).toBe(state.texts);
    const result = resolveModelRequest('ball', removed.texts, removed.choices);
    expect(result.spec?.section).toEqual({ type: 'horizontal', offsetPercent: 25 });
    // A draft of the removed plane blocks nothing.
    expect(
      resolveModelRequest('ball', { ...removed.texts, ballSectionSecondOffsetPercent: 'abc' }, removed.choices).errors,
    ).toEqual({});
  });

  it('refuses planes too close to each other or beyond the limits, on the second plane’s field', () => {
    const close = request({ ballSectionOffsetPercent: '10', ballSectionSecondOffsetPercent: '25' }, { ballSecondCut: true });
    expect(close.errors.ballSectionSecondOffsetPercent).toMatch(/^Перерізи надто близько: середня частина має завтовшки 6 мм/);
    expect(close.spec).toBeUndefined();
    const far = request({ ballSectionSecondOffsetPercent: '85' }, { ballSecondCut: true });
    expect(far.errors.ballSectionSecondOffsetPercent).toMatch(/^Допустимі значення — від -80 % до 80 %/);
    expect(far.sectionRanges?.ballSectionSecondOffsetPercent).toEqual({ min: -80, max: 80 });
  });

  it('takes no section plate, and is not offered while the plate is on', () => {
    const group = groupOf('Переріз', {}, { ballPlate: true });
    expect(group.fields.find((field) => field.key === 'ball-add-second-cut')).toMatchObject({ disabled: true });
    expect(labels(group)).toContain('Паралельний переріз недоступний із січною пластиною.');
    // A plate switched on in the state does not reach the two planes' specification.
    const both = request({}, { ballPlate: true, ballSecondCut: true });
    expect(both.spec?.section).toEqual({ type: 'horizontal', offsetPercent: 0, secondOffsetPercent: 40 });
  });

  it('keeps the planes’ positions relative to the ball whatever its size', () => {
    for (const printSizeMm of ['60', '160']) {
      const result = request({ printSizeMm, ballSectionOffsetPercent: '-30' }, { ballSecondCut: true });
      expect(result.spec?.section).toEqual({ type: 'horizontal', offsetPercent: -30, secondOffsetPercent: 40 });
    }
  });

  it('fits a connector at both planes, and says which plane cannot take it', () => {
    const dowels = request({ ballSectionOffsetPercent: '-30' }, { ballSecondCut: true, ballConnector: 'dowel' });
    expect(dowels.errors).toEqual({});
    expect(dowels.connectorStatus?.unavailable).toBeUndefined();
    expect(dowels.spec?.section).toMatchObject({ offsetPercent: -30, secondOffsetPercent: 40, connector: { type: 'dowel' } });
    const connector = groupOf('Кріплення', { ballSectionOffsetPercent: '-30' }, { ballSecondCut: true, ballConnector: 'dowel' });
    expect(connector.fields).toContainEqual(
      expect.objectContaining({
        text: 'Кріплення однакове на обох перерізах: між нижньою й середньою та між середньою й верхньою частинами.',
      }),
    );
    // Two 3 mm magnets' pockets and the 2 mm between them do not fit the 8 mm middle part.
    const thin = request(
      { ballSectionOffsetPercent: '10', ballSectionSecondOffsetPercent: '30', ballMagnetThicknessMm: '3' },
      { ballSecondCut: true, ballConnector: 'magnet' },
    );
    expect(thin.connectorStatus?.unavailable).toMatch(/^Біля першого перерізу: Середня частина затонка для гнізд з обох боків/);
    expect(thin.spec?.section).toEqual({ type: 'horizontal', offsetPercent: 10, secondOffsetPercent: 30 });
    expect(thin.key).toMatch(/:connector-unavailable$/);
    // A new dowel is fitted to both planes and to the 8 mm middle part: its holes from both sides keep 1,2 mm between them.
    const fitted = request(
      { ballSectionOffsetPercent: '10', ballSectionSecondOffsetPercent: '30' },
      { ballSecondCut: true, ballConnector: 'dowel' },
    );
    expect(fitted.connectorStatus?.unavailable).toBeUndefined();
    const dowel = fitted.spec?.section?.connector as { depthFactor: number };
    const insertion = 0.05 * 80 * dowel.depthFactor;
    expect(8 - 2 * (insertion + 0.3)).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });

  it('a whole reset takes the second plane away', () => {
    const state: ParameterState = {
      texts: texts({ ballSectionSecondOffsetPercent: '-40' }),
      choices: choices({ ballSecondCut: true }),
    };
    expect(canResetShapeParameters('ball', state)).toBe(true);
    const reset = resetShapeParameters('ball', state);
    expect(reset.choices.ballSecondCut).toBe(false);
    expect(reset.texts.ballSectionSecondOffsetPercent).toBe('40');
  });
});
