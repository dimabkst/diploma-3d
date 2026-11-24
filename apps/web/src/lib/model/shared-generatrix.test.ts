import { linkedCylinder, linkedStart, roundDimensionsMm } from '@diploma-3d/engine';
import { DEFAULT_DOVETAIL } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { type LinkedDiagramField, previewHighlightOf, sectionNumberFields, shapePanel } from '../shapes.ts';
import {
  initialParameterChoices,
  initialParameterTexts,
  linkedAxial,
  type ParameterChoices,
  type ParameterExact,
  type ParameterState,
  type ParameterTexts,
  resolveModelRequest,
  startLinkedSection,
  switchLinkedAlternative,
} from './parameters.ts';

const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const LINKED = { cylinderSection: 'shared-generatrix', cylinderLinkedStarted: true } as const;
const LEANING = { cylinderOffsetRatio: '0,8' };

const request = (overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices>, exact?: ParameterExact) =>
  resolveModelRequest('cylinder', texts(overrides), choices(chosen), { connectorEdits: {}, ...(exact ? { exact } : {}) });

const cutGroup = (overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices>) => {
  const { values, sectionRanges, connectorStatus } = request(overrides, chosen);
  const panel = shapePanel('cylinder', choices(chosen), { values, sectionRanges, connectorStatus });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Переріз') : undefined;
  if (found === undefined) throw new Error('No cut group');
  return found;
};
const labelsOf = (group: ReturnType<typeof cutGroup>) =>
  group.fields.map((field) => ('label' in field ? field.label : field.key));

describe('a cylinder’s planes through a shared generatrix', () => {
  it('is offered for right and leaning cylinders alike, and starts with two planes 60° apart, off the axis', () => {
    for (const overrides of [{}, LEANING]) {
      const group = cutGroup(overrides, { cylinderSection: 'vertical' });
      const options = (group.fields[0] as unknown as { options: { value: string; label: string }[] }).options;
      expect(options).toContainEqual({ value: 'shared-generatrix', label: 'Через спільну твірну' });
    }
    const result = request({}, LINKED);
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toEqual({
      type: 'shared-generatrix',
      generatrixDeg: 0,
      firstPlaneDeg: -30,
      dihedralDeg: 60,
      otherSide: false,
      third: false,
    });
  });

  it('names what each control changes, with the diagram first and the generatrix among further settings', () => {
    const group = cutGroup({}, LINKED);
    expect(labelsOf(group)).toEqual([
      'Тип перерізу',
      'cylinder-linked-diagram',
      'Кут між площинами',
      'Повернути обидва перерізи',
      'cylinder-linked-pair-note',
      'Перший переріз — осьовий',
      'Додати третій переріз',
      'cylinder-linked-third-note',
      'Додаткові налаштування',
      'Розсунути частини',
    ]);
    // No plate, no parallel second cut, no side checkbox in this mode.
    for (const absent of ['Січна пластина', 'Додати паралельний переріз', 'Інший бік', 'Поворот першої площини']) {
      expect(labelsOf(group)).not.toContain(absent);
    }
    expect(group.fields.find((field) => field.key === 'cylinder-linked-pair-note')).toMatchObject({
      text: '0° — перший переріз проходить через вісь',
    });
    expect(group.fields.find((field) => field.key === 'cylinder-linked-third-note')).toMatchObject({
      text: 'Третя площина проходить через дві інші твірні.',
    });
    const more = group.fields.find((field) => field.key === 'cylinder-linked-more');
    expect(more).toMatchObject({ type: 'disclosure', fields: [{ key: 'cylinderLinkedGeneratrixDeg' }] });
    expect(group.status).toEqual({ text: 'два перерізи', highlighted: true });
    expect(group.help?.text).toContain('Він змінює лише другий переріз');
    const third = cutGroup({}, { ...LINKED, cylinderLinkedThird: true });
    expect(third.status).toEqual({ text: 'три перерізи', highlighted: true });
    expect(request({}, { ...LINKED, cylinderLinkedThird: true }).spec?.section).toMatchObject({ third: true });
  });

  it('keeps each control on a fixed scale, passing over the narrow gaps about the tangent planes only', () => {
    const rangeOf = (overrides: Partial<ParameterTexts>, key: string) =>
      sectionNumberFields(cutGroup(overrides, LINKED)).find((field) => field.key === key)?.range;
    const pair = rangeOf({}, 'cylinderLinkedFirstPlaneDeg');
    expect(pair?.min).toBeLessThan(-85);
    expect(pair?.max).toBeGreaterThan(85);
    // The second plane, 60° from the first, is tangent at a turn of 30°.
    expect(pair?.gaps).toHaveLength(1);
    expect(pair?.gaps?.[0]?.min).toBeLessThan(30);
    expect(pair?.gaps?.[0]?.max).toBeGreaterThan(30);
    expect(pair?.gaps?.[0]?.max).toBeLessThan(35);
    // The dihedral angle reaches down to a fraction of a degree: no former limit such as 73,84–90°.
    const dihedral = rangeOf({ cylinderLinkedFirstPlaneDeg: '-80' }, 'cylinderLinkedDihedralDeg');
    expect(dihedral?.min).toBeLessThan(1);
    expect(rangeOf({}, 'cylinderLinkedDihedralDeg')?.min).toBeLessThan(0.1);
    expect(dihedral?.max).toBe(90);
    // The scale stays as another field changes; only its gap moves with the angle.
    const other = rangeOf({ cylinderLinkedDihedralDeg: '40' }, 'cylinderLinkedFirstPlaneDeg');
    expect(other?.min).toBe(pair?.min);
    expect(other?.max).toBe(pair?.max);
    expect(rangeOf({}, 'cylinderLinkedGeneratrixDeg')).toEqual({ min: 0, max: 360, increment: 5 });
  });

  it('allows thin but valid parts, building them and warning at the export scale', () => {
    const thin = request({ cylinderLinkedFirstPlaneDeg: '-80', cylinderLinkedDihedralDeg: '40' }, LINKED);
    expect(thin.errors).toEqual({});
    expect(thin.spec?.section).toMatchObject({ firstPlaneDeg: -80, dihedralDeg: 40 });
    const note = cutGroup({ cylinderLinkedFirstPlaneDeg: '-80', cylinderLinkedDihedralDeg: '40' }, LINKED).fields.find(
      (field) => field.key === 'cylinder-linked-thin-note',
    );
    expect(note).toMatchObject({ tone: 'status' });
    expect((note as { text: string }).text).toMatch(/^Частина за першим перерізом має завтовшки лише 0,\d+ мм/);
    expect(cutGroup({}, LINKED).fields.some((field) => field.key === 'cylinder-linked-thin-note')).toBe(false);
  });

  it('offers the other second plane only by an explicit action, where it is another valid plane, never at 90°', () => {
    const actionsOf = (overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices> = {}) =>
      labelsOf(cutGroup(overrides, { ...LINKED, ...chosen }));
    // From −30° by 60° the other way the second plane would be the tangent plane.
    expect(actionsOf({})).not.toContain('Інше положення другої площини');
    const turned = { cylinderLinkedFirstPlaneDeg: '0', cylinderLinkedDihedralDeg: '40' };
    expect(actionsOf(turned)).toContain('Інше положення другої площини');
    expect(actionsOf({ ...turned, cylinderLinkedDihedralDeg: '90' })).not.toContain('Інше положення другої площини');
    const state: ParameterState = { texts: texts(turned), choices: choices(LINKED) };
    const switched = switchLinkedAlternative(state);
    expect(switched.texts).toEqual(state.texts);
    expect(switched.choices).toEqual({ ...state.choices, cylinderLinkedOtherSide: true });
    expect(resolveModelRequest('cylinder', switched.texts, switched.choices).spec?.section).toMatchObject({
      firstPlaneDeg: 0,
      dihedralDeg: 40,
      otherSide: true,
    });
  });

  it('never switches the second plane on its own: an invalid turn is refused at the edited control, all else kept', () => {
    // Beyond the second plane's tangent position the same solution goes on.
    expect(request({ cylinderLinkedFirstPlaneDeg: '35' }, LINKED).spec?.section).toMatchObject({
      firstPlaneDeg: 35,
      dihedralDeg: 60,
      otherSide: false,
    });
    // At it, nothing is built, and the problem is said at the control the user changed last.
    const tangent = { cylinderLinkedFirstPlaneDeg: '30' };
    const atPair = resolveModelRequest('cylinder', texts(tangent), choices(LINKED), {
      edited: 'cylinderLinkedFirstPlaneDeg',
    });
    expect(atPair.spec).toBeUndefined();
    expect(atPair.errors).toEqual({ cylinderLinkedFirstPlaneDeg: expect.stringMatching(/^За цього повороту одна з площин/) });
    expect(atPair.errors.cylinderLinkedFirstPlaneDeg).toContain('Інші параметри й положення другої площини не змінено');
    const atDihedral = resolveModelRequest('cylinder', texts(tangent), choices(LINKED), {
      edited: 'cylinderLinkedDihedralDeg',
    });
    expect(Object.keys(atDihedral.errors)).toEqual(['cylinderLinkedDihedralDeg']);
    expect(resolveModelRequest('cylinder', texts({ cylinderLinkedDihedralDeg: '0,01' }), choices(LINKED)).spec).toBeUndefined();
    expect(request({ cylinderLinkedDihedralDeg: '0' }, LINKED).errors.cylinderLinkedDihedralDeg).toBe(
      'Кут має бути більшим за 0° і не більшим за 90°.',
    );
    expect(request({ cylinderLinkedDihedralDeg: '95' }, LINKED).errors.cylinderLinkedDihedralDeg).toBeDefined();
    expect(request({ cylinderLinkedFirstPlaneDeg: '180' }, LINKED).errors.cylinderLinkedFirstPlaneDeg).toBeDefined();
  });

  it('turns the pair so that the first plane is axial, keeping the angle and the solution', () => {
    const state: ParameterState = { texts: texts(), choices: choices(LINKED), exact: { cylinderLinkedFirstPlaneDeg: -30 } };
    const group = cutGroup({}, LINKED);
    expect(group.fields.find((field) => field.key === 'cylinder-linked-axial')).not.toHaveProperty('disabled');
    const axial = linkedAxial(state);
    expect(axial.texts.cylinderLinkedFirstPlaneDeg).toBe('0');
    expect(axial.exact?.cylinderLinkedFirstPlaneDeg).toBeUndefined();
    expect(resolveModelRequest('cylinder', axial.texts, axial.choices).spec?.section).toMatchObject({
      firstPlaneDeg: 0,
      dihedralDeg: 60,
      otherSide: false,
    });
    expect(
      cutGroup({ cylinderLinkedFirstPlaneDeg: '0' }, LINKED).fields.find((field) => field.key === 'cylinder-linked-axial'),
    ).toMatchObject({ disabled: true });
  });

  it('draws the lower base with the same points as the 3D construction, and highlights what a control changes', () => {
    const diagramOf = (overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices> = {}) =>
      (
        cutGroup(overrides, { ...LINKED, ...chosen }).fields.find(
          (field) => field.type === 'linked-diagram',
        ) as LinkedDiagramField
      ).diagram;
    const shown = diagramOf({}, { cylinderLinkedThird: true });
    expect(shown?.a.x).toBeCloseTo(1, 9);
    expect(shown?.b.x).toBeCloseTo(-0.5, 9);
    expect(shown?.b.y).toBeCloseTo(Math.sqrt(3) / 2, 9);
    expect(shown?.c.y).toBeCloseTo(-Math.sqrt(3) / 2, 9);
    expect(shown?.third).toBe(true);
    expect(shown?.alternative).toBeUndefined();
    // The diagram's points are those of the engine's planes, on an oblique cylinder too.
    const { values } = request(LEANING, LINKED);
    const shape = { kind: 'cylinder', heightRatio: values.cylinderHeightRatio as number, offsetRatio: 0.8 } as const;
    const scale = { longestDimensionMm: values.printSizeMm as number };
    const planes = { generatrixDeg: 0, firstPlaneDeg: -30, dihedralDeg: 60, otherSide: false, third: false };
    const [, b, c] = linkedCylinder(shape, scale, planes).points;
    const radius = roundDimensionsMm(shape, scale).radius;
    const leaning = diagramOf(LEANING);
    expect(leaning?.b.x).toBeCloseTo((b?.[0] ?? 0) / radius, 9);
    expect(leaning?.c.y).toBeCloseTo((c?.[1] ?? 0) / radius, 9);
    expect(diagramOf({ cylinderLinkedFirstPlaneDeg: '0', cylinderLinkedDihedralDeg: '40' })?.alternative).toBeDefined();
    // An invalid construction leaves the diagram to keep the last valid one.
    expect(diagramOf({ cylinderLinkedFirstPlaneDeg: '30' })).toBeUndefined();
    const panel = shapePanel('cylinder', choices(LINKED), { values: request({}, LINKED).values });
    expect(previewHighlightOf(panel, 'cylinderLinkedDihedralDeg')).toEqual({
      materials: ['plane-2', 'guide-CC1'],
      labels: ['C', 'C1'],
    });
    expect(previewHighlightOf(panel, 'cylinderLinkedGeneratrixDeg')).toEqual({ materials: ['guide-AA1'], labels: ['A', 'A1'] });
    expect(previewHighlightOf(panel, 'cylinderLinkedFirstPlaneDeg')?.materials).toEqual(
      expect.arrayContaining(['plane-1', 'plane-2']),
    );
    expect(previewHighlightOf(panel, 'cylinderPartsSeparated')).toBeUndefined();
  });

  it('starts a leaning cylinder’s planes from its own generatrices 120° apart, keeping the exact angles behind the texts', () => {
    const state: ParameterState = {
      texts: texts({ ...LEANING, cylinderLinkedGeneratrixDeg: '30' }),
      choices: choices({ cylinderSection: 'shared-generatrix' }),
    };
    const { values } = resolveModelRequest('cylinder', state.texts, state.choices);
    const started = startLinkedSection(state, values) as ParameterState;
    const shape = { kind: 'cylinder', heightRatio: values.cylinderHeightRatio as number, offsetRatio: 0.8 } as const;
    const start = linkedStart(shape, { longestDimensionMm: values.printSizeMm as number }, 30);
    expect(started.choices.cylinderLinkedStarted).toBe(true);
    expect(started.exact?.cylinderLinkedFirstPlaneDeg).toBeCloseTo(start.firstPlaneDeg, 8);
    expect(started.exact?.cylinderLinkedDihedralDeg).toBeCloseTo(start.dihedralDeg, 8);
    expect(started.exact?.cylinderLinkedDihedralDeg).not.toBeCloseTo(60, 2);
    expect(started.texts.cylinderLinkedGeneratrixDeg).toBe('30');
    // Started once: a later change of the cylinder keeps the planes' fields, and with them their relations to it.
    expect(startLinkedSection(started, values)).toBeUndefined();
    const result = resolveModelRequest('cylinder', started.texts, started.choices, { exact: started.exact });
    expect(result.errors).toEqual({});
    expect(result.spec?.section).toMatchObject({ generatrixDeg: 30 });
    expect((result.spec?.section as { dihedralDeg: number } | undefined)?.dihedralDeg).toBeCloseTo(start.dihedralDeg, 8);
    const steeper = resolveModelRequest('cylinder', { ...started.texts, cylinderOffsetRatio: '0,4' }, started.choices, {
      exact: started.exact,
    });
    expect(steeper.spec?.section).toMatchObject({
      firstPlaneDeg: started.exact?.cylinderLinkedFirstPlaneDeg,
      dihedralDeg: started.exact?.cylinderLinkedDihedralDeg,
    });
  });

  it('keeps the other sections’ settings while it is chosen, and its own when another is', () => {
    const moved = { cylinderSectionOffsetPercent: '20', cylinderLinkedDihedralDeg: '45' };
    expect(request(moved, { cylinderSection: 'vertical' }).spec?.section).toMatchObject({ type: 'vertical', offsetPercent: 20 });
    expect(request(moved, LINKED).spec?.section).toMatchObject({ dihedralDeg: 45 });
  });

  it('fits one connector to every plane and says at which plane it does not fit', () => {
    const dovetail = { cylinderConnector: 'dovetail' } as const;
    const joined = request({}, { ...LINKED, ...dovetail, cylinderLinkedThird: true });
    expect(joined.errors).toEqual({});
    expect(joined.spec?.section).toMatchObject({ third: true, connector: { type: 'dovetail', ...DEFAULT_DOVETAIL } });
    const dowels = request({}, { ...LINKED, cylinderConnector: 'dowel', cylinderLinkedThird: true });
    expect(dowels.connectorStatus?.unavailable).toBeUndefined();
    expect(dowels.spec?.section?.connector?.type).toBe('dowel');
    const group = cutGroup({}, { ...LINKED, cylinderConnector: 'dowel' });
    expect(group.status?.text).toBe('два перерізи');
    // Magnets too thick for the thin part beyond the first plane: refused at that plane, the settings kept.
    const thin = { cylinderLinkedFirstPlaneDeg: '-50', cylinderLinkedDihedralDeg: '30', cylinderMagnetThicknessMm: '12' };
    const magnets = request(thin, { ...LINKED, cylinderConnector: 'magnet' });
    expect(magnets.connectorStatus?.unavailable).toMatch(
      /^Біля першого перерізу: Магніти задовгі для цього перерізу: відрізана частина/,
    );
  });
});
