import { boxPlane, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { shapePanel } from '../shapes.ts';
import { type BoxKeysOf, type BoxSolid, boxContextOf, boxKeysOf, type ThroughLineChoices, throughLineSelection } from './box.ts';
import {
  addSecondCut,
  canResetShapeParameters,
  followNormal,
  followTrace,
  initialParameterChoices,
  initialParameterTexts,
  normalAlongManual,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  removeSecondCut,
  resetShapeParameters,
  resolveModelRequest,
  settleBoxChoices,
  startLineAngle,
  startPoint,
  throughHeightFoot,
  traceThrough,
} from './parameters.ts';
import { PILOT_MESSAGES } from './throughPoint.ts';

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

  it('a plane parallel to a face: its face and its ratio of distances in one construction, the lower base at first', () => {
    const chosen = { cubeSection: 'face-parallel', cubeFaceMode: 'ratio' } as const;
    const ratio = { cubeFaceRatioFirst: '3', cubeFaceRatioSecond: '7' };
    const group = groupOf('cube', 'Переріз', ratio, chosen);
    expect(labels(group)).toEqual(['Тип перерізу', 'cube-face-construction', 'Додати паралельний переріз', 'Розсунути частини']);
    expect(request('cube', ratio, chosen).spec?.section).toEqual({
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
    expect(labels(apart)).toContain('Площина паралельна діагональному перерізу через BD, але не проходить через діагональ.');
    expect(request('cuboid', moved.texts, moved.choices).spec?.section).toMatchObject({ positionPercent: 65 });
    const again = settled('cuboid', traceThrough('cuboid', moved));
    expect(again.texts.cuboidSectionPercent).toBe('50');
  });

  it('a plane through an edge at an angle to a face: the smaller angle to that face, kept as typed, said when too thin', () => {
    const chosen = { cubeSection: 'through-line' } as const;
    const state: ParameterState = { texts: texts({ cubeLineDihedralDeg: '10' }), choices: choices(chosen) };
    const values = request('cube', state.texts, chosen).values;
    // Nothing moves the angle of the construction: neither a start nor a later correction.
    expect(startLineAngle('cube', state, values)).toBeUndefined();
    expect(request('cube', { cubeLineDihedralDeg: '45' }, chosen).spec?.section).toEqual({
      type: 'through-line',
      face: 'ABCD',
      line: ['A', 'B'],
      method: 'angle',
      angleDeg: 45,
    });
    const group = groupOf('cube', 'Переріз', {}, chosen);
    expect(group.fields.find((field) => field.type === 'through-point')).toMatchObject({
      method: 'angle',
      angle: { title: 'Кут до ABCD', value: '45°', faces: [{ value: 'ABCD' }, { value: 'ABB1A1' }] },
    });
    // Near the adjacent face the part beyond the plane is a sliver: said at the construction, as such angles from ABCD.
    const thin = request('cube', { cubeLineDihedralDeg: '88' }, chosen);
    expect(thin.errors).toEqual({});
    expect(thin.pilotDraft).toMatchObject({ status: 'invalid', problem: 'thin' });
    expect((thin.pilotDraft as { message: string }).message).toMatch(
      /^За цього кута одна з частин була б надто тонкою\. У цьому положенні допустимо від \d+(,\d)?° до \d+(,\d)?° до грані ABCD\.$/,
    );
  });
  it('keeps the line and the point’s edge to the chosen face, and offers its edges and diagonals', () => {
    // A pentagonal prism's plane through a line is the construction too: a base's and a lateral face's diagonals among its
    // segments, no diagonal of the solid.
    const pentagonal = groupOf('prism', 'Переріз', {}, { prismSection: 'through-line', prismBaseSides: 5 });
    const field = pentagonal.fields.find((candidate) => candidate.type === 'through-point');
    const segments = field?.type === 'through-point' ? field.segment.options.map((option) => option.label) : [];
    expect(segments).toEqual(expect.arrayContaining(['AB — ребро', 'AC — діагональ грані', 'BC₁ — діагональ грані']));
    expect(segments).not.toContain('AC₁ — діагональ грані');
    expect(segments.some((label) => label.startsWith('AC₁'))).toBe(false);
    // A parallelepiped's construction keeps its own segment and face: nothing is settled for it.
    const construction: ParameterState = {
      texts: texts(),
      choices: choices({ parallelepipedSection: 'through-line', parallelepipedLineFace: 'BCC1B1' }),
    };
    const own = settleBoxChoices('parallelepiped', construction, request('parallelepiped', {}, construction.choices).values);
    expect(own?.choices.parallelepipedLine ?? 'A-B').toBe('A-B');
  });
  it('a plane through an edge and a point of another: M at the midpoint or a ratio, a point on the line refused', () => {
    const chosen = { cubeSection: 'through-line', cubeLineMethod: 'point' } as const;
    expect(request('cube', {}, chosen).spec?.section).toEqual({
      type: 'through-line',
      face: 'ABCD',
      line: ['A', 'B'],
      method: 'point',
      pointEdge: ['C', 'C1'],
      pointPercent: 50,
    });
    const group = groupOf('cube', 'Переріз', {}, chosen);
    expect(group.fields.find((field) => field.type === 'through-point')).toMatchObject({
      segment: { title: 'AB' },
      point: { title: 'Середина CC₁', mode: 'midpoint', labels: ['CM', 'MC₁'] },
    });
    // A on AA1, AM : MA1 = 0 : 1, lies on the diagonal AC itself.
    const onLine = request(
      'cube',
      { cubePointRatioFirst: '0', cubePointRatioSecond: '1' },
      { ...chosen, cubeLine: 'A-C', cubePointEdge: 'A-A1', cubePointMode: 'ratio' },
    );
    // Said at the construction, which shows the plain solid meanwhile: no field error to block it.
    expect(onLine.pilotDraft).toEqual({ status: 'invalid', problem: 'collinear', message: PILOT_MESSAGES.collinear });
    expect(onLine.errors).toEqual({});
    expect(onLine.spec?.section).toBeUndefined();
  });

  it('an inclined plane by its angles, or perpendicular to an edge or a diagonal from the collapsed further way', () => {
    const chosen = { cubeSection: 'inclined' } as const;
    expect(request('cube', { cubePlaneInclinationDeg: '30', cubePlaneDirectionDeg: '120' }, chosen).spec?.section).toEqual({
      type: 'inclined',
      inclinationDeg: 30,
      directionDeg: 120,
      positionPercent: 50,
    });
    // A cube's segment in its own field, listed by name in three groups; the lateral edges once, as they are parallel.
    const group = groupOf('cube', 'Переріз', {}, chosen);
    const field = group.fields.find((candidate) => candidate.type === 'normal-construction');
    const segments = field?.type === 'normal-construction' ? field.options : [];
    expect(segments.map(({ label }) => label)).toContain('Бічні ребра (AA₁)');
    expect(segments.map(({ label }) => label)).not.toContain('AA₁');
    expect(segments).toContainEqual({ value: 'A-C', label: 'AC', group: 'Діагоналі граней' });
    expect(segments).toContainEqual({ value: 'A-C1', label: 'AC₁', group: 'Діагоналі тіла' });
    // The lateral edges as one, the eight base edges, twelve face diagonals and four body diagonals.
    expect(segments).toHaveLength(1 + 8 + 12 + 4);
    // A pentagonal prism and a square pyramid have the same field and no collapsed list beside it.
    const pentagonal = groupOf('prism', 'Переріз', {}, { prismSection: 'inclined', prismBaseSides: 5 }).fields;
    expect(pentagonal.some((candidate) => candidate.key === 'prism-normal-along')).toBe(false);
    expect(pentagonal.find((candidate) => candidate.key === 'prism-normal')?.type).toBe('normal-construction');
    const pyramid = groupOf('pyramid', 'Переріз', {}, { pyramidSection: 'inclined' }).fields;
    expect(pyramid.some((candidate) => candidate.key === 'pyramid-normal-along')).toBe(false);
    const pyramidNormal = pyramid.find((candidate) => candidate.type === 'normal-construction');
    expect(pyramidNormal?.type === 'normal-construction' ? pyramidNormal.options.map(({ label }) => label) : []).toEqual(
      expect.arrayContaining(['SA', 'AC']),
    );
    // The triangle near the corner A, perpendicular to the body diagonal.
    const perpendicular = { ...chosen, cubeNormalAlong: 'A-C1' } as const;
    const triangle = request('cube', { cubeSectionPercent: '16' }, perpendicular);
    expect(triangle.errors).toEqual({});
    expect(triangle.spec?.section).toMatchObject({ type: 'inclined', normalAlong: ['A', 'C1'], positionPercent: 16 });
    expect(labels(groupOf('cube', 'Переріз', {}, perpendicular))).toContain(
      'Площина перпендикулярна до відрізка AC₁: він задає лише напрям, а положення площини — поле нижче, тож сам відрізок вона ' +
        'може й не перетинати.',
    );
  });

  it('refuses a position that leaves a part thinner than its tenth of the extent, with the positions allowed', () => {
    const chosen = { cubeSection: 'face-parallel', cubeFaceMode: 'ratio' } as const;
    const tooFar = request('cube', { cubeFaceRatioFirst: '95', cubeFaceRatioSecond: '5' }, chosen);
    expect(tooFar.errors).toEqual({});
    expect(tooFar.pilotDraft).toMatchObject({ status: 'invalid', problem: 'thin', position: 'first' });
    expect((tooFar.pilotDraft as { message: string }).message).toMatch(/від 10 % до 90 % відстані від ABCD до A₁B₁C₁D₁\.$/);
    // A small solid keeps both parts at least 1,2 mm thick: the positions narrow.
    const small = request('cube', { printSizeMm: '10', cubeFaceRatioFirst: '11', cubeFaceRatioSecond: '89' }, chosen);
    expect((small.pilotDraft as { message: string }).message).toMatch(/від 12 % до 88 %/);
    // A pentagonal prism's lateral face, measured to the lateral edge DD₁ its far support plane passes through.
    const prism = request(
      'prism',
      { prismFaceRatioFirst: '95', prismFaceRatioSecond: '5' },
      { prismSection: 'face-parallel', prismBaseSides: 5, prismFace: 'ABB1A1', prismFaceMode: 'ratio' },
    );
    expect((prism.pilotDraft as { message: string }).message).toMatch(
      /^Переріз надто близько до грані або ребра: .* до 90 % відстані від ABB₁A₁ до DD₁\.$/,
    );
  });
});

describe('a second parallel plane of a box', () => {
  it('starts halfway between the first plane and the farther end, and gives three parts', () => {
    const chosen = { cubeSection: 'face-parallel', cubeFaceMode: 'ratio' } as const;
    const at = (first: string, second: string) => {
      const typed = { cubeFaceRatioFirst: first, cubeFaceRatioSecond: second };
      const state: ParameterState = { texts: texts(typed), choices: choices(chosen) };
      const added = addSecondCut('cube', state, request('cube', state.texts, chosen).values);
      expect(added.choices.cubeSecondCut).toBe(true);
      expect(added.choices.cubeSecondMode).toBe('ratio');
      return `${added.texts.cubeSecondRatioFirst} : ${added.texts.cubeSecondRatioSecond}`;
    };
    expect(at('1', '1')).toBe('7 : 3');
    expect(at('3', '7')).toBe('3 : 2');
    expect(at('4', '1')).toBe('1 : 1');
    const two = { ...chosen, cubeSecondCut: true };
    const typed = { cubeFaceRatioFirst: '3', cubeFaceRatioSecond: '7', cubeSecondRatioFirst: '3', cubeSecondRatioSecond: '2' };
    expect(request('cube', typed, two).spec?.section).toEqual({
      type: 'face-parallel',
      face: 'ABCD',
      positionPercent: 30,
      secondPositionPercent: 60,
    });
    const group = groupOf('cube', 'Переріз', typed, two);
    expect(labels(group)).toEqual(['Тип перерізу', 'cube-face-construction', 'Прибрати другий переріз', 'Розсунути частини']);
    expect(group.status).toEqual({ text: 'два перерізи', highlighted: true });
    const removed = removeSecondCut('cube', { texts: texts(), choices: choices(two) });
    expect(request('cube', removed.texts, removed.choices).spec?.section).toEqual({
      type: 'face-parallel',
      face: 'ABCD',
      positionPercent: 50,
    });
  });
  it('beside a plane through a line, starts from where the line puts the first plane', () => {
    const chosen = { cubeSection: 'through-line', cubeLineFace: 'ABB1A1', cubeLine: 'A-B1' } as const;
    const state: ParameterState = { texts: texts({ cubeLineDihedralDeg: '90' }), choices: choices(chosen) };
    // The diagonal section AB1C1D passes through the cube's centre: 50 %, so the second plane starts at 70 %.
    const added = addSecondCut('cube', state, request('cube', state.texts, chosen).values);
    expect(added.texts.cubeSectionSecondPercent).toBe('70');
  });
  it('refuses a middle part that is too thin, at the second plane’s position', () => {
    const close = request(
      'cube',
      { cubeSecondRatioFirst: '11', cubeSecondRatioSecond: '9' },
      { cubeSection: 'face-parallel', cubeSecondCut: true },
    );
    expect(close.errors).toEqual({});
    expect(close.pilotDraft).toMatchObject({ status: 'invalid', problem: 'thin', position: 'second' });
    expect((close.pilotDraft as { message: string }).message).toMatch(
      /^Перерізи надто близько: середня частина має завтовшки 4 мм/,
    );
    expect(close.spec?.section).toBeUndefined();
  });
  it('fits a dowel to both planes, and says which plane cannot take magnets', () => {
    const chosen = { cubeSection: 'face-parallel', cubeSecondCut: true, cubeFaceMode: 'ratio' } as const;
    const planes = { cubeFaceRatioFirst: '3', cubeFaceRatioSecond: '7', cubeSecondRatioFirst: '7', cubeSecondRatioSecond: '3' };
    const dowels = request('cube', planes, { ...chosen, cubeConnector: 'dowel' });
    expect(dowels.errors).toEqual({});
    expect(dowels.connectorStatus?.unavailable).toBeUndefined();
    expect(dowels.spec?.section).toMatchObject({ secondPositionPercent: 70, connector: { type: 'dowel' } });
    const thin = request(
      'cube',
      // At 60 mm the middle part is 6,6 mm thick: two pockets 3,1 mm deep leave 0,4 mm between them.
      {
        printSizeMm: '60',
        cubeFaceRatioFirst: '45',
        cubeFaceRatioSecond: '55',
        cubeSecondRatioFirst: '56',
        cubeSecondRatioSecond: '44',
        cubeMagnetThicknessMm: '3',
      },
      { ...chosen, cubeConnector: 'magnet' },
    );
    expect(thin.connectorStatus?.unavailable).toMatch(/^Біля першого перерізу: Середня частина затонка/);
    const connector = groupOf('cube', 'Кріплення', planes, { ...chosen, cubeConnector: 'dowel' });
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
  // The pilot's list of M's edges, which the model's picking offers too.
  const edgeLabels = (chosen: Partial<ParameterChoices>, kind: BoxSolid = 'cube', overrides: Partial<ParameterTexts> = {}) =>
    (
      groupOf(kind, 'Переріз', overrides, chosen).fields.find((field) => field.type === 'through-point') as unknown as {
        point: { options: { label: string }[] };
      }
    ).point.options.map((option) => option.label);

  it('leaves out an edge all of whose points give a face, and keeps one that only an end of fails', () => {
    // Through AB, any point of BC or DA gives the base, and of AA1 or BB1 the side face: no face to choose first.
    expect(edgeLabels(through)).toEqual(['Ребро B₁C₁', 'Ребро C₁D₁', 'Ребро A₁D₁', 'Ребро CC₁', 'Ребро DD₁']);
    // Through AC, AA1 stays: only A, at 0 : 1, lies on the line.
    const diagonal = { ...through, cubeLine: 'A-C', cubePointEdge: 'A-A1' } as const;
    expect(edgeLabels(diagonal)).toEqual(expect.arrayContaining(['Ребро AA₁', 'Ребро B₁C₁']));
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
        [keys.Line]: 'A-C',
        [keys.LineMethod]: 'point',
        [keys.PointEdge]: 'B1-C1',
      } as Partial<ParameterChoices>;
      expect(edgeLabels(chosen, kind, shape)).toContain('Ребро B₁C₁');
      for (const [mode, first, second, percent] of [
        ['ratio', '0', '1', 0],
        ['midpoint', '1', '1', 50],
        ['ratio', '1', '0', 100],
      ] as const) {
        const result = request(
          kind,
          { ...shape, [keys.PointRatioFirst]: first, [keys.PointRatioSecond]: second },
          { ...chosen, [keys.PointMode]: mode },
        );
        expect(result.errors).toEqual({});
        expect(result.spec?.section).toEqual({
          type: 'through-line',
          face: 'ABCD',
          line: ['A', 'C'],
          method: 'point',
          pointEdge: ['B1', 'C1'],
          pointPercent: percent,
        });
      }
    }
  });

  it('keeps the chosen segment and M’s edge: no face to settle, nothing replaced behind the user’s back', () => {
    const state: ParameterState = {
      texts: texts(),
      choices: choices({ ...through, cubeLine: 'A-C', cubePointEdge: 'A-A1', cubeLineFace: 'ABB1A1' }),
    };
    const values = request('cube', {}, state.choices).values;
    const settled = settleBoxChoices('cube', state, values);
    expect(settled?.choices.cubeLine ?? 'A-C').toBe('A-C');
    expect(settled?.choices.cubePointEdge ?? 'A-A1').toBe('A-A1');
    expect(request('cube', {}, state.choices).spec?.section).toMatchObject({ face: 'ABCD', line: ['A', 'C'] });
  });

  it('never moves M: a point on the line or a part too thin stays as typed, said at the construction', () => {
    // At 0 : 1 the point on AA1 is A, on the diagonal AC.
    const chosen = { ...through, cubeLine: 'A-C', cubePointEdge: 'A-A1', cubePointMode: 'ratio' } as const;
    const onLine = { cubePointRatioFirst: '0', cubePointRatioSecond: '1' };
    const state: ParameterState = { texts: texts(onLine), choices: choices(chosen) };
    expect(startPoint('cube', state, request('cube', state.texts, chosen).values)).toBeUndefined();
    // Through AB and CC1 the wedge below is too thin near C: 1 : 19 stays, and the section's own check says why.
    const low = { ...through, cubePointEdge: 'C-C1', cubePointMode: 'ratio' } as const;
    const thinTexts = { cubePointRatioFirst: '1', cubePointRatioSecond: '19' };
    const thin = request('cube', thinTexts, low);
    expect(thin.errors).toEqual({});
    expect(thin.pilotDraft).toMatchObject({ status: 'invalid', problem: 'thin' });
    expect((thin.pilotDraft as { message: string }).message).toMatch(
      /^За цього положення M одна з частин була б надто тонкою\. M має лежати від 11,2 % до 100 % довжини CC₁, рахуючи від C\./,
    );
    expect(startPoint('cube', { texts: texts(thinTexts), choices: choices(low) }, thin.values)).toBeUndefined();
    const kept = { cubePointRatioFirst: '3', cubePointRatioSecond: '7' };
    expect(request('cube', kept, low).spec?.section).toMatchObject({ pointEdge: ['C', 'C1'], pointPercent: 30 });
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
    expect(result.errors.cubePointRatioFirst).toBeUndefined();
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

  it('offers the three pairs of opposite faces by name, and a plane through a segment all of its segments', () => {
    for (const [kind, shape] of parallelepipeds) {
      const keys = boxKeysOf(kind);
      const parallel = groupOf(kind, 'Переріз', shape, { [keys.Section]: 'face-parallel' } as Partial<ParameterChoices>);
      const construction = parallel.fields.find((field) => field.type === 'face-construction');
      expect(construction?.type === 'face-construction' ? construction.face.options.map(({ label }) => label) : []).toEqual([
        'ABCD ∥ A₁B₁C₁D₁',
        'ABB₁A₁ ∥ CDD₁C₁',
        'BCC₁B₁ ∥ DAA₁D₁',
      ]);
      // A plane through a segment offers every edge and every face's diagonal, with no face to choose first.
      const through = groupOf(kind, 'Переріз', shape, { [keys.Section]: 'through-line' } as Partial<ParameterChoices>);
      const segments = through.fields.find((field) => field.type === 'through-point');
      expect(segments?.type === 'through-point' ? segments.segment.options : []).toHaveLength(24);
    }
  });
  it('keeps the face clicked, either of its pair, and both planes measured from it', () => {
    for (const [kind, shape] of parallelepipeds) {
      const keys = boxKeysOf(kind);
      const chosen = {
        [keys.Section]: 'face-parallel',
        [keys.Face]: 'CDD1C1',
        [keys.FaceMode]: 'ratio',
        [keys.SecondCut]: true,
      } as Partial<ParameterChoices>;
      const state: ParameterState = {
        texts: texts({
          ...shape,
          [keys.FaceRatioFirst]: '3',
          [keys.FaceRatioSecond]: '7',
          [keys.SecondRatioFirst]: '62,5',
          [keys.SecondRatioSecond]: '37,5',
        }),
        choices: choices(chosen),
      };
      const before = request(kind, state.texts, state.choices);
      expect(settleBoxChoices(kind, state, before.values)?.choices[keys.Face] ?? 'CDD1C1').toBe('CDD1C1');
      expect(before.spec?.section).toMatchObject({ face: 'CDD1C1', positionPercent: 30, secondPositionPercent: 62.5 });
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
      // Every prism's construction: its orientations by name, as its geometry pairs parallel faces, and its segments with no
      // face to choose first.
      const group = groupOf('prism', 'Переріз', {}, prism({ prismBaseSides: sides }));
      const field = group.fields.find((candidate) => candidate.type === 'face-construction');
      const labels = field?.type === 'face-construction' ? field.face.options.map(({ label }) => label) : [];
      expect(labels).toHaveLength(count);
      if (sides === 3) expect(labels).toEqual(['ABC ∥ A₁B₁C₁', 'ABB₁A₁', 'BCC₁B₁', 'CAA₁C₁']);
      if (sides === 6) expect(labels).toEqual(['ABCDEF ∥ A₁B₁C₁D₁E₁F₁', 'ABB₁A₁ ∥ DEE₁D₁', 'BCC₁B₁ ∥ EFF₁E₁', 'CDD₁C₁ ∥ FAA₁F₁']);
      const through = groupOf('prism', 'Переріз', {}, prism({ prismBaseSides: sides, prismSection: 'through-line' }));
      expect(through.fields.some((candidate) => candidate.type === 'through-point')).toBe(true);
      expect(through.fields.some((candidate) => candidate.key === 'prismLineFace')).toBe(false);
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
    const vertex = scalene.fields.find((field) => field.type === 'trace-construction');
    expect(vertex?.type === 'trace-construction' ? vertex.options.map((option) => option.label) : []).toEqual(['A']);
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
    expect(after.choices).toMatchObject({ prismFace: 'ABC', prismTrace: 'angle', prismNormalAlong: 'none' });
    // The triangular prism's construction never replaces the user's segment: BE, which it lacks, is said to be chosen again.
    const through = request('prism', after.texts, { ...after.choices, prismSection: 'through-line' });
    expect(through.pilotDraft).toEqual({ status: 'incomplete', message: 'Оберіть відрізок: ребро або діагональ грані.' });
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
    const field = group.fields.find((candidate) => candidate.type === 'through-point');
    if (field?.type !== 'through-point') throw new Error('Expected the construction.');
    expect(field.point.options.map((option) => option.label).sort()).toEqual(['Ребро A₁C₁', 'Ребро B₁C₁', 'Ребро CC₁']);
    // A lateral face has its diagonals, though the bases have none.
    expect(field.segment.options.map((option) => option.label)).toContain('AB₁ — діагональ грані');
    expect(field.segment.options.map((option) => option.label)).toContain('AC — ребро');
  });

  it('perpendicular to the lateral edges a click away; a prism without body diagonals lists none', () => {
    const chosen = prism({ prismSection: 'inclined' });
    const state: ParameterState = { texts: texts({ prismOffsetXRatio: '0,5' }), choices: choices(chosen) };
    const lateral = lateralEdges('prism', state);
    expect(request('prism', lateral.texts, lateral.choices).spec?.section).toMatchObject({
      type: 'inclined',
      normalAlong: ['A', 'A1'],
      positionPercent: 50,
    });
    const group = groupOf('prism', 'Переріз', lateral.texts, lateral.choices);
    expect(labels(group)).toContain('Площина перпендикулярна до бічних ребер.');
    const field = group.fields.find((candidate) => candidate.type === 'normal-construction');
    const segments = field?.type === 'normal-construction' ? field.options : [];
    expect(segments.some(({ group: name }) => name === 'Діагоналі тіла')).toBe(false);
    expect(segments).toContainEqual({ value: 'A-B1', label: 'AB₁', group: 'Діагоналі граней' });
  });
});

/** The state the removed «Перпендикулярно бічним ребрам» button set: the lateral edges, by AA₁, which the field shows as chosen. */
const lateralEdges = (kind: BoxSolid, state: ParameterState): ParameterState => ({
  ...state,
  choices: { ...state.choices, [boxKeysOf(kind).NormalAlong]: 'A-A1' } as ParameterChoices,
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
  ] as const)('%s: the same planes, the angles shown again, and the lateral edges offered again', (_, kind, base, shape) => {
    const keys = boxKeysOf(kind);
    // Every prism and a parallelepiped offer the lateral edges among the segments of «Перпендикулярно до», always there.
    const lateral = `${kind}-normal`;
    const manual = settled(kind, {
      texts: texts({ ...shape, [keys.PlaneInclinationDeg]: '30', [keys.PlaneDirectionDeg]: '60', [keys.SectionPercent]: '40' }),
      choices: choices({ ...base, [keys.Section]: 'inclined' } as Partial<ParameterChoices>),
    });
    expect(fieldKeys(kind, manual)).toContain(lateral);
    expect(fieldKeys(kind, manual)).not.toContain(`${kind}-normal-lateral`);
    let state = manual;
    for (let round = 0; round < 3; round += 1) {
      const perpendicular = settled(kind, lateralEdges(kind, state));
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
      expect(fieldKeys(kind, back)).toEqual(expect.arrayContaining([keys.PlaneInclinationDeg, keys.PlaneDirectionDeg, lateral]));
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
    const perpendicular = settled('prism', lateralEdges('prism', start));
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
    const squareFaces = groupOf('pyramid', 'Переріз', {}, chosen({})).fields.find((field) => field.type === 'face-construction');
    expect(squareFaces?.type === 'face-construction' ? squareFaces.face.options.map(({ label }) => label) : []).toEqual([
      'ABCD',
      'SAB',
      'SBC',
      'SCD',
      'SDA',
    ]);
    // A triangular pyramid's faces in the construction: four orientations, each its own, measured to the vertex opposite.
    const face = groupOf('tetrahedron', 'Переріз', {}, { tetrahedronSection: 'face-parallel' }).fields.find(
      (field) => field.type === 'face-construction',
    );
    expect(face?.type === 'face-construction' ? face.face.options.map(({ label }) => label) : []).toEqual([
      'ABC',
      'SAB',
      'SBC',
      'SCA',
    ]);
    expect(face?.type === 'face-construction' ? face.positions[0]?.labels : []).toEqual(['Від ABC', 'До S']);
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
    // The lateral edge and M picked in the construction, M at the midpoint or a ratio.
    const group = groupOf('tetrahedron', 'Переріз', {}, sc);
    const field = group.fields.find((candidate) => candidate.type === 'trace-construction');
    if (field?.type !== 'trace-construction') throw new Error('Expected the construction.');
    expect(field).toMatchObject({ label: 'Бічне ребро', target: 'lateral', title: 'SC', selected: 'C' });
    expect(field.options.map((option) => option.label)).toEqual(['SA', 'SB', 'SC']);
    expect(field.point).toMatchObject({ title: 'Середина AB', mode: 'midpoint', labels: ['AM', 'MB'] });
    expect(field.point?.options.map((option) => option.label)).toEqual(['Ребро AB']);
    expect(group.fields.some((candidate) => candidate.key === 'tetrahedronTraceVertex')).toBe(false);
    expect(labels(group)).toContain('Площина проходить через бічне ребро SC і точку ребра AB.');
  });

  it('through a base edge: only the base’s edges, and of the lateral edges those that do not meet it', () => {
    const group = groupOf('tetrahedron', 'Переріз', {}, { tetrahedronSection: 'through-line', tetrahedronLineMethod: 'point' });
    const field = group.fields.find((candidate) => candidate.type === 'through-point');
    if (field?.type !== 'through-point') throw new Error('Expected the construction.');
    expect(field.segment.baseEdge).toBe(true);
    expect(field.segment.options.map((option) => option.label)).toEqual(['AB — ребро', 'BC — ребро', 'AC — ребро']);
    expect(field.point.options.map((option) => option.label)).toEqual(['Ребро CS']);
    const result = request('tetrahedron', {}, { tetrahedronSection: 'through-line', tetrahedronLineMethod: 'point' });
    expect(result.spec?.section).toEqual({
      type: 'through-line',
      face: 'ABC',
      line: ['A', 'B'],
      method: 'point',
      pointEdge: ['C', 'S'],
      pointPercent: 50,
    });
    // C and S give the faces ABC and SAB: said at the construction, the plain solid shown meanwhile.
    for (const [first, second] of [
      ['0', '1'],
      ['1', '0'],
    ] as const) {
      const end = request(
        'tetrahedron',
        { tetrahedronPointRatioFirst: first, tetrahedronPointRatioSecond: second },
        { tetrahedronSection: 'through-line', tetrahedronLineMethod: 'point', tetrahedronPointMode: 'ratio' },
      );
      expect(end.pilotDraft).toMatchObject({ status: 'invalid', problem: 'face' });
      expect(end.spec?.section).toBeUndefined();
    }
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
    const pairs = group.fields.find((field) => field.type === 'pair-construction');
    expect(pairs).toMatchObject({ title: 'SC і AB', selected: 'S-C|A-B' });
    expect(pairs?.type === 'pair-construction' ? pairs.options.map((option) => option.label) : []).toEqual([
      'SA і BC',
      'SB і AC',
      'SC і AB',
    ]);
    expect(group.fields.some((field) => field.key === 'tetrahedron-parallel-edges')).toBe(false);
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
