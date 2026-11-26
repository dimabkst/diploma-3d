import { type BoxLikeShape, boxPlane, boxVertices } from '@diploma-3d/engine';
import type { BoxSectionSpec, BoxSegment, BoxVertex } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { type DiagonalField, shapePanel } from '../shapes.ts';
import { type BoxSolid, boxKeysOf } from './box.ts';
import { diagonalFamilies, diagonalPartners, familyOf } from './diagonalConstruction.ts';
import {
  applyPilotChoice,
  initialParameterChoices,
  initialParameterTexts,
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

/** A longitudinal plane through a base diagonal, through it or moved off it, as the page holds it. */
function diagonal(
  kind: BoxSolid,
  shape: Partial<ParameterTexts>,
  segment: string,
  through = true,
  percent = '50',
): ParameterState {
  const keys = boxKeysOf(kind);
  return {
    texts: texts({ ...shape, [keys.SectionPercent]: percent } as Partial<ParameterTexts>),
    choices: choices({
      [keys.Section]: 'longitudinal',
      [keys.Trace]: 'diagonal',
      [keys.TraceSegment]: segment,
      [keys.TraceThrough]: through,
    } as Partial<ParameterChoices>),
  };
}

const resolve = (kind: BoxSolid, state: ParameterState) =>
  resolveModelRequest(kind, state.texts, state.choices, { exact: state.exact ?? {}, connectorEdits: {} });

function planeOf(kind: BoxSolid, state: ParameterState) {
  const request = resolve(kind, state);
  expect(request.errors).toEqual({});
  const spec = request.spec;
  if (spec?.section === undefined) throw new Error('Expected a section.');
  const vertices = boxVertices(spec.shape as BoxLikeShape, spec.scale);
  const { normal, offset } = boxPlane(vertices, spec.section as BoxSectionSpec);
  return { normal: normal as Vec, offset, vertices, section: spec.section };
}

describe('a longitudinal plane through a base diagonal, picked on the model', () => {
  it('cuts a unit cube in x − y = 0 through AC and in x + y = 1 through BD', () => {
    for (const [segment, expected] of [
      ['A-C', { normal: [Math.SQRT1_2, -Math.SQRT1_2, 0], offset: 0 }],
      ['B-D', { normal: [Math.SQRT1_2, Math.SQRT1_2, 0], offset: Math.SQRT1_2 }],
    ] as const) {
      const { normal, offset, vertices } = planeOf('cube', diagonal('cube', {}, segment));
      // The unit cube with A at the origin: the solid's edge a, and its corner A as the origin.
      const a = (vertices.B as Vec)[0] - (vertices.A as Vec)[0];
      const sign = Math.sign(dot(normal, expected.normal));
      const unitOffset = (offset - dot(normal, vertices.A as Vec)) / a;
      for (const axis of [0, 1, 2] as const) expect(normal[axis] * sign).toBeCloseTo(expected.normal[axis], 12);
      expect(unitOffset * sign).toBeCloseTo(expected.offset, 12);
    }
  });

  it.each(SOLIDS)('holds both bases’ diagonals and runs along the actual lateral edges, on the %s', (kind, shape) => {
    for (const [segment, corners] of [
      ['A-C', ['A', 'C', 'A1', 'C1']],
      ['B-D', ['B', 'D', 'B1', 'D1']],
    ] as const) {
      const { normal, offset, vertices } = planeOf(kind, diagonal(kind, shape, segment));
      for (const corner of corners) expect(Math.abs(dot(normal, vertices[corner as BoxVertex]) - offset)).toBeLessThan(1e-9);
      expect(dot(normal, minus(vertices.A1, vertices.A))).toBeCloseTo(0, 9);
    }
  });

  it('takes a diagonal of either base, its ends in either order, as its family; an equivalent one changes nothing', () => {
    const keys = boxKeysOf('cube');
    const families = diagonalFamilies([
      ['A', 'C'],
      ['B', 'D'],
    ]);
    expect(familyOf(families, ['C1', 'A1'])?.key).toBe('A-C');
    expect(familyOf(families, ['A', 'C1'])).toBeUndefined();
    expect(familyOf(families, ['A', 'B'])).toBeUndefined();
    expect([diagonalPartners(families, 'A'), diagonalPartners(families, 'D1'), diagonalPartners(families, 'C')]).toEqual([
      ['C'],
      ['B1'],
      ['A'],
    ]);
    // Moved off the diagonal: an equivalent diagonal leaves the plane where it is.
    const moved = diagonal('cube', {}, 'A-C', false, '30');
    for (const segment of [
      ['A1', 'C1'],
      ['C', 'A'],
      ['C1', 'A1'],
    ] satisfies BoxSegment[]) {
      expect(applyPilotChoice('cube', moved, resolve('cube', moved).values, { kind: 'diagonal', segment })).toBe(moved);
    }
    // The other family.
    const other = applyPilotChoice('cube', moved, resolve('cube', moved).values, { kind: 'diagonal', segment: ['D1', 'B1'] });
    expect(other.choices[keys.TraceSegment]).toBe('B-D');
    expect(other.texts).toEqual(moved.texts);
  });

  it('keeps the diagonal through a new shape, and shows two families by name, the upper base’s with them', () => {
    const [, shape] = SOLIDS[2] as [BoxSolid, Partial<ParameterTexts>];
    const state = diagonal('parallelepiped', shape, 'B-D');
    const leaning = {
      ...state,
      texts: { ...state.texts, parallelepipedOffsetXRatio: '-0,4', parallelepipedBaseAngleDeg: '110' },
    };
    const { normal, offset, vertices, section } = planeOf('parallelepiped', leaning);
    expect(section).toMatchObject({ type: 'longitudinal', trace: 'diagonal', traceSegment: ['B', 'D'], through: true });
    for (const corner of ['B', 'D', 'B1', 'D1'] as const)
      expect(Math.abs(dot(normal, vertices[corner]) - offset)).toBeLessThan(1e-9);
    const panel = shapePanel('parallelepiped', leaning.choices, resolve('parallelepiped', leaning));
    const fields = panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : [];
    const field = fields.find((candidate) => candidate.type === 'diagonal-construction') as DiagonalField;
    expect(field).toMatchObject({ title: 'BD', selected: 'B-D', open: false });
    expect(field.options.map(({ label }) => label)).toEqual(['AC (і A₁C₁)', 'BD (і B₁D₁)']);
    // No other list of diagonals beside it, and the menu of traces as it was.
    expect(fields.some((candidate) => 'key' in candidate && candidate.key === 'parallelepipedTraceSegment')).toBe(false);
    const traces = fields.find((candidate) => 'key' in candidate && candidate.key === 'parallelepipedTrace');
    expect(traces?.type === 'choice' ? traces.options.map(({ label }) => label) : []).toEqual([
      'Під кутом до ребра AB',
      'Через діагональ',
    ]);
  });
});
