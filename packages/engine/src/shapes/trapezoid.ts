import { polygonAreaCentroid, type Vec2 } from './polygon.ts';

function assertTrapezoid(a: number, b: number, t: number, delta: number): void {
  for (const [name, value] of [
    ['side a', a],
    ['side b', b],
    ['height t', t],
  ] as const) {
    if (!(value > 0) || !Number.isFinite(value)) throw new RangeError(`Invalid trapezoid ${name}: ${value}.`);
  }
  if (!Number.isFinite(delta)) throw new RangeError(`Invalid trapezoid shift: ${delta}.`);
}

/**
 * Vertices of the trapezoid with the parallel sides a = P0P1 along X and b = P2P3 at the distance t, the midpoint of b
 * shifted by δ along X from that of a: P0 = (−a/2, 0), P1 = (a/2, 0), P2 = (δ + b/2, t), P3 = (δ − b/2, t). For
 * positive a, b and t it is convex and counter-clockwise seen from +Z for every δ, also when the projections of a and b
 * onto X do not overlap. It is moved so that its area centroid, not the average of its vertices, is at the origin.
 */
export function trapezoidVertices(a: number, b: number, t: number, delta: number): [Vec2, Vec2, Vec2, Vec2] {
  assertTrapezoid(a, b, t, delta);
  const points: [Vec2, Vec2, Vec2, Vec2] = [
    [-a / 2, 0],
    [a / 2, 0],
    [delta + b / 2, t],
    [delta - b / 2, t],
  ];
  const [gx, gy] = polygonAreaCentroid(points);
  return points.map(([x, y]): Vec2 => [x - gx, y - gy]) as [Vec2, Vec2, Vec2, Vec2];
}

/** The lateral sides of the base: c = |P1P2| = √(t² + (δ + (b − a)/2)²) and d = |P3P0| = √(t² + (δ + (a − b)/2)²). */
export function trapezoidLegs(a: number, b: number, t: number, delta: number): { readonly c: number; readonly d: number } {
  assertTrapezoid(a, b, t, delta);
  return { c: Math.hypot(t, delta + (b - a) / 2), d: Math.hypot(t, delta + (a - b) / 2) };
}

/** Area (a + b)·t / 2. */
export function trapezoidArea(a: number, b: number, t: number, delta: number): number {
  assertTrapezoid(a, b, t, delta);
  return ((a + b) * t) / 2;
}

export type TrapezoidKind = 'rectangle' | 'parallelogram' | 'isosceles' | 'right' | 'general';

/**
 * The special case the trapezoid's parameters describe: b = a gives a parallelogram (a rectangle when δ = 0), δ = 0 an
 * isosceles trapezoid, and side b flush with one end of a a right trapezoid. Values within 1e-9·a count as equal, so
 * that rounded decimal input such as b/a = 1,1 with δ/a = 0,05 is recognised.
 */
export function trapezoidKind(parallelSideRatio: number, baseShiftRatio: number): TrapezoidKind {
  const equal = (x: number, y: number) => Math.abs(x - y) <= 1e-9;
  if (equal(parallelSideRatio, 1)) return equal(baseShiftRatio, 0) ? 'rectangle' : 'parallelogram';
  if (equal(baseShiftRatio, 0)) return 'isosceles';
  return equal(Math.abs(baseShiftRatio), Math.abs(parallelSideRatio - 1) / 2) ? 'right' : 'general';
}
