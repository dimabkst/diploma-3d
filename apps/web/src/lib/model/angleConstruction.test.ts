import { type BoxLikeShape, boxPlane, boxVertices } from '@diploma-3d/engine';
import { BOX_TOPOLOGY, type BoxFace, type BoxSectionSpec, type BoxVertex } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { type BoxSolid, boxKeysOf } from './box.ts';
import {
  applyPilotChoice,
  initialParameterChoices,
  initialParameterTexts,
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
const unit = (a: Vec): Vec => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
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

/** A plane through a segment at an angle to a face, on a side, as the page holds it. */
function atAngle(
  kind: BoxSolid,
  shape: Partial<ParameterTexts>,
  line: string,
  face: BoxFace,
  angle: string,
  side: 'first' | 'second' = 'first',
): ParameterState {
  const keys = boxKeysOf(kind);
  return {
    texts: texts({ ...shape, [keys.LineDihedralDeg]: angle } as Partial<ParameterTexts>),
    choices: choices({
      [keys.Section]: 'through-line',
      [keys.LineMethod]: 'angle',
      [keys.Line]: line,
      [keys.LineFace]: face,
      [keys.LineSide]: side,
    } as Partial<ParameterChoices>),
  };
}

const resolve = (kind: BoxSolid, state: ParameterState) =>
  resolveModelRequest(kind, state.texts, state.choices, { exact: state.exact ?? {}, connectorEdits: {} });
const choose = (kind: BoxSolid, state: ParameterState, choice: PilotChoice) =>
  applyPilotChoice(kind, state, resolve(kind, state).values, choice);

/** The request's plane: its unit normal turned to one orientation, its offset, and the solid's vertices. */
function planeOf(kind: BoxSolid, state: ParameterState) {
  const request = resolve(kind, state);
  expect(request.errors).toEqual({});
  const spec = request.spec;
  if (spec?.section === undefined) throw new Error(`Expected a section: ${JSON.stringify(request.pilotDraft)}`);
  const vertices = boxVertices(spec.shape as BoxLikeShape, spec.scale);
  const { normal, offset } = boxPlane(vertices, spec.section as BoxSectionSpec);
  const sign = Math.sign(normal.find((value) => Math.abs(value) > 1e-9) ?? 1);
  return { normal: normal.map((value) => value * sign) as unknown as Vec, offset: offset * sign, vertices, request };
}

const expectSamePlane = (a: ReturnType<typeof planeOf>, b: ReturnType<typeof planeOf>) => {
  for (const axis of [0, 1, 2] as const) expect(a.normal[axis]).toBeCloseTo(b.normal[axis], 9);
  expect(a.offset).toBeCloseTo(b.offset, 6);
};

/** The smaller dihedral angle between a plane and a face of the solid, from their normals, in degrees. */
function angleTo(plane: ReturnType<typeof planeOf>, face: BoxFace): number {
  const corners = (BOX_TOPOLOGY.faces[face] ?? []).map((name) => plane.vertices[name]);
  const [a, b, c] = corners as [Vec, Vec, Vec];
  const faceNormal = unit(cross(minus(b, a), minus(c, a)));
  return (Math.acos(Math.min(1, Math.abs(dot(plane.normal, faceNormal)))) * 180) / Math.PI;
}

const onPlane = (plane: ReturnType<typeof planeOf>, vertex: BoxVertex) =>
  Math.abs(dot(plane.normal, plane.vertices[vertex]) - plane.offset);

describe('a plane through a segment at an angle to a face that holds it', () => {
  it('A: AC at 45° to ABCD has two planes, the other one offered and switched to explicitly', () => {
    const first = atAngle('cube', {}, 'A-C', 'ABCD', '45');
    const one = planeOf('cube', first);
    expect(one.request.pilotDraft).toMatchObject({ status: 'valid', alternative: true });
    const other = choose('cube', first, { kind: 'angle-side' });
    expect(other.choices.cubeLineSide).toBe('second');
    const two = planeOf('cube', other);
    expect(two.request.pilotDraft).toMatchObject({ status: 'valid', alternative: true });
    for (const plane of [one, two]) {
      expect(angleTo(plane, 'ABCD')).toBeCloseTo(45, 9);
      expect(onPlane(plane, 'A')).toBeLessThan(1e-9);
      expect(onPlane(plane, 'C')).toBeLessThan(1e-9);
    }
    expect(Math.abs(dot(one.normal, two.normal))).toBeLessThan(1 - 1e-6);
  });

  it('B: AC at 90° to ABCD is the one plane through A, C, A₁ and C₁, with no other offered', () => {
    const plane = planeOf('cube', atAngle('cube', {}, 'A-C', 'ABCD', '90'));
    expect(plane.request.pilotDraft).toMatchObject({ status: 'valid', alternative: false });
    for (const vertex of ['A', 'C', 'A1', 'C1'] as const) expect(onPlane(plane, vertex)).toBeLessThan(1e-9);
    expectSamePlane(planeOf('cube', atAngle('cube', {}, 'A-C', 'ABCD', '90', 'second')), plane);
  });

  it('C: AB at 30° to ABCD cuts the cube; the same plane reads 60° to ABB₁A₁, which keeps it', () => {
    const state = atAngle('cube', {}, 'A-B', 'ABCD', '30');
    const plane = planeOf('cube', state);
    // The other plane at 30° leans away from the cube over AB: it only touches it, and is not offered.
    expect(plane.request.pilotDraft).toMatchObject({ status: 'valid', alternative: false });
    expect(angleTo(plane, 'ABCD')).toBeCloseTo(30, 9);
    const side = choose('cube', state, { kind: 'angle-face', face: 'ABB1A1' });
    expect(side.choices.cubeLineFace).toBe('ABB1A1');
    expect(side.texts.cubeLineDihedralDeg).toBe('60');
    expectSamePlane(planeOf('cube', side), plane);
    // And back to ABCD: 30° again, the same plane.
    const back = choose('cube', side, { kind: 'angle-face', face: 'ABCD' });
    expect(back.texts.cubeLineDihedralDeg).toBe('30');
    expectSamePlane(planeOf('cube', back), plane);
  });

  it('D: AB at 90° to ABCD lies in ABB₁A₁, said at the construction, the plain solid shown', () => {
    const request = resolve('cube', atAngle('cube', {}, 'A-B', 'ABCD', '90'));
    expect(request.errors).toEqual({});
    expect(request.spec?.section).toBeUndefined();
    expect(request.pilotDraft).toEqual({
      status: 'invalid',
      problem: 'face',
      message: 'Під цим кутом площина збігається з гранню ABB₁A₁. Змініть кут.',
      alternative: false,
    });
    // 0° is the reference face itself, and an angle out of 0°–90° is said at the field.
    expect(resolve('cube', atAngle('cube', {}, 'A-C', 'ABCD', '0')).pilotDraft).toMatchObject({ problem: 'face' });
    expect(resolve('cube', atAngle('cube', {}, 'A-C', 'ABCD', '120')).pilotDraft).toMatchObject({
      status: 'invalid',
      problem: 'angle',
    });
  });

  it('keeps a chosen plane that only touches the solid, says so, and offers the other one that cuts it', () => {
    const state = atAngle('cube', {}, 'A-B', 'ABCD', '30', 'second');
    const request = resolve('cube', state);
    expect(request.spec?.section).toBeUndefined();
    expect(request.pilotDraft).toEqual({
      status: 'invalid',
      problem: 'touching',
      message:
        'Під цим кутом площина лише дотикається до тіла вздовж AB, не розтинаючи його. Змініть кут або оберіть «Інше положення перерізу».',
      alternative: true,
    });
    // Asked for, the other plane: the one that cuts the cube.
    expect(planeOf('cube', choose('cube', state, { kind: 'angle-side' })).request.pilotDraft).toMatchObject({ status: 'valid' });
  });

  it('E: AB₁ and the midpoint of DD₁, taken to an angle, keep the plane; the point is kept for the way back', () => {
    for (const [kind, shape] of SOLIDS) {
      const keys = boxKeysOf(kind);
      const point: ParameterState = {
        texts: texts(shape),
        choices: choices({
          [keys.Section]: 'through-line',
          [keys.LineMethod]: 'point',
          [keys.Line]: 'A-B1',
          [keys.PointEdge]: 'D-D1',
          [keys.PointMode]: 'midpoint',
        } as Partial<ParameterChoices>),
      };
      const through = planeOf(kind, point);
      const angled = choose(kind, point, { kind: 'method', method: 'angle' });
      expect(angled.choices[keys.LineMethod]).toBe('angle');
      expect(angled.choices[keys.PointEdge]).toBe('D-D1');
      const atAnAngle = planeOf(kind, angled);
      expectSamePlane(atAnAngle, through);
      expect(angleTo(atAnAngle, angled.choices[keys.LineFace] as BoxFace)).toBeCloseTo(
        Number(angled.exact?.[keys.LineDihedralDeg]),
        9,
      );
      // Back to the point: the same construction as before.
      expectSamePlane(planeOf(kind, choose(kind, angled, { kind: 'method', method: 'point' })), through);
    }
  });

  it.each(SOLIDS)(
    'makes the true angle with the face and holds the segment, whichever way its ends are given, on the %s',
    (kind, shape) => {
      const keys = boxKeysOf(kind);
      for (const [line, face] of [
        ['A-C', 'ABCD'],
        ['B-D', 'ABCD'],
        ['A-B', 'ABCD'],
        ['A-B', 'ABB1A1'],
        ['B-C1', 'BCC1B1'],
        ['C-C1', 'CDD1C1'],
      ] as const) {
        for (const angle of ['30', '55', '80']) {
          const state = atAngle(kind, shape, line, face, angle);
          const request = resolve(kind, state);
          if (request.spec?.section === undefined) continue;
          const plane = planeOf(kind, state);
          expect(angleTo(plane, face)).toBeCloseTo(Number(angle), 9);
          const [a, b] = line.split('-') as [BoxVertex, BoxVertex];
          expect(onPlane(plane, a)).toBeLessThan(1e-9);
          expect(onPlane(plane, b)).toBeLessThan(1e-9);
          // Picked the other way round: the same segment, the same plane.
          const reversed = choose(kind, state, { kind: 'segment', segment: [b, a] });
          expect(reversed.choices[keys.Line]).toBe(line);
          expectSamePlane(planeOf(kind, reversed), plane);
        }
      }
    },
  );
});
