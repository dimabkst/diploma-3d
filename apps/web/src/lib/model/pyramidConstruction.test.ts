import { type BoxLikeShape, boxPlane, boxSection, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec, BoxSegment, BoxVertex } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { shapePanel } from '../shapes.ts';
import { type BoxSolid, boxKeysOf } from './box.ts';
import {
  applyPilotChoice,
  followNormal,
  initialParameterChoices,
  initialParameterTexts,
  normalAlongManual,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  type PilotChoice,
  resolveModelRequest,
} from './parameters.ts';

type Vec = readonly [number, number, number];
const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along = (a: Vec, b: Vec, t: number): Vec => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
const middle = (a: Vec, b: Vec) => along(a, b, 0.5);
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};
/** A tetrahedron's volume from its four corners. */
const volume = (a: Vec, b: Vec, c: Vec, d: Vec) => Math.abs(dot(minus(b, a), cross(minus(c, a), minus(d, a)))) / 6;
/** A planar polygon's area from its corners in order. */
const area = (points: readonly Vec[]) => {
  const sum = points.reduce<Vec>(
    (total, point, index) => {
      const next = points[(index + 1) % points.length] as Vec;
      const term = cross(point, next);
      return [total[0] + term[0], total[1] + term[1], total[2] + term[2]];
    },
    [0, 0, 0],
  );
  return Math.hypot(...sum) / 2;
};

/** The triangular pyramids: the regular tetrahedron, a regular pyramid, a leaning one, and a leaning one over a scalene base. */
const PYRAMIDS: readonly [string, BoxSolid, Partial<ParameterChoices>, Partial<ParameterTexts>][] = [
  ['the regular tetrahedron', 'tetrahedron', {}, {}],
  ['a regular triangular pyramid', 'pyramid', { pyramidBaseType: 'regular', pyramidBaseSides: 3 }, {}],
  [
    'an oblique triangular pyramid',
    'pyramid',
    { pyramidBaseType: 'regular', pyramidBaseSides: 3 },
    { pyramidApexXRatio: '0,6', pyramidApexYRatio: '-0,3' },
  ],
  [
    'an oblique pyramid over a scalene triangle',
    'pyramid',
    { pyramidBaseType: 'triangle' },
    { pyramidTriangleSideRatio: '1,4', pyramidTriangleAngleDeg: '70', pyramidApexXRatio: '-0,4', pyramidApexYRatio: '0,5' },
  ],
];

const TOLERANCE = 1e-9;

describe.each(PYRAMIDS)('the constructions of %s SABC', (_, kind, base, shape) => {
  const keys = boxKeysOf(kind);
  const state = (own: Partial<ParameterChoices>, typed: Partial<ParameterTexts> = {}): ParameterState => ({
    texts: texts({ ...shape, ...typed }),
    choices: choices({ ...base, ...own }),
  });
  const own = (fields: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(fields).map(([field, value]) => [`${kind}${field}`, value])) as Partial<ParameterChoices>;
  const typed = (fields: Record<string, string>) =>
    Object.fromEntries(Object.entries(fields).map(([field, value]) => [`${kind}${field}`, value])) as Partial<ParameterTexts>;
  const resolve = (current: ParameterState) =>
    resolveModelRequest(kind, current.texts, current.choices, { exact: current.exact ?? {}, connectorEdits: {} });
  const choose = (current: ParameterState, choice: PilotChoice) =>
    applyPilotChoice(kind, current, resolve(current).values, choice);
  const fieldsOf = (current: ParameterState) => {
    const panel = shapePanel(kind, current.choices, resolve(current));
    return panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : [];
  };
  function planeOf(current: ParameterState) {
    const request = resolve(current);
    expect(request.errors).toEqual({});
    const spec = request.spec;
    if (spec?.section === undefined) throw new Error(`Expected a section: ${JSON.stringify(request.pilotDraft)}`);
    const v = boxVertices(spec.shape as BoxLikeShape, spec.scale) as Readonly<Record<BoxVertex, Vec>>;
    const section = spec.section as BoxSectionSpec;
    const { normal, offset } = boxPlane(v, section);
    const { contour } = boxSection(spec.shape as BoxLikeShape, spec.scale, { box: section });
    return { normal: normal as Vec, offset, v, contour: contour as readonly Vec[], section };
  }
  const on = (plane: ReturnType<typeof planeOf>, point: Vec) => Math.abs(dot(plane.normal, point) - plane.offset);
  /** That the contour's corners are exactly these points, in some order. */
  const expectCorners = (plane: ReturnType<typeof planeOf>, points: readonly Vec[]) => {
    expect(plane.contour).toHaveLength(points.length);
    for (const point of points) {
      expect(Math.min(...plane.contour.map((corner) => Math.hypot(...minus(corner, point))))).toBeLessThan(1e-7);
    }
  };

  it('has 4 vertices, 6 edges, 4 faces; its «Перпендикулярно до» lists the 6 edges only', () => {
    const fields = fieldsOf(state(own({ Section: 'inclined' })));
    const normal = fields.find((field) => field.type === 'normal-construction');
    if (normal?.type !== 'normal-construction') throw new Error('Expected the field.');
    expect(normal.options.map(({ label }) => label)).toEqual(['AB', 'BC', 'CA', 'SA', 'SB', 'SC']);
    expect(new Set(normal.options.map(({ group }) => group))).toEqual(new Set(['Ребра']));
  });

  it('A: parallel to ABC at 1 : 1, through the midpoints of SA, SB, SC: a quarter of the base, an eighth of the solid at S', () => {
    const plane = planeOf(state(own({ Section: 'face-parallel', Face: 'ABC', FaceMode: 'midpoint' })));
    const { S, A, B, C } = plane.v;
    expectCorners(plane, [middle(S, A), middle(S, B), middle(S, C)]);
    expect(area(plane.contour) / area([A, B, C])).toBeCloseTo(1 / 4, 12);
    expect(volume(S, middle(S, A), middle(S, B), middle(S, C)) / volume(S, A, B, C)).toBeCloseTo(1 / 8, 12);
    // Measured to the vertex S opposite, its ratio fields named so.
    const field = fieldsOf(state(own({ Section: 'face-parallel', Face: 'ABC', FaceMode: 'ratio' }))).find(
      (candidate) => candidate.type === 'face-construction',
    );
    if (field?.type !== 'face-construction') throw new Error('Expected the field.');
    expect(field.face).toMatchObject({ opposite: 'S', oppositeVertex: true, oppositeEdge: false });
    expect(field.face.options).toHaveLength(4);
    expect(field.positions[0]?.labels).toEqual(['Від ABC', 'До S']);
  });

  it('B: parallel to SAB at 1 : 1 through the midpoints of CA, CB and CS; at 1 : 2 a third of the gap to C', () => {
    const plane = planeOf(state(own({ Section: 'face-parallel', Face: 'SAB', FaceMode: 'midpoint' })));
    const { S, A, B, C } = plane.v;
    expectCorners(plane, [middle(C, A), middle(C, B), middle(C, S)]);
    const third = planeOf(
      state(
        own({ Section: 'face-parallel', Face: 'SAB', FaceMode: 'ratio' }),
        typed({ FaceRatioFirst: '1', FaceRatioSecond: '2' }),
      ),
    );
    // d_section = d_face + t (d_far − d_face), t = 1/3, along the face's normal: the points a third of the way from the face to C.
    for (const vertex of [S, A, B]) expect(on(third, along(vertex, C, 1 / 3))).toBeLessThan(1e-7);
    // At C itself the plane only touches the solid: said at the construction.
    const atC = resolve(
      state(
        own({ Section: 'face-parallel', Face: 'SAB', FaceMode: 'ratio' }),
        typed({ FaceRatioFirst: '1', FaceRatioSecond: '0' }),
      ),
    );
    expect(atC.pilotDraft).toMatchObject({ status: 'invalid', problem: 'boundary' });
    expect((atC.pilotDraft as { message: string }).message).toContain('лише проходить через вершину C');
  });

  it('C: AB and M on CS: the triangle ABM, halves at the midpoint, a third at C for CM : MS = 1 : 2; neither end a section', () => {
    const through = own({ Section: 'through-line', LineMethod: 'point', Line: 'A-B', PointEdge: 'C-S' });
    const half = planeOf(state({ ...through, ...own({ PointMode: 'midpoint' }) }));
    const { S, A, B, C } = half.v;
    expectCorners(half, [A, B, middle(C, S)]);
    expect(volume(A, B, C, middle(C, S)) / volume(S, A, B, C)).toBeCloseTo(1 / 2, 12);
    const ratio = state({ ...through, ...own({ PointMode: 'ratio' }) }, typed({ PointRatioFirst: '1', PointRatioSecond: '2' }));
    const third = planeOf(ratio);
    const m = along(C, S, 1 / 3);
    expectCorners(third, [A, B, m]);
    expect(volume(A, B, C, m) / volume(S, A, B, C)).toBeCloseTo(1 / 3, 12);
    const field = fieldsOf(ratio).find((candidate) => candidate.type === 'through-point');
    expect(field?.type === 'through-point' ? field.point.title : '').toBe('CM : MS = 1 : 2');
    // Only base edges for the segment, and for AB only CS for M: SA and SB would give the face SAB.
    expect(field?.type === 'through-point' ? field.point.options.map(({ label }) => label) : []).toEqual(['Ребро CS']);
    expect(field?.type === 'through-point' ? field.segment.options.every(({ value }) => !value.includes('S')) : false).toBe(true);
    for (const ends of [
      ['0', '1'],
      ['1', '0'],
    ] as const) {
      const end = resolve(
        state({ ...through, ...own({ PointMode: 'ratio' }) }, typed({ PointRatioFirst: ends[0], PointRatioSecond: ends[1] })),
      );
      expect(end.pilotDraft).toMatchObject({ status: 'invalid', problem: 'face' });
    }
  });

  it('D: through SA and M on BC: the triangle SAM, BM : MC labelled, kept on the edge as the apex moves; neither end a section', () => {
    const apex = own({ Section: 'through-apex', Trace: 'edge-point', TraceVertex: 'A', TraceSegment: 'B-C' });
    const plane = planeOf(state(apex));
    const { S, A, B, C } = plane.v;
    expectCorners(plane, [S, A, middle(B, C)]);
    const ratio = state(
      { ...apex, ...own({ TracePointMode: 'ratio' }) },
      typed({ TracePointRatioFirst: '1', TracePointRatioSecond: '2' }),
    );
    const third = planeOf(ratio);
    expectCorners(third, [S, A, along(B, C, 1 / 3)]);
    const field = fieldsOf(ratio).find((candidate) => candidate.type === 'trace-construction');
    if (field?.type !== 'trace-construction') throw new Error('Expected the field.');
    expect(field).toMatchObject({ title: 'SA', target: 'lateral' });
    expect(field.point).toMatchObject({ title: 'BM : MC = 1 : 2', labels: ['BM', 'MC'] });
    // The apex moved: the same semantic M, the same ratio along BC.
    if (kind === 'pyramid') {
      const moved = planeOf({ ...ratio, texts: { ...ratio.texts, pyramidApexXRatio: '-0,5', pyramidHeightRatio: '1,3' } });
      expectCorners(moved, [moved.v.S, moved.v.A, along(moved.v.B, moved.v.C, 1 / 3)]);
    }
    for (const ends of [
      ['0', '1'],
      ['1', '0'],
    ] as const) {
      const end = resolve(
        state(
          { ...apex, ...own({ TracePointMode: 'ratio' }) },
          typed({ TracePointRatioFirst: ends[0], TracePointRatioSecond: ends[1] }),
        ),
      );
      expect(end.pilotDraft).toMatchObject({ status: 'invalid', problem: 'face' });
      expect((end.pilotDraft as { message: string }).message).toMatch(
        /^Точка M збігається з вершиною [BC]: площина SA[BC] — грань піраміди\./,
      );
    }
    // The lateral edge picked by itself or by its base vertex, either way the same choice.
    const start = state(apex);
    expect(choose(start, { kind: 'trace-vertex', vertex: 'B' }).choices[keys.TraceVertex]).toBe('B');
    expect(choose(start, { kind: 'trace-vertex', vertex: 'S' })).toBe(start);
  });

  it('through SV and the height SH: the plane holds the actual foot H, which a leaning apex moves off the centroid', () => {
    const plane = planeOf(state(own({ Section: 'through-apex', Trace: 'height-edge', TraceVertex: 'B' })));
    const { S, B } = plane.v;
    const foot: Vec = [S[0], S[1], 0];
    for (const point of [S, B, foot]) expect(on(plane, point)).toBeLessThan(TOLERANCE);
    // A second parallel plane is parallel only: it does not pass through the apex.
    const two = planeOf({
      ...state(
        own({ Section: 'through-apex', Trace: 'height-edge', TraceVertex: 'B', SecondCut: true }),
        typed({ SectionSecondPercent: '25' }),
      ),
    });
    expect(two.section).toMatchObject({ secondPositionPercent: 25 });
    const { contour } = boxSection(
      resolve(state(own({}))).spec?.shape as BoxLikeShape,
      { longestDimensionMm: 80 },
      { box: two.section, atSecond: true },
    );
    expect(contour.length).toBeGreaterThanOrEqual(3);
  });

  it('E: parallel to SA and BC, picked by either edge: a parallelogram, n ∥ SA × BC; a square halfway in the regular tetrahedron', () => {
    const inclined = state(own({ Section: 'inclined' }));
    const bySA = choose(inclined, { kind: 'pair', segment: ['A', 'S'] });
    const byBC = choose(inclined, { kind: 'pair', segment: ['C', 'B'] });
    expect(bySA.choices[keys.ParallelEdges]).toBe('S-A|B-C');
    expect(byBC.choices).toEqual(bySA.choices);
    expect(choose(bySA, { kind: 'pair', segment: ['B', 'C'] })).toBe(bySA);
    const plane = planeOf(bySA);
    const { S, A, B, C } = plane.v;
    expect(Math.hypot(...cross(plane.normal, unit(cross(minus(A, S), minus(C, B)))))).toBeLessThan(1e-9);
    // It holds neither edge: the plane is parallel to both, halfway between their supporting planes.
    expect(on(plane, S)).toBeGreaterThan(1e-3);
    expect(on(plane, B)).toBeGreaterThan(1e-3);
    expect(plane.contour).toHaveLength(4);
    const [p, q, r, t] = plane.contour as [Vec, Vec, Vec, Vec];
    // Opposite sides parallel: a parallelogram.
    expect(Math.hypot(...cross(unit(minus(q, p)), unit(minus(r, t))))).toBeLessThan(1e-9);
    expect(Math.hypot(...cross(unit(minus(t, p)), unit(minus(r, q))))).toBeLessThan(1e-9);
    const square =
      Math.abs(Math.hypot(...minus(q, p)) - Math.hypot(...minus(t, p))) < 1e-9 && Math.abs(dot(minus(q, p), minus(t, p))) < 1e-9;
    expect(square).toBe(kind === 'tetrahedron');
  });

  it('F: perpendicular to SA only, then given by its angles again without moving', () => {
    const picked = choose(state(own({ Section: 'inclined' }), typed({ SectionPercent: '35' })), {
      kind: 'normal',
      segment: ['S', 'A'],
    });
    const plane = planeOf(picked);
    const { S, A } = plane.v;
    expect(Math.hypot(...cross(plane.normal, unit(minus(A, S))))).toBeLessThan(1e-9);
    const notes = fieldsOf(picked).flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(notes.some((text) => text.includes('бічних ребер'))).toBe(false);
    let next = picked;
    for (let round = 0; round < 3; round += 1) next = followNormal(kind, next, resolve(next).values) ?? next;
    next = normalAlongManual(kind, next);
    for (let round = 0; round < 3; round += 1) next = followNormal(kind, next, resolve(next).values) ?? next;
    expect(next.choices[keys.NormalAlong]).toBe('none');
    const after = planeOf(next);
    const sign = Math.sign(dot(after.normal, plane.normal));
    for (const axis of [0, 1, 2] as const) expect(sign * after.normal[axis]).toBeCloseTo(plane.normal[axis], 9);
    expect(sign * after.offset).toBeCloseTo(plane.offset, 6);
  });

  it('the base lines through the apex: the median’s vertex picked, the plane through S and the median', () => {
    const current = choose(state(own({ Section: 'through-apex', Trace: 'median' })), { kind: 'trace-vertex', vertex: 'B' });
    const plane = planeOf(current);
    const { S, A, B, C } = plane.v;
    for (const point of [S, B, middle(A, C)]) expect(on(plane, point)).toBeLessThan(TOLERANCE);
  });

  it('through a base edge at an angle: offered only towards a usable plane, either reference face', () => {
    for (const face of ['ABC', 'SAB'] as const) {
      for (const angle of ['30', '55', '75']) {
        for (const side of ['first', 'second'] as const) {
          const current = state(
            own({ Section: 'through-line', LineMethod: 'angle', Line: 'A-B', LineFace: face, LineSide: side }),
            typed({ LineDihedralDeg: angle }),
          );
          const draft = resolve(current).pilotDraft;
          const offered = draft !== undefined && 'alternative' in draft && draft.alternative === true;
          const after = choose(current, { kind: 'angle-side' });
          if (!offered) {
            expect(after).toBe(current);
            continue;
          }
          expect(resolve(after).pilotDraft?.status).toBe('valid');
        }
      }
      // The plane at an angle to the face actually holds AB.
      const valid = state(
        own({ Section: 'through-line', LineMethod: 'angle', Line: 'A-B', LineFace: face }),
        typed({ LineDihedralDeg: '60' }),
      );
      if (resolve(valid).spec?.section !== undefined) {
        const plane = planeOf(valid);
        for (const vertex of ['A', 'B'] as const) expect(on(plane, plane.v[vertex])).toBeLessThan(TOLERANCE);
      }
    }
  });
});

describe('a regular tetrahedron picked by the same pair whichever edge', () => {
  it('maps each edge to its pair', () => {
    const start: ParameterState = { texts: texts(), choices: choices({ tetrahedronSection: 'inclined' }) };
    const values = resolveModelRequest('tetrahedron', start.texts, start.choices).values;
    const pairs = (['S-A', 'B-C', 'S-B', 'A-C', 'S-C', 'A-B'] as const).map(
      (edge) =>
        applyPilotChoice('tetrahedron', start, values, { kind: 'pair', segment: edge.split('-') as unknown as BoxSegment })
          .choices.tetrahedronParallelEdges,
    );
    expect(pairs).toEqual(['S-A|B-C', 'S-A|B-C', 'S-B|A-C', 'S-B|A-C', 'S-C|A-B', 'S-C|A-B']);
  });
});

/** The other pyramids: over a square, a parallelogram, a trapezoid, a regular pentagon, hexagon and octagon, upright and leaning. */
const NGONS: readonly [string, Partial<ParameterChoices>][] = [
  ['square', { pyramidBaseType: 'regular', pyramidBaseSides: 4 }],
  ['parallelogram', { pyramidBaseType: 'parallelogram' }],
  ['trapezoid', { pyramidBaseType: 'trapezoid' }],
  ['pentagon', { pyramidBaseType: 'regular', pyramidBaseSides: 5 }],
  ['hexagon', { pyramidBaseType: 'regular', pyramidBaseSides: 6 }],
  ['octagon', { pyramidBaseType: 'regular', pyramidBaseSides: 8 }],
];
const APEXES: readonly [string, Partial<ParameterTexts>][] = [
  ['upright', {}],
  ['leaning', { pyramidApexXRatio: '0,25', pyramidApexYRatio: '-0,15' }],
];

describe.each(NGONS.flatMap(([name, base]) => APEXES.map(([apex, shape]) => [`${apex} ${name}`, base, shape] as const)))(
  'the constructions of the %s pyramid',
  (_, base, shape) => {
    const state = (own: Partial<ParameterChoices>, typed: Partial<ParameterTexts> = {}): ParameterState => ({
      texts: texts({ ...shape, ...typed }),
      choices: choices({ ...base, ...own }),
    });
    const resolve = (current: ParameterState) =>
      resolveModelRequest('pyramid', current.texts, current.choices, { exact: current.exact ?? {}, connectorEdits: {} });
    const choose = (current: ParameterState, choice: PilotChoice) =>
      applyPilotChoice('pyramid', current, resolve(current).values, choice);
    const fieldsOf = (current: ParameterState) => {
      const panel = shapePanel('pyramid', current.choices, resolve(current));
      return panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : [];
    };
    function planeOf(current: ParameterState) {
      const request = resolve(current);
      expect(request.errors).toEqual({});
      const spec = request.spec;
      if (spec?.section === undefined) throw new Error(`Expected a section: ${JSON.stringify(request.pilotDraft)}`);
      const v = boxVertices(spec.shape as BoxLikeShape, spec.scale) as Readonly<Record<BoxVertex, Vec>>;
      const section = spec.section as BoxSectionSpec;
      const { normal, offset } = boxPlane(v, section);
      const { contour } = boxSection(spec.shape as BoxLikeShape, spec.scale, { box: section });
      return { normal: normal as Vec, offset, v, contour: contour as readonly Vec[], section, spec };
    }
    const on = (plane: ReturnType<typeof planeOf>, point: Vec) => Math.abs(dot(plane.normal, point) - plane.offset);
    const start = planeOf(state({ pyramidSection: 'face-parallel', pyramidFace: 'ABC', pyramidFaceMode: 'midpoint' }));
    const names = Object.keys(start.v) as BoxVertex[];
    const basis: BoxVertex[] = names.filter((name) => name !== 'S');
    const n = basis.length;
    const baseName = basis.join('');
    const S = start.v.S;

    it('lists its 2n edges and the base’s diagonals only, in two groups', () => {
      const field = fieldsOf(state({ pyramidSection: 'inclined' })).find((candidate) => candidate.type === 'normal-construction');
      if (field?.type !== 'normal-construction') throw new Error('Expected the field.');
      expect(field.options).toHaveLength(2 * n + (n * (n - 3)) / 2);
      expect([...new Set(field.options.map(({ group }) => group))]).toEqual(['Ребра', 'Діагоналі граней']);
      for (const { value, group } of field.options) {
        if (group === 'Діагоналі граней') expect(value.includes('S')).toBe(false);
      }
      // Its faces: the base and n lateral ones, each its own orientation; no pair of opposite edges to choose from.
      const faces = fieldsOf(state({ pyramidSection: 'face-parallel' })).find(
        (candidate) => candidate.type === 'face-construction',
      );
      expect(faces?.type === 'face-construction' ? faces.face.options : []).toHaveLength(n + 1);
      expect(fieldsOf(state({ pyramidSection: 'inclined' })).some((candidate) => candidate.type === 'pair-construction')).toBe(
        false,
      );
    });

    it('A: parallel to the base halfway to S: the midpoints of the lateral edges, a quarter of the base, an eighth of the solid', () => {
      const plane = planeOf(state({ pyramidSection: 'face-parallel', pyramidFace: baseName, pyramidFaceMode: 'midpoint' }));
      const { v } = plane;
      expect(plane.contour).toHaveLength(n);
      for (const vertex of basis) expect(on(plane, middle(S, v[vertex]))).toBeLessThan(1e-7);
      const base = basis.map((vertex) => v[vertex]);
      expect(area(plane.contour) / area(base)).toBeCloseTo(1 / 4, 12);
      // A pyramid's volume is its base's area times its height over three: halved height, a quarter of the area.
      expect(((area(plane.contour) / area(base)) * on(plane, S)) / S[2]).toBeCloseTo(1 / 8, 12);
      const field = fieldsOf(state({ pyramidSection: 'face-parallel', pyramidFace: baseName, pyramidFaceMode: 'ratio' })).find(
        (candidate) => candidate.type === 'face-construction',
      );
      expect(field?.type === 'face-construction' ? field.positions[0]?.labels : []).toEqual([`Від ${baseName}`, 'До S']);
    });

    it('parallel to SAB at 1 : 1: halfway to its actual far support, a base edge or a base vertex, named so', () => {
      const current = state({ pyramidSection: 'face-parallel', pyramidFace: 'SAB', pyramidFaceMode: 'midpoint' });
      const plane = planeOf(current);
      const { v } = plane;
      const along = (point: Vec) => dot(plane.normal, point);
      const values = names.map((name) => along(v[name]));
      const [low, high] = [Math.min(...values), Math.max(...values)];
      const face = along(S);
      const farValue = Math.abs(face - low) < Math.abs(face - high) ? high : low;
      const far = names.filter((name) => Math.abs(along(v[name]) - farValue) < 1e-7 * (high - low));
      // Halfway between the face and the far support: the midpoint of A and any far vertex lies on it.
      expect(on(plane, middle(v.A, v[far[0] as BoxVertex]))).toBeLessThan(1e-7);
      const field = fieldsOf(current).find((candidate) => candidate.type === 'face-construction');
      if (field?.type !== 'face-construction') throw new Error('Expected the field.');
      expect(far.length === 1 || far.length === 2).toBe(true);
      expect(field.face).toMatchObject({
        opposite: far.join(''),
        oppositeEdge: far.length === 2,
        oppositeVertex: far.length === 1,
      });
    });

    it('through AB and M on a lateral edge: every offered edge gives a plane through A, B, M, whatever its polygon', () => {
      const through = { pyramidSection: 'through-line', pyramidLineMethod: 'point', pyramidLine: 'A-B' } as const;
      const field = fieldsOf(state(through)).find((candidate) => candidate.type === 'through-point');
      if (field?.type !== 'through-point') throw new Error('Expected the field.');
      const edges = field.point.options.map(({ value }) => value);
      // Lateral edges off AB: none through A or B, which would give the face SAB.
      expect(edges.length).toBeGreaterThan(0);
      for (const edge of edges) expect(edge.includes('S') && !edge.includes('A') && !edge.includes('B')).toBe(true);
      for (const edge of edges) {
        const plane = planeOf(state({ ...through, pyramidPointEdge: edge as never, pyramidPointMode: 'midpoint' }));
        const [p, q] = edge.split('-') as [BoxVertex, BoxVertex];
        for (const point of [plane.v.A, plane.v.B, middle(plane.v[p], plane.v[q])]) expect(on(plane, point)).toBeLessThan(1e-9);
        // At either end: the base, or the face SAB.
        for (const ends of [
          ['0', '1'],
          ['1', '0'],
        ] as const) {
          const end = resolve(
            state(
              { ...through, pyramidPointEdge: edge as never, pyramidPointMode: 'ratio' },
              { pyramidPointRatioFirst: ends[0], pyramidPointRatioSecond: ends[1] },
            ),
          );
          expect(end.pilotDraft).toMatchObject({ status: 'invalid', problem: 'face' });
        }
      }
    });

    it('E: every base diagonal through the apex: S, P and Q on the plane, n ∥ (P − S) × (Q − S)', () => {
      const current = state({ pyramidSection: 'through-apex', pyramidTrace: 'diagonal' });
      const field = fieldsOf(current).find((candidate) => candidate.type === 'diagonal-construction');
      if (field?.type !== 'diagonal-construction') throw new Error('Expected the field.');
      expect(field.pyramid).toBe(true);
      expect(field.options).toHaveLength((n * (n - 3)) / 2);
      for (const { value, label } of field.options) {
        expect(label).not.toContain('₁');
        const [p, q] = value.split('-') as [BoxVertex, BoxVertex];
        const picked = choose(current, { kind: 'diagonal', segment: [q, p] });
        const plane = planeOf(picked);
        for (const point of [S, plane.v[p], plane.v[q]]) expect(on(plane, point)).toBeLessThan(1e-9);
        const expected = unit(cross(minus(plane.v[p], S), minus(plane.v[q], S)));
        expect(Math.abs(dot(plane.normal, expected))).toBeCloseTo(1, 12);
        // The base's area on either side of the diagonal is what the plane splits the pyramid's volume by.
        const corners = basis.map((vertex) => plane.v[vertex]);
        const [i, j] = [basis.indexOf(p), basis.indexOf(q)].sort((a, b) => a - b) as [number, number];
        const piece = area(corners.slice(i, j + 1)) / area(corners);
        expect(piece).toBeGreaterThan(0);
        expect(piece).toBeLessThan(1);
      }
    });

    it('D: SA and M on a base edge: an end joined to A gives the face, said inline; any other end a diagonal section', () => {
      const apex = { pyramidSection: 'through-apex', pyramidTrace: 'edge-point', pyramidTraceVertex: 'A' } as const;
      const field = fieldsOf(state(apex)).find((candidate) => candidate.type === 'trace-construction');
      if (field?.type !== 'trace-construction' || field.point === undefined) throw new Error('Expected the field.');
      expect(field.point.options.length).toBeGreaterThan(0);
      for (const { value } of field.point.options) {
        const edge = value.split('-') as [BoxVertex, BoxVertex];
        for (const [first, second, end] of [
          ['0', '1', edge[0]],
          ['1', '0', edge[1]],
        ] as const) {
          const current = state(
            { ...apex, pyramidTraceSegment: value as never, pyramidTracePointMode: 'ratio' },
            { pyramidTracePointRatioFirst: first, pyramidTracePointRatioSecond: second },
          );
          const draft = resolve(current).pilotDraft;
          // A's neighbours in the base: B and the last vertex.
          const adjacent = [basis[1], basis[n - 1]].includes(end);
          if (adjacent) {
            expect(draft).toMatchObject({ status: 'invalid', problem: 'face' });
          } else if (draft?.status === 'valid') {
            const plane = planeOf(current);
            for (const point of [S, plane.v.A, plane.v[end]]) expect(on(plane, point)).toBeLessThan(1e-9);
          }
        }
      }
    });

    it('G: the apex moved: SA with M at 1 : 2 on its edge, the height through the actual foot, AB at 60° to the base', () => {
      const apex = { pyramidSection: 'through-apex', pyramidTrace: 'edge-point', pyramidTraceVertex: 'A' } as const;
      const field = fieldsOf(state(apex)).find((candidate) => candidate.type === 'trace-construction');
      const edge = (field?.type === 'trace-construction' ? field.point?.selected : '') as string;
      const [p, q] = edge.split('-') as [BoxVertex, BoxVertex];
      // A ratio this solid allows, as a part may be too thin for another: 1 : 2, else 2 : 1, else the midpoint.
      const options = [
        [['1', '2'], 1 / 3],
        [['2', '1'], 2 / 3],
        [['1', '1'], 1 / 2],
      ] as const;
      const [ratio, t] = options
        .map(
          ([parts, share]) =>
            [
              state(
                { ...apex, pyramidTracePointMode: 'ratio' },
                { pyramidTracePointRatioFirst: parts[0], pyramidTracePointRatioSecond: parts[1] },
              ),
              share,
            ] as const,
        )
        .find(([candidate]) => resolve(candidate).pilotDraft?.status === 'valid') as readonly [ParameterState, number];
      for (const moved of [{}, { pyramidApexXRatio: '-0,3', pyramidApexYRatio: '0,2', pyramidHeightRatio: '1,4' }]) {
        const current = { ...ratio, texts: { ...ratio.texts, ...moved } };
        // The same semantic M wherever the apex is, while that still leaves both parts thick enough.
        if (resolve(current).pilotDraft?.status === 'valid') {
          const plane = planeOf(current);
          for (const point of [plane.v.S, plane.v.A, along(plane.v[p], plane.v[q], t)]) {
            expect(on(plane, point)).toBeLessThan(1e-9);
          }
        }
        const height = state({ pyramidSection: 'through-apex', pyramidTrace: 'height-edge' }, moved);
        const offered = fieldsOf(height).find((candidate) => candidate.type === 'trace-construction');
        if (offered?.type === 'trace-construction' && offered.selected !== '') {
          const h = planeOf(height);
          const foot: Vec = [h.v.S[0], h.v.S[1], 0];
          for (const point of [h.v.S, h.v[offered.selected as BoxVertex], foot]) expect(on(h, point)).toBeLessThan(1e-9);
        }
        const angled = state(
          { pyramidSection: 'through-line', pyramidLineMethod: 'angle', pyramidLine: 'A-B', pyramidLineFace: baseName as never },
          { ...moved, pyramidLineDihedralDeg: '60' },
        );
        if (resolve(angled).spec?.section !== undefined) {
          const a = planeOf(angled);
          const angle = (Math.acos(Math.abs(a.normal[2])) * 180) / Math.PI;
          expect(angle).toBeCloseTo(60, 9);
        }
      }
    });

    it('H: through S and a diagonal with a displaced parallel second plane: three parts, only the first through S', () => {
      const first = (
        planeOf(state({ pyramidSection: 'through-apex', pyramidTrace: 'diagonal' })).section as { positionPercent: number }
      ).positionPercent;
      // The second plane well apart from the first, on its larger side.
      const at = first < 50 ? '80' : '20';
      const current = state(
        { pyramidSection: 'through-apex', pyramidTrace: 'diagonal', pyramidSecondCut: true },
        { pyramidSectionSecondPercent: at },
      );
      const plane = planeOf(current);
      expect(on(plane, S)).toBeLessThan(1e-9);
      expect(plane.section).toMatchObject({ secondPositionPercent: Number(at) });
      const second = boxSection(plane.spec.shape as BoxLikeShape, plane.spec.scale, {
        box: plane.section,
        atSecond: true,
      }).contour;
      expect(second.length).toBeGreaterThanOrEqual(3);
      const offset = dot(plane.normal, second[0] as Vec);
      expect(Math.abs(dot(plane.normal, S) - offset)).toBeGreaterThan(1e-3);
    });

    it('through a base edge at an angle: the other plane offered only where it is usable, and recovered to', () => {
      for (const face of [baseName, 'SAB']) {
        for (const angle of ['35', '60', '80']) {
          for (const side of ['first', 'second'] as const) {
            const current = state(
              {
                pyramidSection: 'through-line',
                pyramidLineMethod: 'angle',
                pyramidLine: 'A-B',
                pyramidLineFace: face as never,
                pyramidLineSide: side,
              },
              { pyramidLineDihedralDeg: angle },
            );
            const draft = resolve(current).pilotDraft;
            const offered = draft !== undefined && 'alternative' in draft && draft.alternative === true;
            const after = choose(current, { kind: 'angle-side' });
            if (!offered) expect(after).toBe(current);
            else expect(resolve(after).pilotDraft?.status).toBe('valid');
          }
        }
      }
    });
  },
);

describe('the square pyramid SABCD and the hexagonal one', () => {
  const square = { pyramidBaseType: 'regular', pyramidBaseSides: 4 } as const;
  const state = (own: Partial<ParameterChoices>, typed: Partial<ParameterTexts> = {}): ParameterState => ({
    texts: texts(typed),
    choices: choices({ ...square, ...own }),
  });
  const planeOf = (current: ParameterState) => {
    const request = resolveModelRequest('pyramid', current.texts, current.choices, {
      exact: current.exact ?? {},
      connectorEdits: {},
    });
    const spec = request.spec;
    if (spec?.section === undefined) throw new Error(`Expected a section: ${JSON.stringify(request.pilotDraft)}`);
    const v = boxVertices(spec.shape as BoxLikeShape, spec.scale) as Readonly<Record<BoxVertex, Vec>>;
    const { normal, offset } = boxPlane(v, spec.section as BoxSectionSpec);
    const { contour } = boxSection(spec.shape as BoxLikeShape, spec.scale, { box: spec.section as BoxSectionSpec });
    return { normal: normal as Vec, offset, v, contour: contour as readonly Vec[], request };
  };
  const on = (plane: ReturnType<typeof planeOf>, point: Vec) => Math.abs(dot(plane.normal, point) - plane.offset);

  it('B: AB and the midpoint of CS: a quadrilateral through the midpoint of DS too', () => {
    const plane = planeOf(
      state({
        pyramidSection: 'through-line',
        pyramidLineMethod: 'point',
        pyramidLine: 'A-B',
        pyramidPointEdge: 'C-S',
        pyramidPointMode: 'midpoint',
      }),
    );
    const { S, A, B, C, D } = plane.v;
    expect(plane.contour).toHaveLength(4);
    for (const point of [A, B, middle(C, S), middle(D, S)]) {
      expect(Math.min(...plane.contour.map((corner) => Math.hypot(...minus(corner, point))))).toBeLessThan(1e-7);
    }
  });

  it('C: parallel to SAB at 1 : 1 to CD, through the midpoints of AD, BC, CS and DS', () => {
    const current = state({ pyramidSection: 'face-parallel', pyramidFace: 'SAB', pyramidFaceMode: 'midpoint' });
    const plane = planeOf(current);
    const { S, A, B, C, D } = plane.v;
    for (const point of [middle(A, D), middle(B, C), middle(C, S), middle(D, S)]) expect(on(plane, point)).toBeLessThan(1e-7);
    const panel = shapePanel('pyramid', current.choices, plane.request);
    const field = (panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : []).find(
      (candidate) => candidate.type === 'face-construction',
    );
    expect(field?.type === 'face-construction' ? field.positions[0]?.labels : []).toEqual(['Від SAB', 'До CD']);
  });

  it('D: SA and M on BC: M = C is the diagonal section SAC, M = B the face SAB said inline', () => {
    const apex = {
      pyramidSection: 'through-apex',
      pyramidTrace: 'edge-point',
      pyramidTraceVertex: 'A',
      pyramidTraceSegment: 'B-C',
      pyramidTracePointMode: 'ratio',
    } as const;
    const atC = planeOf(state(apex, { pyramidTracePointRatioFirst: '1', pyramidTracePointRatioSecond: '0' }));
    for (const vertex of ['S', 'A', 'C'] as const) expect(on(atC, atC.v[vertex])).toBeLessThan(1e-9);
    const atB = resolveModelRequest(
      'pyramid',
      texts({ pyramidTracePointRatioFirst: '0', pyramidTracePointRatioSecond: '1' }),
      choices({ ...square, ...apex }),
    );
    expect(atB.pilotDraft).toMatchObject({ status: 'invalid', problem: 'face' });
    expect((atB.pilotDraft as { message: string }).message).toMatch(
      /^Точка M збігається з вершиною B: площина SAB — грань піраміди\./,
    );
  });

  it('F: a regular hexagonal pyramid: SAC cuts off a sixth, SAD halves it, through the diagonals themselves', () => {
    for (const [segment, share] of [
      [['A', 'C'], 1 / 6],
      [['A', 'D'], 1 / 2],
    ] as const) {
      const current: ParameterState = {
        texts: texts(),
        choices: choices({
          pyramidBaseType: 'regular',
          pyramidBaseSides: 6,
          pyramidSection: 'through-apex',
          pyramidTrace: 'diagonal',
          pyramidTraceSegment: segment.join('-') as never,
        }),
      };
      const plane = planeOf(current);
      for (const vertex of ['S', ...segment] as const) expect(on(plane, plane.v[vertex])).toBeLessThan(1e-9);
      const corners = (['A', 'B', 'C', 'D', 'E', 'F'] as const).map((name) => plane.v[name]);
      const cut = corners.slice(0, ['A', 'B', 'C', 'D', 'E', 'F'].indexOf(segment[1]) + 1);
      expect(area(cut) / area(corners)).toBeCloseTo(share, 12);
      expect(plane.request.pilotDraft === undefined || plane.request.pilotDraft.status === 'valid').toBe(true);
    }
  });
});
