import { boxVertices } from '@diploma-3d/engine';
import type { BoxVertex, ShapeKind } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import {
  initialParameterChoices,
  initialParameterTexts,
  type ParameterChoices,
  type ParameterTexts,
  resolveModelRequest,
} from './model/parameters.ts';
import { type NumericField, sectionNumberFields, shapePanel } from './shapes.ts';

type Point = readonly [number, number, number];

/**
 * The shape's fields by their labels with their values, and the named vertices of the very solid the request builds, so that
 * a label naming AC or ∠BAC can be checked against the geometry it stands for.
 */
function labelledSolid(kind: ShapeKind, texts: Partial<ParameterTexts> = {}, choices: Partial<ParameterChoices> = {}) {
  const chosen = { ...initialParameterChoices(), ...choices } as ParameterChoices;
  const request = resolveModelRequest(kind, { ...initialParameterTexts(), ...texts }, chosen);
  const spec = request.spec;
  if (spec === undefined) throw new Error(`No model: ${JSON.stringify(request.errors)}`);
  const panel = shapePanel(kind, chosen, { values: request.values });
  if (panel.type !== 'parameters') throw new Error('No parameters');
  const fields = panel.sections.flatMap(sectionNumberFields);
  const field = (label: string): NumericField => {
    const found = fields.find((candidate) => candidate.label === label);
    if (found === undefined) throw new Error(`No field "${label}" among ${fields.map((each) => each.label).join(', ')}`);
    return found;
  };
  const value = (label: string) => request.values[field(label).key] as number;
  const vertices = boxVertices(spec.shape as never, spec.scale) as Record<BoxVertex, Point>;
  const at = (name: BoxVertex) => vertices[name];
  return { fields, field, value, at, help: panel.help };
}

const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: Point) => Math.hypot(...a);
const distance = (a: Point, b: Point) => length(minus(a, b));
const angleDeg = (vertex: Point, a: Point, b: Point) => {
  const [u, v] = [minus(a, vertex), minus(b, vertex)];
  return (Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (length(u) * length(v))) * 180) / Math.PI;
};

describe('labels name the solid’s own vertices', () => {
  it('a triangular base: AC relative to AB and the angle BAC, for a prism and a pyramid', () => {
    for (const [kind, prefix] of [
      ['prism', 'prism'],
      ['pyramid', 'pyramid'],
    ] as const) {
      const solid = labelledSolid(
        kind,
        { [`${prefix}TriangleSideRatio`]: '1,5', [`${prefix}TriangleAngleDeg`]: '70' },
        { [`${prefix}BaseType`]: 'triangle' },
      );
      const { at, value, field } = solid;
      expect(field('Сторона AC').suffix).toBe('× AB');
      expect(distance(at('A'), at('C')) / distance(at('A'), at('B'))).toBeCloseTo(value('Сторона AC'), 9);
      expect(angleDeg(at('A'), at('B'), at('C'))).toBeCloseTo(value('Кут BAC'), 9);
    }
  });

  it('a parallelogram: AD relative to AB and the angle BAD, for a parallelepiped and a pyramid', () => {
    const parallelepiped = labelledSolid('parallelepiped', {
      parallelepipedBaseSideRatio: '0,75',
      parallelepipedBaseAngleDeg: '50',
    });
    const pyramid = labelledSolid(
      'pyramid',
      { pyramidParallelogramSideRatio: '0,75', pyramidParallelogramAngleDeg: '50' },
      { pyramidBaseType: 'parallelogram' },
    );
    for (const { at, value } of [parallelepiped, pyramid]) {
      expect(distance(at('A'), at('D')) / distance(at('A'), at('B'))).toBeCloseTo(value('Сторона AD'), 9);
      expect(angleDeg(at('A'), at('B'), at('D'))).toBeCloseTo(value('Кут BAD'), 9);
      expect(distance(at('C'), at('D'))).toBeCloseTo(distance(at('A'), at('B')), 9);
    }
  });

  it('a trapezoid: CD parallel to AB, the distance between them and the shift of CD’s midpoint along AB', () => {
    const { at, value, field } = labelledSolid(
      'prism',
      { prismTrapezoidSideRatio: '0,5', prismTrapezoidHeightRatio: '0,75', prismTrapezoidShiftRatio: '0,25' },
      { prismBaseType: 'trapezoid' },
    );
    const ab = distance(at('A'), at('B'));
    const along = minus(at('B'), at('A')).map((component) => component / ab) as unknown as Point;
    const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // C to D runs back along AB: CD ∥ AB.
    expect(dot(minus(at('D'), at('C')), along)).toBeCloseTo(-distance(at('C'), at('D')), 9);
    expect(distance(at('C'), at('D')) / ab).toBeCloseTo(value('Сторона CD'), 9);
    // The distance from D to the line AB, in the base plane.
    const fromA = minus(at('D'), at('A'));
    expect(length(minus(fromA, along.map((c) => c * dot(fromA, along)) as unknown as Point)) / ab).toBeCloseTo(
      value('Відстань між AB і CD'),
      9,
    );
    const midpoint = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    expect(dot(minus(midpoint(at('C'), at('D')), midpoint(at('A'), at('B'))), along) / ab).toBeCloseTo(
      value('Зміщення сторони CD'),
      9,
    );
    expect(field('Зміщення сторони CD').suffix).toBe('× AB');
  });

  it('a cuboid: AD and the height AA₁ relative to AB', () => {
    const { at, value } = labelledSolid('cuboid', { cuboidWidthRatio: '1,25', cuboidHeightRatio: '0,5' });
    const ab = distance(at('A'), at('B'));
    expect(distance(at('A'), at('D')) / ab).toBeCloseTo(value('Ширина AD'), 9);
    expect(distance(at('A'), at('A1')) / ab).toBeCloseTo(value('Висота AA₁'), 9);
    expect(at('A1')[2] - at('A')[2]).toBeCloseTo(distance(at('A'), at('A1')), 9);
  });

  it('the height of a prism is AA₁ only while it is right; leaning, AA₁ is a longer lateral edge', () => {
    for (const [kind, prefix] of [
      ['prism', 'prism'],
      ['parallelepiped', 'parallelepiped'],
    ] as const) {
      const right = labelledSolid(kind, { [`${prefix}HeightRatio`]: '1,5' });
      const ab = distance(right.at('A'), right.at('B'));
      expect(right.fields.map(({ label }) => label)).toContain('Висота AA₁');
      expect(distance(right.at('A'), right.at('A1')) / ab).toBeCloseTo(right.value('Висота AA₁'), 9);

      const leaning = labelledSolid(kind, { [`${prefix}HeightRatio`]: '1,5', [`${prefix}OffsetXRatio`]: '0,5' });
      const labels = leaning.fields.map(({ label }) => label);
      expect(labels).toContain('Висота');
      expect(labels).not.toContain('Висота AA₁');
      const height = leaning.at('A1')[2] - leaning.at('A')[2];
      expect(height / distance(leaning.at('A'), leaning.at('B'))).toBeCloseTo(leaning.value('Висота'), 9);
      expect(distance(leaning.at('A'), leaning.at('A1'))).toBeGreaterThan(height);
    }
  });

  it('a pyramid’s height is never a lateral edge such as SA', () => {
    const { at, value, fields } = labelledSolid('pyramid', { pyramidHeightRatio: '1,5', pyramidApexXRatio: '0,25' });
    const labels = fields.map(({ label }) => label);
    expect(labels).toContain('Висота');
    expect(labels.some((label) => /S[A-H]/.test(label))).toBe(false);
    const height = at('S')[2] - at('A')[2];
    expect(height / distance(at('A'), at('B'))).toBeCloseTo(value('Висота'), 9);
    expect(distance(at('S'), at('A'))).toBeGreaterThan(height);
  });

  it('the multipliers are relative to AB, as their help says; round solids keep r', () => {
    for (const kind of ['cuboid', 'parallelepiped', 'prism', 'pyramid'] as const) {
      const { fields, help } = labelledSolid(kind);
      expect(help?.label).toBe('Що означає × AB?');
      for (const { suffix } of fields) expect(suffix).not.toBe('× a');
    }
    const cylinder = shapePanel('cylinder', initialParameterChoices());
    expect(cylinder.type === 'parameters' && cylinder.help?.label).toBe('Що означає × r?');
  });
});
