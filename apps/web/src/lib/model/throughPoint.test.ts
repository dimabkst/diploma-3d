import { type BoxLikeShape, boxSection, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec, BoxSegment, BoxVertex } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { shapePanel, type ThroughPointField } from '../shapes.ts';
import { type BoxSolid, boxContextFrom, boxKeysOf } from './box.ts';
import {
  addSecondCut,
  applyPilotChoice,
  boxCutHorizontal,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  resolveModelRequest,
} from './parameters.ts';
import {
  type ConstructionDraft,
  canonicalSegment,
  constructionDraftOf,
  constructionGeometry,
  constructionTargets,
  PILOT_MESSAGES,
  pilotPlaneKind,
  pointTitle,
  throughPointSelection,
} from './throughPoint.ts';

const throughPointOf = (panel: ReturnType<typeof shapePanel>) =>
  (panel.type === 'parameters' ? panel.sections.flatMap((section) => section.fields) : []).find(
    (candidate) => candidate.type === 'through-point',
  ) as ThroughPointField;

const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
type Vec = readonly [number, number, number];

/** The pilot's construction AB₁ and M on DD₁, by midpoint or ratio, on a solid. */
const construction = (kind: BoxSolid, mode: 'midpoint' | 'ratio', ratio: readonly [string, string] = ['1', '1']) => {
  const keys = boxKeysOf(kind);
  return {
    texts: { [keys.PointRatioFirst]: ratio[0], [keys.PointRatioSecond]: ratio[1] } as Partial<ParameterTexts>,
    choices: {
      [keys.Section]: 'through-line',
      [keys.LineMethod]: 'point',
      [keys.Line]: 'A-B1',
      [keys.PointEdge]: 'D-D1',
      [keys.PointMode]: mode,
    } as Partial<ParameterChoices>,
  };
};

const SOLIDS: readonly [BoxSolid, Partial<ParameterTexts>][] = [
  ['cube', {}],
  ['cuboid', { cuboidWidthRatio: '0,6', cuboidHeightRatio: '1,4' }],
  [
    'parallelepiped',
    {
      parallelepipedBaseSideRatio: '0,7',
      parallelepipedHeightRatio: '1,1',
      parallelepipedBaseAngleDeg: '70',
      parallelepipedOffsetXRatio: '0,3',
      parallelepipedOffsetYRatio: '0,2',
    },
  ],
];

const along = (from: Vec, to: Vec, t: number): Vec => [
  from[0] + t * (to[0] - from[0]),
  from[1] + t * (to[1] - from[1]),
  from[2] + t * (to[2] - from[2]),
];
const near = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotOf = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('the pilot’s plane through a segment and a point M', () => {
  it.each(SOLIDS)(
    'makes the section A–B₁–N–M of AB₁ and M on DD₁, N on C₁D₁ with C₁N : ND₁ = DM : MD₁, on the %s',
    (kind, shape) => {
      for (const [mode, ratio, t] of [
        ['midpoint', ['1', '1'], 1 / 2],
        ['ratio', ['1', '2'], 1 / 3],
        ['ratio', ['2', '4'], 1 / 3],
      ] as const) {
        const { texts: own, choices: chosen } = construction(kind, mode, ratio);
        const request = resolveModelRequest(kind, texts({ ...shape, ...own }), choices(chosen));
        expect(request.errors).toEqual({});
        const section = request.spec?.section as BoxSectionSpec & { pointPercent: number };
        expect(section).toMatchObject({ type: 'through-line', line: ['A', 'B1'], method: 'point', pointEdge: ['D', 'D1'] });
        expect(section.pointPercent).toBeCloseTo(100 * t, 12);
        const solid = request.spec?.shape as BoxLikeShape;
        const scale = request.spec?.scale as { longestDimensionMm: number };
        const vertices = boxVertices(solid, scale);
        const { contour } = boxSection(solid, scale, { box: section });
        // An affine image of the cube's z = x + t·y: the same incidences and ratios on every parallelepiped.
        const expected = [vertices.A, vertices.B1, along(vertices.C1, vertices.D1, t), along(vertices.D, vertices.D1, t)];
        expect(contour).toHaveLength(4);
        for (const corner of expected) {
          expect(Math.min(...contour.map((point) => near(point, corner)))).toBeLessThan(1e-9 * scale.longestDimensionMm);
        }
      }
    },
  );

  it('reads a ratio in the edge’s stable order, as typed, whatever order its ends were picked or stored in', () => {
    expect(canonicalSegment(['D1', 'D'])).toEqual(['D', 'D1']);
    expect(canonicalSegment(['D1', 'C1'])).toEqual(['C1', 'D1']);
    expect(canonicalSegment(['B1', 'A'])).toEqual(['A', 'B1']);
    expect(pointTitle(['D', 'D1'], 'ratio', ['2', '4'])).toBe('DM : MD₁ = 2 : 4');
    expect(pointTitle(['D', 'D1'], 'midpoint', ['2', '4'])).toBe('Середина DD₁');
    // Picked B₁ then A, and DD₁ from its far end: the construction chosen from the lists.
    const start: ParameterState = { texts: texts(), choices: choices({ cubeSection: 'through-line', cubeLineMethod: 'point' }) };
    const values = resolveModelRequest('cube', start.texts, start.choices).values;
    const segment = applyPilotChoice('cube', start, values, { kind: 'segment', segment: ['B1', 'A'] });
    const point = applyPilotChoice('cube', segment, values, { kind: 'point-edge', edge: ['D1', 'D'] });
    const listed = construction('cube', 'midpoint');
    expect(resolveModelRequest('cube', point.texts, point.choices).spec?.section).toEqual(
      resolveModelRequest('cube', texts(listed.texts), choices(listed.choices)).spec?.section,
    );
  });

  it('keeps every choice through a segment that gives a face with M, says so, and shows the plain solid meanwhile', () => {
    const pick = (state: ParameterState, segment: BoxSegment) =>
      applyPilotChoice('cube', state, resolveModelRequest('cube', state.texts, state.choices).values, {
        kind: 'segment',
        segment,
      });
    const { texts: own, choices: chosen } = construction('cube', 'midpoint', ['1', '2']);
    // A: AB₁ and M at the midpoint of DD₁, the section A–B₁–N–M.
    const valid: ParameterState = { texts: texts(own), choices: choices(chosen) };
    const first = resolveModelRequest('cube', valid.texts, valid.choices);
    expect(first.pilotDraft).toEqual({ status: 'valid', percent: 50 });
    // B: A₁D₁ with the same M lies in the face ADD₁A₁; M keeps its edge, mode and ratio.
    const face = pick(valid, ['A1', 'D1']);
    expect(face.choices).toMatchObject({ cubeLine: 'A1-D1', cubePointEdge: 'D-D1', cubePointMode: 'midpoint' });
    expect(face.texts).toEqual(valid.texts);
    const drafted = resolveModelRequest('cube', face.texts, face.choices);
    expect(drafted.pilotDraft).toEqual({ status: 'invalid', problem: 'face', message: PILOT_MESSAGES.face });
    expect(drafted.errors).toEqual({});
    // The plain solid is shown, under a key of its own: it is not the section's file to download.
    expect(drafted.spec?.section).toBeUndefined();
    expect(drafted.key?.endsWith(':construction-draft')).toBe(true);
    const selection = throughPointSelection(boxKeysOf('cube'), face.choices as never, boxContextFrom('cube', {}, face.choices));
    expect(selection).toMatchObject({ segment: ['A1', 'D1'], pointEdge: ['D', 'D1'], pointEdgeEligible: false });
    // C: back to AB₁, the same section at once.
    const back = pick(face, ['A', 'B1']);
    expect(resolveModelRequest('cube', back.texts, back.choices).spec).toEqual(first.spec);
    // D: A₁D₁ kept, M at the midpoint of BB₁: a section through the interior.
    const other = applyPilotChoice('cube', face, drafted.values, { kind: 'point-edge', edge: ['B', 'B1'] });
    const cut = resolveModelRequest('cube', other.texts, other.choices);
    expect(cut.pilotDraft).toEqual({ status: 'valid', percent: 50 });
    expect(cut.spec?.section).toMatchObject({ line: ['A1', 'D1'], pointEdge: ['B', 'B1'], pointPercent: 50 });
  });

  it('tells the next choice, a point on the line and a part too thin apart, before any plane is made', () => {
    const at = (overrides: Partial<ParameterChoices>, ratio: readonly [string, string] = ['1', '1']) =>
      resolveModelRequest(
        'cube',
        texts({ cubePointRatioFirst: ratio[0], cubePointRatioSecond: ratio[1] }),
        choices({ cubeSection: 'through-line', cubeLineMethod: 'point', cubePointMode: 'ratio', ...overrides }),
      );
    // No edge for M, or a body diagonal, which is no segment: the next step, neutrally.
    expect(at({ cubeLine: 'A-B1', cubePointEdge: '' }).pilotDraft).toEqual({
      status: 'incomplete',
      message: PILOT_MESSAGES.pointEdge,
    });
    expect(at({ cubeLine: 'A-C1', cubePointEdge: 'D-D1' }).pilotDraft).toEqual({
      status: 'incomplete',
      message: PILOT_MESSAGES.segment,
    });
    // M at A, an end of AD, lies on AB₁; anywhere else on AD the plane AB₁D cuts the cube.
    expect(at({ cubeLine: 'A-B1', cubePointEdge: 'A-D' }, ['0', '1']).pilotDraft).toEqual({
      status: 'invalid',
      problem: 'collinear',
      message: PILOT_MESSAGES.collinear,
    });
    expect(at({ cubeLine: 'A-B1', cubePointEdge: 'A-D' }, ['1', '0']).pilotDraft).toEqual({ status: 'valid', percent: 100 });
    // M near A₁ with B₁D₁ cuts off a corner too thin to print: the section's own check, said at the construction.
    const thin = at({ cubeLine: 'B1-D1', cubePointEdge: 'A-A1' }, ['99', '1']);
    expect(thin.pilotDraft).toMatchObject({ status: 'invalid', problem: 'thin' });
    expect(thin.errors).toEqual({});
    expect(thin.spec?.section).toBeUndefined();
    for (const request of [thin, at({ cubeLine: 'A-B1', cubePointEdge: 'A-D' }, ['0', '1'])]) {
      expect(request.key?.endsWith(':construction-draft')).toBe(true);
    }
  });

  it('classifies a plane through the segment and M by the vertices on its two sides, at any scale', () => {
    const cube = { kind: 'cube' } as BoxLikeShape;
    const topology = boxContextFrom('cube', {}, choices()).topology;
    expect(pilotPlaneKind(cube, topology, ['A', 'B1'], ['D', 'D1'], 50)).toBe('cut');
    expect(pilotPlaneKind(cube, topology, ['A1', 'D1'], ['D', 'D1'], 50)).toBe('face');
    expect(pilotPlaneKind(cube, topology, ['A1', 'D1'], ['D', 'D1'], 37.5)).toBe('face');
    expect(pilotPlaneKind(cube, topology, ['A', 'B1'], ['A', 'D'], 0)).toBe('collinear');
    // The plane AB₁D₁ meets the cube in the triangle AB₁D₁ and cuts off A₁ alone.
    expect(pilotPlaneKind(cube, topology, ['A', 'B1'], ['D', 'D1'], 100)).toBe('cut');
    // An oblique parallelepiped: the same incidences.
    const oblique = resolveModelRequest(
      'parallelepiped',
      texts({ parallelepipedBaseAngleDeg: '70', parallelepipedOffsetXRatio: '0,3', parallelepipedOffsetYRatio: '0,2' }),
      choices(),
    ).spec?.shape as BoxLikeShape;
    expect(pilotPlaneKind(oblique, topology, ['A1', 'D1'], ['D', 'D1'], 50)).toBe('face');
    expect(pilotPlaneKind(oblique, topology, ['A1', 'D1'], ['B', 'B1'], 50)).toBe('cut');
  });

  it('makes no plane of an unfinished construction anywhere a panel or an action asks for one', () => {
    const pilot = { cubeSection: 'through-line', cubeLineMethod: 'point', cubePointMode: 'midpoint' } as const;
    for (const unfinished of [
      { cubePointEdge: '' },
      // A₁D₁ and the midpoint of DD₁: the face ADD₁A₁.
      { cubeLine: 'A1-D1', cubePointEdge: 'D-D1' },
      { cubeLine: 'A-C1', cubePointEdge: 'D-D1' },
    ] as const) {
      const state: ParameterState = { texts: texts(), choices: choices({ ...pilot, ...unfinished }) };
      const request = resolveModelRequest('cube', state.texts, state.choices);
      expect(request.pilotDraft?.status).not.toBe('valid');
      expect(request.spec?.section).toBeUndefined();
      expect(boxCutHorizontal('cube', state.choices, request.values)).toBe(false);
      expect(() => shapePanel('cube', state.choices, request)).not.toThrow();
      // The second plane starts as for a first plane through the centre.
      expect(addSecondCut('cube', state, request.values).texts.cubeSectionSecondPercent).toBe('70');
    }
    // A ratio of zeros has no plane either.
    const zeros: ParameterState = {
      texts: texts({ cubePointRatioFirst: '0', cubePointRatioSecond: '0' }),
      choices: choices({ ...pilot, cubeLine: 'A-B1', cubePointEdge: 'D-D1', cubePointMode: 'ratio' }),
    };
    const { values } = resolveModelRequest('cube', zeros.texts, zeros.choices);
    expect(boxCutHorizontal('cube', zeros.choices, values)).toBe(false);
    expect(addSecondCut('cube', zeros, values).texts.cubeSectionSecondPercent).toBe('70');
  });

  it('says what is wrong with the ratio beside it, as typed, without blocking the plain solid', () => {
    const { choices: chosen } = construction('cube', 'ratio');
    for (const [first, second, invalid] of [
      ['', '2', [true, false]],
      ['1', '-1', [false, true]],
      ['0', '0', [true, true]],
      ['abc', '1', [true, false]],
    ] as const) {
      const all = choices(chosen);
      const request = resolveModelRequest('cube', texts({ cubePointRatioFirst: first, cubePointRatioSecond: second }), all);
      expect(request.errors).toEqual({});
      expect(request.pilotDraft).toMatchObject({ status: 'invalid', problem: 'ratio' });
      expect(request.spec?.section).toBeUndefined();
      const field = throughPointOf(shapePanel('cube', all, request));
      expect(field.point.ratioInvalid).toEqual(invalid);
      expect(field.point.ratioError).toBe((request.pilotDraft as { message: string }).message);
      expect(field.status).toBeUndefined();
    }
    // An end of the edge where it gives a section: D, at 0 : 1, with AB₁.
    const end = resolveModelRequest('cube', texts({ cubePointRatioFirst: '0', cubePointRatioSecond: '1' }), choices(chosen));
    expect(end.errors).toEqual({});
    expect(end.spec?.section).toMatchObject({ pointPercent: 0 });
  });

  it('keeps the construction while the solid changes, and its second parallel plane alongside', () => {
    const { texts: own, choices: chosen } = construction('cuboid', 'ratio', ['1', '2']);
    for (const ratios of [
      { cuboidWidthRatio: '0,6', cuboidHeightRatio: '1,4' },
      { cuboidWidthRatio: '1,3', cuboidHeightRatio: '0,8' },
    ]) {
      expect(resolveModelRequest('cuboid', texts({ ...own, ...ratios }), choices(chosen)).spec?.section).toMatchObject({
        line: ['A', 'B1'],
        pointEdge: ['D', 'D1'],
        pointPercent: 100 / 3,
      });
    }
    const paired = resolveModelRequest(
      'cuboid',
      texts({ ...own, cuboidSectionSecondPercent: '80' }),
      choices({ ...chosen, cuboidSecondCut: true }),
    );
    expect(paired.errors).toEqual({});
    expect(paired.spec?.section).toMatchObject({ pointPercent: 100 / 3, secondPositionPercent: 80 });
  });

  it('says a face at the construction, keeps its edge named, and holds back what needs a section', () => {
    const all = choices({
      cubeSection: 'through-line',
      cubeLineMethod: 'point',
      cubeLine: 'A1-D1',
      cubePointEdge: 'D-D1',
      cubePointMode: 'midpoint',
    });
    const request = resolveModelRequest('cube', texts(), all);
    const panel = shapePanel('cube', all, request);
    const fields = panel.type === 'parameters' ? panel.sections.flatMap((section) => section.fields) : [];
    const field = throughPointOf(panel);
    expect(field.status).toEqual({ tone: 'warning', text: PILOT_MESSAGES.face });
    expect(field.point).toMatchObject({ title: 'Середина DD₁', selected: 'D-D1' });
    expect(field.point.options).toContainEqual({ value: 'D-D1', label: 'Ребро DD₁ — не дає перерізу', disabled: true });
    expect(fields.find((candidate) => candidate.key === 'cube-add-second-cut')).toMatchObject({ disabled: true });
    expect(fields.find((candidate) => candidate.key === 'cubePartsSeparated')).toMatchObject({
      disabled: true,
      describedBy: 'cube-construction-blocked',
    });
    expect(fields.some((candidate) => candidate.key === 'cube-construction-blocked')).toBe(true);
    // A valid construction offers all of it again.
    const valid = choices({ ...all, cubeLine: 'A-B1' });
    const restored = shapePanel('cube', valid, resolveModelRequest('cube', texts(), valid));
    const again = restored.type === 'parameters' ? restored.sections.flatMap((section) => section.fields) : [];
    expect(throughPointOf(restored).status).toBeUndefined();
    expect(again.find((candidate) => candidate.key === 'cube-add-second-cut')).not.toHaveProperty('disabled');
    expect(again.some((candidate) => candidate.key === 'cube-construction-blocked')).toBe(false);
  });

  it('shows its two fields with their values, and offers on the model what the lists offer', () => {
    const { texts: own, choices: chosen } = construction('parallelepiped', 'ratio', ['2', '4']);
    const all = choices(chosen);
    const request = resolveModelRequest('parallelepiped', texts(own), all);
    const panel = shapePanel('parallelepiped', all, {
      values: request.values,
      construction: { field: 'point', pending: undefined, notice: undefined },
    });
    const field = (panel.type === 'parameters' ? panel.sections.flatMap((section) => section.fields) : []).find(
      (candidate) => candidate.type === 'through-point',
    ) as ThroughPointField;
    expect(field).toMatchObject({
      open: 'point',
      segment: { title: 'AB₁', selected: 'A-B1' },
      point: { title: 'DM : MD₁ = 2 : 4', selected: 'D-D1', mode: 'ratio', labels: ['DM', 'MD₁'] },
    });
    // No face to choose, and no body diagonal among the segments.
    expect(field.segment.options.map(({ label }) => label)).toContain('AB₁ — діагональ грані');
    expect(field.segment.options.map(({ label }) => label)).not.toContain('AC₁ — діагональ грані');
    const selection = throughPointSelection(
      boxKeysOf('parallelepiped'),
      all as never,
      boxContextFrom('parallelepiped', request.values, all),
    );
    const point = constructionTargets('point', selection, undefined);
    expect(point.edgeTargets).toEqual(field.point.options.map(({ value }) => value));
    expect(point.vertexTargets).toEqual([]);
    // With A picked first, its completions: the vertices of the faces through A, never C₁ across the body.
    const segment = constructionTargets('segment', selection, 'A');
    expect(segment.vertexTargets).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', 'A1', 'B1', 'D1']));
    expect(segment.vertexTargets).not.toContain('C1' satisfies BoxVertex);
  });

  it('draws the segment, M and both sections from one draft at once: M and the segment in the plane of the sections drawn', () => {
    for (const [kind, shape] of SOLIDS) {
      const keys = boxKeysOf(kind);
      const { texts: own, choices: chosen } = construction(kind, 'ratio', ['1', '2']);
      const all = choices({ ...chosen, [keys.SecondCut]: true } as Partial<ParameterChoices>);
      const typed = texts({ ...shape, ...own, [keys.SectionSecondPercent]: '75' } as Partial<ParameterTexts>);
      const request = resolveModelRequest(kind, typed, all);
      expect(request.errors).toEqual({});
      const solid = request.spec?.shape as BoxLikeShape;
      const scale = request.spec?.scale as { longestDimensionMm: number };
      const selection = throughPointSelection(keys, all as never, boxContextFrom(kind, request.values, all));
      const draft = constructionDraftOf(keys, selection, request.values, request.pilotDraft, 75);
      const geometry = constructionGeometry(solid, scale, draft);
      if (geometry === undefined) throw new Error('Expected a construction.');
      expect(geometry.edges).toHaveLength(12);
      for (const edge of geometry.edges) expect(edge.faces).toHaveLength(2);
      expect(geometry.faces).toHaveLength(6);
      for (const faces of Object.values(geometry.vertexFaces)) expect(faces).toHaveLength(3);
      expect(geometry.segment).toEqual({ ends: ['A', 'B1'], diagonal: true });
      const [first, second] = geometry.sections as [readonly string[], readonly string[]];
      expect(first).toHaveLength(4);
      expect(second.length).toBeGreaterThanOrEqual(3);
      // The first section's plane, from three of its corners: M, A and B₁ lie in it, the second section parallel to it.
      const corner = (id: string) => geometry.points[id] as Vec;
      const [p, q, r] = first.map(corner) as [Vec, Vec, Vec];
      const normal = cross(minus(q, p), minus(r, p));
      const distance = (point: Vec) => Math.abs(dotOf(normal, minus(point, p))) / Math.hypot(...normal);
      const size = scale.longestDimensionMm / 1000;
      for (const id of ['M', 'A', 'B1', ...first]) expect(distance(corner(id))).toBeLessThan(1e-9 * size);
      const offsets = second.map((id) => distance(corner(id)));
      for (const offset of offsets) expect(offset).toBeCloseTo(offsets[0] as number, 12);
      expect(offsets[0]).toBeGreaterThan(1e-3 * size);
      // M at DM : MD₁ = 1 : 2.
      expect(near(corner('M'), along(corner('D'), corner('D1'), 1 / 3))).toBeLessThan(1e-9 * size);
    }
  });

  it('draws a draft that gives no section with its segment and M only, and no M while the ratio is not valid', () => {
    const solid = { kind: 'cube' } as BoxLikeShape;
    const scale = { longestDimensionMm: 80 };
    const face = constructionGeometry(solid, scale, {
      segment: ['A1', 'D1'],
      pointEdge: ['D', 'D1'],
      pointEdgeEligible: false,
      percent: 50,
      plane: undefined,
    });
    expect(face?.segment).toEqual({ ends: ['A1', 'D1'], diagonal: false });
    expect(face?.pointEdge).toEqual({ ends: ['D', 'D1'], eligible: false });
    expect(face?.m).toBe('M');
    expect(face?.sections).toEqual([]);
    const draft: ConstructionDraft = {
      segment: ['A', 'B1'],
      pointEdge: ['D', 'D1'],
      pointEdgeEligible: true,
      percent: undefined,
      plane: undefined,
    };
    expect(constructionGeometry(solid, scale, draft)?.m).toBeUndefined();
    // The plane is built from the draft alone: no model, built or still building, takes part.
    const plane = constructionDraftOf(
      boxKeysOf('cube'),
      throughPointSelection(
        boxKeysOf('cube'),
        choices(construction('cube', 'midpoint').choices) as never,
        boxContextFrom('cube', {}, choices()),
      ),
      {},
      { status: 'valid', percent: 50 },
      undefined,
    ).plane;
    expect(plane).toEqual({
      type: 'through-line',
      face: 'ABB1A1',
      line: ['A', 'B1'],
      method: 'point',
      pointEdge: ['D', 'D1'],
      pointPercent: 50,
    });
  });
});
