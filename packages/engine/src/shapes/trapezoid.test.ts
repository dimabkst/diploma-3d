import { describe, expect, it } from 'vitest';
import { polygonAreaCentroid, signedPolygonArea, type Vec2 } from './polygon.ts';
import { trapezoidArea, trapezoidKind, trapezoidLegs, trapezoidVertices } from './trapezoid.ts';

const distance = (p: Vec2, q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]);
const cross = (o: Vec2, p: Vec2, q: Vec2) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);

/**
 * The area centroid of the trapezoid before centring, in closed form: it lies at the fraction k = (a + 2b) / (3(a + b))
 * of the way from side a to side b, both along the height and along the line joining the midpoints of the parallel
 * sides.
 */
const closedFormCentroid = (a: number, b: number, t: number, delta: number): Vec2 => {
  const k = (a + 2 * b) / (3 * (a + b));
  return [k * delta, k * t];
};

describe('polygonAreaCentroid', () => {
  it('gives the centre of a rectangle and of a triangle the average of the vertices', () => {
    expect(
      polygonAreaCentroid([
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ]),
    ).toEqual([2, 1]);
    const [x, y] = polygonAreaCentroid([
      [0, 0],
      [3, 0],
      [0, 6],
    ]);
    expect(x).toBeCloseTo(1, 15);
    expect(y).toBeCloseTo(2, 15);
  });

  it('differs from the average of the vertices for a trapezoid', () => {
    const trapezoid: Vec2[] = [
      [-0.5, 0],
      [0.5, 0],
      [0.25, 1],
      [-0.25, 1],
    ];
    expect(polygonAreaCentroid(trapezoid)[1]).toBeCloseTo((1 + 2 * 0.5) / (3 * 1.5), 15);
    expect(polygonAreaCentroid(trapezoid)[1]).not.toBeCloseTo(0.5, 3);
  });

  it('rejects a polygon without area', () => {
    expect(() =>
      polygonAreaCentroid([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toThrow(RangeError);
  });
});

describe('trapezoidVertices', () => {
  const cases = [0.25, 0.5, 1, 2.05, 4].flatMap((b) =>
    [0.25, 0.375, 4].flatMap((t) => [-2, -0.25, 0, 0.1, (b - 1) / 2, (1 - b) / 2, 2].map((delta) => [b, t, delta] as const)),
  );

  it.each(cases)(
    'builds b/a = %s at t = %s with the shift %s: sides, parallelism, convexity and the area centroid',
    (b, t, delta) => {
      const vertices = trapezoidVertices(1, b, t, delta);
      const [p0, p1, p2, p3] = vertices;
      expect(vertices).toHaveLength(4);
      const { c, d } = trapezoidLegs(1, b, t, delta);
      expect(distance(p0, p1)).toBeCloseTo(1, 14);
      expect(distance(p2, p3)).toBeCloseTo(b, 14);
      expect(distance(p1, p2)).toBeCloseTo(c, 14);
      expect(distance(p3, p0)).toBeCloseTo(d, 14);
      // a runs along +X and b along −X, both horizontal, at the distance t.
      expect(p0[1]).toBe(p1[1]);
      expect(p2[1]).toBe(p3[1]);
      expect(p1[0]).toBeGreaterThan(p0[0]);
      expect(p2[1] - p1[1]).toBeCloseTo(t, 14);
      // The midpoint of b is shifted by δ along X from that of a.
      expect((p2[0] + p3[0]) / 2 - (p0[0] + p1[0]) / 2).toBeCloseTo(delta, 14);
      // Convex and counter-clockwise: every turn is to the left.
      vertices.forEach((vertex, index) => {
        expect(cross(vertex, vertices[(index + 1) % 4] as Vec2, vertices[(index + 2) % 4] as Vec2)).toBeGreaterThan(0);
      });
      const area = ((1 + b) * t) / 2;
      expect(signedPolygonArea(vertices)).toBeCloseTo(area, 13);
      expect(trapezoidArea(1, b, t, delta)).toBeCloseTo(area, 15);
      // Centred on the area centroid, which the closed form places at k·(δ, t) from the midpoint of a.
      const [gx, gy] = polygonAreaCentroid(vertices);
      expect(gx).toBeCloseTo(0, 14);
      expect(gy).toBeCloseTo(0, 14);
      const [kx, ky] = closedFormCentroid(1, b, t, delta);
      expect((p0[0] + p1[0]) / 2).toBeCloseTo(-kx, 14);
      expect(p0[1]).toBeCloseTo(-ky, 14);
    },
  );

  it('builds the right trapezoid of the reference case: a = 4, b = 2, t = 1,5, δ = −1 gives c = 2,5 and d = 1,5', () => {
    expect(trapezoidLegs(4, 2, 1.5, -1)).toEqual({ c: 2.5, d: 1.5 });
    const [p0, , , p3] = trapezoidVertices(4, 2, 1.5, -1);
    // Left-aligned: side d is vertical.
    expect(p3[0]).toBeCloseTo(p0[0], 15);
    expect(trapezoidArea(4, 2, 1.5, -1)).toBe(4.5);
  });

  it.each([
    [0.5, 0.25],
    [2, 1.25],
    [1, 0.75],
  ])('swaps c and d and keeps the area when the shift of b/a = %s changes sign (%s)', (b, delta) => {
    const shifted = trapezoidLegs(1, b, 0.5, delta);
    const mirrored = trapezoidLegs(1, b, 0.5, -delta);
    expect(mirrored.c).toBeCloseTo(shifted.d, 15);
    expect(mirrored.d).toBeCloseTo(shifted.c, 15);
    expect(trapezoidArea(1, b, 0.5, -delta)).toBe(trapezoidArea(1, b, 0.5, delta));
    // The bases are mirror images about the Y axis.
    const reflected = trapezoidVertices(1, b, 0.5, delta).map(([x, y]) => [-x, y]);
    for (const [x, y] of trapezoidVertices(1, b, 0.5, -delta)) {
      expect(reflected.some(([rx, ry]) => Math.hypot((rx as number) - x, (ry as number) - y) < 1e-14)).toBe(true);
    }
  });

  it('builds a parallelogram for b = a, and a rectangle for b = a and δ = 0', () => {
    const [p0, p1, p2, p3] = trapezoidVertices(1, 1, 0.5, 0.3);
    expect(distance(p0, p3)).toBeCloseTo(distance(p1, p2), 15);
    expect(p2[0] - p1[0]).toBeCloseTo(p3[0] - p0[0], 15);
    const expected = [
      [-1, -0.5],
      [1, -0.5],
      [1, 0.5],
      [-1, 0.5],
    ];
    trapezoidVertices(2, 2, 1, 0).forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expected[index]?.[0] as number, 15);
      expect(y).toBeCloseTo(expected[index]?.[1] as number, 15);
    });
    expect(trapezoidLegs(2, 2, 1, 0)).toEqual({ c: 1, d: 1 });
  });

  it('stays convex when the projections of a and b onto X do not overlap', () => {
    // b/a = 0,25 shifted by 2a: side b spans x ∈ [1,875, 2,125], side a x ∈ [−0,5, 0,5].
    const vertices = trapezoidVertices(1, 0.25, 0.5, 2);
    const [p0, p1, p2, p3] = vertices;
    expect(Math.min(p2[0], p3[0])).toBeGreaterThan(Math.max(p0[0], p1[0]));
    vertices.forEach((vertex, index) => {
      expect(cross(vertex, vertices[(index + 1) % 4] as Vec2, vertices[(index + 2) % 4] as Vec2)).toBeGreaterThan(0);
    });
    expect(signedPolygonArea(vertices)).toBeCloseTo(0.3125, 14);
  });

  it.each([
    ['a zero side a', 0, 1, 1, 0],
    ['a negative side b', 1, -1, 1, 0],
    ['a zero height', 1, 1, 0, 0],
    ['a NaN side', Number.NaN, 1, 1, 0],
    ['an infinite height', 1, 1, Number.POSITIVE_INFINITY, 0],
    ['a NaN shift', 1, 1, 1, Number.NaN],
    ['an infinite shift', 1, 1, 1, Number.NEGATIVE_INFINITY],
  ])('rejects %s', (_, a, b, t, delta) => {
    expect(() => trapezoidVertices(a, b, t, delta)).toThrow(RangeError);
    expect(() => trapezoidLegs(a, b, t, delta)).toThrow(RangeError);
    expect(() => trapezoidArea(a, b, t, delta)).toThrow(RangeError);
  });
});

describe('trapezoidKind', () => {
  it.each([
    [1, 0, 'rectangle'],
    [1, 0.5, 'parallelogram'],
    [1, -2, 'parallelogram'],
    [0.5, 0, 'isosceles'],
    [2, 0, 'isosceles'],
    [0.5, -0.25, 'right'],
    [0.5, 0.25, 'right'],
    [2, 0.5, 'right'],
    [2, -0.5, 'right'],
    // Decimal input whose difference is not exact in binary: (1,1 − 1)/2 = 0,05.
    [1.1, 0.05, 'right'],
    [0.5, 0.1, 'general'],
    [0.25, 2, 'general'],
  ] as const)('classifies b/a = %s with the shift %s as %s', (b, delta, kind) => {
    expect(trapezoidKind(b, delta)).toBe(kind);
  });
});
