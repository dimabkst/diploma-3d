import { describe, expect, it } from 'vitest';
import { shapePanel } from '../shapes.ts';
import {
  addSecondCut,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  removeSecondCut,
  resolveModelRequest,
  twistAvailable,
} from './parameters.ts';

type Kind = 'cylinder' | 'cone';
const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const request = (kind: Kind, state: ParameterState) =>
  resolveModelRequest(kind, state.texts, state.choices, { connectorEdits: {}, exact: state.exact });

const cutGroup = (kind: Kind, state: ParameterState) => {
  const { values, sectionRanges, connectorStatus } = request(kind, state);
  const panel = shapePanel(kind, state.choices, { values, sectionRanges, connectorStatus });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Переріз') : undefined;
  if (found === undefined) throw new Error('No cut group');
  return found;
};
const labelsOf = (group: ReturnType<typeof cutGroup>) =>
  group.fields.map((field) => ('label' in field ? field.label : field.key));

/** The state with the second plane added the way the button adds it. */
const added = (kind: Kind, state: ParameterState): ParameterState => addSecondCut(kind, state, request(kind, state).values);

const CASES: [string, Kind, Partial<ParameterTexts>, Partial<ParameterChoices>][] = [
  ['a right cylinder parallel to its bases', 'cylinder', {}, { cylinderSection: 'parallel-to-bases' }],
  ['a right cylinder through its axis', 'cylinder', {}, { cylinderSection: 'vertical' }],
  [
    'an oblique cylinder parallel to its axis',
    'cylinder',
    { cylinderOffsetRatio: '0,8', cylinderAxisDirectionDeg: '90' },
    { cylinderSection: 'axis-parallel' },
  ],
  ['an oblique cylinder by an inclined plane', 'cylinder', { cylinderOffsetRatio: '0,8' }, { cylinderSection: 'oblique' }],
  ['a right cone parallel to its base', 'cone', {}, { coneSection: 'parallel-to-bases' }],
  ['an oblique cone parallel to its base', 'cone', { coneOffsetRatio: '0,7' }, { coneSection: 'parallel-to-bases' }],
  [
    'a cone through its apex',
    'cone',
    { coneApexInclinationDeg: '80', coneApexDirectionDeg: '0' },
    { coneSection: 'oblique-apex', coneApexStarted: true },
  ],
];

describe('a second plane parallel to a cylinder’s or a cone’s section', () => {
  it.each(CASES)('is added to %s at a valid, distinct position, the first plane kept, and removed again', (_name, kind, t, c) => {
    const state: ParameterState = { texts: texts(t), choices: choices(c) };
    const single = request(kind, state);
    expect(single.errors).toEqual({});
    expect(labelsOf(cutGroup(kind, state))).toContain('Додати паралельний переріз');
    const two = added(kind, state);
    const paired = request(kind, two);
    expect(paired.errors).toEqual({});
    // The first plane's fields are those of the single cut; the second takes its own position.
    expect(paired.spec?.section).toEqual({
      ...single.spec?.section,
      secondPositionPercent: expect.any(Number),
    });
    expect(paired.spec?.shape).toEqual(single.spec?.shape);
    expect(paired.spec?.scale).toEqual(single.spec?.scale);
    const group = cutGroup(kind, two);
    expect(group.status).toMatchObject({ text: 'два перерізи' });
    const labels = labelsOf(group);
    expect(labels[1]).toBe('Перший переріз');
    expect(labels).toContain('Другий переріз: положення');
    expect(labels).toContain('Прибрати другий переріз');
    expect(labels).not.toContain('Додати паралельний переріз');
    expect(group.fields.find((field) => field.type === 'section-mark')).toMatchObject({ tone: 0 });
    expect(group.fields.find((field) => field.type === 'number' && field.label === 'Другий переріз: положення')).toMatchObject({
      sectionTone: 1,
      range: { min: 10, max: 90, increment: 5 },
    });
    // Removing it leaves the first plane exactly as it was.
    expect(request(kind, removeSecondCut(kind, two)).spec).toEqual(single.spec);
  });

  it('starts the second plane halfway between the first and the farther end, on either side', () => {
    const at = (position: string) =>
      added('cylinder', {
        texts: texts({ cylinderSectionPercent: position }),
        choices: choices({ cylinderSection: 'parallel-to-bases' }),
      }).texts.cylinderSectionSecondPercent;
    expect(at('50')).toBe('70');
    expect(at('30')).toBe('60');
    expect(at('80')).toBe('45');
  });

  it('takes the second plane on either side of the first, and refuses it too close, at its own field', () => {
    const base = choices({ cylinderSection: 'parallel-to-bases', cylinderSecondCut: true });
    for (const second of ['20', '80']) {
      expect(
        request('cylinder', {
          texts: texts({ cylinderSectionPercent: '50', cylinderSectionSecondPercent: second }),
          choices: base,
        }).spec?.section,
      ).toMatchObject({ positionPercent: 50, secondPositionPercent: Number(second) });
    }
    const close = request('cylinder', {
      texts: texts({ cylinderSectionPercent: '50', cylinderSectionSecondPercent: '52' }),
      choices: base,
    });
    expect(close.spec).toBeUndefined();
    expect(Object.keys(close.errors)).toEqual(['cylinderSectionSecondPercent']);
    expect(close.errors.cylinderSectionSecondPercent).toMatch(/^Одна з частин біля другого перерізу була б завтовшки лише/);
    // An invalid draft blocks the model like any other field, and keeps the text.
    const draft = request('cylinder', { texts: texts({ cylinderSectionSecondPercent: 'abc' }), choices: base });
    expect(draft.spec).toBeUndefined();
    expect(draft.errors.cylinderSectionSecondPercent).toBeDefined();
  });

  it('offers no plate beside two planes, and no second plane beside a plate', () => {
    const plated = { texts: texts(), choices: choices({ coneSection: 'parallel-to-bases', conePlate: true }) };
    const group = cutGroup('cone', plated);
    expect(group.fields.find((field) => field.key === 'cone-add-second-cut')).toMatchObject({ disabled: true });
    expect(labelsOf(group)).toContain('cone-second-cut-plate');
    const two = cutGroup('cone', { texts: texts(), choices: choices({ coneSection: 'parallel-to-bases', coneSecondCut: true }) });
    expect(two.fields.find((field) => field.key === 'conePlate')).toMatchObject({ disabled: true });
    expect(
      request('cone', {
        texts: texts(),
        choices: choices({ coneSection: 'parallel-to-bases', coneSecondCut: true, conePlate: true }),
      }).spec?.section,
    ).not.toHaveProperty('plate');
  });

  it('joins the parts at both planes with one connector, offers no twist, and adds no plane to a shared generatrix', () => {
    const two = choices({ cylinderSection: 'parallel-to-bases', cylinderSecondCut: true, cylinderConnector: 'dowel' });
    const joined = request('cylinder', {
      texts: texts({ cylinderSectionPercent: '30', cylinderSectionSecondPercent: '70' }),
      choices: two,
    });
    expect(joined.errors).toEqual({});
    expect(joined.connectorStatus?.unavailable).toBeUndefined();
    expect(joined.spec?.section?.connector?.type).toBe('dowel');
    expect(twistAvailable('cylinder', two, joined.values)).toBe(false);
    expect(twistAvailable('cylinder', { ...two, cylinderSecondCut: false }, joined.values)).toBe(true);
    const linked = cutGroup('cylinder', {
      texts: texts(),
      choices: choices({ cylinderSection: 'shared-generatrix', cylinderLinkedStarted: true, cylinderSecondCut: true }),
    });
    expect(labelsOf(linked)).not.toContain('Додати паралельний переріз');
    expect(labelsOf(linked)).not.toContain('Другий переріз: положення');
  });
});
