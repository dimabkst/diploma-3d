import { boxPlane, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { sectionNumberFields, shapePanel } from '../shapes.ts';
import { type BoxKeysOf, type BoxSolid, boxContextOf, boxKeysOf, type ThroughLineChoices, throughLineSelection } from './box.ts';
import {
  addSecondCut,
  canResetShapeParameters,
  followNormal,
  followTrace,
  initialParameterChoices,
  initialParameterTexts,
  normalAlongLateral,
  normalAlongManual,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  pointAtMidpoint,
  removeSecondCut,
  resetShapeParameters,
  resolveModelRequest,
  settleBoxChoices,
  startLineAngle,
  startPoint,
  throughHeightFoot,
  traceThrough,
} from './parameters.ts';

const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const request = (kind: BoxSolid, overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices>) =>
  resolveModelRequest(kind, texts(overrides), choices(chosen), { connectorEdits: {} });
/** The state after the app's effects: the choices settled, and every start and trace applied, until nothing changes. */
const settled = (kind: BoxSolid, state: ParameterState): ParameterState => {
  let current = state;
  for (let round = 0; round < 10; round += 1) {
    const { values } = resolveModelRequest(kind, current.texts, current.choices, {
      exact: current.exact ?? {},
      connectorEdits: {},
    });
    const next =
      settleBoxChoices(kind, current, values) ??
      startLineAngle(kind, current, values) ??
      startPoint(kind, current, values) ??
      followTrace(kind, current, values) ??
      followNormal(kind, current, values);
    if (next === undefined) return current;
    current = next;
  }
  throw new Error('The effects did not settle.');
};
const groupOf = (kind: BoxSolid, title: string, overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices>) => {
  const { values, sectionRanges, connectorStatus } = request(kind, overrides, chosen);
  const panel = shapePanel(kind, choices(chosen), { values, sectionRanges, connectorStatus });
  const found = panel.type === 'parameters' ? panel.sections.find((group) => group.title === title) : undefined;
  if (found === undefined) throw new Error(`No ${title}`);
  return found;
};
const labels = (group: ReturnType<typeof groupOf>) =>
  group.fields.map((field) => ('label' in field ? field.label : 'text' in field ? field.text : field.key));
const optionsOf = (group: ReturnType<typeof groupOf>, key: string) =>
  (group.fields.find((field) => field.key === key) as unknown as { options: { value: string; label: string }[] }).options;

describe('the sections of a cube and the parallelepipeds', () => {
  it('are offered by each of them, the cube included, by their four modes', () => {
    for (const kind of ['cube', 'cuboid', 'parallelepiped'] as const) {
      const group = groupOf(kind, 'Переріз', {}, {});
      expect(optionsOf(group, `${kind}Section`).map((option) => option.label)).toEqual([
        'Без перерізу',
        'Паралельно грані',
        'Поздовжній',
        'Через ребро або діагональ',
        'Похилий',
      ]);
      expect(request(kind, {}, {}).spec?.section).toBeUndefined();
    }
    expect(shapePanel('cube', choices()).type).toBe('parameters');
  });

  it('a plane parallel to a face: the face by its letters, the position from it, the lower base at first', () => {
    const chosen = { cubeSection: 'face-parallel' } as const;
    const group = groupOf('cube', 'Переріз', { cubeSectionPercent: '30' }, chosen);
    expect(labels(group)).toEqual([
      'Тип перерізу',
      'Паралельно грані',
      'Від грані ABCD',
      'Додати паралельний переріз',
      'Розсунути частини',
    ]);
    expect(optionsOf(group, 'cubeFace').map((option) => option.label)).not.toContain('A₁B₁C₁D₁ — верхня основа');
    expect(request('cube', { cubeSectionPercent: '30' }, chosen).spec?.section).toEqual({
      type: 'face-parallel',
      face: 'ABCD',
      positionPercent: 30,
    });
    expect(group.status).toEqual({ text: 'паралельно грані', highlighted: true });
  });

  it('a longitudinal plane: at an angle to AB, or through a diagonal, then parallel to it once moved', () => {
    const chosen = { cuboidSection: 'longitudinal' } as const;
    expect(request('cuboid', { cuboidTraceAngleDeg: '30', cuboidSectionPercent: '40' }, chosen).spec?.section).toEqual({
      type: 'longitudinal',
      trace: 'angle',
      traceAngleDeg: 30,
      positionPercent: 40,
    });
    const diagonal = settled('cuboid', {
      texts: texts({ cuboidSectionPercent: '40' }),
      choices: choices({ ...chosen, cuboidTrace: 'diagonal', cuboidTraceSegment: 'B-D' }),
    });
    expect(diagonal.choices.cuboidTraceThrough).toBe(true);
    expect(diagonal.texts.cuboidSectionPercent).toBe('50');
    const group = groupOf('cuboid', 'Переріз', diagonal.texts, diagonal.choices);
    expect(group.status).toEqual({ text: 'діагональний', highlighted: true });
    expect(labels(group)).toContain('Діагональний переріз: площина проходить через діагональ BD і бічні ребра BB₁ та DD₁.');
    // The plane stays through the diagonal whatever the cuboid becomes.
    const taller = settled('cuboid', { ...diagonal, texts: { ...diagonal.texts, cuboidHeightRatio: '3' } });
    expect(request('cuboid', taller.texts, taller.choices).spec?.section).toEqual({
      type: 'longitudinal',
      trace: 'diagonal',
      traceAngleDeg: 0,
      traceSegment: ['B', 'D'],
      through: true,
      positionPercent: 50,
    });
    // Moved away, it is parallel to the diagonal, no longer through it, until passed through it again.
    const moved = settled('cuboid', { ...diagonal, texts: { ...diagonal.texts, cuboidSectionPercent: '65' } });
    expect(moved.choices.cuboidTraceThrough).toBe(false);
    const apart = groupOf('cuboid', 'Переріз', moved.texts, moved.choices);
    expect(apart.status).toEqual({ text: 'поздовжній', highlighted: true });
    expect(labels(apart)).toContain('Площина паралельна діагоналі BD, але не проходить через неї.');
    expect(request('cuboid', moved.texts, moved.choices).spec?.section).toMatchObject({ positionPercent: 65 });
    const again = settled('cuboid', traceThrough('cuboid', moved));
    expect(again.texts.cuboidSectionPercent).toBe('50');
  });

  it('a plane through an edge by its angle starts in the middle of the usable angles, once per line', () => {
    const chosen = { cubeSection: 'through-line' } as const;
    const state: ParameterState = { texts: texts({ cubeLineAngleDeg: '10' }), choices: choices(chosen) };
    const values = request('cube', {}, chosen).values;
    const started = startLineAngle('cube', state, values) as ParameterState;
    expect(started.texts.cubeLineAngleDeg).toBe('45');
    expect(started.choices.cubeLineAngleFor).toBe('ABCD:A-B');
    expect(startLineAngle('cube', { ...started, texts: { ...started.texts, cubeLineAngleDeg: '60' } }, values)).toBeUndefined();
    const result = request('cube', started.texts, started.choices);
    expect(result.spec?.section).toEqual({
      type: 'through-line',
      face: 'ABCD',
      line: ['A', 'B'],
      method: 'angle',
      angleDeg: 45,
    });
    const group = groupOf('cube', 'Переріз', started.texts, started.choices);
    expect(labels(group)).toContain('Кут повороту від грані ABCD');
    expect(labels(group)).not.toContain('Кут до основи');
    const angle = sectionNumberFields(group).find((field) => field.key === 'cubeLineAngleDeg');
    expect(angle?.range?.min).toBeGreaterThan(0);
    expect(angle?.range?.max).toBeLessThan(90);
    // Beyond the adjacent face the plane no longer cuts the cube.
    expect(request('cube', { cubeLineAngleDeg: '95' }, chosen).errors.cubeLineAngleDeg).toMatch(
      /^За цього кута одна з частин була б надто тонкою\. Для прямої AB допустимо від \d/,
    );
  });

  it('keeps the line and the point’s edge to the chosen face, and offers its edges and diagonals', () => {
    const state: ParameterState = {
      texts: texts(),
      choices: choices({ parallelepipedSection: 'through-line', parallelepipedLineFace: 'BCC1B1' }),
    };
    const values = request('parallelepiped', {}, state.choices).values;
    const settled = settleBoxChoices('parallelepiped', state, values) as ParameterState;
    expect(settled.choices.parallelepipedLine).toBe('B-C');
    // Every point of DA gives the base through BC; the first edge that gives another plane takes its place.
    expect(settled.choices.parallelepipedPointEdge).toBe('D1-A1');
    expect(settleBoxChoices('parallelepiped', settled, values)).toBeUndefined();
    const group = groupOf('parallelepiped', 'Переріз', {}, settled.choices);
    expect(optionsOf(group, 'parallelepipedLine').map((option) => option.label)).toEqual([
      'Ребро BC',
      'Ребро CC₁',
      'Ребро C₁B₁',
      'Ребро B₁B',
      'Діагональ BC₁',
      'Діагональ CB₁',
    ]);
  });

  it('a plane through an edge and a point of another: the midpoint a click away, a point on the line refused', () => {
    const chosen = { cubeSection: 'through-line', cubeLineMethod: 'point' } as const;
    const state: ParameterState = { texts: texts({ cubePointPercent: '20' }), choices: choices(chosen) };
    const middle = pointAtMidpoint('cube', state);
    expect(middle.texts.cubePointPercent).toBe('50');
    expect(request('cube', middle.texts, chosen).spec?.section).toEqual({
      type: 'through-line',
      face: 'ABCD',
      line: ['A', 'B'],
      method: 'point',
      pointEdge: ['C', 'C1'],
      pointPercent: 50,
    });
    const group = groupOf('cube', 'Переріз', middle.texts, chosen);
    expect(labels(group)).toContain('Точка на CC₁ від C');
    expect(group.fields.find((field) => field.key === 'cube-line-midpoint')).toMatchObject({ disabled: true });
    // A on AA1 lies on the diagonal AC itself.
    const onLine = request('cube', { cubePointPercent: '0' }, { ...chosen, cubeLine: 'A-C', cubePointEdge: 'A-A1' });
    expect(onLine.errors.cubePointPercent).toMatch(/^Точка на ребрі AA₁ лежить на прямій AC, тож площину не визначено/);
    expect(onLine.spec).toBeUndefined();
  });

  it('an inclined plane by its angles, or perpendicular to an edge or a diagonal from the collapsed further way', () => {
    const chosen = { cubeSection: 'inclined' } as const;
    expect(request('cube', { cubePlaneInclinationDeg: '30', cubePlaneDirectionDeg: '120' }, chosen).spec?.section).toEqual({
      type: 'inclined',
      inclinationDeg: 30,
      directionDeg: 120,
      positionPercent: 50,
    });
    const group = groupOf('cube', 'Переріз', {}, chosen);
    const further = group.fields.find((field) => field.key === 'cube-normal-along') as unknown as {
      label: string;
      fields: { key: string; options?: { label: string }[] }[];
    };
    expect(further.label).toBe('Перпендикулярно ребру або діагоналі');
    const segments = (further.fields[0]?.options ?? []).map((option) => option.label);
    expect(segments).toContain('Бічні ребра');
    expect(segments).not.toContain('Ребро AA₁');
    expect(segments).toContain('Діагональ грані AC');
    expect(segments).toContain('Діагональ тіла AC₁');
    // Not chosen, the lateral edges as one, the eight base edges, twelve face diagonals and four body diagonals.
    expect(segments).toHaveLength(1 + 1 + 8 + 12 + 4);
    // The triangle near the corner A, perpendicular to the body diagonal.
    const perpendicular = { ...chosen, cubeNormalAlong: 'A-C1' } as const;
    const triangle = request('cube', { cubeSectionPercent: '16' }, perpendicular);
    expect(triangle.errors).toEqual({});
    expect(triangle.spec?.section).toMatchObject({ type: 'inclined', normalAlong: ['A', 'C1'], positionPercent: 16 });
    expect(labels(groupOf('cube', 'Переріз', {}, perpendicular))).toContain('Площина перпендикулярна до відрізка AC₁.');
  });

  it('refuses a position that leaves a part thinner than its tenth of the extent, with the positions allowed', () => {
    const tooFar = request('cube', { cubeSectionPercent: '95' }, { cubeSection: 'face-parallel' });
    expect(tooFar.errors.cubeSectionPercent).toBe('Допустимі значення — від 10 % до 90 %.');
    // A small solid keeps both parts at least 1,2 mm thick: the positions narrow.
    const small = request('cube', { printSizeMm: '10', cubeSectionPercent: '11' }, { cubeSection: 'face-parallel' });
    expect(small.sectionRanges?.cubeSectionPercent).toEqual({ min: 12, max: 88 });
    expect(small.errors.cubeSectionPercent).toMatch(/^Допустимі значення — від 12 % до 88 %: усі частини/);
  });
});

describe('a second parallel plane of a box', () => {
  it('starts halfway between the first plane and the farther end, and gives three parts', () => {
    const chosen = { cubeSection: 'face-parallel' } as const;
    const at = (first: string) => {
      const state: ParameterState = { texts: texts({ cubeSectionPercent: first }), choices: choices(chosen) };
      const added = addSecondCut('cube', state, request('cube', state.texts, chosen).values);
      expect(added.choices.cubeSecondCut).toBe(true);
      return added.texts.cubeSectionSecondPercent;
    };
    expect(at('50')).toBe('70');
    expect(at('30')).toBe('60');
    expect(at('80')).toBe('45');
    const two = request('cube', { cubeSectionPercent: '30', cubeSectionSecondPercent: '60' }, { ...chosen, cubeSecondCut: true });
    expect(two.spec?.section).toEqual({ type: 'face-parallel', face: 'ABCD', positionPercent: 30, secondPositionPercent: 60 });
    const group = groupOf('cube', 'Переріз', { cubeSectionPercent: '30' }, { ...chosen, cubeSecondCut: true });
    expect(labels(group)).toEqual([
      'Тип перерізу',
      'Паралельно грані',
      'Перший переріз: від грані ABCD',
      'Другий переріз: положення',
      'Прибрати другий переріз',
      'Розсунути частини',
    ]);
    expect(group.status).toEqual({ text: 'два перерізи', highlighted: true });
    const removed = removeSecondCut('cube', { texts: texts(), choices: choices({ ...chosen, cubeSecondCut: true }) });
    expect(request('cube', removed.texts, removed.choices).spec?.section).toEqual({
      type: 'face-parallel',
      face: 'ABCD',
      positionPercent: 50,
    });
  });

  it('beside a plane through a line, starts from where the line puts the first plane', () => {
    const chosen = { cubeSection: 'through-line', cubeLineFace: 'ABB1A1', cubeLine: 'A-B1' } as const;
    const state: ParameterState = { texts: texts({ cubeLineAngleDeg: '90' }), choices: choices(chosen) };
    // The diagonal section AB1C1D passes through the cube's centre: 50 %, so the second plane starts at 70 %.
    const added = addSecondCut('cube', state, request('cube', state.texts, chosen).values);
    expect(added.texts.cubeSectionSecondPercent).toBe('70');
  });

  it('refuses a middle part that is too thin, on the second plane’s field', () => {
    const close = request(
      'cube',
      { cubeSectionPercent: '50', cubeSectionSecondPercent: '55' },
      { cubeSection: 'face-parallel', cubeSecondCut: true },
    );
    expect(close.errors.cubeSectionSecondPercent).toMatch(/^Перерізи надто близько: середня частина має завтовшки 4 мм/);
    expect(close.spec).toBeUndefined();
  });

  it('fits a dowel to both planes, and says which plane cannot take magnets', () => {
    const chosen = { cubeSection: 'face-parallel', cubeSecondCut: true } as const;
    const dowels = request(
      'cube',
      { cubeSectionPercent: '30', cubeSectionSecondPercent: '70' },
      { ...chosen, cubeConnector: 'dowel' },
    );
    expect(dowels.errors).toEqual({});
    expect(dowels.connectorStatus?.unavailable).toBeUndefined();
    expect(dowels.spec?.section).toMatchObject({ secondPositionPercent: 70, connector: { type: 'dowel' } });
    const thin = request(
      'cube',
      // At 60 mm the middle part is 6,6 mm thick: two pockets 3,1 mm deep leave 0,4 mm between them.
      { printSizeMm: '60', cubeSectionPercent: '45', cubeSectionSecondPercent: '56', cubeMagnetThicknessMm: '3' },
      { ...chosen, cubeConnector: 'magnet' },
    );
    expect(thin.connectorStatus?.unavailable).toMatch(/^Біля першого перерізу: Середня частина затонка/);
    const connector = groupOf('cube', 'Кріплення', { cubeSectionPercent: '30' }, { ...chosen, cubeConnector: 'dowel' });
    expect(labels(connector)).toContain(
      'Кріплення однакове на обох перерізах: між нижньою й середньою та між середньою й верхньою частинами.',
    );
  });
});

describe('a box’s section among its other settings', () => {
  it('numbers the parts of any plane but a horizontal one in the connector’s fields', () => {
    const dowel = { cubeConnector: 'dowel' } as const;
    const numbered = groupOf('cube', 'Кріплення', {}, { ...dowel, cubeSection: 'longitudinal' });
    expect(labels(numbered)).toContain('Збільшення отворів частини 1, мм');
    const horizontal = groupOf('cube', 'Кріплення', {}, { ...dowel, cubeSection: 'face-parallel' });
    expect(labels(horizontal)).toContain('Збільшення нижніх отворів, мм');
  });

  it('is reset with the solid, and offers the reset only while a section is chosen', () => {
    const initial: ParameterState = { texts: texts(), choices: choices() };
    expect(canResetShapeParameters('cube', initial)).toBe(false);
    // A hidden mode's value changes nothing yet.
    expect(canResetShapeParameters('cube', { ...initial, texts: texts({ cubeLineAngleDeg: '30' }) })).toBe(false);
    const chosen: ParameterState = {
      texts: texts({ cubeSectionPercent: '30' }),
      choices: choices({ cubeSection: 'face-parallel', cubeSecondCut: true, cubeFace: 'ABB1A1' }),
    };
    expect(canResetShapeParameters('cube', chosen)).toBe(true);
    const reset = resetShapeParameters('cube', chosen);
    expect(reset.choices).toMatchObject({ cubeSection: 'none', cubeSecondCut: false, cubeFace: 'ABCD' });
    expect(reset.texts.cubeSectionPercent).toBe('50');
    // The cuboid's own section stays as it was.
    const other: ParameterState = { ...chosen, choices: { ...chosen.choices, cuboidSection: 'inclined' } };
    expect(resetShapeParameters('cube', other).choices.cuboidSection).toBe('inclined');
  });
});

describe('the choices of a plane through a line lead only to usable planes', () => {
  const through = { cubeSection: 'through-line', cubeLineMethod: 'point' } as const;
  const edgeLabels = (chosen: Partial<ParameterChoices>, kind: BoxSolid = 'cube', overrides: Partial<ParameterTexts> = {}) =>
    optionsOf(groupOf(kind, 'Переріз', overrides, chosen), `${kind}PointEdge`).map((option) => option.label);

  it('leaves out an edge all of whose points give a face, and keeps one that only an end of fails', () => {
    // Through AB of the side face ABB1A1, any point of BC or DA gives the base.
    const side = edgeLabels({ ...through, cubeLineFace: 'ABB1A1', cubeLine: 'A-B' });
    expect(side).not.toContain('Ребро BC');
    expect(side).not.toContain('Ребро DA');
    expect(side.length).toBeGreaterThan(0);
    // Through AB of the base, A1B1 gives the side face, and so do AA1 and BB1 wherever they do not meet AB.
    expect(edgeLabels(through)).toEqual(['Ребро B₁C₁', 'Ребро C₁D₁', 'Ребро D₁A₁', 'Ребро CC₁', 'Ребро DD₁']);
    // Through AC, AA1 stays: only A, at 0 %, lies on the line; its field starts a step above it.
    const diagonal = { ...through, cubeLine: 'A-C', cubePointEdge: 'A-A1' } as const;
    expect(edgeLabels(diagonal)).toEqual(expect.arrayContaining(['Ребро AA₁', 'Ребро B₁C₁']));
    const point = sectionNumberFields(groupOf('cube', 'Переріз', {}, diagonal)).find((field) => field.key === 'cubePointPercent');
    expect(point?.range).toMatchObject({ min: 5, max: 100 });
  });

  it('the screenshot’s section through AC and the midpoint of B1C1, and its ends, on the cube and the parallelepipeds', () => {
    const solids: readonly [BoxSolid, Partial<ParameterTexts>][] = [
      ['cube', {}],
      ['cuboid', { cuboidWidthRatio: '0,6', cuboidHeightRatio: '1,4' }],
      ['parallelepiped', {}],
      [
        'parallelepiped',
        {
          parallelepipedBaseSideRatio: '0,7',
          parallelepipedHeightRatio: '1,1',
          parallelepipedOffsetXRatio: '0,3',
          parallelepipedOffsetYRatio: '0,2',
        },
      ],
    ];
    for (const [kind, shape] of solids) {
      const keys = boxKeysOf(kind);
      const chosen = {
        [keys.Section]: 'through-line',
        [keys.LineFace]: 'ABCD',
        [keys.Line]: 'A-C',
        [keys.LineMethod]: 'point',
        [keys.PointEdge]: 'B1-C1',
      } as Partial<ParameterChoices>;
      expect(edgeLabels(chosen, kind, shape)).toContain('Ребро B₁C₁');
      for (const percent of ['0', '50', '100']) {
        const result = request(kind, { ...shape, [keys.PointPercent]: percent }, chosen);
        expect(result.errors).toEqual({});
        expect(result.spec?.section).toEqual({
          type: 'through-line',
          face: 'ABCD',
          line: ['A', 'C'],
          method: 'point',
          pointEdge: ['B1', 'C1'],
          pointPercent: Number(percent),
        });
      }
    }
  });

  it('replaces the choices a new face leaves without a usable plane, all together and before any model is made', () => {
    const before = { ...through, cubeLine: 'A-C', cubePointEdge: 'A-A1' } as const;
    // On the side face ABB1A1 there is no diagonal AC, and AA1 lies in that face.
    const state: ParameterState = { texts: texts(), choices: choices({ ...before, cubeLineFace: 'ABB1A1' }) };
    const values = request('cube', {}, state.choices).values;
    const settled = settleBoxChoices('cube', state, values) as ParameterState;
    expect(settled.choices.cubeLine).toBe('A-B');
    expect(settled.choices.cubeLineMethod).toBe('point');
    const group = groupOf('cube', 'Переріз', {}, settled.choices);
    expect(optionsOf(group, 'cubePointEdge').map((option) => option.value)).toContain(settled.choices.cubePointEdge);
    expect(settleBoxChoices('cube', settled, values)).toBeUndefined();
    // The request of the unsettled choices already makes the plane of the settled ones: no removed option reaches a model.
    expect(request('cube', {}, state.choices).spec?.section).toEqual(request('cube', {}, settled.choices).spec?.section);
  });

  it('moves a point that its new edge does not allow, once, and keeps one that it does', () => {
    // At 0 % the point on AA1 is A, on the diagonal AC.
    const chosen = { ...through, cubeLine: 'A-C', cubePointEdge: 'A-A1' } as const;
    const state: ParameterState = { texts: texts({ cubePointPercent: '0' }), choices: choices(chosen) };
    const values = request('cube', state.texts, chosen).values;
    const started = startPoint('cube', state, values) as ParameterState;
    expect(started.texts.cubePointPercent).toBe('50');
    expect(started.choices.cubePointFor).toBe('ABCD:A-C:A-A1');
    expect(startPoint('cube', { ...started, texts: { ...started.texts, cubePointPercent: '0' } }, values)).toBeUndefined();
    // Through AB and CC1 the wedge below is too thin near C: 5 % goes to the middle, 30 % stays.
    const low = { ...through, cubePointEdge: 'C-C1' } as const;
    const kept = startPoint(
      'cube',
      { texts: texts({ cubePointPercent: '30' }), choices: choices(low) },
      request('cube', { cubePointPercent: '30' }, low).values,
    );
    expect(kept?.texts.cubePointPercent).toBe('30');
    const thin = request('cube', { cubePointPercent: '5' }, low);
    expect(thin.errors.cubePointPercent).toMatch(
      /^За цього положення точки одна з частин була б надто тонкою\. На ребрі CC₁ допустимо від 11,2 % до 100 %\./,
    );
    const moved = startPoint('cube', { texts: texts({ cubePointPercent: '5' }), choices: choices(low) }, thin.values);
    expect(moved?.texts.cubePointPercent).toBe('50');
  });

  it('falls back to the angle where no edge of the line has a usable point, and offers only the angle there', () => {
    const keys: BoxKeysOf = boxKeysOf('cube');
    const lines = {
      ABCD: [{ line: ['A', 'B'], pointEdges: [] }],
      A1B1C1D1: [],
      ABB1A1: [],
      BCC1B1: [],
      CDD1C1: [],
      DAA1D1: [],
    } as unknown as ThroughLineChoices;
    const context = { ...boxContextOf('cube', choices(), { kind: 'cube' }), lines };
    const selection = throughLineSelection(keys, choices({ ...through, cubeLineFace: 'BCC1B1', cubeLine: 'B-C' }), context);
    expect(selection).toMatchObject({ faces: ['ABCD'], face: 'ABCD', line: ['A', 'B'], methods: ['angle'], method: 'angle' });
  });

  it('keeps the plane’s choices when magnets do not fit it: their fit is the connector’s, not the plane’s', () => {
    const chosen = { ...through, cubeLine: 'A-C', cubePointEdge: 'B1-C1', cubeConnector: 'magnet' } as const;
    const smooth = edgeLabels({ ...chosen, cubeConnector: 'none' });
    expect(edgeLabels(chosen, 'cube', { cubeMagnetDiameterMm: '40' })).toEqual(smooth);
    const result = request('cube', { cubeMagnetDiameterMm: '40' }, chosen);
    expect(result.errors.cubePointPercent).toBeUndefined();
    expect(Object.keys(result.errors).some((key) => key.startsWith('cubeMagnet'))).toBe(true);
    expect(result.spec).toBeUndefined();
  });
});

describe('a plane parallel to a face, by one face of each opposite pair', () => {
  const parallelepipeds: readonly [BoxSolid, Partial<ParameterTexts>][] = [
    ['cube', {}],
    ['cuboid', { cuboidWidthRatio: '0,25', cuboidHeightRatio: '3' }],
    ['parallelepiped', {}],
    ['parallelepiped', { parallelepipedOffsetXRatio: '2', parallelepipedOffsetYRatio: '-1,5', parallelepipedBaseAngleDeg: '35' }],
  ];

  it('offers three faces, and the other modes all six', () => {
    for (const [kind, shape] of parallelepipeds) {
      const keys = boxKeysOf(kind);
      const parallel = groupOf(kind, 'Переріз', shape, { [keys.Section]: 'face-parallel' } as Partial<ParameterChoices>);
      expect(optionsOf(parallel, keys.Face).map((option) => option.label)).toEqual([
        'ABCD — нижня основа',
        'ABB₁A₁ — бічна грань',
        'BCC₁B₁ — бічна грань',
      ]);
      const through = groupOf(kind, 'Переріз', shape, { [keys.Section]: 'through-line' } as Partial<ParameterChoices>);
      expect(optionsOf(through, keys.LineFace)).toHaveLength(6);
    }
  });

  it('turns an earlier opposite face into its representative, keeping both planes where they are', () => {
    for (const [kind, shape] of parallelepipeds) {
      const keys = boxKeysOf(kind);
      const chosen = {
        [keys.Section]: 'face-parallel',
        [keys.Face]: 'CDD1C1',
        [keys.SecondCut]: true,
      } as Partial<ParameterChoices>;
      const state: ParameterState = {
        texts: texts({ ...shape, [keys.SectionPercent]: '30', [keys.SectionSecondPercent]: '62,5' }),
        choices: choices(chosen),
      };
      const before = request(kind, state.texts, state.choices);
      const settled = settleBoxChoices(kind, state, before.values) as ParameterState;
      expect(settled.choices[keys.Face]).toBe('ABB1A1');
      expect(settled.texts[keys.SectionPercent]).toBe('70');
      expect(settled.texts[keys.SectionSecondPercent]).toBe('37,5');
      expect(settleBoxChoices(kind, settled, request(kind, settled.texts, settled.choices).values)).toBeUndefined();
      // The parts are the same solids: the planes did not move, nor did the order of the parts.
      const volumes = (texts_: ParameterTexts, chosen_: ParameterChoices) => {
        const result = resolveModelRequest(kind, texts_, chosen_, { connectorEdits: {} });
        return result.spec;
      };
      const [a, b] = [volumes(state.texts, state.choices), volumes(settled.texts, settled.choices)];
      expect(a?.section).toMatchObject({ face: 'CDD1C1', positionPercent: 30, secondPositionPercent: 62.5 });
      expect(b?.section).toMatchObject({ face: 'ABB1A1', positionPercent: 70, secondPositionPercent: 37.5 });
    }
  });

  it('keeps another mode’s position: the shared field is converted only for a plane parallel to a face', () => {
    const state: ParameterState = {
      texts: texts({ cubeSectionPercent: '30' }),
      choices: choices({ cubeSection: 'longitudinal', cubeFace: 'A1B1C1D1' }),
    };
    expect(settleBoxChoices('cube', state, request('cube', state.texts, state.choices).values)).toBeUndefined();
  });
});

describe('the sections of the prisms, by the same fields', () => {
  const prism = (overrides: Partial<ParameterChoices>) =>
    ({ prismSection: 'face-parallel', prismBaseType: 'regular', prismBaseSides: 3, ...overrides }) as Partial<ParameterChoices>;
  const OBTUSE_TEXTS = { prismTriangleSideRatio: '1,4', prismTriangleAngleDeg: '115' };

  it.each([
    [3, 4],
    [4, 3],
    [5, 6],
    [6, 4],
    [8, 5],
  ] as const)(
    'a prism over a regular %i-gon offers %i face orientations, every lateral face for a plane through a line',
    (sides, count) => {
      const group = groupOf('prism', 'Переріз', {}, prism({ prismBaseSides: sides }));
      expect(optionsOf(group, 'prismFace')).toHaveLength(count);
      const through = groupOf('prism', 'Переріз', {}, prism({ prismBaseSides: sides, prismSection: 'through-line' }));
      expect(optionsOf(through, 'prismLineFace')).toHaveLength(sides + 2);
    },
  );

  it('a triangular base offers its median, altitude, bisector and midline, and a scalene one each apart', () => {
    const equilateral = groupOf('prism', 'Переріз', {}, prism({ prismSection: 'longitudinal' }));
    expect(optionsOf(equilateral, 'prismTrace').map((option) => option.value)).toEqual(['angle', 'median', 'midline']);
    const scalene = groupOf(
      'prism',
      'Переріз',
      OBTUSE_TEXTS,
      prism({ prismSection: 'longitudinal', prismBaseType: 'triangle', prismTrace: 'height' }),
    );
    expect(optionsOf(scalene, 'prismTrace').map((option) => option.value)).toEqual([
      'angle',
      'median',
      'height',
      'bisector',
      'midline',
    ]);
    // Obtuse at A: only A's altitude passes through the base.
    expect(optionsOf(scalene, 'prismTraceVertex').map((option) => option.label)).toEqual(['A']);
    const hexagon = groupOf('prism', 'Переріз', {}, prism({ prismSection: 'longitudinal', prismBaseSides: 6 }));
    expect(optionsOf(hexagon, 'prismTrace').map((option) => option.value)).toEqual(['angle', 'diagonal']);
  });

  // A median lies at the middle of the extent across it, as the other two vertices are equally far from it; a bisector does not.
  it('keeps a plane through a bisector of a scalene base through it as the base changes, and its position field with it', () => {
    const start = settled('prism', {
      texts: texts(OBTUSE_TEXTS),
      choices: choices(
        prism({ prismSection: 'longitudinal', prismBaseType: 'triangle', prismTrace: 'bisector', prismTraceVertex: 'B' }),
      ),
    });
    const before = start.texts.prismSectionPercent;
    const changed = settled('prism', {
      ...start,
      texts: { ...start.texts, prismTriangleAngleDeg: '70', prismHeightRatio: '1,5' },
    });
    expect(changed.choices.prismTraceThrough).toBe(true);
    expect(changed.texts.prismSectionPercent).not.toBe(before);
    expect(request('prism', changed.texts, changed.choices).spec?.section).toMatchObject({
      type: 'longitudinal',
      trace: 'bisector',
      traceVertex: 'B',
      through: true,
    });
  });

  it('replaces whatever a new base no longer has, all together, and no request of the old choices names it', () => {
    const hexagonal = {
      prismSection: 'longitudinal',
      prismBaseSides: 6,
      prismFace: 'CDD1C1',
      prismTrace: 'diagonal',
      prismTraceSegment: 'A-D',
      prismLineFace: 'ABCDEF',
      prismLine: 'B-E',
      prismPointEdge: 'F-F1',
      prismNormalAlong: 'C-F1',
    } as const;
    const triangular = { ...hexagonal, prismBaseSides: 3 } as const;
    // Before settling, every mode's request already uses the triangular prism's own elements.
    for (const mode of ['face-parallel', 'longitudinal', 'through-line', 'inclined'] as const) {
      const result = request('prism', {}, prism({ ...triangular, prismSection: mode }));
      expect(result.errors).toEqual({});
      expect(result.spec).toBeDefined();
    }
    expect(request('prism', {}, prism(triangular)).spec?.section).toMatchObject({ trace: 'angle' });
    const state: ParameterState = { texts: texts(), choices: choices(prism(triangular)) };
    const after = settled('prism', state);
    expect(after.choices).toMatchObject({
      prismFace: 'ABC',
      prismTrace: 'angle',
      prismLineFace: 'ABC',
      prismLine: 'A-B',
      prismNormalAlong: 'none',
    });
    expect(['B1-C1', 'C1-A1', 'C-C1']).toContain(after.choices.prismPointEdge);
  });

  it('AB of the base and the midpoint of CC1, the triangular prism’s own construction, a choice away', () => {
    const chosen = prism({ prismSection: 'through-line', prismLineMethod: 'point' });
    expect(request('prism', {}, chosen).spec?.section).toEqual({
      type: 'through-line',
      face: 'ABC',
      line: ['A', 'B'],
      method: 'point',
      pointEdge: ['C', 'C1'],
      pointPercent: 50,
    });
    const group = groupOf('prism', 'Переріз', {}, chosen);
    expect(optionsOf(group, 'prismPointEdge').map((option) => option.label)).toEqual(['Ребро B₁C₁', 'Ребро C₁A₁', 'Ребро CC₁']);
    // A lateral face has its diagonals, though the bases have none.
    const lateral = groupOf('prism', 'Переріз', {}, prism({ prismSection: 'through-line', prismLineFace: 'ABB1A1' }));
    expect(optionsOf(lateral, 'prismLine').map((option) => option.label)).toContain('Діагональ AB₁');
  });

  it('perpendicular to the lateral edges a click away; a prism without body diagonals lists none', () => {
    const chosen = prism({ prismSection: 'inclined' });
    const state: ParameterState = { texts: texts({ prismOffsetXRatio: '0,5' }), choices: choices(chosen) };
    const lateral = normalAlongLateral('prism', state);
    expect(request('prism', lateral.texts, lateral.choices).spec?.section).toMatchObject({
      type: 'inclined',
      normalAlong: ['A', 'A1'],
      positionPercent: 50,
    });
    const group = groupOf('prism', 'Переріз', lateral.texts, lateral.choices);
    expect(labels(group)).toContain('Площина перпендикулярна до бічних ребер.');
    const further = group.fields.find((field) => field.key === 'prism-normal-along') as unknown as {
      fields: { options?: { label: string }[] }[];
    };
    const segments = (further.fields[0]?.options ?? []).map((option) => option.label);
    expect(segments.some((label) => label.startsWith('Діагональ тіла'))).toBe(false);
    expect(segments).toContain('Діагональ грані AB₁');
  });
});

describe('leaving a plane perpendicular to the lateral edges for its angles', () => {
  type Plane = { normal: readonly number[]; offset: number };
  /** The physical planes a request makes: the first and the second, each up to the sign of n·x = d. */
  const planesOf = (kind: BoxSolid, state: ParameterState): Plane[] => {
    const result = resolveModelRequest(kind, state.texts, state.choices, { exact: state.exact ?? {}, connectorEdits: {} });
    const shape = result.spec?.shape as never;
    const section = result.spec?.section as BoxSectionSpec;
    const vertices = boxVertices(shape, { longestDimensionMm: result.values.printSizeMm as number });
    const plane = boxPlane(vertices, section);
    const at = (percent: number) => plane.extent.min + (percent / 100) * (plane.extent.max - plane.extent.min);
    return [
      { normal: plane.normal, offset: plane.offset },
      ...(section.secondPositionPercent === undefined
        ? []
        : [{ normal: plane.normal, offset: at(section.secondPositionPercent) }]),
    ];
  };
  const expectSamePlanes = (before: Plane[], after: Plane[]) => {
    expect(after).toHaveLength(before.length);
    before.forEach((plane, index) => {
      const other = after[index] as Plane;
      const sign = Math.sign(plane.normal.reduce((sum, value, axis) => sum + value * (other.normal[axis] as number), 0));
      plane.normal.forEach((value, axis) => {
        expect(sign * (other.normal[axis] as number)).toBeCloseTo(value, 9);
      });
      expect(sign * other.offset).toBeCloseTo(plane.offset, 7);
    });
  };
  const fieldKeys = (kind: BoxSolid, state: ParameterState) =>
    groupOf(kind, 'Переріз', state.texts, state.choices).fields.map((field) => field.key);

  it.each([
    ['a right prism', 'prism', { prismBaseSides: 5 }, {}],
    ['an oblique prism', 'prism', { prismBaseSides: 3 }, { prismOffsetXRatio: '0,4', prismOffsetYRatio: '-0,2' }],
    ['a parallelepiped', 'parallelepiped', {}, { parallelepipedOffsetXRatio: '0,3' }],
  ] as const)('%s: the same planes, the angles shown again, and the preset offered again', (_, kind, base, shape) => {
    const keys = boxKeysOf(kind);
    const manual = settled(kind, {
      texts: texts({ ...shape, [keys.PlaneInclinationDeg]: '30', [keys.PlaneDirectionDeg]: '60', [keys.SectionPercent]: '40' }),
      choices: choices({ ...base, [keys.Section]: 'inclined' } as Partial<ParameterChoices>),
    });
    expect(fieldKeys(kind, manual)).toContain(`${kind}-normal-lateral`);
    let state = manual;
    for (let round = 0; round < 3; round += 1) {
      const perpendicular = settled(kind, normalAlongLateral(kind, state));
      expect(fieldKeys(kind, perpendicular)).toEqual(expect.arrayContaining([`${kind}-normal-manual`]));
      expect(fieldKeys(kind, perpendicular)).not.toContain(keys.PlaneInclinationDeg);
      expect(fieldKeys(kind, perpendicular)).not.toContain(`${kind}-normal-lateral`);
      // The solid leans another way while the plane is perpendicular to its lateral edges: the plane follows them.
      const leaning = settled(kind, {
        ...perpendicular,
        texts: {
          ...perpendicular.texts,
          [kind === 'prism' ? 'prismOffsetXRatio' : 'parallelepipedOffsetXRatio']: `0,${round + 2}`,
        },
      });
      const before = planesOf(kind, leaning);
      const back = settled(kind, normalAlongManual(kind, leaning));
      expect(back.choices[keys.NormalAlong]).toBe('none');
      expect(back.choices[keys.NormalFrom]).toBe('');
      expect(fieldKeys(kind, back)).toEqual(
        expect.arrayContaining([keys.PlaneInclinationDeg, keys.PlaneDirectionDeg, `${kind}-normal-lateral`]),
      );
      expect(fieldKeys(kind, back)).not.toContain(`${kind}-normal-manual`);
      expectSamePlanes(before, planesOf(kind, back));
      // Nothing else changed: the solid, the position, the separation.
      expect(back.texts).toMatchObject({ [keys.SectionPercent]: leaning.texts[keys.SectionPercent] });
      expect(back.choices[keys.PartsSeparated]).toBe(leaning.choices[keys.PartsSeparated]);
      state = back;
    }
    // The angles are the user's again: an edit takes effect, and no stale constraint returns.
    const edited = settled(kind, { ...state, texts: { ...state.texts, [keys.PlaneInclinationDeg]: '20' } });
    expect(request(kind, edited.texts, edited.choices).spec?.section).toMatchObject({ type: 'inclined', inclinationDeg: 20 });
    expect(edited.choices[keys.NormalAlong]).toBe('none');
  });

  it('keeps both planes of a second cut with magnets, the parts apart and the print size', () => {
    const keys = boxKeysOf('prism');
    const start = settled('prism', {
      texts: texts({ prismOffsetXRatio: '0,5', printSizeMm: '120', prismSectionPercent: '35', prismSectionSecondPercent: '70' }),
      choices: choices({ prismSection: 'inclined', prismSecondCut: true, prismConnector: 'magnet', prismPartsSeparated: true }),
    });
    const perpendicular = settled('prism', normalAlongLateral('prism', start));
    const before = planesOf('prism', perpendicular);
    expect(before).toHaveLength(2);
    const back = settled('prism', normalAlongManual('prism', perpendicular));
    expectSamePlanes(before, planesOf('prism', back));
    expect(back.choices).toMatchObject({ prismSecondCut: true, prismConnector: 'magnet', prismPartsSeparated: true });
    expect(back.texts.printSizeMm).toBe('120');
    expect(request('prism', back.texts, back.choices).spec?.section).toMatchObject({ connector: { type: 'magnet' } });
    expect(keys.NormalFrom).toBe('prismNormalFrom');
  });

  it('a horizontal plane keeps its direction field; a segment pointing down is measured from the other side', () => {
    // Perpendicular to the lateral edges of a right prism: the horizontal plane, which rises in no direction.
    const right = settled('prism', {
      texts: texts({ prismPlaneDirectionDeg: '123' }),
      choices: choices({ prismSection: 'inclined', prismNormalAlong: 'A-A1' }),
    });
    const flat = settled('prism', normalAlongManual('prism', right));
    expect(flat.texts.prismPlaneInclinationDeg).toBe('0');
    expect(flat.texts.prismPlaneDirectionDeg).toBe('123');
    expectSamePlanes(planesOf('prism', right), planesOf('prism', flat));
    // From C1 down to A in a cube: the normal turns upwards, and the positions are read from the other side.
    const down = settled('cube', {
      texts: texts({ cubeSectionPercent: '30', cubeSectionSecondPercent: '60' }),
      choices: choices({ cubeSection: 'inclined', cubeNormalAlong: 'C1-A', cubeSecondCut: true }),
    });
    const before = planesOf('cube', down);
    const angles = settled('cube', normalAlongManual('cube', down));
    expect(angles.texts.cubeSectionPercent).toBe('70');
    expect(angles.texts.cubeSectionSecondPercent).toBe('40');
    expectSamePlanes(before, planesOf('cube', angles));
    // Choosing «Не вибрано» in the list is the same way out.
    const listed = settled('cube', { ...down, choices: { ...down.choices, cubeNormalAlong: 'none' } });
    expectSamePlanes(before, planesOf('cube', listed));
  });
});

describe('the sections of the pyramids and the tetrahedron', () => {
  const chosen = (overrides: Partial<ParameterChoices>) =>
    ({
      pyramidSection: 'face-parallel',
      pyramidBaseType: 'regular',
      pyramidBaseSides: 4,
      ...overrides,
    }) as Partial<ParameterChoices>;

  it('offer their four modes, every face for a parallel plane, as no two of a pyramid’s faces are parallel', () => {
    for (const kind of ['pyramid', 'tetrahedron'] as const) {
      const group = groupOf(kind, 'Переріз', {}, {});
      expect(optionsOf(group, `${kind}Section`).map((option) => option.label)).toEqual([
        'Без перерізу',
        'Паралельно грані',
        'Через вершину піраміди',
        'Через ребро основи',
        'Похилий',
      ]);
    }
    expect(optionsOf(groupOf('pyramid', 'Переріз', {}, chosen({})), 'pyramidFace').map((option) => option.label)).toEqual([
      'ABCD — основа',
      'SAB — бічна грань',
      'SBC — бічна грань',
      'SCD — бічна грань',
      'SDA — бічна грань',
    ]);
    expect(
      optionsOf(groupOf('tetrahedron', 'Переріз', {}, { tetrahedronSection: 'face-parallel' }), 'tetrahedronFace'),
    ).toHaveLength(4);
  });

  it('through the apex: the base’s lines, the lateral edge with a point, and the pyramid’s height', () => {
    const tetrahedron = groupOf('tetrahedron', 'Переріз', {}, { tetrahedronSection: 'through-apex' });
    expect(optionsOf(tetrahedron, 'tetrahedronTrace').map((option) => option.value)).toEqual([
      'angle',
      'median',
      'midline',
      'edge-point',
      'height-edge',
    ]);
    const square = groupOf('pyramid', 'Переріз', {}, chosen({ pyramidSection: 'through-apex' }));
    expect(optionsOf(square, 'pyramidTrace').map((option) => option.value)).toEqual([
      'angle',
      'diagonal',
      'edge-point',
      'height-edge',
    ]);
    // SC and the midpoint of AB, a choice away.
    const sc = { tetrahedronSection: 'through-apex', tetrahedronTrace: 'edge-point', tetrahedronTraceSegment: 'A-B' } as const;
    expect(request('tetrahedron', {}, sc).spec?.section).toEqual({
      type: 'through-apex',
      trace: 'edge-point',
      traceAngleDeg: 0,
      traceVertex: 'C',
      traceSegment: ['A', 'B'],
      tracePointPercent: 50,
      positionPercent: 50,
    });
    const group = groupOf('tetrahedron', 'Переріз', {}, sc);
    expect(optionsOf(group, 'tetrahedronTraceVertex').map((option) => option.label)).toEqual(['SA', 'SB', 'SC']);
    expect(optionsOf(group, 'tetrahedronTraceSegment').map((option) => option.label)).toEqual(['Ребро AB']);
    expect(labels(group)).toContain('Площина проходить через бічне ребро SC і точку ребра AB.');
  });

  it('through a base edge: only the base’s edges, and of the lateral edges those that do not meet it', () => {
    const group = groupOf('tetrahedron', 'Переріз', {}, { tetrahedronSection: 'through-line', tetrahedronLineMethod: 'point' });
    expect(group.fields.some((field) => field.key === 'tetrahedronLineFace')).toBe(false);
    expect(optionsOf(group, 'tetrahedronLine').map((option) => option.label)).toEqual(['Ребро AB', 'Ребро BC', 'Ребро CA']);
    expect(optionsOf(group, 'tetrahedronPointEdge').map((option) => option.label)).toEqual(['Ребро SC']);
    const result = request('tetrahedron', {}, { tetrahedronSection: 'through-line', tetrahedronLineMethod: 'point' });
    expect(result.spec?.section).toEqual({
      type: 'through-line',
      face: 'ABC',
      line: ['A', 'B'],
      method: 'point',
      pointEdge: ['S', 'C'],
      pointPercent: 50,
    });
    // S and C give the faces SAB and ABC: the field stops short of both.
    const point = sectionNumberFields(group).find((field) => field.key === 'tetrahedronPointPercent');
    expect(point?.range?.min).toBeGreaterThan(0);
    expect(point?.range?.max).toBeLessThan(100);
  });

  it('parallel to a pair of opposite edges, through the height’s foot, and back to its angles where it is', () => {
    const start = settled('tetrahedron', {
      texts: texts({ tetrahedronSectionSecondPercent: '88' }),
      choices: choices({ tetrahedronSection: 'inclined', tetrahedronParallelEdges: 'S-C|A-B', tetrahedronSecondCut: true }),
    });
    const result = request('tetrahedron', start.texts, start.choices);
    expect(result.spec?.section).toMatchObject({
      type: 'inclined',
      parallelTo: [
        ['S', 'C'],
        ['A', 'B'],
      ],
      secondPositionPercent: 88,
    });
    const group = groupOf('tetrahedron', 'Переріз', start.texts, start.choices);
    const pairs = group.fields.find((field) => field.key === 'tetrahedron-parallel-edges') as unknown as {
      fields: { options?: { label: string }[] }[];
    };
    expect((pairs.fields[0]?.options ?? []).map((option) => option.label)).toEqual([
      'Не вибрано — задати кутами',
      'SA і BC',
      'SB і AC',
      'SC і AB',
    ]);
    expect(group.fields.map((field) => field.key)).toEqual(
      expect.arrayContaining(['tetrahedron-height-foot', 'tetrahedron-normal-manual']),
    );
    expect(group.fields.map((field) => field.key)).not.toContain('tetrahedron-normal-lateral');
    // Through H: in the regular tetrahedron, H is the centroid of ABC, a third of the way from AB to SC.
    const foot = throughHeightFoot('tetrahedron', start, result.values);
    const percent = Number.parseFloat((foot.texts.tetrahedronSectionPercent as string).replace(',', '.'));
    expect(percent).not.toBe(50);
    // Back to the angles: the same planes, the second cut kept.
    const back = settled('tetrahedron', normalAlongManual('tetrahedron', foot));
    expect(back.choices.tetrahedronParallelEdges).toBe('none');
    expect(back.choices.tetrahedronSecondCut).toBe(true);
    const before = resolveModelRequest('tetrahedron', foot.texts, foot.choices, { exact: foot.exact ?? {}, connectorEdits: {} });
    const after = resolveModelRequest('tetrahedron', back.texts, back.choices, { exact: back.exact ?? {}, connectorEdits: {} });
    expect(before.errors).toEqual({});
    expect(after.errors).toEqual({});
    const vertices = boxVertices({ kind: 'tetrahedron' }, { longestDimensionMm: 80 });
    const [p, q] = [
      boxPlane(vertices, before.spec?.section as BoxSectionSpec),
      boxPlane(vertices, after.spec?.section as BoxSectionSpec),
    ];
    const sign = Math.sign(p.normal.reduce((sum, value, axis) => sum + value * (q.normal[axis] as number), 0));
    p.normal.forEach((value, axis) => {
      expect(sign * (q.normal[axis] as number)).toBeCloseTo(value, 9);
    });
    expect(sign * q.offset).toBeCloseTo(p.offset, 6);
  });

  it('replaces what a new base does not have before any model is made: a diagonal, a pair of opposite edges', () => {
    const square = chosen({
      pyramidSection: 'through-apex',
      pyramidTrace: 'diagonal',
      pyramidTraceSegment: 'A-C',
      pyramidParallelEdges: 'S-C|A-B',
      pyramidNormalAlong: 'D-S',
    });
    const triangular = { ...square, pyramidBaseSides: 3 } as Partial<ParameterChoices>;
    expect(request('pyramid', {}, triangular).spec?.section).toMatchObject({ type: 'through-apex', trace: 'angle' });
    expect(request('pyramid', {}, { ...triangular, pyramidSection: 'inclined' }).spec?.section).not.toHaveProperty('normalAlong');
    const after = settled('pyramid', { texts: texts(), choices: choices(triangular) });
    expect(after.choices).toMatchObject({ pyramidTrace: 'angle', pyramidNormalAlong: 'none', pyramidParallelEdges: 'S-C|A-B' });
    // Back to four sides: no pair of opposite edges there.
    const four = settled('pyramid', { ...after, choices: { ...after.choices, pyramidBaseSides: 4 } });
    expect(four.choices.pyramidParallelEdges).toBe('none');
  });
});
