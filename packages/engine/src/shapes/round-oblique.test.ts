import type { ModelSpecInput } from '@diploma-3d/schema';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  findMeshDefects,
  length,
  measureMesh,
  meshFromManifold,
  type TriangleMesh,
  triangleAreaVector,
  triangleCount,
  type Vec3,
  vertexAt,
} from '../mesh.ts';
import { generateModel } from '../model.ts';
import { withScope } from '../scope.ts';
import {
  buildRound,
  circularSegments,
  MAX_CIRCLE_DEVIATION_MM,
  type RoundShape,
  roundBoundingSize,
  roundDimensionsMm,
  roundSolidMeasurements,
} from './round.ts';

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Kind = RoundShape['kind'];
const KINDS: readonly Kind[] = ['cylinder', 'cone'];
const L80 = { longestDimensionMm: 80 };
const shapeOf = (kind: Kind, heightRatio: number, offsetRatio: number): RoundShape => ({ kind, heightRatio, offsetRatio });

const onlySolid = (spec: ModelSpecInput) => {
  const [solid] = generateModel(kernel, spec).solids;
  if (solid === undefined) throw new Error('No solid');
  return solid;
};

const RELATIVE_TOLERANCE = 1e-6;
const expectRelativelyClose = (actual: number | undefined, expected: number, tolerance = RELATIVE_TOLERANCE) => {
  expect(Math.abs((actual ?? Number.NaN) / expected - 1)).toBeLessThan(tolerance);
};
const ABSOLUTE_TOLERANCE_MM = 1e-4;
// The final area's error target: 1e-4 mm² plus 1e-8 of the area.
const areaTolerance = (area: number) => 1e-4 + 1e-8 * area;

const verticesOf = (mesh: TriangleMesh): Vec3[] =>
  Array.from({ length: mesh.positions.length / 3 }, (_, vertex) => vertexAt(mesh, vertex));

/** Area of the inscribed regular N-gon of radius r: N·r²·sin(2π/N) / 2. */
const polygonArea = (segments: number, r: number) => (segments * r ** 2 * Math.sin((2 * Math.PI) / segments)) / 2;

/** The lateral areas by the trapezoid rule with many panels: spectrally accurate for these periodic integrands. */
function referenceLateralArea(kind: Kind, r: number, h: number, d: number): number {
  const n = 1 << 16;
  let sum = 0;
  for (let index = 0; index < n; index += 1) {
    const theta = (2 * Math.PI * index) / n;
    sum += kind === 'cylinder' ? r * Math.hypot(h, d * Math.cos(theta)) : (r / 2) * Math.hypot(h, r - d * Math.cos(theta));
  }
  return (sum * 2 * Math.PI) / n;
}

describe('the oblique references with r = h = d = 1, before normalisation', () => {
  it('gives the cylinder the lateral area ≈ 7,640395578055, the surface ≈ 13,923580885235 and a 3 × 2 × 1 box', () => {
    const shape = shapeOf('cylinder', 1, 1);
    expect(roundBoundingSize(shape)).toEqual([3, 2, 1]);
    // L = 3 keeps the scale 1.
    const m = roundSolidMeasurements(shape, { longestDimensionMm: 3 });
    expect(m).toMatchObject({ radius: 1, height: 1, offset: 1, lateralAreaIntegrated: true });
    expect(Math.abs(m.lateralArea - 7.640395578055)).toBeLessThan(areaTolerance(7.64));
    expect(Math.abs(m.surfaceArea - 13.923580885235)).toBeLessThan(areaTolerance(13.92));
    expect(m.volume).toBeCloseTo(Math.PI, 12);
    expect(m.generatrix.min).toBeCloseTo(Math.SQRT2, 15);
    expect(m.generatrix.max).toBe(m.generatrix.min);
  });

  it('gives the cone the lateral area ≈ 4,753793841546, the surface ≈ 7,895386495136 and a 2 × 2 × 1 box', () => {
    const shape = shapeOf('cone', 1, 1);
    expect(roundBoundingSize(shape)).toEqual([2, 2, 1]);
    const m = roundSolidMeasurements(shape, { longestDimensionMm: 2 });
    expect(m).toMatchObject({ radius: 1, height: 1, offset: 1, lateralAreaIntegrated: true });
    expect(Math.abs(m.lateralArea - 4.753793841546)).toBeLessThan(areaTolerance(4.75));
    expect(Math.abs(m.surfaceArea - 7.895386495136)).toBeLessThan(areaTolerance(7.9));
    expect(m.volume).toBeCloseTo(Math.PI / 3, 12);
    // The apex above the rim point (1, 0): the shortest generatrix is vertical, h = 1; the longest is √(1 + 4).
    expect(m.generatrix.min).toBeCloseTo(1, 15);
    expect(m.generatrix.max).toBeCloseTo(Math.sqrt(5), 15);
  });
});

describe('roundSolidMeasurements for oblique solids', () => {
  const cases = KINDS.flatMap((kind) => [0.25, 1, 4].flatMap((h0) => [0.25, 1.1, 2.5, 4].map((d0) => [kind, h0, d0] as const)));

  it.each(cases)('integrates the %s lateral area for h/r = %s and d/r = %s within its tolerance', (kind, h0, d0) => {
    const m = roundSolidMeasurements(shapeOf(kind, h0, d0), L80);
    const reference = referenceLateralArea(kind, m.radius, m.height, m.offset);
    expect(Math.abs(m.lateralArea - reference)).toBeLessThan(areaTolerance(reference));
    expect(m.surfaceArea).toBeCloseTo((kind === 'cylinder' ? 2 : 1) * m.baseArea + m.lateralArea, 9);
    // Independent of the shear: πr²h for the cylinder and πr²h/3 for the cone.
    expectRelativelyClose(m.volume, (Math.PI * m.radius ** 2 * m.height) / (kind === 'cylinder' ? 1 : 3));
    expect(m.diameter).toBe(2 * m.radius);
    expect(m.baseArea).toBeCloseTo(Math.PI * m.radius ** 2, 9);
    if (kind === 'cylinder') {
      expect(m.generatrix).toEqual({ min: Math.hypot(m.height, m.offset), max: Math.hypot(m.height, m.offset) });
    } else {
      expect(m.generatrix.min).toBeCloseTo(Math.hypot(m.height, m.radius - m.offset), 9);
      expect(m.generatrix.max).toBeCloseTo(Math.hypot(m.height, m.radius + m.offset), 9);
    }
  });

  it.each(KINDS)('approaches the closed form of the right %s as the displacement vanishes', (kind) => {
    for (const h0 of [0.25, 1, 4]) {
      const right = roundSolidMeasurements(shapeOf(kind, h0, 0), L80);
      expect(right.lateralAreaIntegrated).toBe(false);
      for (const d0 of [1e-3, 1e-6]) {
        const nearlyRight = roundSolidMeasurements(shapeOf(kind, h0, d0), L80);
        expect(nearlyRight.lateralAreaIntegrated).toBe(true);
        // The box widens by d0 and the scale shrinks slightly; the area follows continuously.
        expect(Math.abs(nearlyRight.surfaceArea / right.surfaceArea - 1)).toBeLessThan(2 * d0);
      }
    }
  });

  it('normalises the displaced solid by its whole bounding box', () => {
    // The cylinder with h/r = 1 and d/r = 4 is 6r wide: r = 80/6 mm. The cone's apex at 4r widens it to 5r: r = 16 mm.
    expect(roundDimensionsMm(shapeOf('cylinder', 1, 4), L80).radius).toBeCloseTo(80 / 6, 12);
    expect(roundDimensionsMm(shapeOf('cone', 1, 4), L80).radius).toBeCloseTo(16, 12);
    // An apex within the base's outline does not widen the cone: d/r = 1 keeps r = 40 mm.
    expect(roundDimensionsMm(shapeOf('cone', 1, 1), L80).radius).toBeCloseTo(40, 12);
    expect(roundDimensionsMm(shapeOf('cone', 4, 1), L80)).toEqual({ radius: 20, height: 80, offset: 20 });
  });
});

describe('generateModel for an oblique cylinder and cone', () => {
  const cases = KINDS.flatMap((kind) => [0.25, 1, 4].flatMap((h0) => [0.25, 1.1, 2.5, 4].map((d0) => [kind, h0, d0] as const)));

  it.each(cases)('builds the %s with h/r = %s and d/r = %s with its circles, bounds and volume', (kind, h0, d0) => {
    const shape = shapeOf(kind, h0, d0);
    const { mesh, measurements, smoothShading, smoothingShear } = onlySolid({ shape, scale: L80 });
    const { radius: r, height: h, offset: d } = roundDimensionsMm(shape, L80);
    const segments = circularSegments(r);
    expect(smoothShading).toBe(true);
    expect(smoothingShear?.[0]).toBeCloseTo(d0 / h0, 15);
    expect(smoothingShear?.[1]).toBe(0);

    // A closed, outward solid without degenerate triangles.
    expect(findMeshDefects(mesh)).toEqual([]);
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      expect(length(triangleAreaVector(mesh, triangle)) / 2).toBeGreaterThan(1e-4);
    }

    // The bounding box: the base circle and the displaced upper circle or apex; the longest side is 80 mm.
    const top = kind === 'cylinder' ? r : 0;
    const expected = {
      min: [Math.min(-r, d - top), -r, 0],
      max: [Math.max(r, d + top), r, h],
    };
    for (const axis of [0, 1, 2] as const) {
      expect(Math.abs(measurements.bounds.min[axis] - (expected.min[axis] as number))).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      expect(Math.abs(measurements.bounds.max[axis] - (expected.max[axis] as number))).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    }
    expect(measurements.bounds.min[2]).toBe(0);
    expectRelativelyClose(Math.max(...measurements.size), 80);

    // The base circle stays centred at the origin; the upper circle is centred at (d, 0, h), or the apex is there.
    const points = verticesOf(mesh);
    const bottom = points.filter((point) => point[2] === 0);
    expect(bottom).toHaveLength(segments);
    for (const point of bottom) expect(Math.abs(Math.hypot(point[0], point[1]) - r)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    const upper = points.filter((point) => point[2] > 0);
    if (kind === 'cylinder') {
      expect(upper).toHaveLength(segments);
      for (const point of upper) {
        expect(Math.abs(point[2] - h)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
        expect(Math.abs(Math.hypot(point[0] - d, point[1]) - r)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      }
    } else {
      expect(upper).toHaveLength(1);
      const [apex] = upper as [Vec3];
      expect(Math.hypot(apex[0] - d, apex[1], apex[2] - h)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      // The mesh's shortest and longest generatrices run to the base vertices at θ = 0 and θ = π.
      const generatrices = bottom.map((point) => Math.hypot(apex[0] - point[0], apex[1] - point[1], apex[2]));
      const ideal = roundSolidMeasurements(shape, L80).generatrix;
      expect(Math.abs(Math.min(...generatrices) - ideal.min)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
      expect(Math.abs(Math.max(...generatrices) - ideal.max)).toBeLessThan(ABSOLUTE_TOLERANCE_MM);
    }

    // The shear keeps every section: the mesh volume is that of the inscribed polygonal solid, below the ideal one.
    const base = polygonArea(segments, r);
    expectRelativelyClose(measurements.volume, kind === 'cylinder' ? base * h : (base * h) / 3);
    expect(measurements.volume).toBeLessThan(roundSolidMeasurements(shape, L80).volume);
    // The sections' polygons deviate from their circles by r·(1 − cos(π/N)) at the final physical radius.
    expect(r * (1 - Math.cos(Math.PI / segments))).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
  });

  it.each(KINDS)('reproduces the right %s exactly without a displacement', (kind) => {
    for (const h0 of [0.25, 2, 4]) {
      const omitted = onlySolid({ shape: { kind, heightRatio: h0 }, scale: L80 });
      const zero = onlySolid({ shape: shapeOf(kind, h0, 0), scale: L80 });
      expect(zero.mesh).toEqual(omitted.mesh);
      expect(zero.smoothingShear).toBeUndefined();
    }
  });

  it.each(KINDS)('refines an oblique %s at a larger export size to stay within 0,05 mm', (kind) => {
    const { mesh } = onlySolid({ shape: shapeOf(kind, 1, 0.5), scale: { longestDimensionMm: 1000 } });
    const { radius } = roundDimensionsMm(shapeOf(kind, 1, 0.5), { longestDimensionMm: 1000 });
    const segments = circularSegments(radius);
    expect(segments).toBeGreaterThan(64);
    expect(findMeshDefects(mesh)).toEqual([]);
    expect(verticesOf(mesh).filter((point) => point[2] === 0)).toHaveLength(segments);
    expect(radius * (1 - Math.cos(Math.PI / segments))).toBeLessThanOrEqual(MAX_CIRCLE_DEVIATION_MM);
  });

  it.each(KINDS)('brings the %s mesh area closer to the ideal area as the segments increase', (kind) => {
    const dimensions = { radius: 40, height: 20, offset: 60 };
    const ideal = roundSolidMeasurements(shapeOf(kind, 0.5, 1.5), { longestDimensionMm: kind === 'cylinder' ? 140 : 100 });
    expect(ideal).toMatchObject(dimensions);
    const errors = [64, 256, 1024].map((segments) => {
      const mesh = withScope((track) => meshFromManifold(buildRound(kernel, track, kind, dimensions, segments)));
      expect(findMeshDefects(mesh)).toEqual([]);
      return ideal.surfaceArea - measureMesh(mesh).surfaceArea;
    });
    // Inscribed polygons: the mesh area stays below the ideal one and the gap shrinks about 16-fold per 4× segments.
    for (const error of errors) expect(error).toBeGreaterThan(0);
    expect(errors[1] as number).toBeLessThan((errors[0] as number) / 10);
    expect(errors[2] as number).toBeLessThan((errors[1] as number) / 10);
  });
});
