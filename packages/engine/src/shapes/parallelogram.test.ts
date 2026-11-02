import { describe, expect, it } from 'vitest';
import { cosSinDeg } from './angle.ts';
import { parallelogramArea, parallelogramVertices } from './parallelogram.ts';
import { signedPolygonArea, type Vec2 } from './polygon.ts';

const distance = (p: Vec2, q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** The interior angle at `vertex` between the rays to `from` and `to`, in degrees. */
function angleDeg(from: Vec2, vertex: Vec2, to: Vec2): number {
  const [ux, uy] = [from[0] - vertex[0], from[1] - vertex[1]];
  const [vx, vy] = [to[0] - vertex[0], to[1] - vertex[1]];
  return (Math.acos((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))) * 180) / Math.PI;
}

const ANGLES = [15, 30, 45, 60, 62, 72.5, 90, 108, 120, 150, 165];

describe('cosSinDeg', () => {
  it('matches cos and sin and gives exactly (0, 1) at 90°', () => {
    expect(cosSinDeg(90)).toEqual([0, 1]);
    for (const angle of ANGLES) {
      const [cos, sin] = cosSinDeg(angle);
      expect(cos).toBeCloseTo(Math.cos((angle * Math.PI) / 180), 15);
      expect(sin).toBeCloseTo(Math.sin((angle * Math.PI) / 180), 15);
    }
  });

  it('gives exactly opposite cosines and equal sines for α and 180° − α', () => {
    for (let angle = 15; angle <= 165; angle += 0.25) {
      const [cos, sin] = cosSinDeg(angle);
      const [mirroredCos, mirroredSin] = cosSinDeg(180 - angle);
      expect(mirroredCos + cos).toBe(0);
      expect(mirroredSin).toBe(sin);
    }
  });
});

describe('parallelogramVertices', () => {
  const cases = [0.25, 1, 2.05, 4].flatMap((b) => ANGLES.map((angle) => [b, angle] as const));

  it.each(cases)('builds A, B, C, D with AB = 1, AD = %s and ∠DAB = %s°, centred and counter-clockwise', (b, angle) => {
    const vertices = parallelogramVertices(1, b, angle);
    const [A, B, C, D] = vertices;
    expect(distance(A, B)).toBeCloseTo(1, 14);
    expect(distance(B, C)).toBeCloseTo(b, 14);
    expect(distance(C, D)).toBeCloseTo(1, 14);
    expect(distance(D, A)).toBeCloseTo(b, 14);
    expect(angleDeg(D, A, B)).toBeCloseTo(angle, 10);
    expect(angleDeg(A, B, C)).toBeCloseTo(180 - angle, 10);
    // AB is parallel to X, below the centre.
    expect(A[1]).toBe(B[1]);
    expect(B[0]).toBeGreaterThan(A[0]);
    // Centred: opposite vertices are symmetric about the origin.
    expect(C).toEqual([-A[0], -A[1]]);
    expect(D).toEqual([-B[0], -B[1]]);
    // Counter-clockwise seen from +Z with the area a·b·sin α.
    const area = b * Math.sin((angle * Math.PI) / 180);
    expect(signedPolygonArea(vertices)).toBeGreaterThan(0);
    expect(signedPolygonArea(vertices)).toBeCloseTo(area, 13);
    expect(parallelogramArea(1, b, angle)).toBeCloseTo(area, 14);
  });

  it('builds an exact axis-aligned rectangle at α = 90°', () => {
    expect(parallelogramVertices(2, 3, 90)).toEqual([
      [-1, -1.5],
      [1, -1.5],
      [1, 1.5],
      [-1, 1.5],
    ]);
    expect(parallelogramArea(2, 3, 90)).toBe(6);
  });

  it.each([15, 60, 90, 120, 165])('builds a rhombus with perpendicular diagonals for b = a and α = %s°', (angle) => {
    const [A, B, C, D] = parallelogramVertices(2.5, 2.5, angle);
    for (const [p, q] of [
      [A, B],
      [B, C],
      [C, D],
      [D, A],
    ] as const) {
      expect(distance(p, q)).toBeCloseTo(2.5, 14);
    }
    const ac = [C[0] - A[0], C[1] - A[1]];
    const bd = [D[0] - B[0], D[1] - B[1]];
    expect((ac[0] as number) * (bd[0] as number) + (ac[1] as number) * (bd[1] as number)).toBeCloseTo(0, 13);
  });

  it.each([
    [60, 120],
    [15, 165],
    [62, 118],
  ])('mirrors the base for α = %s° and α = %s° about the Y axis, with equal areas', (angle, supplement) => {
    const mirrored = (vertices: readonly Vec2[]) => vertices.map(([x, y]) => `${-x + 0},${y}`).sort();
    const plain = (vertices: readonly Vec2[]) => vertices.map(([x, y]) => `${x},${y}`).sort();
    expect(mirrored(parallelogramVertices(1, 1.5, angle))).toEqual(plain(parallelogramVertices(1, 1.5, supplement)));
    expect(parallelogramArea(1, 1.5, angle)).toBe(parallelogramArea(1, 1.5, supplement));
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
    expect(() => parallelogramVertices(a, b, angle)).toThrow(RangeError);
    expect(() => parallelogramArea(a, b, angle)).toThrow(RangeError);
  });
});
