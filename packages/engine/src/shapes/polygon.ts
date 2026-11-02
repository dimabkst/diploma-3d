export type Vec2 = readonly [number, number];

/** Width (X) and depth (Y) of the polygon's axis-aligned bounding box. */
export function polygonSize(polygon: readonly Vec2[]): Vec2 {
  const extent = (axis: 0 | 1) =>
    Math.max(...polygon.map((vertex) => vertex[axis])) - Math.min(...polygon.map((vertex) => vertex[axis]));
  return [extent(0), extent(1)];
}

/** Shoelace formula: positive for a counter-clockwise polygon seen from +Z. */
export const signedPolygonArea = (polygon: readonly Vec2[]): number =>
  polygon.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = polygon[(index + 1) % polygon.length] as Vec2;
    return sum + (x * nextY - nextX * y) / 2;
  }, 0);

/**
 * The area centroid of a simple polygon: C = Σ (pᵢ + pᵢ₊₁)·(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ) / (6A), with A its signed area. Unlike the
 * average of the vertices, it is the balance point of the region, e.g. for a trapezoid.
 */
export function polygonAreaCentroid(polygon: readonly Vec2[]): Vec2 {
  const area = signedPolygonArea(polygon);
  if (!(Math.abs(area) > 0) || !Number.isFinite(area)) throw new RangeError('A polygon centroid needs a non-zero area.');
  let [cx, cy] = [0, 0];
  polygon.forEach(([x, y], index) => {
    const [nextX, nextY] = polygon[(index + 1) % polygon.length] as Vec2;
    const cross = x * nextY - nextX * y;
    cx += (x + nextX) * cross;
    cy += (y + nextY) * cross;
  });
  return [cx / (6 * area), cy / (6 * area)];
}

/** A base polygon as the contour list that manifold-3d's extrusion expects. */
export const baseContours = (base: readonly Vec2[]): [number, number][][] => [base.map(([x, y]): [number, number] => [x, y])];
