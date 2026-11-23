import { axialApexAngles } from '@diploma-3d/engine';
import { describe, expect, it } from 'vitest';
import { sectionNumberFields, shapePanel } from '../shapes.ts';
import {
  axialAxisParallel,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  resolveModelRequest,
} from './parameters.ts';

const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const LEANING = { cylinderOffsetRatio: '0,8' };

const cutGroup = (kind: 'cylinder' | 'cone', overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices>) => {
  const { values, sectionRanges } = resolveModelRequest(kind, texts(overrides), choices(chosen), { connectorEdits: {} });
  const panel = shapePanel(kind, choices(chosen), { values, sectionRanges });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === 'Переріз') : undefined;
  if (found === undefined) throw new Error('No cut group');
  return found;
};
const optionsOf = (group: ReturnType<typeof cutGroup>) =>
  (group.fields[0] as unknown as { options: { value: string }[] }).options.map((option) => option.value);

describe('a plane parallel to a cylinder’s axis', () => {
  it('is offered for a leaning cylinder, where it differs from the vertical cut, and not for a right one', () => {
    expect(optionsOf(cutGroup('cylinder', {}, { cylinderSection: 'vertical' }))).toEqual([
      'none',
      'parallel-to-bases',
      'vertical',
      'oblique',
    ]);
    expect(optionsOf(cutGroup('cylinder', LEANING, { cylinderSection: 'vertical' }))).toContain('axis-parallel');
  });

  it('takes an offset and a direction, with the axial section a click away, and keeps its meaning as the cylinder changes', () => {
    const chosen = { cylinderSection: 'axis-parallel' } as const;
    const moved = { ...LEANING, cylinderAxisOffsetPercent: '30', cylinderAxisDirectionDeg: '45' };
    const request = resolveModelRequest('cylinder', texts(moved), choices(chosen));
    expect(request.errors).toEqual({});
    expect(request.spec?.section).toEqual({ type: 'axis-parallel', offsetPercent: 30, directionDeg: 45 });
    const group = cutGroup('cylinder', moved, chosen);
    expect(group.fields.map((field) => ('label' in field ? field.label : field.key))).toEqual([
      'Тип перерізу',
      'Зміщення від осі',
      'Напрям зміщення',
      'Осьовий переріз',
      'Розсунути частини',
      'Січна пластина',
    ]);
    expect(group.status).toEqual({ text: 'паралельно осі', highlighted: true });
    expect(group.help?.text).toContain('не обов’язково вертикальна');
    expect(sectionNumberFields(group)[0]?.range).toEqual({ min: -80, max: 80, increment: 5 });
    expect(group.fields.find((field) => field.key === 'cylinder-axial-section')).toMatchObject({ action: 'axial-section' });
    // The preset moves the plane onto the axis and keeps its direction.
    const state: ParameterState = { texts: texts(moved), choices: choices(chosen) };
    const axial = axialAxisParallel('cylinder', state);
    expect(axial.texts).toMatchObject({ cylinderAxisOffsetPercent: '0', cylinderAxisDirectionDeg: '45' });
    const axialGroup = cutGroup('cylinder', { ...moved, cylinderAxisOffsetPercent: '0' }, chosen);
    expect(axialGroup.status).toEqual({ text: 'осьовий', highlighted: true });
    expect(axialGroup.fields.find((field) => field.key === 'cylinder-axial-section')).toMatchObject({ disabled: true });
    // A new height or lean keeps the stored offset and direction, relative to the axis.
    const changed = resolveModelRequest(
      'cylinder',
      texts({ ...moved, cylinderHeightRatio: '3', cylinderOffsetRatio: '1,2' }),
      choices(chosen),
    );
    expect(changed.spec?.section).toEqual({ type: 'axis-parallel', offsetPercent: 30, directionDeg: 45 });
  });

  it('refuses an offset beyond what leaves both parts usable in that direction', () => {
    const request = resolveModelRequest(
      'cylinder',
      texts({ ...LEANING, cylinderAxisOffsetPercent: '85' }),
      choices({ cylinderSection: 'axis-parallel' }),
    );
    expect(request.errors.cylinderAxisOffsetPercent).toMatch(/^За цього напряму допустимо від -80 % до 80 %/);
    expect(request.spec).toBeUndefined();
  });

  it('takes a connector like the vertical cut', () => {
    const request = resolveModelRequest(
      'cylinder',
      texts(LEANING),
      choices({ cylinderSection: 'axis-parallel', cylinderConnector: 'dowel' }),
      { connectorEdits: {} },
    );
    expect(request.errors).toEqual({});
    expect(request.spec?.section).toMatchObject({ type: 'axis-parallel', connector: { type: 'dowel' } });
  });
});

describe('the axial section of a cone', () => {
  const apex = { coneSection: 'oblique-apex', coneApexStarted: true } as const;
  const leaning = { coneOffsetRatio: '0,7', coneApexInclinationDeg: '80', coneApexDirectionDeg: '30' };

  it('is a switch in the plane through the apex: the angle follows from the cone, the direction stays the user’s', () => {
    const plain = cutGroup('cone', leaning, apex);
    expect(plain.fields.map((field) => field.key)).toContain('coneApexInclinationDeg');
    expect(plain.fields.find((field) => field.key === 'coneApexAxial')).toMatchObject({ label: 'Осьовий переріз' });
    const request = resolveModelRequest('cone', texts(leaning), choices({ ...apex, coneApexAxial: true }));
    expect(request.errors).toEqual({});
    const shape = request.spec?.shape as { kind: 'cone'; heightRatio: number; offsetRatio: number };
    expect(request.spec?.section).toEqual({ type: 'oblique-apex', axial: true, ...axialApexAngles(shape, 30) });
    const group = cutGroup('cone', leaning, { ...apex, coneApexAxial: true });
    expect(group.fields.map((field) => field.key)).not.toContain('coneApexInclinationDeg');
    expect(group.fields).toContainEqual(
      expect.objectContaining({
        text: expect.stringMatching(/^Площина проходить через вершину й центр основи, кут до площини основи — \d/),
      }),
    );
    expect(group.status).toEqual({ text: 'осьовий', highlighted: true });
  });

  it('stays axial when the cone changes, and turned off returns to the user’s own angle', () => {
    const taller = resolveModelRequest(
      'cone',
      texts({ ...leaning, coneHeightRatio: '3' }),
      choices({ ...apex, coneApexAxial: true }),
    );
    const shape = taller.spec?.shape as { kind: 'cone'; heightRatio: number; offsetRatio: number };
    expect(taller.spec?.section).toMatchObject(axialApexAngles(shape, 30));
    const off = resolveModelRequest('cone', texts(leaning), choices(apex));
    expect(off.spec?.section).toEqual({ type: 'oblique-apex', inclinationDeg: 80, directionDeg: 30 });
  });
});
