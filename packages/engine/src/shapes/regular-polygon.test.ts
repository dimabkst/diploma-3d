import { describe, expect, it } from 'vitest';
import { signedPolygonArea, type Vec2 } from './polygon.ts';
import { regularPolygonArea, regularPolygonVertices } from './regular-polygon.ts';

const SIDE_COUNTS = [3, 4, 5, 6, 7, 8, 12];

describe('regularPolygonVertices', () => {
  it.each(SIDE_COUNTS)('builds %s equal edges, counter-clockwise around the origin', (sides) => {
    const edge = 2.5;
    const vertices = regularPolygonVertices(sides, edge);
    expect(vertices).toHaveLength(sides);
    vertices.forEach(([x, y], index) => {
      const [nextX, nextY] = vertices[(index + 1) % sides] as Vec2;
      expect(Math.hypot(nextX - x, nextY - y)).toBeCloseTo(edge, 12);
    });
    expect(signedPolygonArea(vertices)).toBeGreaterThan(0);
    const centroid = vertices.reduce(([sx, sy], [x, y]) => [sx + x / sides, sy + y / sides], [0, 0]);
    expect(centroid[0]).toBeCloseTo(0, 12);
    expect(centroid[1]).toBeCloseTo(0, 12);
  });

  it.each(SIDE_COUNTS)('puts the first edge of the %s-gon parallel to X below the centre, symmetric about Y', (sides) => {
    const vertices = regularPolygonVertices(sides);
    const [first, second] = vertices as [Vec2, Vec2];
    expect(first[1]).toBeCloseTo(second[1], 12);
    expect(first[1]).toBeLessThan(0);
    expect(first[0]).toBeCloseTo(-0.5, 12);
    expect(second[0]).toBeCloseTo(0.5, 12);
    expect(Math.min(...vertices.map(([, y]) => y))).toBeCloseTo(first[1], 12);
    for (const [x, y] of vertices) {
      expect(vertices.some(([mx, my]) => Math.abs(mx + x) < 1e-12 && Math.abs(my - y) < 1e-12)).toBe(true);
    }
  });

  it('builds the reference shapes: equilateral triangle, axis-aligned square and the hexagon of circumradius a', () => {
    const close = (vertices: readonly Vec2[], expected: readonly Vec2[]) => {
      expect(vertices).toHaveLength(expected.length);
      vertices.forEach((vertex, index) => {
        expect(vertex[0]).toBeCloseTo((expected[index] as Vec2)[0], 12);
        expect(vertex[1]).toBeCloseTo((expected[index] as Vec2)[1], 12);
      });
    };
    const h = Math.sqrt(3) / 2;
    close(regularPolygonVertices(3), [
      [-0.5, -h / 3],
      [0.5, -h / 3],
      [0, (2 * h) / 3],
    ]);
    close(regularPolygonVertices(4), [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ]);
    close(regularPolygonVertices(6), [
      [-0.5, -h],
      [0.5, -h],
      [1, 0],
      [0.5, h],
      [-0.5, h],
      [-1, 0],
    ]);
  });

  it('builds the octagon with flat edges on all four sides, (1 + √2)·a wide and deep', () => {
    const vertices = regularPolygonVertices(8, 2);
    const extent = 2 * (1 + Math.SQRT2);
    for (const axis of [0, 1] as const) {
      const coordinates = vertices.map((vertex) => vertex[axis]);
      expect(Math.max(...coordinates) - Math.min(...coordinates)).toBeCloseTo(extent, 12);
      // Two vertices on each extreme line form an edge parallel to the other axis.
      expect(coordinates.filter((value) => Math.abs(value - Math.max(...coordinates)) < 1e-12)).toHaveLength(2);
      expect(coordinates.filter((value) => Math.abs(value - Math.min(...coordinates)) < 1e-12)).toHaveLength(2);
    }
  });

  it.each([2, 1, 0, -3, 3.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s sides', (sides) => {
    expect(() => regularPolygonVertices(sides)).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the edge %s', (edge) => {
    expect(() => regularPolygonVertices(4, edge)).toThrow(RangeError);
  });
});

describe('regularPolygonArea', () => {
  it.each([
    [3, (Math.sqrt(3) / 4) * 9],
    [4, 9],
    [6, ((3 * Math.sqrt(3)) / 2) * 9],
  ])('gives the textbook area for %s sides with a = 3', (sides, area) => {
    expect(regularPolygonArea(sides, 3)).toBeCloseTo(area, 12);
  });

  it.each(SIDE_COUNTS)('matches the shoelace area of the constructed %s-gon', (sides) => {
    expect(regularPolygonArea(sides, 1.75)).toBeCloseTo(signedPolygonArea(regularPolygonVertices(sides, 1.75)), 12);
  });
});
