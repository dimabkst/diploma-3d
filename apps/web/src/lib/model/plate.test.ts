import { buildModelArtifacts, loadGeometryKernel, MODEL_SETTINGS_PATH } from '@diploma-3d/engine';
import { describe, expect, it } from 'vitest';
import { readThreeMfPart } from '../../../../../packages/engine/src/export/three-mf.test-helper.ts';
import { sectionNumberFields, shapePanel } from '../shapes.ts';
import {
  canResetShapeParameters,
  commitConnectorEdit,
  dovetailIssueMessage,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  PLATE_TWIST_NOTICE,
  PLATE_UNAVAILABLE_ELSEWHERE_MESSAGE,
  PLATE_UNAVAILABLE_MESSAGE,
  plateConnectorFallback,
  resetShapeParameters,
  resolveModelRequest,
  roundConnectorIssueMessage,
} from './parameters.ts';

const kernel = await loadGeometryKernel();

const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({
  ...initialParameterChoices(),
  coneSection: 'parallel-to-bases',
  ...overrides,
});
const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const request = (overrides: Partial<ParameterTexts> = {}, chosen: Partial<ParameterChoices> = {}, edits = {}) =>
  resolveModelRequest('cone', texts(overrides), choices(chosen), { connectorEdits: edits });
const cutGroup = (overrides: Partial<ParameterTexts> = {}, chosen: Partial<ParameterChoices> = {}) => {
  const { values, sectionRanges } = request(overrides, chosen);
  const panel = shapePanel('cone', choices(chosen), { values, sectionRanges });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Переріз') : undefined;
  if (found === undefined) throw new Error('No cut group');
  return found;
};
const connectorGroup = (overrides: Partial<ParameterTexts> = {}, chosen: Partial<ParameterChoices> = {}) => {
  const { values, sectionRanges, connectorStatus } = request(overrides, chosen);
  const panel = shapePanel('cone', choices(chosen), { values, sectionRanges, connectorStatus });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Кріплення') : undefined;
  if (found === undefined) throw new Error('No connector group');
  return found;
};

describe('the section plate of a cone', () => {
  it('starts off, and a cut without it is the plain cut it always was', () => {
    expect(initialParameterChoices().conePlate).toBe(false);
    expect(initialParameterTexts()).toMatchObject({ conePlateThicknessMm: '1,6', conePlateMarginMm: '10' });
    const plain = request();
    expect(plain.spec?.section).toEqual({ type: 'parallel-to-bases', positionPercent: 50 });
    // Its drafts block nothing while it is off.
    expect(request({ conePlateThicknessMm: 'abc' }).spec?.section).toEqual({ type: 'parallel-to-bases', positionPercent: 50 });
    expect(sectionNumberFields(cutGroup())).toHaveLength(1);
  });

  it('adds its thickness and margin, in its own fields after the switch and before the connector', () => {
    const plated = request({}, { conePlate: true });
    expect(plated.errors).toEqual({});
    expect(plated.spec?.section).toEqual({
      type: 'parallel-to-bases',
      positionPercent: 50,
      plate: { thicknessMm: 1.6, marginMm: 10 },
    });
    const group = cutGroup({}, { conePlate: true });
    expect(group.status).toEqual({ text: 'з пластиною', highlighted: true });
    expect(group.fields.map((field) => field.key)).toEqual([
      'coneSection',
      'coneSectionPercent',
      'conePartsSeparated',
      'conePlate',
      'conePlateThicknessMm',
      'conePlateMarginMm',
    ]);
    expect(sectionNumberFields(group).slice(1)).toMatchObject([
      { key: 'conePlateThicknessMm', label: 'Товщина пластини, мм', range: { min: 1.2, max: 4, increment: 0.2 } },
      { key: 'conePlateMarginMm', label: 'Виступ за межі фігури, мм', range: { min: 3, max: 30, increment: 1 } },
    ]);
    expect(group.help?.text).toContain('Січна пластина — окрема пласка деталь');
    // Every cut of the cone carries it while the switch is on; without a cut there is none.
    expect(request({}, { conePlate: true, coneSection: 'vertical' }).spec?.section).toMatchObject({
      type: 'vertical',
      plate: { thicknessMm: 1.6, marginMm: 10 },
    });
    expect(request({}, { conePlate: true, coneSection: 'none' }).spec?.section).toBeUndefined();
  });

  it('holds typed values to the same bounds as the sliders, narrowed by the cone', () => {
    const plated = { conePlate: true } as const;
    expect(request({ conePlateThicknessMm: '1,1' }, plated).errors.conePlateThicknessMm).toBe(
      'Допустимі значення — від 1,2 мм до 4 мм.',
    );
    expect(request({ conePlateThicknessMm: '4,2' }, plated).spec).toBeUndefined();
    expect(request({ conePlateMarginMm: '2' }, plated).errors.conePlateMarginMm).toBe('Допустимі значення — від 3 мм до 30 мм.');
    expect(request({ conePlateMarginMm: '31' }, plated).spec).toBeUndefined();
    expect(request({ conePlateThicknessMm: '3,2', conePlateMarginMm: '25' }, plated).spec?.section).toMatchObject({
      plate: { thicknessMm: 3.2, marginMm: 25 },
    });
    // r = 10 mm and H = 5 mm at 20 mm: at 50 % each part keeps 2,5 mm, of which 1,2 mm must stay.
    const small = { printSizeMm: '20', coneHeightRatio: '0,5' };
    const narrowed = request({ ...small, conePlateThicknessMm: '3' }, plated);
    expect(narrowed.sectionRanges?.conePlateThicknessMm?.max).toBeCloseTo(2.6, 9);
    expect(narrowed.errors.conePlateThicknessMm).toBe(
      'За цього положення перерізу допустимо від 1,2 мм до 2,6 мм: кожна частина має лишатися не тоншою за 1,2 мм.',
    );
    expect(narrowed.spec).toBeUndefined();
    const { sectionRanges, values } = request({ ...small, conePlateThicknessMm: '2,6' }, plated);
    expect(request({ ...small, conePlateThicknessMm: '2,6' }, plated).errors).toEqual({});
    const panel = shapePanel('cone', choices(plated), { values, sectionRanges });
    const field =
      panel.type === 'parameters'
        ? sectionNumberFields(panel.sections.find((group) => group.title === 'Переріз') as never).find(
            (candidate) => candidate.key === 'conePlateThicknessMm',
          )
        : undefined;
    expect(field?.range).toEqual({ min: 1.2, max: 2.6, increment: 0.2 });
  });

  it('is unavailable where even the thinnest would leave a part too thin, and says so', () => {
    // H = 5 mm: at 10 % the lower part would keep 0,5 − 0,6 mm.
    const tiny = { printSizeMm: '20', coneHeightRatio: '0,5', coneSectionPercent: '10' };
    const off = cutGroup(tiny);
    expect(off.fields.find((field) => field.key === 'conePlate')).toMatchObject({
      disabled: true,
      describedBy: 'cone-plate-unavailable',
    });
    expect(off.fields.find((field) => field.key === 'cone-plate-unavailable')).toMatchObject({ text: PLATE_UNAVAILABLE_MESSAGE });
    // Chosen before the cut moved: no model, the thickness says why, and the switch stays free to turn it off.
    const on = request(tiny, { conePlate: true });
    expect(on.spec).toBeUndefined();
    expect(on.errors.conePlateThicknessMm).toBe(PLATE_UNAVAILABLE_MESSAGE);
    expect(cutGroup(tiny, { conePlate: true }).fields.find((field) => field.key === 'conePlate')).not.toHaveProperty('disabled');
  });

  it('reset turns it off with its defaults, and keeps the print size', () => {
    const state: ParameterState = {
      texts: texts({ printSizeMm: '120', conePlateThicknessMm: '2,4', conePlateMarginMm: '15' }),
      choices: choices({ conePlate: true }),
    };
    expect(canResetShapeParameters('cone', state)).toBe(true);
    const reset = resetShapeParameters('cone', state);
    expect(reset.choices.conePlate).toBe(false);
    expect(reset.texts).toMatchObject({ printSizeMm: '120', conePlateThicknessMm: '1,6', conePlateMarginMm: '10' });
    // A changed thickness of a plate that is off changes nothing to reset.
    const hidden: ParameterState = { texts: texts({ conePlateThicknessMm: '2,4' }), choices: choices() };
    expect(canResetShapeParameters('cone', { ...hidden, choices: initialParameterChoices() })).toBe(false);
  });
});

describe('connectors through the plate', () => {
  it('offers dovetails, plugs and dowels, never the twist connector, which turns into none, said so', () => {
    const group = connectorGroup({}, { conePlate: true });
    const selector = group.fields[0] as unknown as { options: { value: string; disabled?: boolean }[] };
    expect(selector.options.filter((option) => !option.disabled).map((option) => option.value)).toEqual([
      'none',
      'dovetail',
      'plug',
      'dowel',
    ]);
    const state: ParameterState = { texts: texts(), choices: choices({ conePlate: true, coneConnector: 'twist' }) };
    expect(plateConnectorFallback('cone', state)?.choices.coneConnector).toBe('none');
    expect(plateConnectorFallback('cone', { ...state, choices: choices({ coneConnector: 'twist' }) })).toBeUndefined();
    expect(
      plateConnectorFallback('cone', { ...state, choices: choices({ conePlate: true, coneConnector: 'dowel' }) }),
    ).toBeUndefined();
    const { values, sectionRanges } = request({}, { conePlate: true });
    const panel = shapePanel('cone', choices({ conePlate: true }), {
      values,
      sectionRanges,
      connectorNotice: PLATE_TWIST_NOTICE,
    });
    const connector = panel.type === 'parameters' ? panel.sections.find((part) => part.title === 'Кріплення') : undefined;
    expect(connector?.fields).toContainEqual(expect.objectContaining({ text: PLATE_TWIST_NOTICE, tone: 'status' }));
  });

  it('a new connector fits the plate’s assembly, and the fields say what crosses the plate', () => {
    const plated = request({}, { conePlate: true, coneConnector: 'dowel' });
    const plain = request({}, { coneConnector: 'dowel' });
    expect(plated.errors).toEqual({});
    expect(plated.spec?.section).toMatchObject({ plate: { thicknessMm: 1.6 }, connector: { type: 'dowel' } });
    expect(plated.values.coneRoundDepth).not.toBe(plain.values.coneRoundDepth);
    const group = connectorGroup({}, { conePlate: true, coneConnector: 'dowel' });
    expect(sectionNumberFields(group).map((field) => field.label)).toContain('Довжина штифта в частинах, мм');
    const notes = group.fields.flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(notes.some((text) => text.startsWith('Повна довжина штифта — ') && text.includes('1,6 мм крізь пластину'))).toBe(true);
    expect(notes).toContain('Отвори пластини мають більше з двох збільшень, щоб штифт проходив крізь неї вільно.');
    expect(group.help?.text).toContain('проходять крізь отвори пластини');
    const plug = connectorGroup({}, { conePlate: true, coneConnector: 'plug' });
    expect(sectionNumberFields(plug).map((field) => field.label)).toContain('Заглиблення виступу, мм');
    expect(plug.help?.text).toContain('проходить крізь отвір пластини');
    const dovetail = connectorGroup({}, { conePlate: true, coneConnector: 'dovetail' });
    expect(dovetail.help?.text).toContain(
      'Виступи друкуються на обох гранях січної пластини, пази — у нижній і верхній частинах.',
    );
    expect(dovetail.fields).toContainEqual(
      expect.objectContaining({ text: 'Виступи — на обох гранях пластини, пази — в обох частинах.' }),
    );
  });

  it('switching the plate never overwrites what was entered: the former values return without it', () => {
    const base: ParameterState = { texts: texts(), choices: choices({ coneConnector: 'dowel' }), connectorEdits: {} };
    const requestOf = (state: ParameterState) =>
      resolveModelRequest('cone', state.texts, state.choices, { connectorEdits: state.connectorEdits });
    // A dowel edited by hand to fill the upper cone without a plate, near the top of the cone.
    const committed = commitConnectorEdit('cone', base, requestOf(base));
    const edited: ParameterState = { ...committed, texts: { ...committed.texts, coneSectionPercent: '80' } };
    const without = requestOf(edited);
    const deepest = without.sectionRanges?.coneRoundDepth?.max as number;
    const deep: ParameterState = {
      ...edited,
      texts: { ...edited.texts, coneRoundDepth: String(deepest / (0.05 * 80 * 2)).replace('.', ',') },
    };
    const before = requestOf(deep);
    expect(before.errors).toEqual({});
    const withPlate: ParameterState = {
      ...deep,
      choices: { ...deep.choices, conePlate: true },
      texts: { ...deep.texts, conePlateThicknessMm: '4' },
    };
    const plated = requestOf(withPlate);
    expect(plated.errors).toEqual({});
    expect(plated.values.coneRoundDepth as number).toBeLessThan(before.values.coneRoundDepth as number);
    expect(plated.connectorStatus?.corrections).toContainEqual(expect.stringMatching(/^Довжину штифта в частинах зменшено до/));
    expect(withPlate.texts.coneRoundDepth).toBe(deep.texts.coneRoundDepth);
    const back = requestOf({ ...withPlate, choices: { ...withPlate.choices, conePlate: false } });
    expect(back.values.coneRoundDepth).toBe(before.values.coneRoundDepth);
    expect(back.spec).toEqual(before.spec);
  });

  it('names the part and the plate in what it explains', () => {
    expect(dovetailIssueMessage({ code: 'backing-thin', part: 'upper', valueMm: 0.8, minimumMm: 1.2 }, 'cone-plate')).toBe(
      'За пазом у верхній частині лишається 0,8 мм, потрібно щонайменше 1,2 мм. Зменште висоту виступу, опустіть переріз або зменште товщину пластини.',
    );
    expect(roundConnectorIssueMessage({ code: 'base-thin', valueMm: 1, minimumMm: 1.2 }, 'plug', 1, 'cone-plate')).toBe(
      'Під виступом лишається 1 мм, потрібно щонайменше 1,2 мм нижньої частини. Підніміть переріз, зменште товщину пластини або збільште найбільший габарит.',
    );
  });
});

describe('the download of a plate', () => {
  it('records the plate it was generated with', async () => {
    const result = request({ conePlateThicknessMm: '2', conePlateMarginMm: '8' }, { conePlate: true, coneConnector: 'plug' });
    if (result.spec === undefined) throw new Error('expected a model');
    const artifacts = await buildModelArtifacts(kernel, result.spec, result.settingsInput);
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.section.plate).toEqual({ thicknessMm: 2, marginMm: 8 });
    expect(artifacts.model.solids.map((solid) => solid.part)).toEqual(['lower', 'upper', 'plate']);
    expect(artifacts.printFile.fileName).toBe('cone-parallel-section-plate.3mf');
  });
});

describe('the plate on every cut of the cone', () => {
  const plated = { conePlate: true } as const;
  const modes = [
    ['vertical', { coneSection: 'vertical' }, 'type: vertical'],
    ['oblique', { coneSection: 'oblique' }, 'type: oblique'],
    ['through the apex', { coneSection: 'oblique', coneObliqueThrough: 'apex' }, 'type: oblique-apex'],
  ] as const;

  it.each(modes)('a %s cut offers the same switch and fields after its own, and carries the plate', (_, chosen) => {
    const result = request({ coneApexInclinationDeg: '75' }, { ...chosen, ...plated, coneConnector: 'dowel' });
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toMatchObject({ plate: { thicknessMm: 1.6, marginMm: 10 }, connector: { type: 'dowel' } });
    const group = cutGroup({ coneApexInclinationDeg: '75' }, { ...chosen, ...plated });
    const keys = group.fields.map((field) => field.key);
    expect(keys.slice(-4)).toEqual(['conePartsSeparated', 'conePlate', 'conePlateThicknessMm', 'conePlateMarginMm']);
    expect(group.status).toEqual({ text: 'з пластиною', highlighted: true });
    expect(group.help?.text).toContain('товщина вимірюється перпендикулярно до площини');
    // Its parts keep their numbers in the connector's fields and help.
    const connector = connectorGroup({ coneApexInclinationDeg: '75' }, { ...chosen, ...plated, coneConnector: 'plug' });
    expect(connector.fields).toContainEqual(
      expect.objectContaining({ text: expect.stringMatching(/^Над частиною 1 виступ має/) }),
    );
    expect(connector.help?.text).toContain('Виступ друкується разом із частиною 1');
  });

  it('switching between cuts keeps the plate, its settings and the connector, and fits the connector to each', () => {
    const stored = { conePlateThicknessMm: '2,4', conePlateMarginMm: '14', coneApexInclinationDeg: '75' };
    const results = [{ coneSection: 'parallel-to-bases' }, ...modes.map(([, chosen]) => chosen)].map((chosen) =>
      request(stored, { ...chosen, ...plated, coneConnector: 'dowel' } as Partial<ParameterChoices>),
    );
    for (const result of results) {
      expect(result.errors).toEqual({});
      expect(result.spec?.section).toMatchObject({ plate: { thicknessMm: 2.4, marginMm: 14 }, connector: { type: 'dowel' } });
    }
    // Each cut resolves the connector's dimensions against its own assembly.
    expect(new Set(results.map((result) => result.values.coneRoundDepth)).size).toBeGreaterThan(1);
  });

  it('the thickness follows each part’s reach along the normal, and the switch is off where none fits', () => {
    // r = 10 mm and H = 20 mm: a vertical plane at 70 % of r leaves part 2 about 3 mm deep.
    const small = { printSizeMm: '20', coneSectionOffsetPercent: '70' };
    const vertical = request({ ...small, conePlateThicknessMm: '4' }, { coneSection: 'vertical', ...plated });
    const range = vertical.sectionRanges?.conePlateThicknessMm;
    expect(range?.max).toBeLessThan(4);
    expect(vertical.errors.conePlateThicknessMm).toMatch(/^За цього перерізу допустимо від 1,2 мм до /);
    expect(vertical.spec).toBeUndefined();
    // At 10 mm (r = 5 mm) a vertical plane at 75 % of r, within its own limit of 76 %, leaves part 2 too little for any plate.
    const tiny = { printSizeMm: '10', coneSectionOffsetPercent: '75' };
    expect(request(tiny, { coneSection: 'vertical' }).errors).toEqual({});
    const off = cutGroup(tiny, { coneSection: 'vertical' });
    expect(off.fields.find((field) => field.key === 'conePlate')).toMatchObject({ disabled: true });
    expect(off.fields).toContainEqual(expect.objectContaining({ text: PLATE_UNAVAILABLE_ELSEWHERE_MESSAGE }));
    expect(request(tiny, { coneSection: 'vertical', ...plated }).errors.conePlateThicknessMm).toBe(
      PLATE_UNAVAILABLE_ELSEWHERE_MESSAGE,
    );
  });

  it('records the cut with its plate in the download', async () => {
    const result = request({ coneSectionOffsetPercent: '20' }, { coneSection: 'vertical', ...plated, coneConnector: 'dovetail' });
    if (result.spec === undefined) throw new Error('expected a model');
    const artifacts = await buildModelArtifacts(kernel, result.spec, result.settingsInput);
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.section).toEqual({ type: 'vertical', offsetPercent: 20, plate: { thicknessMm: 1.6, marginMm: 10 } });
    expect(artifacts.model.solids.map((solid) => solid.part)).toEqual(['part-1', 'part-2', 'plate']);
    expect(artifacts.printFile.fileName).toBe('cone-vertical-section-plate.3mf');
  });
});
