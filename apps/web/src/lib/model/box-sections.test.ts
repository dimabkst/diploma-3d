import { describe, expect, it } from 'vitest';
import { sectionNumberFields, shapePanel } from '../shapes.ts';
import { type BoxKeysOf, type BoxSolid, boxKeysOf, type ThroughLineChoices, throughLineSelection } from './box.ts';
import {
  addSecondCut,
  canResetShapeParameters,
  diagonalSection,
  initialParameterChoices,
  initialParameterTexts,
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
} from './parameters.ts';

const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const request = (kind: BoxSolid, overrides: Partial<ParameterTexts>, chosen: Partial<ParameterChoices>) =>
  resolveModelRequest(kind, texts(overrides), choices(chosen), { connectorEdits: {} });
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

  it('a longitudinal plane: at an angle to AB, or along a diagonal, with the diagonal section a click away', () => {
    const chosen = { cuboidSection: 'longitudinal' } as const;
    expect(request('cuboid', { cuboidTraceAngleDeg: '30', cuboidSectionPercent: '40' }, chosen).spec?.section).toEqual({
      type: 'longitudinal',
      trace: 'angle',
      traceAngleDeg: 30,
      positionPercent: 40,
    });
    const state: ParameterState = { texts: texts({ cuboidSectionPercent: '40' }), choices: choices(chosen) };
    const diagonal = diagonalSection('cuboid', state, 'BD');
    expect(diagonal.choices.cuboidTrace).toBe('BD');
    expect(diagonal.texts.cuboidSectionPercent).toBe('50');
    const group = groupOf('cuboid', 'Переріз', diagonal.texts, diagonal.choices);
    expect(group.status).toEqual({ text: 'діагональний', highlighted: true });
    expect(labels(group)).toContain('Діагональний переріз: площина проходить через діагональ BD і бічні ребра BB₁ та DD₁.');
    expect(group.fields.find((field) => field.key === 'cuboid-diagonal-bd')).toMatchObject({ disabled: true });
    // The trace stays with the diagonal whatever the cuboid becomes.
    const taller = request('cuboid', { ...diagonal.texts, cuboidHeightRatio: '3' }, diagonal.choices);
    expect(taller.spec?.section).toEqual({ type: 'longitudinal', trace: 'BD', traceAngleDeg: 0, positionPercent: 50 });
    // Moved away, it is parallel to the diagonal, no longer through it.
    const moved = groupOf('cuboid', 'Переріз', { ...diagonal.texts, cuboidSectionPercent: '65' }, diagonal.choices);
    expect(moved.status).toEqual({ text: 'поздовжній', highlighted: true });
    expect(labels(moved)).toContain('Площина паралельна діагоналі BD, але не проходить через неї.');
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
    expect(segments).toContain('Ребро AA₁');
    expect(segments).toContain('Діагональ грані AC');
    expect(segments).toContain('Діагональ тіла AC₁');
    expect(segments).toHaveLength(1 + 12 + 12 + 4);
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
    const available = {
      ABCD: [{ line: ['A', 'B'], pointEdges: [] }],
      A1B1C1D1: [],
      ABB1A1: [],
      BCC1B1: [],
      CDD1C1: [],
      DAA1D1: [],
    } as unknown as ThroughLineChoices;
    const selection = throughLineSelection(keys, choices({ ...through, cubeLineFace: 'BCC1B1', cubeLine: 'B-C' }), available);
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
