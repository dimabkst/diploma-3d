import { type BoxLikeShape, boxPlane, boxVertices } from '@diploma-3d/engine';
import { BOX_TOPOLOGY, type BoxFace, type BoxSectionSpec } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { type FaceConstructionField, shapePanel } from '../shapes.ts';
import { type BoxSolid, boxKeysOf } from './box.ts';
import { facePairs, oppositeFace, startingSecondRatio } from './faceConstruction.ts';
import {
  addSecondCut,
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

/** The construction of a solid with a face at a ratio, as the page holds it. */
function start(kind: BoxSolid, shape: Partial<ParameterTexts>, face: BoxFace, ratio?: readonly [string, string]): ParameterState {
  const keys = boxKeysOf(kind);
  return {
    texts: texts({
      ...shape,
      ...(ratio === undefined ? {} : { [keys.FaceRatioFirst]: ratio[0], [keys.FaceRatioSecond]: ratio[1] }),
    } as Partial<ParameterTexts>),
    choices: choices({
      [keys.Section]: 'face-parallel',
      [keys.Face]: face,
      [keys.FaceMode]: ratio === undefined ? 'midpoint' : 'ratio',
    } as Partial<ParameterChoices>),
  };
}

const resolve = (kind: BoxSolid, state: ParameterState) =>
  resolveModelRequest(kind, state.texts, state.choices, { exact: state.exact ?? {}, connectorEdits: {} });

const choose = (kind: BoxSolid, state: ParameterState, choice: PilotChoice) =>
  applyPilotChoice(kind, state, resolve(kind, state).values, choice);

/** The physical planes of a request's section, first and second, each as a unit normal and an offset with a positive normal. */
function planes(kind: BoxSolid, state: ParameterState): { normal: Vec; offset: number }[] {
  const request = resolve(kind, state);
  expect(request.errors).toEqual({});
  const spec = request.spec;
  if (spec?.section === undefined) throw new Error('Expected a section.');
  const vertices = boxVertices(spec.shape as BoxLikeShape, spec.scale);
  const section = spec.section as BoxSectionSpec;
  const first = boxPlane(vertices, section);
  const found = [{ normal: first.normal as Vec, offset: first.offset }];
  if ('secondPositionPercent' in section && section.secondPositionPercent !== undefined) {
    const { extent } = first;
    found.push({
      normal: first.normal as Vec,
      offset: extent.min + (section.secondPositionPercent / 100) * (extent.max - extent.min),
    });
  }
  // One orientation of each normal, so that the same plane measured from either side compares equal.
  return found.map(({ normal, offset }) => {
    const sign = Math.sign(normal.find((value) => Math.abs(value) > 1e-9) ?? 1);
    return { normal: normal.map((value) => value * sign) as unknown as Vec, offset: offset * sign };
  });
}

const expectSamePlanes = (actual: { normal: Vec; offset: number }[], expected: { normal: Vec; offset: number }[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((plane, index) => {
    const other = expected[index] as { normal: Vec; offset: number };
    for (const axis of [0, 1, 2] as const) expect(plane.normal[axis]).toBeCloseTo(other.normal[axis], 12);
    expect(plane.offset).toBeCloseTo(other.offset, 9);
  });
};

describe('a plane parallel to a face, by its face and its distances to it and to the opposite face', () => {
  it('pairs every face of a parallelepiped with the one opposite, three pairs by their first faces', () => {
    expect(facePairs(BOX_TOPOLOGY)).toEqual([
      { face: 'ABCD', opposite: 'A1B1C1D1' },
      { face: 'ABB1A1', opposite: 'CDD1C1' },
      { face: 'BCC1B1', opposite: 'DAA1D1' },
    ]);
    expect(oppositeFace(BOX_TOPOLOGY, 'DAA1D1')).toBe('BCC1B1');
  });

  it('A–C on a cube: the midpoint, 1 : 2 at a third of the height, and the top face that keeps the plane and reads 2 : 1', () => {
    const height = (state: ParameterState) => {
      const [plane] = planes('cube', state);
      return (plane?.offset as number) / (plane?.normal[2] as number);
    };
    const middle = start('cube', {}, 'ABCD');
    expect(height(middle)).toBeCloseTo(40, 9);
    const third = start('cube', {}, 'ABCD', ['1', '2']);
    expect(height(third)).toBeCloseTo(80 / 3, 9);
    const top = choose('cube', third, { kind: 'face', face: 'A1B1C1D1' });
    expect(top.choices.cubeFace).toBe('A1B1C1D1');
    expect([top.texts.cubeFaceRatioFirst, top.texts.cubeFaceRatioSecond]).toEqual(['2', '1']);
    expect(resolve('cube', top).spec?.section).toMatchObject({ face: 'A1B1C1D1' });
    expect(height(top)).toBeCloseTo(80 / 3, 9);
    // The midpoint stays the midpoint; a typed fraction is kept as typed, only read from the other side.
    expect(height(choose('cube', middle, { kind: 'face', face: 'A1B1C1D1' }))).toBeCloseTo(40, 9);
    const typed = choose('cube', start('cube', {}, 'ABCD', ['1,5', '2']), { kind: 'face', face: 'A1B1C1D1' });
    expect([typed.texts.cubeFaceRatioFirst, typed.texts.cubeFaceRatioSecond]).toEqual(['2', '1,5']);
  });

  it.each(SOLIDS)(
    'keeps both planes, their order and their colours when the reference turns to the opposite face, on the %s',
    (kind, shape) => {
      const keys = boxKeysOf(kind);
      for (const { face, opposite } of facePairs(BOX_TOPOLOGY)) {
        const first = start(kind, shape, face, ['1', '2']);
        // D: a second plane, from the same face, at 7 : 3.
        const two = addSecondCut(kind, first, resolve(kind, first).values);
        expect([two.texts[keys.SecondRatioFirst], two.texts[keys.SecondRatioSecond], two.choices[keys.SecondMode]]).toEqual([
          '3',
          '2',
          'ratio',
        ]);
        const before = planes(kind, two);
        const turned = choose(kind, two, { kind: 'face', face: opposite });
        expect([turned.texts[keys.FaceRatioFirst], turned.texts[keys.FaceRatioSecond]]).toEqual(['2', '1']);
        expect([turned.texts[keys.SecondRatioFirst], turned.texts[keys.SecondRatioSecond]]).toEqual(['2', '3']);
        // The first plane stays the first, orange, and the second the second, green, though now the second lies nearer the face.
        expectSamePlanes(planes(kind, turned), before);
        const section = resolve(kind, turned).spec?.section as { positionPercent: number; secondPositionPercent: number };
        expect(section.positionPercent).toBeCloseTo(200 / 3, 9);
        expect(section.secondPositionPercent).toBeCloseTo(40, 9);
        // And back: the same texts as at first.
        const back = choose(kind, turned, { kind: 'face', face });
        expect(back.texts).toEqual(two.texts);
      }
    },
  );

  it.each(SOLIDS)('puts the plane parallel to the very face, at t of the perpendicular gap, on the %s', (kind, shape) => {
    for (const { face, opposite } of facePairs(BOX_TOPOLOGY)) {
      const state = start(kind, shape, face, ['1', '3']);
      const spec = resolve(kind, state).spec;
      if (spec === undefined) throw new Error('Expected a model.');
      const vertices = boxVertices(spec.shape as BoxLikeShape, spec.scale);
      const [plane] = planes(kind, state);
      const { normal, offset } = plane as { normal: Vec; offset: number };
      // Every edge of the face lies in a plane parallel to the section: the normal is perpendicular to it.
      const corners = BOX_TOPOLOGY.faces[face] ?? [];
      for (const [index, corner] of corners.entries()) {
        const next = corners[(index + 1) % corners.length] as (typeof corners)[number];
        expect(dot(normal, minus(vertices[next], vertices[corner]))).toBeCloseTo(0, 9);
      }
      // d = d0 + t (d1 − d0), with d0 the face's and d1 the opposite face's offsets along n.
      const d0 = dot(normal, vertices[corners[0] as (typeof corners)[number]]);
      const d1 = dot(normal, vertices[(BOX_TOPOLOGY.faces[opposite] ?? [])[0] as (typeof corners)[number]]);
      expect(offset).toBeCloseTo(d0 + 0.25 * (d1 - d0), 9);
    }
  });

  it('keeps the face and the ratio while the solid changes, and its plane parallel to that face', () => {
    const state = start('parallelepiped', SOLIDS[2]?.[1] ?? {}, 'DAA1D1', ['2', '5']);
    for (const angle of ['70', '110']) {
      const changed = {
        ...state,
        texts: { ...state.texts, parallelepipedBaseAngleDeg: angle, parallelepipedOffsetXRatio: '-0,4' },
      };
      expect(resolve('parallelepiped', changed).spec?.section).toMatchObject({
        type: 'face-parallel',
        face: 'DAA1D1',
        positionPercent: 200 / 7,
      });
    }
  });

  it('chooses a pair by name from its first face, and leaves the face in effect alone when its own pair is chosen again', () => {
    const top = start('cube', {}, 'A1B1C1D1', ['1', '2']);
    expect(choose('cube', top, { kind: 'face-pair', face: 'ABCD' })).toEqual(top);
    const side = choose('cube', top, { kind: 'face-pair', face: 'BCC1B1' });
    expect(side.choices.cubeFace).toBe('BCC1B1');
    // Another orientation takes the position as it is, from the new face.
    expect([side.texts.cubeFaceRatioFirst, side.texts.cubeFaceRatioSecond]).toEqual(['1', '2']);
    const panel = shapePanel('cube', top.choices, resolve('cube', top));
    const field = (panel.type === 'parameters' ? panel.sections.flatMap((group) => group.fields) : []).find(
      (candidate) => candidate.type === 'face-construction',
    ) as FaceConstructionField;
    expect(field.face).toMatchObject({ title: 'A₁B₁C₁D₁', opposite: 'ABCD', selected: 'ABCD' });
    expect(field.face.options.map(({ label }) => label)).toEqual(['ABCD ∥ A₁B₁C₁D₁', 'ABB₁A₁ ∥ CDD₁C₁', 'BCC₁B₁ ∥ DAA₁D₁']);
    expect(field.positions[0]).toMatchObject({ title: '1 : 2', labels: ['Від A₁B₁C₁D₁', 'До ABCD'] });
  });

  it('says a position on a face, a ratio not valid, a plane too near a face and two equal planes beside them, not over the model', () => {
    const said = (state: ParameterState) => {
      const request = resolve('cube', state);
      expect(request.errors).toEqual({});
      expect(request.spec?.section).toBeUndefined();
      expect(request.key?.endsWith(':construction-draft')).toBe(true);
      return request.pilotDraft;
    };
    expect(said(start('cube', {}, 'ABCD', ['0', '1']))).toMatchObject({
      status: 'invalid',
      problem: 'boundary',
      position: 'first',
      message: 'Переріз збігається з гранню ABCD. Оберіть положення строго між ABCD і A₁B₁C₁D₁.',
    });
    expect(said(start('cube', {}, 'ABCD', ['1', '0']))).toMatchObject({
      problem: 'boundary',
      message: expect.stringContaining('A₁B₁C₁D₁.'),
    });
    expect(said(start('cube', {}, 'ABCD', ['0', '0']))).toMatchObject({ problem: 'ratio' });
    expect(said(start('cube', {}, 'ABCD', ['абв', '1']))).toMatchObject({ problem: 'ratio', position: 'first' });
    expect(said(start('cube', {}, 'ABCD', ['1', '99']))).toMatchObject({
      problem: 'thin',
      message: expect.stringContaining('відстані від ABCD до A₁B₁C₁D₁'),
    });
    // A second plane where the first is.
    const first = start('cube', {}, 'ABCD');
    const twice = {
      ...first,
      choices: { ...first.choices, cubeSecondCut: true, cubeSecondMode: 'midpoint' as const },
    };
    expect(said(twice)).toMatchObject({ problem: 'boundary', position: 'second' });
    // Fixed, the section again.
    expect(
      resolve('cube', choose('cube', twice, { kind: 'placement', which: 'second', mode: 'ratio' })).spec?.section,
    ).toMatchObject({ positionPercent: 50, secondPositionPercent: 70 });
  });

  it('starts a second plane halfway to the farther end, at a tenth of the gap, in lowest terms and apart from the first', () => {
    const limits = { min: 10, max: 90 };
    expect(startingSecondRatio(50, limits)).toEqual(['7', '3']);
    expect(startingSecondRatio(100 / 3, limits)).toEqual(['3', '2']);
    expect(startingSecondRatio(80, limits)).toEqual(['1', '1']);
    // From 60 % towards the farther end, 10 %: 40 %, 2 : 3.
    expect(startingSecondRatio(60, limits)).toEqual(['2', '3']);
  });
});
