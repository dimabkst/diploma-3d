import { type BoxLikeShape, boxPlane, boxSection, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec, BoxSegment, BoxVertex } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { type NormalField, shapePanel } from '../shapes.ts';
import { type BoxSolid, boxKeysOf, boxTopologyFor } from './box.ts';
import {
  applyPilotChoice,
  followNormal,
  initialParameterChoices,
  initialParameterTexts,
  normalAlongManual,
  type ParameterChoices,
  type ParameterState,
  type ParameterTexts,
  resolveModelRequest,
} from './parameters.ts';

type Vec = readonly [number, number, number];
const texts = (overrides: Partial<ParameterTexts> = {}): ParameterTexts => ({ ...initialParameterTexts(), ...overrides });
const choices = (overrides: Partial<ParameterChoices> = {}): ParameterChoices => ({ ...initialParameterChoices(), ...overrides });
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

const OBLIQUE = {
  parallelepipedBaseSideRatio: '0,7',
  parallelepipedHeightRatio: '0,6',
  parallelepipedBaseAngleDeg: '70',
  parallelepipedOffsetXRatio: '1,2',
  parallelepipedOffsetYRatio: '0,4',
};
const SOLIDS: readonly [BoxSolid, Partial<ParameterTexts>][] = [
  ['cube', {}],
  ['cuboid', { cuboidWidthRatio: '0,6', cuboidHeightRatio: '1,4' }],
  ['parallelepiped', OBLIQUE],
];

/** An inclined plane of a solid, given by its angles, at a position along its normal. */
function inclined(kind: BoxSolid, shape: Partial<ParameterTexts>, percent = '50'): ParameterState {
  const keys = boxKeysOf(kind);
  return {
    texts: texts({ ...shape, [keys.SectionPercent]: percent } as Partial<ParameterTexts>),
    choices: choices({ [keys.Section]: 'inclined' } as Partial<ParameterChoices>),
  };
}

const resolve = (kind: BoxSolid, state: ParameterState) =>
  resolveModelRequest(kind, state.texts, state.choices, { exact: state.exact ?? {}, connectorEdits: {} });
const perpendicularTo = (kind: BoxSolid, state: ParameterState, segment: BoxSegment) =>
  applyPilotChoice(kind, state, resolve(kind, state).values, { kind: 'normal', segment });

/** The request's plane with its normal turned to one orientation, and the solid's vertices. */
function planeOf(kind: BoxSolid, state: ParameterState) {
  const request = resolve(kind, state);
  expect(request.errors).toEqual({});
  const spec = request.spec;
  if (spec?.section === undefined) throw new Error('Expected a section.');
  const vertices = boxVertices(spec.shape as BoxLikeShape, spec.scale);
  const section = spec.section as BoxSectionSpec;
  const { normal, offset } = boxPlane(vertices, section);
  const sign = Math.sign(normal.find((value) => Math.abs(value) > 1e-9) ?? 1);
  return {
    normal: normal.map((value) => value * sign) as unknown as Vec,
    offset: offset * sign,
    vertices,
    spec,
    section,
  };
}

const expectSamePlane = (a: ReturnType<typeof planeOf>, b: ReturnType<typeof planeOf>) => {
  for (const axis of [0, 1, 2] as const) expect(a.normal[axis]).toBeCloseTo(b.normal[axis], 9);
  expect(a.offset).toBeCloseTo(b.offset, 6);
};

const actions = (kind: BoxSolid, state: ParameterState) => {
  const panel = shapePanel(kind, state.choices, resolve(kind, state));
  return (panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : []).flatMap((field) =>
    field.type === 'action' ? [field.action] : [],
  );
};

/** Every prism base the app offers, as its choices and shape texts give it. */
const PRISMS: readonly {
  readonly name: string;
  readonly choices: Partial<ParameterChoices>;
  readonly texts: Partial<ParameterTexts>;
}[] = [
  { name: 'a regular triangular prism', choices: { prismBaseType: 'regular', prismBaseSides: 3 }, texts: {} },
  { name: 'a scalene triangular prism', choices: { prismBaseType: 'triangle' }, texts: {} },
  { name: 'a regular quadrilateral prism', choices: { prismBaseType: 'regular', prismBaseSides: 4 }, texts: {} },
  { name: 'a trapezoidal prism', choices: { prismBaseType: 'trapezoid' }, texts: {} },
  { name: 'a regular pentagonal prism', choices: { prismBaseType: 'regular', prismBaseSides: 5 }, texts: {} },
  { name: 'a regular hexagonal prism', choices: { prismBaseType: 'regular', prismBaseSides: 6 }, texts: {} },
  { name: 'a regular octagonal prism', choices: { prismBaseType: 'regular', prismBaseSides: 8 }, texts: {} },
];

/** A prism's inclined plane, given by its angles, at a position along its normal. */
const prismInclined = (base: Partial<ParameterChoices>, shape: Partial<ParameterTexts>, percent = '50'): ParameterState => ({
  texts: texts({ ...shape, prismSectionPercent: percent }),
  choices: choices({ ...base, prismSection: 'inclined' }),
});

/** The second parallel plane's offset along the first plane's turned normal. */
const secondOffset = (plane: ReturnType<typeof planeOf>) => {
  const along = Object.values(plane.vertices).map((vertex) => dot(plane.normal, vertex as Vec));
  const [low, high] = [Math.min(...along), Math.max(...along)];
  const percent = (plane.section as { secondPositionPercent: number }).secondPositionPercent;
  const raw = boxPlane(plane.vertices, plane.section).normal;
  return Math.sign(dot(raw as Vec, plane.normal)) > 0
    ? low + (percent / 100) * (high - low)
    : high - (percent / 100) * (high - low);
};

/** The planes an inclined state gives, as «Змінити нахил» leaves them: the page's effects run until nothing changes. */
function manualOf(kind: BoxSolid, state: ParameterState): ParameterState {
  let next = state;
  for (let round = 0; round < 3; round += 1) next = followNormal(kind, next, resolve(kind, next).values) ?? next;
  next = normalAlongManual(kind, next);
  for (let round = 0; round < 3; round += 1) next = followNormal(kind, next, resolve(kind, next).values) ?? next;
  return next;
}

const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** That the plane's normal is parallel to the segment P → Q at the solid's actual vertices. */
function expectPerpendicular(plane: ReturnType<typeof planeOf>, [p, q]: BoxSegment) {
  const direction = unit(minus(plane.vertices[q] as Vec, plane.vertices[p] as Vec));
  expect(Math.hypot(...cross(plane.normal, direction))).toBeLessThan(1e-9);
}

describe('an inclined plane perpendicular to a segment picked on the model', () => {
  it('A–D on a unit cube at the middle position: x = 1/2, x + y = 1, x + y + z = 3/2 with its regular hexagon, either end first', () => {
    for (const [segment, expected, sides] of [
      [['A', 'B'], [1, 0, 0], 4],
      [['A', 'C'], [1, 1, 0], 4],
      [['A', 'C1'], [1, 1, 1], 6],
    ] as const) {
      const state = perpendicularTo('cube', inclined('cube', {}), [...segment]);
      const plane = planeOf('cube', state);
      // The unit cube with A at the origin: its edge a, and A as the origin; the plane n·x = d, n along the segment.
      const a = plane.vertices.B[0] - plane.vertices.A[0];
      const n = unit(expected as Vec);
      expect(Math.abs(dot(plane.normal, n))).toBeCloseTo(1, 12);
      const sign = Math.sign(dot(plane.normal, n));
      const unitOffset = ((plane.offset - dot(plane.normal, plane.vertices.A)) / a) * sign;
      const sum = expected.reduce((total: number, value) => total + value, 0);
      expect(unitOffset).toBeCloseTo(sum / 2 / Math.hypot(...expected), 12);
      const { contour } = boxSection(plane.spec.shape as BoxLikeShape, plane.spec.scale, { box: plane.section });
      expect(contour).toHaveLength(sides);
      if (sides === 6) {
        // A regular hexagon: equal sides, each at the same distance from the centre.
        const lengths = contour.map((point, index) => Math.hypot(...minus(point, contour[(index + 1) % 6] as Vec)));
        for (const length of lengths) expect(length).toBeCloseTo(lengths[0] as number, 9);
        const centre = contour.reduce<Vec>(
          (sum_, point) => [sum_[0] + point[0] / 6, sum_[1] + point[1] / 6, sum_[2] + point[2] / 6],
          [0, 0, 0],
        );
        const radii = contour.map((point) => Math.hypot(...minus(point, centre)));
        for (const radius of radii) expect(radius).toBeCloseTo(lengths[0] as number, 9);
      }
      // Picked the other way round: the same listed segment, the same plane.
      const reversed = perpendicularTo('cube', inclined('cube', {}), [segment[1], segment[0]]);
      expect(reversed.choices.cubeNormalAlong).toBe(state.choices.cubeNormalAlong);
      expectSamePlane(planeOf('cube', reversed), plane);
    }
  });

  it.each(SOLIDS)('is perpendicular to the very segment, halfway along the solid in its direction, on the %s', (kind, shape) => {
    for (const segment of [
      ['A', 'B'],
      ['B', 'D'],
      ['A', 'C1'],
      ['B', 'D1'],
      ['A', 'A1'],
      ['B1', 'C'],
    ] as const) {
      const plane = planeOf(kind, perpendicularTo(kind, inclined(kind, shape), [...segment]));
      const direction = unit(minus(plane.vertices[segment[1]], plane.vertices[segment[0]]));
      expect(Math.abs(dot(plane.normal, direction))).toBeCloseTo(1, 9);
      const along = Object.values(plane.vertices).map((vertex) => dot(plane.normal, vertex as Vec));
      expect(plane.offset).toBeCloseTo((Math.min(...along) + Math.max(...along)) / 2, 6);
    }
  });

  it('takes a lateral edge picked on the model as the lateral edges, as their preset does, along the actual lean', () => {
    const keys = boxKeysOf('parallelepiped');
    for (const edge of [
      ['B', 'B1'],
      ['D1', 'D'],
    ] as const) {
      const picked = perpendicularTo('parallelepiped', inclined('parallelepiped', OBLIQUE), [...edge]);
      expect(picked.choices[keys.NormalAlong]).toBe('A-A1');
    }
    const plane = planeOf('parallelepiped', perpendicularTo('parallelepiped', inclined('parallelepiped', OBLIQUE), ['B', 'B1']));
    const lateral = unit(minus(plane.vertices.A1, plane.vertices.A));
    expect(Math.abs(dot(plane.normal, lateral))).toBeCloseTo(1, 9);
    expect(Math.abs(plane.normal[2])).toBeLessThan(0.99);
  });

  it('keeps the plane when a parallel segment that points the other way is chosen, and a position meeting only an extension', () => {
    const keys = boxKeysOf('parallelepiped');
    const at = perpendicularTo('parallelepiped', inclined('parallelepiped', OBLIQUE, '30'), ['A', 'B']);
    const first = planeOf('parallelepiped', at);
    // C → D runs against A → B: the position is read from the other side, 70 %, the same plane.
    const turned = perpendicularTo('parallelepiped', at, ['C', 'D']);
    expect(turned.choices[keys.NormalAlong]).not.toBe(at.choices[keys.NormalAlong]);
    expect(turned.texts[keys.SectionPercent]).toBe('70');
    expectSamePlane(planeOf('parallelepiped', turned), first);
    // Perpendicular to AB at 80 % of the solid's extent along it: the leaning upper base reaches far beyond B, so the plane cuts
    // the solid there, meeting AB's line beyond B only.
    const far = perpendicularTo('parallelepiped', inclined('parallelepiped', OBLIQUE, '80'), ['A', 'B']);
    const plane = planeOf('parallelepiped', far);
    const [a, b] = [plane.vertices.A, plane.vertices.B];
    const t = (plane.offset - dot(plane.normal, a)) / dot(plane.normal, minus(b, a));
    expect(t).toBeGreaterThan(1);
  });

  it('given by its angles again by «Змінити нахил», stays the plane it was, both of its planes', () => {
    const keys = boxKeysOf('parallelepiped');
    const picked = perpendicularTo('parallelepiped', inclined('parallelepiped', OBLIQUE, '35'), ['A', 'C1']);
    const two: ParameterState = {
      ...picked,
      texts: { ...picked.texts, [keys.SectionSecondPercent]: '70' },
      choices: { ...picked.choices, [keys.SecondCut]: true },
    };
    const before = planeOf('parallelepiped', two);
    // The page's effects: the segment remembered, then the angles read off the plane once it is given by them.
    let state = two;
    for (let round = 0; round < 3; round += 1)
      state = followNormal('parallelepiped', state, resolve('parallelepiped', state).values) ?? state;
    state = normalAlongManual('parallelepiped', state);
    for (let round = 0; round < 3; round += 1)
      state = followNormal('parallelepiped', state, resolve('parallelepiped', state).values) ?? state;
    expect(state.choices[keys.NormalAlong]).toBe('none');
    const after = planeOf('parallelepiped', state);
    expectSamePlane(after, before);
    expect(secondOffset(after)).toBeCloseTo(secondOffset(before), 6);
  });

  it('offers no separate lateral-edge shortcut beside the field: its AA₁ is the very state the shortcut set, for every prism too', () => {
    const solids: readonly [BoxSolid, ParameterState][] = [
      ...SOLIDS.map(([kind, shape]): [BoxSolid, ParameterState] => [kind, inclined(kind, shape, '35')]),
      ...PRISMS.map(({ choices: base, texts: shape }): [BoxSolid, ParameterState] => [
        'prism',
        prismInclined(base, { ...shape, prismOffsetXRatio: '0,4' }, '35'),
      ]),
    ];
    for (const [kind, state] of solids) {
      expect(actions(kind, state)).not.toContain('normal-lateral');
      // AA₁ chosen in the field is the state the old shortcut set: the same plane, the position kept.
      const chosen = perpendicularTo(kind, state, ['A', 'A1']);
      expect(chosen.choices).toEqual({ ...state.choices, [boxKeysOf(kind).NormalAlong]: 'A-A1' });
      expect(resolve(kind, chosen).spec?.section).toMatchObject({ normalAlong: ['A', 'A1'], positionPercent: 35 });
      expect(actions(kind, chosen)).toContain('normal-manual');
    }
  });

  it('lists its segments in three groups by name, and shows the segment chosen', () => {
    const state = perpendicularTo('cube', inclined('cube', {}), ['C1', 'A']);
    const panel = shapePanel('cube', state.choices, resolve('cube', state));
    const fields = panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : [];
    const field = fields.find((candidate) => candidate.type === 'normal-construction') as NormalField;
    expect(field).toMatchObject({ title: 'AC₁', chosen: 'AC₁ — діагональ тіла', selected: 'A-C1', open: false });
    expect([...new Set(field.options.map(({ group }) => group))]).toEqual(['Ребра', 'Діагоналі граней', 'Діагоналі тіла']);
    expect(field.options.filter(({ group }) => group === 'Діагоналі тіла').map(({ label }) => label)).toEqual([
      'AC₁',
      'BD₁',
      'CA₁',
      'DB₁',
    ]);
    // The old collapsed list of the same choice is not offered beside it.
    expect(fields.some((candidate) => candidate.type === 'disclosure' && candidate.key === 'cube-normal-along')).toBe(false);
    // The segment-holding construction keeps its own rule: no body diagonal among its segments.
    const through = shapePanel('cube', choices({ cubeSection: 'through-line' }), {});
    const segments = (through.type === 'parameters' ? through.sections.flatMap((group) => group.fields) : []).find(
      (candidate) => candidate.type === 'through-point',
    );
    expect(segments?.type === 'through-point' ? segments.segment.options.map(({ label }) => label) : []).not.toContain(
      'AC₁ — діагональ грані',
    );
    expect(segments?.type === 'through-point' ? segments.segment.options.some(({ value }) => value === 'A-C1') : true).toBe(
      false,
    );
  });
});

describe('the segment of every prism, right or oblique, picked by the same field', () => {
  const LEANS = [
    ['right', {}],
    ['oblique', { prismOffsetXRatio: '0,4', prismOffsetYRatio: '-0,3' }],
  ] as const;
  const fieldsOf = (state: ParameterState) => {
    const panel = shapePanel('prism', state.choices, resolve('prism', state));
    return panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : [];
  };
  const normalFieldOf = (state: ParameterState) =>
    fieldsOf(state).find((candidate) => candidate.type === 'normal-construction') as NormalField;

  describe.each(PRISMS)('$name', ({ choices: base, texts: shape }) => {
    const topology = boxTopologyFor('prism', choices(base));
    const n = topology.sides;
    const together = (pair: readonly [BoxVertex, BoxVertex]) =>
      topology.faceNames.some((face) => pair.every((vertex) => (topology.faces[face] ?? []).includes(vertex)));
    const isEdge = ([a, b]: readonly [BoxVertex, BoxVertex]) =>
      topology.edges.some(([u, v]) => (u === a && v === b) || (u === b && v === a));

    it.each(LEANS)('%s: one field, no shortcut nor list by name, its groups and segments classified by topology', (_, lean) => {
      const state = prismInclined(base, { ...shape, ...lean });
      const field = normalFieldOf(state);
      expect(field).toMatchObject({ key: 'prism-normal', title: 'не вибрано', selected: '' });
      expect(fieldsOf(state).some(({ key }) => key === 'prism-normal-along' || key === 'prism-normal-lateral')).toBe(false);
      expect(actions('prism', state)).not.toContain('normal-lateral');
      // Every pair of vertices once, the n parallel lateral edges as one entry.
      expect(field.options).toHaveLength((2 * n * (2 * n - 1)) / 2 - n + 1);
      for (const { value, group } of field.options) {
        const pair = value.split('-') as unknown as [BoxVertex, BoxVertex];
        const kind = isEdge(pair) ? 'Ребра' : together(pair) ? 'Діагоналі граней' : 'Діагоналі тіла';
        expect(group).toBe(kind);
      }
      // A triangular prism's two vertices off a common face do not exist: no body diagonals, and no empty group for them.
      expect([...new Set(field.options.map(({ group }) => group))]).toEqual(
        n === 3 ? ['Ребра', 'Діагоналі граней'] : ['Ребра', 'Діагоналі граней', 'Діагоналі тіла'],
      );
    });

    it.each(LEANS)(
      '%s: an edge, a face diagonal and a body diagonal, by the model or by name, give the normal Q − P',
      (_, lean) => {
        const state = prismInclined(base, { ...shape, ...lean }, '40');
        const field = normalFieldOf(state);
        for (const { value, group } of field.options) {
          const segment = value.split('-') as unknown as BoxSegment;
          // By name: the option's ends; on the model: the same two vertices tapped the other way round.
          const named = perpendicularTo('prism', state, segment);
          const reversed = perpendicularTo('prism', state, [segment[1], segment[0]]);
          expect(named.choices.prismNormalAlong).toBe(value);
          expect(reversed.choices.prismNormalAlong).toBe(value);
          const plane = planeOf('prism', named);
          expectPerpendicular(plane, segment);
          expectSamePlane(planeOf('prism', reversed), plane);
          expect(plane.section).toMatchObject({ type: 'inclined', positionPercent: 40 });
          expect(normalFieldOf(named).chosen).toContain(
            group === 'Ребра'
              ? value === 'A-A1'
                ? 'усі бічні ребра'
                : 'ребро'
              : group === 'Діагоналі граней'
                ? 'діагональ грані'
                : 'діагональ тіла',
          );
        }
      },
    );

    it('any lateral edge picked is the lateral edges, the same plane; the solid changed, the plane follows the segment', () => {
      const state = prismInclined(base, { ...shape, prismOffsetXRatio: '0,4', prismOffsetYRatio: '-0,3' }, '30');
      const a = perpendicularTo('prism', state, ['A', 'A1']);
      const plane = planeOf('prism', a);
      for (const vertex of topology.vertices.slice(0, n)) {
        const other = perpendicularTo('prism', state, [`${vertex}1` as BoxVertex, vertex]);
        expect(other.choices.prismNormalAlong).toBe('A-A1');
        expectSamePlane(planeOf('prism', other), plane);
      }
      // A body diagonal where there is one, else a face's: taller and leaning the other way, still perpendicular to it.
      const far = topology.vertices.find((vertex) => !together(['A', vertex]) && vertex !== 'A');
      const segment: BoxSegment = ['A', far ?? 'B1'];
      const picked = perpendicularTo('prism', state, segment);
      const changed: ParameterState = {
        ...picked,
        texts: { ...picked.texts, prismHeightRatio: '1,3', prismOffsetXRatio: '-0,5', prismOffsetYRatio: '0,2' },
      };
      expectPerpendicular(planeOf('prism', changed), segment);
      expect(normalFieldOf(changed).selected).toBe(picked.choices.prismNormalAlong);
    });

    it('«Змінити нахил» keeps both planes of a second cut, its connector and its parts apart', () => {
      const state = prismInclined(base, { ...shape, prismOffsetXRatio: '0,4' }, '35');
      const far = topology.vertices.find((vertex) => !together(['A', vertex]) && vertex !== 'A') ?? 'C1';
      const picked = perpendicularTo('prism', state, [far, 'A']);
      const two: ParameterState = {
        ...picked,
        texts: { ...picked.texts, prismSectionSecondPercent: '70' },
        choices: { ...picked.choices, prismSecondCut: true, prismConnector: 'magnet', prismPartsSeparated: true },
      };
      const before = planeOf('prism', two);
      const after = manualOf('prism', two);
      expect(after.choices).toMatchObject({
        prismNormalAlong: 'none',
        prismSecondCut: true,
        prismConnector: 'magnet',
        prismPartsSeparated: true,
      });
      const plane = planeOf('prism', after);
      expectSamePlane(plane, before);
      expect(secondOffset(plane)).toBeCloseTo(secondOffset(before), 6);
      expect(normalFieldOf(after).title).toBe('не вибрано');
    });
  });

  it('classifies AC₁ by the solid: a face diagonal of a triangular prism, a body diagonal of a quadrilateral one', () => {
    const groupOf = (base: Partial<ParameterChoices>) =>
      normalFieldOf(prismInclined(base, {})).options.find(({ value }) => value === 'A-C1')?.group;
    expect(groupOf({ prismBaseType: 'regular', prismBaseSides: 3 })).toBe('Діагоналі граней');
    expect(groupOf({ prismBaseType: 'triangle' })).toBe('Діагоналі граней');
    expect(groupOf({ prismBaseType: 'regular', prismBaseSides: 4 })).toBe('Діагоналі тіла');
    expect(groupOf({ prismBaseType: 'trapezoid' })).toBe('Діагоналі тіла');
    // In a hexagon AC is a base diagonal, so AC₁ still crosses a lateral face of none: a body diagonal; AB₁ a face's.
    expect(groupOf({ prismBaseType: 'regular', prismBaseSides: 6 })).toBe('Діагоналі тіла');
  });
});
