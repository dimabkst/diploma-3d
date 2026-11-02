import { describe, expect, it } from 'vitest';
import { signedPolygonArea, type Vec2 } from './polygon.ts';
import { regularPolygonVertices } from './regular-polygon.ts';
import { triangleArea, triangleThirdSide, triangleVertices } from './triangle.ts';

const distance = (p: Vec2, q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** The interior angle at `vertex` between the rays to `from` and `to`, in degrees. */
function angleDeg(from: Vec2, vertex: Vec2, to: Vec2): number {
  const [ux, uy] = [from[0] - vertex[0], from[1] - vertex[1]];
  const [vx, vy] = [to[0] - vertex[0], to[1] - vertex[1]];
  return (Math.acos((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))) * 180) / Math.PI;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

describe('triangleVertices', () => {
  const cases = [0.25, 0.75, 1, 2.05, 4].flatMap((b) => [15, 30, 60, 62, 90, 120, 165].map((angle) => [b, angle] as const));

  it.each(cases)('builds a = 1, b = %s with α = %s° between them, centred on the centroid and counter-clockwise', (b, angle) => {
    const vertices = triangleVertices(1, b, angle);
    const [p0, p1, p2] = vertices;
    expect(vertices).toHaveLength(3);
    expect(distance(p0, p1)).toBeCloseTo(1, 14);
    expect(distance(p0, p2)).toBeCloseTo(b, 14);
    expect(angleDeg(p1, p0, p2)).toBeCloseTo(angle, 10);
    // The reference edge P0P1 runs along +X.
    expect(p0[1]).toBe(p1[1]);
    expect(p1[0]).toBeGreaterThan(p0[0]);
    // The centroid is the origin.
    expect((p0[0] + p1[0] + p2[0]) / 3).toBeCloseTo(0, 15);
    expect((p0[1] + p1[1] + p2[1]) / 3).toBeCloseTo(0, 15);
    // Counter-clockwise seen from +Z with the area a·b·sin α / 2.
    const area = (b * Math.sin(radians(angle))) / 2;
    expect(signedPolygonArea(vertices)).toBeGreaterThan(0);
    expect(signedPolygonArea(vertices)).toBeCloseTo(area, 13);
    expect(triangleArea(1, b, angle)).toBeCloseTo(area, 14);
  });

  it.each(cases)(
    'derives the third side for b = %s and α = %s° by the cosine rule, within the strict triangle inequalities',
    (b, angle) => {
      const [, p1, p2] = triangleVertices(1, b, angle);
      const c = triangleThirdSide(1, b, angle);
      expect(c).toBeCloseTo(distance(p1, p2), 14);
      expect(c ** 2).toBeCloseTo(1 + b ** 2 - 2 * b * Math.cos(radians(angle)), 12);
      expect(c).toBeLessThan(1 + b);
      expect(1).toBeLessThan(b + c);
      expect(b).toBeLessThan(1 + c);
      expect(c).toBeGreaterThan(Math.abs(1 - b));
    },
  );

  it.each([
    // [b, α, c, type]: c² < a² + b² for an acute α, = for a right one, > for an obtuse one.
    [1, 60, 1, 'acute'],
    [0.75, 90, 1.25, 'right'],
    [1, 120, Math.sqrt(3), 'obtuse'],
    [2, 60, Math.sqrt(3), 'acute'],
  ] as const)('gives b = %s, α = %s° the third side %s (%s at P0)', (b, angle, c, type) => {
    expect(triangleThirdSide(1, b, angle)).toBeCloseTo(c, 14);
    const difference = c ** 2 - (1 + b ** 2);
    expect(type === 'acute' ? difference < 0 : type === 'right' ? Math.abs(difference) < 1e-12 : difference > 0).toBe(true);
  });

  it('builds the 3-4-5 right triangle exactly at α = 90°', () => {
    const expected = [
      [-4 / 3, -1],
      [8 / 3, -1],
      [-4 / 3, 2],
    ];
    triangleVertices(4, 3, 90).forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expected[index]?.[0] as number, 15);
      expect(y).toBeCloseTo(expected[index]?.[1] as number, 15);
    });
    expect(triangleThirdSide(4, 3, 90)).toBe(5);
    expect(triangleArea(4, 3, 90)).toBe(6);
  });

  it('gives the regular triangle of the regular polygon generator for b = a and α = 60°', () => {
    const configurable = triangleVertices(1, 1, 60);
    regularPolygonVertices(3).forEach(([x, y], index) => {
      expect(configurable[index]?.[0]).toBeCloseTo(x, 15);
      expect(configurable[index]?.[1]).toBeCloseTo(y, 15);
    });
  });

  it.each([
    ['a zero side a', 0, 1, 60],
    ['a negative side b', 1, -1, 60],
    ['a NaN side', Number.NaN, 1, 60],
    ['an infinite side', 1, Number.POSITIVE_INFINITY, 60],
    ['a zero angle', 1, 1, 0],
    ['a flat angle', 1, 1, 180],
    ['a NaN angle', 1, 1, Number.NaN],
  ])('rejects %s', (_, a, b, angle) => {
    expect(() => triangleVertices(a, b, angle)).toThrow(RangeError);
    expect(() => triangleThirdSide(a, b, angle)).toThrow(RangeError);
    expect(() => triangleArea(a, b, angle)).toThrow(RangeError);
  });
});
