import { buildModelArtifacts, loadGeometryKernel, MODEL_SETTINGS_PATH } from '@diploma-3d/engine';
import type { ShapeKind } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { readThreeMfPart } from '../../../../../packages/engine/src/export/three-mf.test-helper.ts';
import { type DisclosureGroup, type ParameterField, sectionNumberFields, shapePanel } from '../shapes.ts';
import {
  canResetShapeParameters,
  initialParameterChoices,
  initialParameterTexts,
  magnetAllowancesChanged,
  type ParameterChoices,
  type ParameterTexts,
  resetMagnetAllowances,
  resetShapeParameters,
  resolveModelRequest,
} from './parameters.ts';

const kernel = await loadGeometryKernel();
const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });

const DEFAULT_SETTINGS = {
  type: 'magnet',
  count: 3,
  magnetDiameterMm: 6,
  magnetThicknessMm: 2,
  diameterAllowanceMm: 0.2,
  depthAllowanceMm: 0.1,
} as const;

const connectorGroup = (kind: ShapeKind, overrides: Partial<ParameterTexts>, chosen: ParameterChoices) => {
  const current = texts(overrides);
  const { values, sectionRanges, connectorStatus } = resolveModelRequest(kind, current, chosen, { connectorEdits: {} });
  const panel = shapePanel(kind, chosen, {
    values,
    sectionRanges,
    connectorStatus,
    magnetAllowancesChanged: magnetAllowancesChanged(kind, current),
  });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Кріплення') : undefined;
  if (found === undefined) throw new Error('No connector group');
  return found;
};

const disclosureOf = (fields: readonly ParameterField[]) =>
  fields.find((field): field is DisclosureGroup => field.type === 'disclosure') as DisclosureGroup;

/** Every cut of every solid with a section, with magnets chosen. */
const cuts: readonly (readonly [ShapeKind, Partial<ParameterChoices>])[] = [
  ['cylinder', { cylinderSection: 'parallel-to-bases', cylinderConnector: 'magnet' }],
  ['cylinder', { cylinderSection: 'vertical', cylinderConnector: 'magnet' }],
  ['cylinder', { cylinderSection: 'oblique', cylinderConnector: 'magnet' }],
  ['cone', { coneSection: 'parallel-to-bases', coneConnector: 'magnet' }],
  ['cone', { coneSection: 'vertical', coneConnector: 'magnet' }],
  ['cone', { coneSection: 'oblique', coneConnector: 'magnet' }],
  ['cone', { coneSection: 'oblique', coneObliqueThrough: 'apex', coneApexStarted: true, coneConnector: 'magnet' }],
  ['ball', { ballSection: 'horizontal', ballConnector: 'magnet' }],
];

describe('magnet pockets in the panel', () => {
  it.each(cuts)(
    'a %s: three controls, the fit allowances collapsed below them, and the defaults in the specification',
    (kind, chosen) => {
      const request = resolveModelRequest(kind, texts({ coneApexInclinationDeg: '75' }), choices(chosen), { connectorEdits: {} });
      expect(request.errors).toEqual({});
      expect(request.connectorStatus?.unavailable).toBeUndefined();
      expect(request.spec?.section?.connector).toEqual(DEFAULT_SETTINGS);
      const group = connectorGroup(kind, { coneApexInclinationDeg: '75' }, choices(chosen));
      expect(group.status).toEqual({ text: 'магнітні гнізда', highlighted: true });
      // Visible at first: the type, three numbers with the pairs' explanation, and the collapsed further settings.
      // The twist connector's note, where that connector is not offered, belongs to the selector, whatever is chosen.
      const own = group.fields.filter((field) => !field.key.endsWith('twist-unsupported'));
      expect(own.map((field) => [field.type, 'label' in field ? field.label : 'text' in field ? field.text : field.key])).toEqual(
        [
          ['choice', 'Тип кріплення'],
          ['number', 'Кількість пар магнітів'],
          ['note', 'Одна пара — два магніти, по одному в кожній частині.'],
          ['number', 'Діаметр магніту, мм'],
          ['number', 'Товщина магніту, мм'],
          ['disclosure', 'Додаткові налаштування'],
        ],
      );
      const disclosure = disclosureOf(group.fields);
      expect(disclosure.fields.map((field) => [field.type, 'label' in field ? field.label : field.text])).toEqual([
        ['number', 'Запас за діаметром, мм'],
        ['note', 'Додається до повного діаметра магніту.'],
        ['number', 'Запас за глибиною, мм'],
        ['note', 'Додається до товщини магніту.'],
        ['note', 'Розмір отвору: Ø6,20 × 2,10 мм'],
        ['action', 'Відновити стандартні значення'],
      ]);
      expect(sectionNumberFields(group).map((field) => [field.key, field.range])).toEqual([
        [`${kind}MagnetCount`, { min: 1, max: 12, increment: 1 }],
        [`${kind}MagnetDiameterMm`, { min: 1, max: 30, increment: 0.1 }],
        [`${kind}MagnetThicknessMm`, { min: 0.5, max: 20, increment: 0.1 }],
        [`${kind}MagnetDiameterAllowanceMm`, { min: 0, max: 1, increment: 0.05 }],
        [`${kind}MagnetDepthAllowanceMm`, { min: 0, max: 1, increment: 0.05 }],
      ]);
      // Nothing to restore at the defaults.
      expect(disclosure.fields.at(-1)).toMatchObject({ action: 'reset-magnet-allowances', disabled: true });
      expect(group.help?.text).toContain('Спершу надрукуйте маленький пробний зразок гнізда');
      expect(group.help?.text).toContain('Перевірте полярність кожної пари');
    },
  );

  it('keeps no removed placement setting anywhere, which could override the automatic placement', () => {
    const keys = Object.keys(initialParameterTexts()).filter((key) => key.includes('Magnet'));
    expect(keys.filter((key) => /EdgeClearance|Wall|Spacing|Chamfer/.test(key))).toEqual([]);
    // Five fields for each of the six solids with sections.
    expect(keys).toHaveLength(30);
  });

  it('shows the hole the allowances give, and restores those two alone', () => {
    const chosen = choices({ ballSection: 'horizontal', ballConnector: 'magnet' });
    const changed = {
      ballMagnetCount: '5',
      ballMagnetDiameterMm: '8',
      ballMagnetThicknessMm: '3',
      ballMagnetDiameterAllowanceMm: '0,35',
      ballMagnetDepthAllowanceMm: '0,25',
      printSizeMm: '120',
      ballSectionOffsetPercent: '20',
    };
    const disclosure = disclosureOf(connectorGroup('ball', changed, chosen).fields);
    expect(disclosure.fields).toContainEqual(expect.objectContaining({ text: 'Розмір отвору: Ø8,35 × 3,25 мм' }));
    expect(disclosure.fields.at(-1)).toMatchObject({ disabled: false });
    const state = { texts: texts(changed), choices: chosen };
    expect(magnetAllowancesChanged('ball', state.texts)).toBe(true);
    const restored = resetMagnetAllowances('ball', state);
    expect(restored.texts).toEqual({ ...state.texts, ballMagnetDiameterAllowanceMm: '0,2', ballMagnetDepthAllowanceMm: '0,1' });
    expect(restored.choices).toBe(state.choices);
    expect(magnetAllowancesChanged('ball', restored.texts)).toBe(false);
  });

  it('keeps the magnets’ millimetres whatever the model’s size', () => {
    const chosen = choices({ cylinderSection: 'parallel-to-bases', cylinderConnector: 'magnet' });
    const small = resolveModelRequest('cylinder', texts({ printSizeMm: '60' }), chosen);
    const large = resolveModelRequest('cylinder', texts({ printSizeMm: '200' }), chosen);
    expect(small.spec?.section?.connector).toEqual(DEFAULT_SETTINGS);
    expect(large.spec?.section?.connector).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses settings outside their windows and a fractional count, in Ukrainian', () => {
    const chosen = choices({ ballSection: 'horizontal', ballConnector: 'magnet' });
    const errorsOf = (overrides: Partial<ParameterTexts>) => resolveModelRequest('ball', texts(overrides), chosen).errors;
    expect(errorsOf({ ballMagnetCount: '2,5' })).toEqual({ ballMagnetCount: 'Введіть ціле число пар від 1 до 12.' });
    expect(errorsOf({ ballMagnetCount: '13' })).toEqual({ ballMagnetCount: 'Допустимі значення — від 1 до 12.' });
    expect(errorsOf({ ballMagnetDiameterMm: '0' })).toEqual({ ballMagnetDiameterMm: 'Допустимі значення — від 1 мм до 30 мм.' });
    expect(errorsOf({ ballMagnetDepthAllowanceMm: '1,05' })).toEqual({
      ballMagnetDepthAllowanceMm: 'Допустимі значення — від 0 мм до 1 мм.',
    });
    expect(errorsOf({ ballMagnetThicknessMm: 'abc' }).ballMagnetThicknessMm).toMatch(/^Введіть число/);
  });

  it('where they do not fit, says why and what to change, keeps the settings, and offers no download', () => {
    const chosen = choices({ coneSection: 'parallel-to-bases', coneConnector: 'magnet' });
    const tip = resolveModelRequest('cone', texts({ coneSectionPercent: '85' }), chosen, { connectorEdits: {} });
    expect(tip.errors).toEqual({});
    expect(tip.connectorStatus?.unavailable).toMatch(/^Верхня частина: навколо гнізда лишається замало матеріалу/);
    expect(tip.connectorStatus?.unavailable).toContain('Налаштування збережено');
    expect(tip.spec?.section?.connector).toBeUndefined();
    expect(tip.key).toMatch(/:connector-unavailable$/);
    expect(tip.values.coneMagnetCount).toBe(3);
    const group = connectorGroup('cone', { coneSectionPercent: '85' }, chosen);
    expect(group.status).toEqual({ text: 'не вміщується', highlighted: true });
    expect(group.fields).toContainEqual(expect.objectContaining({ tone: 'alert', text: tip.connectorStatus?.unavailable }));
    expect(sectionNumberFields(group)).toHaveLength(5);
    const crowded = resolveModelRequest(
      'cylinder',
      texts({ cylinderMagnetCount: '12', cylinderMagnetDiameterMm: '20' }),
      choices({ cylinderSection: 'parallel-to-bases', cylinderConnector: 'magnet' }),
    );
    expect(crowded.connectorStatus?.unavailable).toMatch(
      /^Для вибраних магнітів недостатньо місця: вдалося розмістити лише \d+ з 12 пар\. Зменште їх кількість або розмір, збільште модель чи змініть положення перерізу\./,
    );
    const shallow = resolveModelRequest(
      'cylinder',
      texts({ printSizeMm: '20', cylinderMagnetThicknessMm: '8' }),
      choices({ cylinderSection: 'vertical', cylinderConnector: 'magnet' }),
    );
    expect(shallow.connectorStatus?.unavailable).toMatch(/^Магніти задовгі для цього перерізу: частина 1 і частина 2 мають/);
  });

  it('works through a section plate, which stays whole between the pockets', () => {
    const chosen = choices({ cylinderSection: 'vertical', cylinderPlate: true, cylinderConnector: 'magnet' });
    const request = resolveModelRequest('cylinder', texts(), chosen, { connectorEdits: {} });
    expect(request.errors).toEqual({});
    expect(request.spec?.section).toMatchObject({ plate: { thicknessMm: 1.6 }, connector: DEFAULT_SETTINGS });
    expect(connectorGroup('cylinder', {}, chosen).help?.text).toContain('магніти тягнуть одне одного крізь неї');
  });

  it('a whole reset returns the magnets to their defaults', () => {
    const state = {
      texts: texts({ cylinderMagnetCount: '5', cylinderMagnetDiameterMm: '8' }),
      choices: choices({ cylinderSection: 'parallel-to-bases', cylinderConnector: 'magnet' }),
    };
    expect(canResetShapeParameters('cylinder', state)).toBe(true);
    const reset = resetShapeParameters('cylinder', state);
    expect(reset.texts).toMatchObject({ cylinderMagnetCount: '3', cylinderMagnetDiameterMm: '6' });
    expect(reset.choices.cylinderConnector).toBe('none');
  });

  it('the download holds the pockets of the request', async () => {
    const result = resolveModelRequest(
      'ball',
      texts({ ballMagnetCount: '4', ballMagnetDiameterMm: '5' }),
      choices({ ballSection: 'horizontal', ballConnector: 'magnet' }),
    );
    if (result.spec === undefined) throw new Error('expected a model');
    const artifacts = await buildModelArtifacts(kernel, result.spec, result.settingsInput);
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.connector.settings).toEqual({ ...DEFAULT_SETTINGS, count: 4, magnetDiameterMm: 5 });
    expect(json.sourceModel.connector.dimensions).toMatchObject({ holeDiameterMm: 5.2, holeDepthMm: 2.1, magnetsTotal: 8 });
    expect(artifacts.model.solids.map((solid) => solid.part)).toEqual(['lower', 'upper']);
  });
});
