import { type BoxLikeShape, boxPlane, boxSection, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec, BoxVertex } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { shapePanel } from '../shapes.ts';
import { boxTopologyFor } from './box.ts';
import {
  addSecondCut,
  applyPilotChoice,
  followTrace,
  initialParameterChoices,
  initialParameterTexts,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  type PilotChoice,
  resolveModelRequest,
} from './parameters.ts';
import { PILOT_MESSAGES } from './throughPoint.ts';

type Vec = readonly [number, number, number];
const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const middle = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const along = (a: Vec, b: Vec, t: number): Vec => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** The triangular prisms: right and oblique, over a regular triangle and over a scalene one. */
const PRISMS: readonly [string, Partial<ParameterChoices>, Partial<ParameterTexts>][] = [
  ['a right prism', { prismBaseType: 'regular', prismBaseSides: 3 }, {}],
  ['an oblique prism', { prismBaseType: 'regular', prismBaseSides: 3 }, { prismOffsetXRatio: '0,4', prismOffsetYRatio: '-0,3' }],
  [
    'an oblique scalene prism',
    { prismBaseType: 'triangle' },
    { prismTriangleSideRatio: '1,4', prismTriangleAngleDeg: '70', prismOffsetXRatio: '-0,3', prismOffsetYRatio: '0,2' },
  ],
];

const state = (base: Partial<ParameterChoices>, shape: Partial<ParameterTexts>, own: Partial<ParameterChoices>, typed = {}) =>
  ({ texts: texts({ ...shape, ...typed }), choices: choices({ ...base, ...own }) }) as ParameterState;

const resolve = (current: ParameterState) =>
  resolveModelRequest('prism', current.texts, current.choices, { exact: current.exact ?? {}, connectorEdits: {} });
const choose = (current: ParameterState, choice: PilotChoice) =>
  applyPilotChoice('prism', current, resolve(current).values, choice);

/** The request's plane, its normal turned one way, the solid's vertices and the section's corners. */
function planeOf(current: ParameterState) {
  const request = resolve(current);
  expect(request.errors).toEqual({});
  const spec = request.spec;
  if (spec?.section === undefined) throw new Error(`Expected a section: ${JSON.stringify(request.pilotDraft)}`);
  const vertices = boxVertices(spec.shape as BoxLikeShape, spec.scale);
  const section = spec.section as BoxSectionSpec;
  const { normal, offset } = boxPlane(vertices, section);
  const sign = Math.sign(normal.find((value) => Math.abs(value) > 1e-9) ?? 1);
  const { contour } = boxSection(spec.shape as BoxLikeShape, spec.scale, { box: section });
  return { normal: normal.map((value) => value * sign) as unknown as Vec, offset: offset * sign, vertices, contour, section };
}

/** The panel's fields for a state. */
const fieldsOf = (current: ParameterState) => {
  const panel = shapePanel('prism', current.choices, resolve(current));
  return panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : [];
};

const on = (plane: ReturnType<typeof planeOf>, point: Vec) => Math.abs(dot(plane.normal, point) - plane.offset);
const expectSamePlane = (a: ReturnType<typeof planeOf>, b: ReturnType<typeof planeOf>) => {
  for (const axis of [0, 1, 2] as const) expect(a.normal[axis]).toBeCloseTo(b.normal[axis], 9);
  expect(a.offset).toBeCloseTo(b.offset, 6);
};
const TOLERANCE = 1e-9;

describe.each(PRISMS)('the constructions of %s ABC–A₁B₁C₁', (_, base, shape) => {
  const through = { prismSection: 'through-line', prismLineMethod: 'point' } as const;

  it('A: AB and M on CC₁, at the midpoint and at CM : MC₁ = 1 : 2, give the triangle ABM', () => {
    for (const [mode, ratio, t] of [
      ['midpoint', ['1', '1'], 1 / 2],
      ['ratio', ['1', '2'], 1 / 3],
    ] as const) {
      const current = state(
        base,
        shape,
        { ...through, prismLine: 'A-B', prismPointEdge: 'C-C1', prismPointMode: mode },
        { prismPointRatioFirst: ratio[0], prismPointRatioSecond: ratio[1] },
      );
      const plane = planeOf(current);
      const m = along(plane.vertices.C, plane.vertices.C1, t);
      for (const point of [plane.vertices.A, plane.vertices.B, m]) expect(on(plane, point)).toBeLessThan(TOLERANCE);
      expect(plane.contour).toHaveLength(3);
      const panel = shapePanel('prism', current.choices, resolve(current));
      const field = (panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : []).find(
        (candidate) => candidate.type === 'through-point',
      );
      expect(field?.type === 'through-point' ? field.point.title : '').toBe(
        mode === 'midpoint' ? 'Середина CC₁' : 'CM : MC₁ = 1 : 2',
      );
    }
  });

  it('B: M at C gives the base, said inline; M at C₁ the valid triangle ABC₁', () => {
    const at = (ratio: readonly [string, string]) =>
      state(
        base,
        shape,
        { ...through, prismLine: 'A-B', prismPointEdge: 'C-C1', prismPointMode: 'ratio' },
        { prismPointRatioFirst: ratio[0], prismPointRatioSecond: ratio[1] },
      );
    const atC = resolve(at(['0', '1']));
    expect(atC.errors).toEqual({});
    expect(atC.pilotDraft).toEqual({ status: 'invalid', problem: 'face', message: PILOT_MESSAGES.face });
    const atC1 = planeOf(at(['1', '0']));
    for (const vertex of ['A', 'B', 'C1'] as const) expect(on(atC1, atC1.vertices[vertex])).toBeLessThan(TOLERANCE);
    expect(atC1.contour).toHaveLength(3);
  });

  it('C: the lateral face’s diagonal AB₁ and the midpoint of CC₁ give one plane holding both', () => {
    const plane = planeOf(
      state(base, shape, { ...through, prismLine: 'A-B1', prismPointEdge: 'C-C1', prismPointMode: 'midpoint' }),
    );
    for (const point of [plane.vertices.A, plane.vertices.B1, middle(plane.vertices.C, plane.vertices.C1)]) {
      expect(on(plane, point)).toBeLessThan(TOLERANCE);
    }
  });

  it('D: parallel to ABB₁A₁ at 1 : 1, through the midpoints of AC, BC, A₁C₁ and B₁C₁, measured to the edge CC₁', () => {
    const current = state(base, shape, { prismSection: 'face-parallel', prismFace: 'ABB1A1', prismFaceMode: 'midpoint' });
    const plane = planeOf(current);
    const v = plane.vertices;
    for (const [a, b] of [
      ['A', 'C'],
      ['B', 'C'],
      ['A1', 'C1'],
      ['B1', 'C1'],
    ] as const) {
      expect(on(plane, middle(v[a], v[b]))).toBeLessThan(TOLERANCE);
    }
    // Parallel to the face itself.
    expect(dot(plane.normal, minus(v.B, v.A))).toBeCloseTo(0, 9);
    expect(dot(plane.normal, minus(v.A1, v.A))).toBeCloseTo(0, 9);
    const panel = shapePanel('prism', current.choices, resolve(current));
    const field = (panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : []).find(
      (candidate) => candidate.type === 'face-construction',
    );
    if (field?.type !== 'face-construction') throw new Error('Expected the construction.');
    expect(field.face).toMatchObject({ title: 'ABB₁A₁', opposite: 'CC₁', oppositeEdge: true, selected: 'ABB1A1' });
    expect(field.face.options.map(({ label }) => label)).toEqual(['ABC ∥ A₁B₁C₁', 'ABB₁A₁', 'BCC₁B₁', 'CAA₁C₁']);
    expect(field.positions[0]?.labels).toEqual(['Від ABB₁A₁', 'До CC₁']);
    // At the far side the plane only touches the solid along CC₁.
    const far = resolve(
      state(
        base,
        shape,
        { prismSection: 'face-parallel', prismFace: 'ABB1A1', prismFaceMode: 'ratio' },
        { prismFaceRatioFirst: '1', prismFaceRatioSecond: '0' },
      ),
    );
    expect(far.pilotDraft).toMatchObject({
      problem: 'boundary',
      message: 'Переріз лише проходить через ребро CC₁ і не розтинає тіла. Оберіть положення строго між ABB₁A₁ і CC₁.',
    });
  });

  it('E: parallel to the bases at 1 : 2, the upper base clicked keeps the plane and reads 2 : 1', () => {
    const current = state(
      base,
      shape,
      { prismSection: 'face-parallel', prismFace: 'ABC', prismFaceMode: 'ratio' },
      { prismFaceRatioFirst: '1', prismFaceRatioSecond: '2' },
    );
    const before = planeOf(current);
    const top = choose(current, { kind: 'face', face: 'A1B1C1' });
    expect([top.texts.prismFaceRatioFirst, top.texts.prismFaceRatioSecond]).toEqual(['2', '1']);
    expectSamePlane(planeOf(top), before);
    // A lateral face chosen next keeps the ratio as it is, from that face.
    const side = choose(top, { kind: 'face', face: 'BCC1B1' });
    expect([side.texts.prismFaceRatioFirst, side.texts.prismFaceRatioSecond]).toEqual(['2', '1']);
  });

  it('F: AC is an edge and AC₁ a face’s diagonal; no base or body diagonals anywhere', () => {
    const current = state(base, shape, { ...through });
    const panel = shapePanel('prism', current.choices, resolve(current));
    const fields = panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : [];
    const field = fields.find((candidate) => candidate.type === 'through-point');
    const labels = field?.type === 'through-point' ? field.segment.options.map(({ label }) => label) : [];
    expect(labels).toContain('AC — ребро');
    expect(labels).toContain('AC₁ — діагональ грані');
    // Nine edges and the lateral faces' six diagonals.
    expect(labels).toHaveLength(9 + 6);
    const inclined = { ...current, choices: { ...current.choices, prismSection: 'inclined' as const } };
    const normal = fieldsOf(inclined).find((candidate) => candidate.type === 'normal-construction');
    expect([...new Set(normal?.type === 'normal-construction' ? normal.options.map(({ group }) => group) : [])]).toEqual([
      'Ребра',
      'Діагоналі граней',
    ]);
    // A triangle's base offers no diagonal trace.
    const trace = fieldsOf(state(base, shape, { prismSection: 'longitudinal' })).find(
      (candidate) => candidate.type === 'choice' && candidate.key === 'prismTrace',
    );
    expect(trace?.type === 'choice' ? trace.options.map(({ value }) => value) : ['missing']).not.toContain('diagonal');
  });

  it('G: a median picked on the upper base runs from the lower vertex along the actual lateral edges; perpendicular to them', () => {
    const median = choose(state(base, shape, { prismSection: 'longitudinal', prismTrace: 'median', prismTraceThrough: true }), {
      kind: 'trace-vertex',
      vertex: 'B1',
    });
    expect(median.choices.prismTraceVertex).toBe('B');
    const plane = planeOf(median);
    const v = plane.vertices;
    for (const point of [v.B, middle(v.A, v.C), v.B1]) expect(on(plane, point)).toBeLessThan(TOLERANCE);
    expect(dot(plane.normal, minus(v.A1, v.A))).toBeCloseTo(0, 9);
    // The lateral edges by a click on CC₁: the normal along the actual lean.
    const perpendicular = choose(state(base, shape, { prismSection: 'inclined' }), { kind: 'normal', segment: ['C', 'C1'] });
    expect(perpendicular.choices.prismNormalAlong).toBe('A-A1');
    const normal = planeOf(perpendicular);
    expect(Math.abs(dot(normal.normal, unit(minus(normal.vertices.A1, normal.vertices.A))))).toBeCloseTo(1, 9);
  });

  it('an edge at an angle to either of its faces: the true angle, and the same plane read from the other face', () => {
    const angled = state(
      base,
      shape,
      { prismSection: 'through-line', prismLineMethod: 'angle', prismLine: 'A-B', prismLineFace: 'ABC' },
      {
        prismLineDihedralDeg: '30',
      },
    );
    const plane = planeOf(angled);
    const v = plane.vertices;
    const angleTo = (corners: readonly BoxVertex[]) => {
      const [a, b, c] = corners.map((name) => v[name]) as [Vec, Vec, Vec];
      const normal = unit(cross(minus(b, a), minus(c, a)));
      return (Math.acos(Math.min(1, Math.abs(dot(plane.normal, normal)))) * 180) / Math.PI;
    };
    expect(angleTo(['A', 'B', 'C'])).toBeCloseTo(30, 9);
    const side = choose(angled, { kind: 'angle-face', face: 'ABB1A1' });
    expectSamePlane(planeOf(side), plane);
    // The other face's angle, from the geometry: not 60° unless the faces meet at a right angle.
    expect(Number(side.exact?.prismLineDihedralDeg)).toBeCloseTo(angleTo(['A', 'B', 'B1']), 9);
    for (const vertex of ['A', 'B'] as const satisfies readonly BoxVertex[]) expect(on(plane, v[vertex])).toBeLessThan(TOLERANCE);
  });
});

/** Every other prism the app offers: over a square, a trapezoid, a regular pentagon, hexagon and octagon, right and oblique. */
const NGONS: readonly [string, Partial<ParameterChoices>][] = [
  ['a square prism', { prismBaseType: 'regular', prismBaseSides: 4 }],
  ['a trapezoidal prism', { prismBaseType: 'trapezoid' }],
  ['a pentagonal prism', { prismBaseType: 'regular', prismBaseSides: 5 }],
  ['a hexagonal prism', { prismBaseType: 'regular', prismBaseSides: 6 }],
  ['an octagonal prism', { prismBaseType: 'regular', prismBaseSides: 8 }],
];
const LEANS: readonly [string, Partial<ParameterTexts>][] = [
  ['right', {}],
  ['oblique', { prismOffsetXRatio: '0,4', prismOffsetYRatio: '-0,3' }],
];
const NGON_CASES = NGONS.flatMap(([name, base]) =>
  LEANS.map(([lean, shape]) => [`${lean} ${name.replace(/^an? /, '')}`, base, shape] as const),
);

/** The unit normal of a face of the solid, turned into it, and its offset. */
function inward(vertices: Readonly<Record<string, Vec>>, corners: readonly BoxVertex[]) {
  const all = Object.values(vertices);
  const centre = all.reduce<Vec>(
    (sum, p) => [sum[0] + p[0] / all.length, sum[1] + p[1] / all.length, sum[2] + p[2] / all.length],
    [0, 0, 0],
  );
  const [a, b, c] = corners.map((name) => vertices[name] as Vec) as [Vec, Vec, Vec];
  let n = unit(cross(minus(b, a), minus(c, a)));
  if (dot(n, minus(centre, a)) < 0) n = [-n[0], -n[1], -n[2]];
  return { n, d: dot(n, a) };
}

/** The smaller dihedral angle between the plane and a face, in degrees. */
const angleTo = (plane: ReturnType<typeof planeOf>, corners: readonly BoxVertex[]) =>
  (Math.acos(Math.min(1, Math.abs(dot(plane.normal, inward(plane.vertices, corners).n)))) * 180) / Math.PI;

/** A polygon's area in the base plane, from its corners in order. */
const areaOf = (points: readonly Vec[]) =>
  Math.abs(
    points.reduce((sum, p, index) => {
      const q = points[(index + 1) % points.length] as Vec;
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;

describe.each(NGON_CASES)('the constructions of a %s', (_, base, shape) => {
  const topology = boxTopologyFor('prism', choices(base));
  const n = topology.sides;
  const lower = topology.faces[topology.lowerBase] ?? [];
  const together = (pair: readonly BoxVertex[]) =>
    topology.faceNames.some((face) => pair.every((vertex) => (topology.faces[face] ?? []).includes(vertex)));
  const through = { prismSection: 'through-line', prismLineMethod: 'point' } as const;
  const pointField = (current: ParameterState) => {
    const field = fieldsOf(current).find((candidate) => candidate.type === 'through-point');
    if (field?.type !== 'through-point') throw new Error('Expected the construction.');
    return field;
  };

  it('A: its segments are the edges and the diagonals of its faces, a base’s and a lateral face’s, by two vertices or by name', () => {
    const start = state(base, shape, through);
    const options = pointField(start).segment.options;
    for (const { value } of options) expect(together(value.split('-') as BoxVertex[])).toBe(true);
    const keys = options.map(({ value }) => value);
    const sorted = new Set(keys.map((key) => key.split('-').sort().join('-')));
    for (const pair of ['A-B', 'A-C', 'A-B1', 'A1-B']) expect(sorted.has(pair)).toBe(true);
    // No vertex pair off a common face, a diagonal of the solid, is a segment a plane through it is built on.
    expect(keys.some((key) => !together(key.split('-') as BoxVertex[]))).toBe(false);
    // Two vertices picked, either way round, and the name: the same choice.
    for (const pair of [
      ['A', 'C'],
      ['B1', 'A'],
    ] as const) {
      const picked = choose(start, { kind: 'segment', segment: [pair[0], pair[1]] });
      const reversed = choose(start, { kind: 'segment', segment: [pair[1], pair[0]] });
      expect(resolve(reversed).spec?.section).toEqual(resolve(picked).spec?.section);
      const named = options.find(({ value }) => value.split('-').sort().join() === [...pair].sort().join());
      expect(named).toBeDefined();
      expect(pointField(picked).segment.selected).toBe(named?.value);
    }
  });

  it('B: the base diagonal AC and M on an edge at its midpoint and at 1 : 2 hold the plane, whatever its section', () => {
    const chosen = choose(state(base, shape, through), { kind: 'segment', segment: ['A', 'C'] });
    const edges = pointField(chosen).point.options.map(({ value }) => value.split('-') as [BoxVertex, BoxVertex]);
    const edge = edges.find(([u, v]) => u.endsWith('1') !== v.endsWith('1')) ?? (edges[0] as [BoxVertex, BoxVertex]);
    for (const [mode, ratio, t] of [
      ['midpoint', ['1', '1'], 1 / 2],
      ['ratio', ['1', '2'], 1 / 3],
    ] as const) {
      const current: ParameterState = {
        texts: { ...chosen.texts, prismPointRatioFirst: ratio[0], prismPointRatioSecond: ratio[1] },
        choices: { ...chosen.choices, prismPointEdge: `${edge[0]}-${edge[1]}`, prismPointMode: mode },
      };
      const plane = planeOf(current);
      const v = plane.vertices as Readonly<Record<string, Vec>>;
      const [u, w] = (plane.section as { pointEdge: [BoxVertex, BoxVertex] }).pointEdge;
      for (const point of [v.A as Vec, v.C as Vec, along(v[u] as Vec, v[w] as Vec, t)]) {
        expect(on(plane, point)).toBeLessThan(TOLERANCE);
      }
      expect(plane.contour.length).toBeGreaterThanOrEqual(3);
      if (mode === 'ratio') expect(pointField(current).point.title).toMatch(/ = 1 : 2$/);
    }
  });

  it('C: AB at 60° to the base, read from ABB₁A₁ as the same plane at its actual angle; a base diagonal’s two solutions', () => {
    const start = state(
      base,
      shape,
      { prismSection: 'through-line', prismLineMethod: 'angle', prismLine: 'A-B', prismLineFace: topology.lowerBase },
      { prismLineDihedralDeg: '60' },
    );
    const plane = planeOf(start);
    expect(angleTo(plane, lower)).toBeCloseTo(60, 9);
    for (const vertex of ['A', 'B'] as const) expect(on(plane, plane.vertices[vertex])).toBeLessThan(TOLERANCE);
    const side = choose(start, { kind: 'angle-face', face: 'ABB1A1' });
    expect(side.choices.prismLineFace).toBe('ABB1A1');
    const turned = planeOf(side);
    expectSamePlane(turned, plane);
    const shown = side.exact?.prismLineDihedralDeg ?? Number(side.texts.prismLineDihedralDeg.replace(',', '.'));
    expect(shown).toBeCloseTo(angleTo(plane, topology.faces.ABB1A1 ?? []), 6);
    // A long base diagonal at 75°: a plane on either side of the base, both offered, switched to explicitly.
    const far = lower[Math.floor(n / 2)] as BoxVertex;
    const diagonal = state(
      base,
      shape,
      { prismSection: 'through-line', prismLineMethod: 'angle', prismLine: `A-${far}`, prismLineFace: topology.lowerBase },
      { prismLineDihedralDeg: '75' },
    );
    const one = planeOf(diagonal);
    expect(resolve(diagonal).pilotDraft).toMatchObject({ status: 'valid', alternative: true });
    const other = choose(diagonal, { kind: 'angle-side' });
    const two = planeOf(other);
    for (const each of [one, two]) {
      expect(angleTo(each, lower)).toBeCloseTo(75, 9);
      for (const vertex of ['A', far] as const) expect(on(each, each.vertices[vertex])).toBeLessThan(TOLERANCE);
    }
    expect(Math.abs(dot(one.normal, two.normal))).toBeLessThan(1 - 1e-6);
    // Nothing switches back by itself.
    expect(choose(other, { kind: 'angle-face', face: topology.lowerBase }).choices.prismLineSide).toBe('second');
  });

  it('D: parallel to ABB₁A₁ at 1 : 2 of the gap to its far support, the parallel face or the lateral edge it passes through', () => {
    const current = state(
      base,
      shape,
      { prismSection: 'face-parallel', prismFace: 'ABB1A1', prismFaceMode: 'ratio' },
      { prismFaceRatioFirst: '1', prismFaceRatioSecond: '2' },
    );
    const plane = planeOf(current);
    const v = plane.vertices as Readonly<Record<string, Vec>>;
    const { n: normal, d } = inward(v, topology.faces.ABB1A1 ?? []);
    const far = Math.max(...Object.values(v).map((point) => dot(normal, point)));
    const at = d + (far - d) / 3;
    // A point at that distance from the face along its normal lies on the plane, and the plane is parallel to the face.
    const a = v.A as Vec;
    expect(on(plane, [a[0] + (at - d) * normal[0], a[1] + (at - d) * normal[1], a[2] + (at - d) * normal[2]])).toBeLessThan(1e-7);
    expect(Math.abs(dot(plane.normal, normal))).toBeCloseTo(1, 12);
    // What the far support is, by the vertices on it: a face's four, or a lateral edge's two.
    const support = topology.vertices.filter(
      (vertex) => Math.abs(dot(normal, v[vertex] as Vec) - far) < 1e-7 * Math.abs(far - d),
    );
    const field = fieldsOf(current).find((candidate) => candidate.type === 'face-construction');
    if (field?.type !== 'face-construction') throw new Error('Expected the face construction.');
    const parallel = topology.faceNames.find((face) => (topology.faces[face] ?? []).every((vertex) => support.includes(vertex)));
    expect(support).toHaveLength(parallel === undefined ? 2 : 4);
    expect(field.face.oppositeEdge).toBe(parallel === undefined);
    const supportName = parallel === undefined ? support.join('') : parallel;
    expect(field.positions[0]?.labels).toEqual(['Від ABB₁A₁', `До ${supportName.replace(/1/g, '₁')}`]);
    // Its orientations: one for the bases, one for each class of parallel base sides.
    const sides = lower.map((vertex, index) => {
      const next = lower[(index + 1) % n] as BoxVertex;
      return unit(minus(v[next] as Vec, v[vertex] as Vec));
    });
    const classes = sides.filter(
      (side, index) => !sides.slice(0, index).some((other) => Math.hypot(...cross(side, other)) < 1e-9),
    ).length;
    expect(field.face.options).toHaveLength(1 + classes);
  });

  it('E–G: every base diagonal once, through both its bases’ copies, the upper one the same plane', () => {
    const families = (n * (n - 3)) / 2;
    const start = state(base, shape, { prismSection: 'longitudinal', prismTrace: 'diagonal', prismTraceThrough: true });
    const field = fieldsOf(start).find((candidate) => candidate.type === 'diagonal-construction');
    if (field?.type !== 'diagonal-construction') throw new Error('Expected the diagonal construction.');
    expect(field.options).toHaveLength(families);
    for (const { value } of field.options) {
      const [p, q] = value.split('-') as [BoxVertex, BoxVertex];
      const current = choose(start, { kind: 'diagonal', segment: [p, q] });
      const plane = planeOf({ ...current, choices: { ...current.choices, prismTraceThrough: true } });
      for (const vertex of [p, q, `${p}1`, `${q}1`] as BoxVertex[]) {
        expect(on(plane, plane.vertices[vertex])).toBeLessThan(TOLERANCE);
      }
      // n = (Q − P) × v, v the actual lateral edge.
      const expected = unit(cross(minus(plane.vertices[q], plane.vertices[p]), minus(plane.vertices.A1, plane.vertices.A)));
      expect(Math.abs(dot(plane.normal, expected))).toBeCloseTo(1, 12);
      const upper = choose(current, { kind: 'diagonal', segment: [`${q}1` as BoxVertex, `${p}1` as BoxVertex] });
      expect(upper).toBe(current);
    }
  });
});

describe('the diagonal sections of a regular hexagonal prism, through the diagonal and moved off it', () => {
  const hexagon = { prismBaseType: 'regular', prismBaseSides: 6 } as const;
  const settle = (current: ParameterState) => {
    let next = current;
    for (let round = 0; round < 4; round += 1) next = followTrace('prism', next, resolve(next).values) ?? next;
    return next;
  };

  it.each(LEANS)('F (%s): AC cuts off a sixth of the base, AD halves it; neither is moved to the centre', (_, shape) => {
    const start = settle(state(hexagon, shape, { prismSection: 'longitudinal', prismTrace: 'diagonal' }));
    for (const [segment, share] of [
      [['A', 'C'], 1 / 6],
      [['A', 'D'], 1 / 2],
    ] as const) {
      const current = settle(choose(start, { kind: 'diagonal', segment: [...segment] }));
      expect(current.choices.prismTraceThrough).toBe(true);
      const plane = planeOf(current);
      expect(plane.section).toMatchObject({ trace: 'diagonal', traceSegment: [...segment], through: true });
      const v = plane.vertices;
      for (const vertex of [...segment, `${segment[0]}1`, `${segment[1]}1`] as BoxVertex[]) {
        expect(on(plane, v[vertex])).toBeLessThan(TOLERANCE);
      }
      // The plane holds the lateral edges' direction: the parts are prisms of the same height over the base's two pieces.
      const corners = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
      const cut = corners.slice(0, corners.indexOf(segment[1]) + 1).map((name) => v[name]);
      expect(areaOf(cut) / areaOf(corners.map((name) => v[name]))).toBeCloseTo(share, 12);
      const sides = corners
        .filter((name) => !(segment as readonly string[]).includes(name))
        .map((name) => Math.sign(dot(plane.normal, v[name]) - plane.offset));
      expect(new Set(sides).size).toBe(2);
    }
  });

  it('H: AC with a second parallel plane keeps the first plane through AC, the second apart from it', () => {
    const start = settle(
      choose(settle(state(hexagon, LEANS[1]?.[1] ?? {}, { prismSection: 'longitudinal', prismTrace: 'diagonal' })), {
        kind: 'diagonal',
        segment: ['C', 'A'],
      }),
    );
    const before = planeOf(start);
    const two = settle(addSecondCut('prism', start, resolve(start).values));
    const after = planeOf(two);
    expectSamePlane(after, before);
    for (const vertex of ['A', 'C', 'A1', 'C1'] as const) expect(on(after, after.vertices[vertex])).toBeLessThan(TOLERANCE);
    const section = after.section as { positionPercent: number; secondPositionPercent: number; through: boolean };
    expect(section.through).toBe(true);
    expect(section.secondPositionPercent).not.toBeCloseTo(section.positionPercent, 3);
    expect(section.positionPercent).not.toBeCloseTo(50, 1);
    // Both planes cut the solid: three parts, the first contour on the plane through AC.
    const { contour } = boxSection(resolve(two).spec?.shape as BoxLikeShape, resolve(two).spec?.scale as never, {
      box: after.section,
      atSecond: true,
    });
    expect(contour.length).toBeGreaterThanOrEqual(3);
    for (const point of after.contour) expect(on(after, point as Vec)).toBeLessThan(1e-7);
    // Moved off the diagonal by typing its position: then parallel to the diagonal section, and said so.
    const moved = settle({ ...two, texts: { ...two.texts, prismSectionPercent: '40' } });
    expect(moved.choices.prismTraceThrough).toBe(false);
    const notes = fieldsOf(moved).flatMap((field) => (field.type === 'note' ? [field.text] : []));
    expect(notes).toContain('Площина паралельна діагональному перерізу через AC, але не проходить через діагональ.');
  });
});
