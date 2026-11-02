import type { Vec2 } from './polygon.ts';

function assertPolygon(sides: number, edge: number): void {
  if (!Number.isInteger(sides) || sides < 3) throw new RangeError(`A regular polygon needs at least 3 sides, not ${sides}.`);
  if (!(edge > 0) || !Number.isFinite(edge)) throw new RangeError(`Invalid regular polygon edge: ${edge}.`);
}

/**
 * Vertices of a regular polygon with `sides` edges of length `edge`, centred at the origin and counter-clockwise seen
 * from +Z. With circumradius R = edge / (2 sin(π/n)), vertex i lies at the angle −π/2 − π/n + 2πi/n, so the first edge
 * runs parallel to X below the centre, the polygon is symmetric about the Y axis and the square is axis-aligned.
 */
export function regularPolygonVertices(sides: number, edge = 1): Vec2[] {
  assertPolygon(sides, edge);
  const radius = edge / (2 * Math.sin(Math.PI / sides));
  return Array.from({ length: sides }, (_, index): Vec2 => {
    const angle = -Math.PI / 2 - Math.PI / sides + (2 * Math.PI * index) / sides;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

/** Area of a regular polygon: n·a² / (4·tan(π/n)). */
export function regularPolygonArea(sides: number, edge: number): number {
  assertPolygon(sides, edge);
  return (sides * edge ** 2) / (4 * Math.tan(Math.PI / sides));
}
