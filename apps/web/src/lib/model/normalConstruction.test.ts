import { type BoxLikeShape, boxPlane, boxSection, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec, BoxSegment } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { type NormalField, shapePanel } from '../shapes.ts';
import { type BoxSolid, boxKeysOf } from './box.ts';
import {
  applyPilotChoice,
  followNormal,
  initialParameterChoices,
  initialParameterTexts,
  normalAlongLateral,
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
    const second = (plane: ReturnType<typeof planeOf>) => {
      const along = Object.values(plane.vertices).map((vertex) => dot(plane.normal, vertex as Vec));
      const [low, high] = [Math.min(...along), Math.max(...along)];
      const percent = (plane.section as { secondPositionPercent: number }).secondPositionPercent;
      const raw = boxPlane(plane.vertices, plane.section).normal;
      return Math.sign(dot(raw as Vec, plane.normal)) > 0
        ? low + (percent / 100) * (high - low)
        : high - (percent / 100) * (high - low);
    };
    expect(second(after)).toBeCloseTo(second(before), 6);
  });

  it('offers no separate lateral-edge shortcut beside the field, whose AA₁ is that very construction, which a prism keeps', () => {
    const actions = (kind: BoxSolid, state: ParameterState) => {
      const panel = shapePanel(kind, state.choices, resolve(kind, state));
      return (panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : []).flatMap((field) =>
        field.type === 'action' ? [field.action] : [],
      );
    };
    for (const [kind, shape] of SOLIDS) {
      const state = inclined(kind, shape, '35');
      expect(actions(kind, state)).not.toContain('normal-lateral');
      // AA₁ chosen in the field is the state the old shortcut set: the same plane, the position kept.
      const chosen = perpendicularTo(kind, state, ['A', 'A1']);
      expect(chosen).toEqual(normalAlongLateral(kind, state));
      expect(resolve(kind, chosen).spec?.section).toMatchObject({ normalAlong: ['A', 'A1'], positionPercent: 35 });
      expect(actions(kind, chosen)).toContain('normal-manual');
    }
    expect(actions('prism', { texts: texts(), choices: choices({ prismSection: 'inclined' }) })).toContain('normal-lateral');
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
