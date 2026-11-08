import {
  type Connector,
  type CylinderShape,
  DEFAULT_DOVETAIL,
  DIAMETRAL_CLEARANCE_LIMITS,
  DOVETAIL_CLEARANCE_LIMITS,
  type DovetailConnector,
  type DowelConnector,
  maxTiltDisplacement,
  type PlugConnector,
  type RoundConnector,
} from '@diploma-3d/schema';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorUnsuitableError, InvalidModelSpecError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  findMeshDefects,
  subtract,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
  vertexCount,
} from '../mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import { circularSegments, roundDimensionsMm } from '../shapes/round.ts';
import { hasFeasibleValues, type ParameterBounds } from './bounds.ts';
import {
  DOVETAIL_LEAD_IN_RELATIVE,
  type DovetailParameter,
  type DovetailPlan,
  dovetailChecks,
  dovetailDimensions,
  dovetailFeasibility,
  planDovetail,
} from './dovetail.ts';
import {
  lateralWall,
  satisfies,
  sectionOffsetMm,
  sectionOffsetPercent,
  verticalCylinderSection,
  verticalOffsetLimitMm,
  verticalOffsetLimitPercent,
} from './frame.ts';
import {
  planRoundConnectors,
  ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorParameter,
  type RoundConnectorPlan,
  roundConnectorChecks,
  roundConnectorDimensions,
  roundConnectorFeasibility,
} from './round.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

const M = 80;
const scale = { longestDimensionMm: M } as const;
const WALL = 1.2;
const VOLUME_TOLERANCE = 1e-3;
const cylinder = (heightRatio: number, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const pair = (count: 1 | 2, spacingPercent = 45) => (count === 2 ? { count, spacingPercent } : { count });
const plug = (count: 1 | 2 = 1, overrides: Partial<PlugConnector> = {}): PlugConnector =>
  ({ type: 'plug', diameterFactor: 1, depthFactor: 1, holeClearanceMm: 0.2, ...pair(count), ...overrides }) as PlugConnector;
const dowel = (count: 1 | 2 = 1, overrides: Partial<DowelConnector> = {}): DowelConnector =>
  ({
    type: 'dowel',
    diameterFactor: 1,
    depthFactor: 1,
    lowerClearanceMm: 0.1,
    upperClearanceMm: 0.2,
    ...pair(count),
    ...overrides,
  }) as DowelConnector;
const dovetail = (overrides: Partial<DovetailConnector> = {}): DovetailConnector => ({
  type: 'dovetail',
  ...DEFAULT_DOVETAIL,
  ...overrides,
});
const diameterFactor = (millimetres: number) => millimetres / (ROUND_CONNECTOR_PROPORTIONS.diameter * M);
const depthFactor = (millimetres: number) => millimetres / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);

const build = (shape: CylinderShape, offsetPercent = 0, connector?: Connector): GeneratedModel =>
  generateModel(kernel, {
    shape,
    scale,
    section: { type: 'vertical', offsetPercent, ...(connector === undefined ? {} : { connector }) },
  });

const SHAPES: readonly (readonly [string, CylinderShape])[] = [
  ['a right cylinder', cylinder(2)],
  ['a slim right cylinder', cylinder(4)],
  ['an oblique cylinder', cylinder(2, 1)],
  ['a tall oblique cylinder', cylinder(4, 2)],
];

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const volumeOf = (track: Track, manifold: Manifold) => track(manifold).volume();

/** Whether a small cube at the point lies in the solid's material. */
const hasMaterialAt = (track: Track, solid: Manifold, [x, y, z]: Vec3, side = 0.1): boolean =>
  volumeOf(track, solid.intersect(track(track(kernel.Manifold.cube([side, side, side], true)).translate([x, y, z])))) >
  0.9 * side ** 3;

const parts = (model: GeneratedModel) => {
  const [a, b, ...pins] = model.solids as [Solid, Solid, ...Solid[]];
  expect([a.part, b.part]).toEqual(['part-1', 'part-2']);
  return { a, b, pins };
};

const yRange = (mesh: TriangleMesh) => {
  const ys = Array.from({ length: vertexCount(mesh) }, (_, vertex) => vertexAt(mesh, vertex)[1]);
  return { min: Math.min(...ys), max: Math.max(...ys) };
};

/** The triangles of a mesh that lie in the plane y = t. */
const capTriangles = (mesh: TriangleMesh, t: number) =>
  Array.from({ length: triangleCount(mesh) }, (_, triangle) => triangle).filter((triangle) =>
    triangleAt(mesh, triangle)
      .map((vertex) => vertexAt(mesh, vertex)[1])
      .every((y) => Math.abs(y - t) < 1e-4),
  );

/** The distance from a point to a triangle: the closest-point regions of Ericson, Real-Time Collision Detection. */
function pointTriangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const dot3 = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const at = (origin: Vec3, s: number, edge: Vec3, r = 0, other: Vec3 = [0, 0, 0]): number => {
    const q = subtract(p, [
      origin[0] + s * edge[0] + r * other[0],
      origin[1] + s * edge[1] + r * other[1],
      origin[2] + s * edge[2] + r * other[2],
    ]);
    return Math.sqrt(dot3(q, q));
  };
  const [ab, ac, ap] = [subtract(b, a), subtract(c, a), subtract(p, a)];
  const [d1, d2] = [dot3(ab, ap), dot3(ac, ap)];
  if (d1 <= 0 && d2 <= 0) return at(a, 0, ab);
  const bp = subtract(p, b);
  const [d3, d4] = [dot3(ab, bp), dot3(ac, bp)];
  if (d3 >= 0 && d4 <= d3) return at(b, 0, ab);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(a, d1 / (d1 - d3), ab);
  const cp = subtract(p, c);
  const [d5, d6] = [dot3(ab, cp), dot3(ac, cp)];
  if (d6 >= 0 && d5 <= d6) return at(c, 0, ab);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(a, d2 / (d2 - d6), ac);
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(b, (d4 - d3) / (d4 - d3 + (d5 - d6)), subtract(c, b));
  const denominator = 1 / (va + vb + vc);
  return at(a, vb * denominator, ab, vc * denominator, ac);
}

/** The least distance from the points to the surface of the mesh. */
function distanceToSurface(points: readonly Vec3[], mesh: TriangleMesh): number {
  const triangles = Array.from({ length: triangleCount(mesh) }, (_, triangle) =>
    triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex)),
  ) as [Vec3, Vec3, Vec3][];
  let least = Number.POSITIVE_INFINITY;
  for (const point of points) {
    for (const [a, b, c] of triangles) least = Math.min(least, pointTriangleDistance(point, a, b, c));
  }
  return least;
}

/** Points on a circle around an axis along Y through (x, z) at this y. */
const ringAround = (x: number, y: number, z: number, radius: number, count = 72): Vec3[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    return [x + radius * Math.cos(angle), y, z + radius * Math.sin(angle)];
  });

describe('the vertical plane', () => {
  it.each(SHAPES)('of %s is parallel to the whole axis and contains it at offset 0', (_, shape) => {
    const { offset: d, height: H } = roundDimensionsMm(shape, scale);
    const { plane, frame, offset } = verticalCylinderSection(shape, scale, 0);
    expect(offset).toBe(0);
    expect(plane.normal[2]).toBe(0);
    expect(Math.hypot(...plane.normal)).toBeCloseTo(1, 12);
    // The axis a = (d, 0, H) lies in the plane from C0 to C1.
    for (const fraction of [0, 0.25, 0.5, 1]) {
      const point: Vec3 = [fraction * d, 0, fraction * H];
      expect(plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2] - plane.offset).toBeCloseTo(
        0,
        12,
      );
    }
    expect(frame.u).toEqual([0, 0, 1]);
    expect(frame.n).toEqual(plane.normal);
    expect(plane.normal).toEqual([0, 1, 0]);
  });

  it.each(SHAPES)(
    'of %s puts part 1 on the negative side and part 2 on the positive side, with the signed offset',
    (_, shape) => {
      const { radius } = roundDimensionsMm(shape, scale);
      for (const offsetPercent of [-40, 0, 25]) {
        const t = (offsetPercent / 100) * radius;
        const model = build(shape, offsetPercent);
        expect(model.section?.plane.offset).toBeCloseTo(t, 9);
        const { a, b } = parts(model);
        expect(yRange(a.mesh).max).toBeCloseTo(t, 3);
        expect(yRange(a.mesh).min).toBeCloseTo(-radius, 3);
        expect(yRange(b.mesh).min).toBeCloseTo(t, 3);
        expect(yRange(b.mesh).max).toBeCloseTo(radius, 3);
        // A positive offset leaves more of the solid in part 1.
        if (offsetPercent !== 0) expect(a.measurements.volume > b.measurements.volume).toBe(offsetPercent > 0);
      }
    },
  );

  it('converts between percent and millimetres on the base circle’s radius, whatever the lean', () => {
    expect(sectionOffsetMm(0, 40)).toBe(0);
    expect(sectionOffsetMm(25, 40)).toBe(10);
    expect(sectionOffsetMm(-25, 40)).toBe(-10);
    expect(sectionOffsetMm(25, 60)).toBe(15);
    for (const percent of [-80, -12.5, 0, 33.3, 80]) {
      expect(sectionOffsetPercent(sectionOffsetMm(percent, 26.7), 26.7)).toBeCloseTo(percent, 10);
    }
    // An oblique cylinder is 3r wide at d = r: half its bounding box is 40 mm, its radius 80/3 mm.
    const oblique = cylinder(2, 1);
    const { radius } = roundDimensionsMm(oblique, scale);
    expect(radius).toBeCloseTo(80 / 3, 12);
    expect(verticalCylinderSection(oblique, scale, 25).offset).toBeCloseTo(20 / 3, 12);
    expect(yRange(parts(build(oblique, 25)).a.mesh).max).toBeCloseTo(20 / 3, 3);
    // Scaling uniformly keeps the percentage's limit and scales the plane.
    expect(verticalCylinderSection(cylinder(2), { longestDimensionMm: 120 }, 25).offset).toBeCloseTo(15, 12);
    expect(verticalOffsetLimitPercent(cylinder(2), { longestDimensionMm: 120 })).toBeCloseTo(80, 9);
    expect(verticalOffsetLimitPercent(oblique, scale)).toBeCloseTo(80, 9);
    expect(verticalOffsetLimitPercent(cylinder(2), { longestDimensionMm: 10 })).toBeCloseTo(76, 9);
  });

  it('stays usable: the offset limit comes from the actual extent, the thinner part’s share and the minimum wall', () => {
    // r = 40 mm: the thinner part keeps 10 % of 80 mm, more than the 1,2 mm wall.
    expect(verticalOffsetLimitMm(cylinder(2), scale)).toBeCloseTo(32, 9);
    // M = 10 mm, r = 5 mm: 10 % of 10 mm is less than the wall, which leaves 3,8 mm.
    expect(verticalOffsetLimitMm(cylinder(2), { longestDimensionMm: 10 })).toBeCloseTo(3.8, 9);
    // M = 2 mm, r = 1 mm: no wall fits beside the axis; only the axial cut remains.
    expect(verticalOffsetLimitMm(cylinder(2), { longestDimensionMm: 2 })).toBe(0);
    for (const shape of [cylinder(2), cylinder(2, 1)]) {
      const limit = verticalOffsetLimitMm(shape, scale);
      const { radius } = roundDimensionsMm(shape, scale);
      const percent = (limit / radius) * 100;
      expect(() => build(shape, percent)).not.toThrow();
      expect(() => build(shape, -percent)).not.toThrow();
      expect(() => build(shape, percent + 0.01)).toThrow(InvalidModelSpecError);
      expect(() => build(shape, -percent - 0.01)).toThrow(InvalidModelSpecError);
    }
  });
});

describe.each(SHAPES)('the section of %s', (_, shape) => {
  const { radius: r, height: H, offset: d } = roundDimensionsMm(shape, scale);

  it.each([0, 37.5, -62.5])('at %d percent of r is the parallelogram of the actual polygon, in both parts', (offsetPercent) => {
    const t = (offsetPercent / 100) * r;
    const section = verticalCylinderSection(shape, scale, offsetPercent);
    const model = build(shape, offsetPercent);
    const { a, b } = parts(model);
    const [c0, c1, c2, c3] = section.contour as [Vec3, Vec3, Vec3, Vec3];
    // A rectangle for a right cylinder, otherwise a parallelogram: both side edges are the axis a.
    for (const [axis, value] of [d, 0, H].entries()) {
      expect(subtract(c3, c0)[axis]).toBeCloseTo(value, 9);
      expect(subtract(c2, c1)[axis]).toBeCloseTo(value, 9);
    }
    // The chord of the inscribed polygon undershoots 2√(r² − t²) by at most the radial deviation, seen along the chord.
    const ideal = 2 * Math.sqrt(r ** 2 - t ** 2);
    const deviation = r * (1 - Math.cos(Math.PI / circularSegments(r)));
    const width = (c1[0] as number) - (c0[0] as number);
    expect(width).toBeLessThanOrEqual(ideal);
    expect(ideal - width).toBeLessThanOrEqual((2 * deviation * r) / (ideal / 2));
    for (const part of [a, b]) {
      const cap = capTriangles(part.mesh, t);
      const area = cap.reduce((sum, triangle) => sum + Math.abs(triangleAreaVector(part.mesh, triangle)[1]) / 2, 0);
      expect(area).toBeCloseTo(width * H, 2);
      const centroid = [0, 2].map(
        (axis) =>
          cap.reduce((sum, triangle) => {
            const corners = triangleAt(part.mesh, triangle).map((vertex) => vertexAt(part.mesh, vertex)[axis] as number);
            return (
              sum +
              (Math.abs(triangleAreaVector(part.mesh, triangle)[1]) / 2) *
                (((corners[0] as number) + (corners[1] as number) + (corners[2] as number)) / 3)
            );
          }, 0) / area,
      );
      expect(centroid[0]).toBeCloseTo(section.frame.origin[0], 2);
      expect(centroid[1]).toBeCloseTo(section.frame.origin[2], 2);
      // Every corner of the contour is a vertex of the cap.
      const vertices = cap.flatMap((triangle) =>
        [...triangleAt(part.mesh, triangle)].map((vertex) => vertexAt(part.mesh, vertex)),
      );
      for (const corner of section.contour) {
        expect(Math.min(...vertices.map((vertex) => Math.hypot(...subtract(vertex, corner))))).toBeLessThan(1e-3);
      }
    }
  });

  it('conserves the volume, splits an axial cut in two equal halves, and keeps the scale of the whole', () => {
    const whole = generateModel(kernel, { shape, scale });
    const wholeVolume = whole.solids[0]?.measurements.volume as number;
    const axial = parts(build(shape, 0));
    expect(axial.a.measurements.volume / axial.b.measurements.volume).toBeCloseTo(1, 4);
    for (const offsetPercent of [0, 30, -55]) {
      const model = build(shape, offsetPercent);
      const { a, b } = parts(model);
      for (const part of [a, b]) {
        expect(findMeshDefects(part.mesh)).toEqual([]);
        expect(part.measurements.volume).toBeGreaterThan(0);
        withScope((track) => {
          const pieces = manifoldOf(track, part.mesh).decompose();
          for (const piece of pieces) track(piece);
          expect(pieces).toHaveLength(1);
        });
      }
      expect((a.measurements.volume + b.measurements.volume) / wholeVolume).toBeCloseTo(1, 5);
      // The cut changes neither the assembled size nor the height of either part.
      for (let axis = 0; axis < 3; axis += 1) expect(model.size[axis]).toBeCloseTo(whole.size[axis] as number, 4);
      expect(a.measurements.size[2]).toBeCloseTo(H, 4);
      expect(b.measurements.size[2]).toBeCloseTo(H, 4);
      expect(Math.max(...model.size)).toBeCloseTo(M, 4);
    }
  });
});

describe('lateralWall', () => {
  /** The distance from a point of a plane perpendicular to the axis to the sampled ellipse. */
  const sampled = (major: number, minor: number, p: number, q: number) => {
    let least = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= 20000; index += 1) {
      const angle = (index / 20000) * (Math.PI / 2);
      least = Math.min(least, Math.hypot(major * Math.sin(angle) - p, minor * Math.cos(angle) - q));
    }
    return least;
  };

  it('is the Euclidean distance to the inscribed oblique cylinder, below the horizontal measure', () => {
    const section = verticalCylinderSection(cylinder(2, 2), scale, 0);
    const { inradius, stretch, lean } = section;
    expect(lean).toBe(1);
    expect(stretch).toBeCloseTo(Math.SQRT2, 12);
    for (const [reach, y] of [
      [0, 0],
      [0, 10],
      [5, 0],
      [5, 3],
      [10, 8],
      [14, 2],
    ] as const) {
      const wall = lateralWall(section, reach, y);
      expect(wall).toBeCloseTo(sampled(inradius, inradius / stretch, y, reach / stretch), 3);
      expect(wall).toBeLessThanOrEqual(inradius - Math.hypot(reach, y) + 1e-9);
    }
    // Along the lean the horizontal wall is √(1 + k²) times the true one; across it the two are equal.
    expect(lateralWall(section, 10, 0)).toBeCloseTo((inradius - 10) / stretch, 9);
    expect(lateralWall(section, 0, 10)).toBeCloseTo(inradius - 10, 9);
    // Outside it is negative.
    expect(lateralWall(section, inradius + 1, 0)).toBeLessThan(0);
  });

  it('is exactly radial for a right cylinder and never rises with the distance from the axis', () => {
    const right = verticalCylinderSection(cylinder(2), scale, 0);
    expect(lateralWall(right, 3, 4)).toBeCloseTo(right.inradius - 5, 12);
    const oblique = verticalCylinderSection(cylinder(2, 3), scale, 0);
    let previous = Number.POSITIVE_INFINITY;
    for (let reach = 0; reach < oblique.inradius; reach += oblique.inradius / 200) {
      const wall = lateralWall(oblique, reach, 3);
      expect(wall).toBeLessThanOrEqual(previous + 1e-9);
      previous = wall;
    }
  });
});

describe('plugs and dowels in a vertical cut', () => {
  const cases: readonly (readonly [string, CylinderShape, number, RoundConnector])[] = [
    ['one plug, right, axial', cylinder(2), 0, plug(1)],
    ['two plugs, right, displaced', cylinder(2), 25, plug(2)],
    ['two plugs, oblique', cylinder(2, 1), -20, plug(2)],
    ['one dowel, right, axial', cylinder(2), 0, dowel(1)],
    ['two dowels, right, displaced', cylinder(2), -30, dowel(2)],
    ['one dowel, oblique', cylinder(2, 1), 0, dowel(1)],
    ['two dowels, tall oblique', cylinder(4, 2), 15, dowel(2)],
  ];

  describe.each(cases)('%s', (_, shape, offsetPercent, connector) => {
    const model = build(shape, offsetPercent, connector);
    const { a, b, pins } = parts(model);
    const plan = model.section?.connector as RoundConnectorPlan;
    const { frame, sites, insertion: e, holeDepth } = plan;
    const section = verticalCylinderSection(shape, scale, offsetPercent);
    const t = section.offset;

    it('leaves closed, connected solids, inside the uncut cylinder, without overlaps', () => {
      expect(plan.issues).toEqual([]);
      expect(pins).toHaveLength(connector.type === 'dowel' ? sites.length : 0);
      expect(model.name).toBe('cylinder-vertical-section');
      expect(a.name).toBe('cylinder-part-1');
      expect(b.name).toBe('cylinder-part-2');
      pins.forEach((pin, index) => {
        expect(pin.name).toBe(`cylinder-dowel-${index + 1}`);
      });
      for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
    });

    it('has its axes along the plane’s normal, one on the centroid or a pair at C ± s·u with the larger pin above', () => {
      expect(frame.n).toEqual(model.section?.plane.normal);
      expect(frame.n[2]).toBe(0);
      expect(frame.origin).toEqual(section.frame.origin);
      if (sites.length === 1) expect(sites[0]?.centre).toEqual(section.frame.origin);
      else {
        const [upper, lower] = sites as [(typeof sites)[0], (typeof sites)[0]];
        const s = ((connector.spacingPercent as number) / 100) * (section.height / 2);
        expect(upper.centre[2]).toBeCloseTo(section.frame.origin[2] + s, 9);
        expect(lower.centre[2]).toBeCloseTo(section.frame.origin[2] - s, 9);
        expect(upper.centre[0]).toBe(section.frame.origin[0]);
        expect(lower.centre[0]).toBe(section.frame.origin[0]);
        expect(upper.pinDiameter).toBeGreaterThan(lower.pinDiameter);
      }
      // Dowels are round about Y, not Z: each is 2e long along n and d wide across it.
      pins.forEach((pin, index) => {
        const diameter = sites[index]?.pinDiameter as number;
        expect(pin.measurements.size[1]).toBeCloseTo(2 * e, 3);
        expect(pin.measurements.size[0]).toBeCloseTo(diameter, 3);
        expect(pin.measurements.size[2]).toBeCloseTo(diameter, 3);
      });
    });

    it('protrudes from part 1 and drills blind holes of the set depth, sideways, into the receiving parts', () => {
      withScope((track) => {
        const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
        for (const { centre } of sites) {
          const inB = (depth: number): Vec3 => [centre[0], t + depth, centre[2]];
          const inA = (depth: number): Vec3 => [centre[0], t - depth, centre[2]];
          expect(hasMaterialAt(track, partB, inB(holeDepth - 0.2))).toBe(false);
          expect(hasMaterialAt(track, partB, inB(holeDepth + 0.2))).toBe(true);
          if (connector.type === 'plug') {
            expect(hasMaterialAt(track, partA, inB(e - 0.2))).toBe(true);
            expect(hasMaterialAt(track, partA, inB(e + 0.2))).toBe(false);
            expect(hasMaterialAt(track, partA, inA(1))).toBe(true);
          } else {
            expect(hasMaterialAt(track, partA, inA(holeDepth - 0.2))).toBe(false);
            expect(hasMaterialAt(track, partA, inA(holeDepth + 0.2))).toBe(true);
          }
        }
        if (connector.type === 'plug') {
          expect(yRange(a.mesh).max).toBeCloseTo(t + e, 3);
          expect(yRange(b.mesh).min).toBeCloseTo(t, 3);
        } else {
          expect(yRange(a.mesh).max).toBeCloseTo(t, 3);
          expect(yRange(b.mesh).min).toBeCloseTo(t, 3);
        }
        expect(volumeOf(track, partA.intersect(partB))).toBeLessThan(VOLUME_TOLERANCE);
      });
    });

    it('comes apart along n', () => {
      withScope((track) => {
        const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
        const n = frame.n;
        const along = (distance: number): KernelVec3 => [n[0] * distance, n[1] * distance, n[2] * distance];
        for (const distance of [0.5, e / 2, e, e + 0.5]) {
          const moved = track(partB.translate(along(distance)));
          expect(volumeOf(track, moved.intersect(partA))).toBeLessThan(VOLUME_TOLERANCE);
          for (const pin of pins) {
            expect(volumeOf(track, moved.intersect(manifoldOf(track, pin.mesh)))).toBeLessThan(VOLUME_TOLERANCE);
          }
        }
      });
    });

    it('joins only one way as a pair: part 2 turned by 180° about the centroid’s normal meets the larger pin', () => {
      if (sites.length !== 2) return;
      withScope((track) => {
        const [cx, , cz] = frame.origin;
        // The half turn about the line through the centroid along Y.
        const turned = track(manifoldOf(track, b.mesh).transform([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 2 * cx, 0, 2 * cz, 1]));
        const mating = connector.type === 'plug' ? [a] : pins;
        const contact = mating.reduce((sum, solid) => sum + volumeOf(track, turned.intersect(manifoldOf(track, solid.mesh))), 0);
        expect(contact).toBeGreaterThan(VOLUME_TOLERANCE);
      });
    });
  });

  it('does not build a combination whose entrance fits but whose depth breaks through the side', () => {
    // r = 40 mm and t = 25 mm: part 2 is 15 mm thick on the axis. The 5 mm entrance fits either way; a 13 mm plug leaves
    // the wall under its hole's bottom, a 14 mm one does not.
    const offsetPercent = 62.5;
    const deep = plug(1, { depthFactor: depthFactor(14) });
    const { issues } = planRoundConnectors(cylinder(2), scale, { offsetPercent }, deep);
    expect(issues.map((issue) => issue.code + ('part' in issue ? `/${issue.part}` : ''))).toEqual(['hole-bottom-thin/upper']);
    expect(() => build(cylinder(2), offsetPercent, deep)).toThrow(ConnectorUnsuitableError);
    const fits = plug(1, { depthFactor: depthFactor(13) });
    expect(planRoundConnectors(cylinder(2), scale, { offsetPercent }, fits).issues).toEqual([]);
    expect(() => build(cylinder(2), offsetPercent, fits)).not.toThrow();
  });

  it('checks the rim of the hole’s bottom, not only its centre', () => {
    // The centre ray would allow the same depth for any width; a wide pin's rim reaches the surface first.
    const inner = verticalCylinderSection(cylinder(2), scale, 62.5).inradius - WALL;
    const depthFor = (diameter: number) => {
      const connector = plug(1, { diameterFactor: diameterFactor(diameter) });
      return roundConnectorFeasibility(cylinder(2), scale, { offsetPercent: 62.5 }, connector).parameters.insertion.bounds.max;
    };
    for (const diameter of [5, 20, 40]) {
      const rim = (diameter + 0.2) / 2;
      expect(depthFor(diameter)).toBeCloseTo(Math.sqrt(inner ** 2 - rim ** 2) - 25 - ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM, 9);
    }
    expect(depthFor(40)).toBeLessThan(depthFor(5));
  });

  it('checks every receiving part: a dowel’s holes are limited by the thinner side, whichever the offset’s sign', () => {
    const bound = (offsetPercent: number) =>
      roundConnectorFeasibility(cylinder(2), scale, { offsetPercent }, dowel(1, { lowerClearanceMm: 0.2 })).parameters.insertion
        .bounds;
    expect(bound(0).max).toBeGreaterThan(30);
    expect(bound(50).max).toBeCloseTo(bound(-50).max, 9);
    expect(bound(50).max).toBeLessThan(bound(25).max);
    expect(planRoundConnectors(cylinder(2), scale, { offsetPercent: -62.5 }, dowel(1, { depthFactor: 3.5 })).issues).toEqual([
      expect.objectContaining({ code: 'hole-bottom-thin', part: 'lower' }),
    ]);
    expect(planRoundConnectors(cylinder(2), scale, { offsetPercent: 62.5 }, dowel(1, { depthFactor: 3.5 })).issues).toEqual([
      expect.objectContaining({ code: 'hole-bottom-thin', part: 'upper' }),
    ]);
  });
});

describe('the bounds of plugs and dowels in a vertical cut', () => {
  const bounds = (shape: CylinderShape, offsetPercent: number, connector: RoundConnector, key: RoundConnectorParameter) =>
    roundConnectorFeasibility(shape, scale, { offsetPercent }, connector).parameters[key].bounds;
  const inradiusOf = (shape: CylinderShape, offsetPercent = 0) => verticalCylinderSection(shape, scale, offsetPercent).inradius;

  it('reach the curved surface along n, not a base: a flat cylinder allows far deeper holes than across its height', () => {
    // H = 20 mm, r = 40 mm: a parallel cut at 50 % allowed e ≤ 8,5 mm; here the hole runs towards the surface 40 mm away.
    const { max } = bounds(cylinder(0.5), 0, plug(1), 'insertion');
    expect(max).toBeCloseTo(Math.sqrt((inradiusOf(cylinder(0.5)) - WALL) ** 2 - 2.6 ** 2) - 0.3, 9);
    expect(max).toBeGreaterThan(38);
    // The chamfers set the lower bound as before.
    expect(bounds(cylinder(0.5), 0, plug(1), 'insertion').min).toBeCloseTo(2.8, 9);
    expect(bounds(cylinder(0.5), 0, dowel(1), 'insertion').min).toBeCloseTo(3.1, 9);
  });

  it('place a pair on the section’s height, from the entrances’ wall to the bases’', () => {
    for (const [shape, diameter, clearance] of [
      [cylinder(2), 5, 0.2],
      [cylinder(0.5), 5, 0.2],
      [cylinder(4), 12, 0.4],
    ] as const) {
      const connector = plug(2, { diameterFactor: diameterFactor(diameter), holeClearanceMm: clearance });
      const { height: H } = roundDimensionsMm(shape, scale);
      const [a1, a2] = [diameter, 0.8 * diameter].map((pin) => (pin + clearance) / 2 + Math.min(0.08 * pin, 0.2 * 4)) as [
        number,
        number,
      ];
      const { min, max } = bounds(shape, 0, connector, 'spacing');
      expect(min).toBeCloseTo((a1 + a2 + WALL) / 2, 9);
      expect(max).toBeCloseTo(H / 2 - WALL - a1, 9);
    }
  });

  it('narrow the spacing with the lean: the holes move across the leaning section', () => {
    const leaning = bounds(cylinder(1, 1.5), 0, plug(2), 'spacing').max;
    const right = bounds(cylinder(1), 0, plug(2), 'spacing').max;
    expect(leaning).toBeLessThan(right);
    expect(bounds(cylinder(0.5, 1.866), 0, plug(2), 'spacing').max).toBeLessThan(
      bounds(cylinder(0.5), 0, plug(2), 'spacing').max,
    );
  });

  it('limit the diameter by the width and height of the section', () => {
    // A slim cylinder: r = 10 mm, H = 80 mm. The rim of a 4,3 mm deep bottom limits a single plug, before its entrance.
    const slim = cylinder(8);
    expect(bounds(slim, 0, plug(1), 'diameter').max).toBeCloseTo(
      2 * Math.sqrt((inradiusOf(slim) - WALL) ** 2 - 4.3 ** 2) - 0.2,
      9,
    );
    // A flat one: r = 40 mm, H = 20 mm. The height limits it: H/2 − (d + c)/2 − 0,8 ≥ 1,2.
    expect(bounds(cylinder(0.5), 0, plug(1), 'diameter').max).toBeCloseTo(2 * (10 - WALL - 0.8) - 0.2, 9);
    // Keying and the minimum pin hold as in any other cut.
    expect(bounds(cylinder(2), 0, plug(2, { holeClearanceMm: 0.4 }), 'diameter').min).toBeCloseTo(4.5, 9);
    expect(bounds(cylinder(2), 0, plug(1), 'diameter').min).toBeCloseTo(3, 9);
  });

  it('keep the clearance’s calibration window, narrowed by the keying', () => {
    expect(bounds(cylinder(2), 0, plug(1), 'upperClearance')).toEqual({ ...DIAMETRAL_CLEARANCE_LIMITS, blocked: false });
    expect(bounds(cylinder(2), 0, plug(2, { diameterFactor: diameterFactor(4.2) }), 'upperClearance').max).toBeCloseTo(0.34, 9);
  });

  it('leave an empty interval when the section cannot hold a dimension, and recover when the plane moves back', () => {
    // At t = 0,8·r = 32 mm, 8 mm remain in part 2 on the axis: a 13 mm plug is out of range, a shorter one fits.
    const near = bounds(cylinder(2), 80, plug(1, { depthFactor: depthFactor(13) }), 'insertion');
    expect(hasFeasibleValues(near)).toBe(true);
    expect(near.max).toBeLessThan(6.5);
    // At r = 20 mm, 4 mm remain: the 2 mm of straight engagement need 2,8 mm, the wall allows about 2,3 mm.
    const thin = bounds(cylinder(4), 80, plug(1), 'insertion');
    expect(hasFeasibleValues(thin)).toBe(false);
    expect(thin.min).toBeCloseTo(2.8, 9);
    expect(thin.max).toBeLessThan(2.4);
    expect(hasFeasibleValues(bounds(cylinder(4), 0, plug(1), 'insertion'))).toBe(true);
  });

  const roundCases: readonly (readonly [string, CylinderShape, number, RoundConnector])[] = [
    ['one plug, right, axial', cylinder(2), 0, plug(1)],
    ['a pair of plugs, slim, displaced', cylinder(4), 30, plug(2)],
    ['a pair of dowels, oblique, negative offset', cylinder(2, 1), -30, dowel(2)],
    ['one dowel, tall oblique', cylinder(4, 2), 20, dowel(1)],
    ['one plug, flattest oblique', cylinder(0.5, maxTiltDisplacement(0.5)), 0, plug(1)],
  ];

  describe.each(roundCases)('of %s', (_, shape, offsetPercent, connector) => {
    const section = verticalCylinderSection(shape, scale, offsetPercent);
    const dimensions = roundConnectorDimensions(connector, M, section.span / 2);
    const { issues, parameters, unattributed } = roundConnectorFeasibility(shape, scale, { offsetPercent }, connector);
    const probe = (key: RoundConnectorParameter, value: number) =>
      roundConnectorChecks(section, {
        ...dimensions,
        ...(key === 'lowerClearance' || key === 'upperClearance'
          ? { clearance: { ...dimensions.clearance, [key === 'lowerClearance' ? 'lower' : 'upper']: value } }
          : { [key]: value }),
      });
    const entries = Object.entries(parameters) as [RoundConnectorParameter, { bounds: ParameterBounds }][];

    it('start from a valid combination', () => {
      expect(issues).toEqual([]);
      expect(unattributed).toEqual([]);
    });

    it('are tight: values within pass, values just outside fail', () => {
      for (const [key, { bounds: range }] of entries) {
        expect(hasFeasibleValues(range)).toBe(true);
        for (const fraction of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
          const value = range.min + fraction * (range.max - range.min);
          expect(probe(key, value).every(satisfies)).toBe(true);
        }
        const window = key.endsWith('Clearance') ? DIAMETRAL_CLEARANCE_LIMITS : undefined;
        if (window === undefined || range.min > window.min) expect(probe(key, range.min - 1e-6).every(satisfies)).toBe(false);
        if (window === undefined || range.max < window.max) expect(probe(key, range.max + 1e-6).every(satisfies)).toBe(false);
      }
    });

    it('rest on checks that are monotone in each dimension', () => {
      for (const [key, { bounds: range }] of entries) {
        const top = key.endsWith('Clearance') ? 0.4 : 1.5 * Math.max(range.max, 1);
        expectMonotone((value) => probe(key, value), 0, top);
      }
    });

    it('agree with the 3D checks and the mesh at their ends: the extreme connectors build, and the walls measure as planned', () => {
      const whole = generateModel(kernel, { shape, scale }).solids[0]?.mesh as TriangleMesh;
      const inward = 1e-6;
      const extremes: [RoundConnectorParameter, RoundConnector][] = [
        ['insertion', { ...connector, depthFactor: depthFactor(parameters.insertion.bounds.max - inward) }],
        ['diameter', { ...connector, diameterFactor: diameterFactor(parameters.diameter.bounds.max - inward) }],
      ];
      if (connector.count === 2) {
        const { max } = parameters.spacing.bounds;
        extremes.push(['spacing', { ...connector, spacingPercent: ((max - inward) / (section.span / 2)) * 100 }]);
      }
      for (const [, extreme] of extremes) {
        const model = build(shape, offsetPercent, extreme);
        const plan = model.section?.connector as RoundConnectorPlan;
        expect(plan.issues).toEqual([]);
        // Every circle that bounds a cavity keeps the wall from the actual surface of the uncut cylinder.
        const worst = holeRings(plan, section.offset, extreme).map((ring) => distanceToSurface(ring, whole));
        expect(Math.min(...worst)).toBeGreaterThanOrEqual(WALL - 1e-3);
      }
    });
  });

  it('are as tight on the mesh as the polygon allows at the deepest hole', () => {
    // The right cylinder's section: the polygon's inscribed circle undershoots its edges by at most its deviation.
    const connector = plug(1);
    const { max } = roundConnectorFeasibility(cylinder(2), scale, { offsetPercent: 0 }, connector).parameters.insertion.bounds;
    const extreme = plug(1, { depthFactor: depthFactor(max - 1e-6) });
    const model = build(cylinder(2), 0, extreme);
    const plan = model.section?.connector as RoundConnectorPlan;
    const whole = generateModel(kernel, { shape: cylinder(2), scale }).solids[0]?.mesh as TriangleMesh;
    const rings = holeRings(plan, 0, extreme);
    const deviation = 40 * (1 - Math.cos(Math.PI / circularSegments(40)));
    expect(distanceToSurface(rings.at(-1) as Vec3[], whole)).toBeLessThanOrEqual(WALL + 2 * deviation);
  });
});

/** The circles that bound every hole of the plan: the entrance, the chamfer's end and the bottom, in both parts it drills. */
function holeRings(plan: RoundConnectorPlan, t: number, connector: RoundConnector): Vec3[][] {
  const clearances =
    connector.type === 'plug' ? [connector.holeClearanceMm] : [connector.upperClearanceMm, connector.lowerClearanceMm];
  const signs = connector.type === 'plug' ? [1] : [1, -1];
  return plan.sites.flatMap(({ centre, pinDiameter, chamfer }) =>
    signs.flatMap((sign, index) => {
      const straight = (pinDiameter + (clearances[index] as number)) / 2;
      return [
        ringAround(centre[0], t, centre[2], straight + chamfer),
        ringAround(centre[0], t + sign * chamfer, centre[2], straight),
        ringAround(centre[0], t + sign * plan.holeDepth, centre[2], straight),
      ];
    }),
  );
}

/** Each check's value, sampled along the dimension, never changes direction. */
function expectMonotone(probe: (value: number) => readonly { valueMm: number }[], from: number, to: number) {
  const samples = Array.from({ length: 401 }, (_, index) => probe(from + ((to - from) * index) / 400));
  const count = samples[0]?.length ?? 0;
  for (let check = 0; check < count; check += 1) {
    const values = samples.map((sample) => sample[check]?.valueMm ?? Number.NaN);
    const steps = values.slice(1).map((value, index) => value - (values[index] as number));
    expect(steps.some((step) => step > 1e-9) && steps.some((step) => step < -1e-9)).toBe(false);
  }
}

describe('the vertical dovetail', () => {
  const plan = (shape: CylinderShape, offsetPercent: number, connector = dovetail()) =>
    planDovetail(shape, scale, { offsetPercent }, connector);

  it('slides along the world’s vertical, u pointing down from the open end to the stop', () => {
    const { frame, length, clearance, exitDistance } = plan(cylinder(2, 1), 0);
    expect(frame.u).toEqual([-0, -0, -1]);
    expect(frame.n).toEqual([0, 1, 0]);
    // A proper frame: v = u × n.
    expect(frame.v[0]).toBe(1);
    const { height } = roundDimensionsMm(cylinder(2, 1), scale);
    expect(exitDistance).toBeCloseTo(height / 2 + length / 2 + clearance + 1, 12);
  });

  describe.each([
    ['a right cylinder, axial', cylinder(2), 0, dovetail()],
    ['a right cylinder, displaced', cylinder(2), 30, dovetail()],
    ['a right cylinder, displaced the other way', cylinder(2), -30, dovetail({ sizeFactor: 1.5 })],
    ['an oblique cylinder', cylinder(2, 1), 0, dovetail()],
    ['an oblique cylinder, displaced', cylinder(2, 1), -25, dovetail({ lengthPercent: 30 })],
    ['a tall oblique cylinder', cylinder(4, 2), 20, dovetail({ sizeFactor: 0.75, lengthPercent: 30 })],
  ] as const)('on %s', (_, shape, offsetPercent, connector) => {
    const model = build(shape, offsetPercent, connector);
    const { a, b } = parts(model);
    const details = model.section?.connector as DovetailPlan;
    const { frame, length: L, clearance: c, height: h, normalPlay, exitDistance } = details;
    const section = verticalCylinderSection(shape, scale, offsetPercent);
    const t = section.offset;
    const [cx, , cz] = frame.origin;
    const closedEnd = cz - L / 2 - c;
    const up = (distance: number): KernelVec3 => [0, 0, distance];

    it('puts the tongue on part 1 and the groove in part 2, in closed, connected solids', () => {
      expect(details.issues).toEqual([]);
      expect(model.solids).toHaveLength(2);
      for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
      expect(yRange(a.mesh).max).toBeCloseTo(t + h, 3);
      expect(yRange(b.mesh).min).toBeCloseTo(t, 3);
      withScope((track) => {
        for (const solid of [a, b]) {
          const pieces = manifoldOf(track, solid.mesh).decompose();
          for (const piece of pieces) track(piece);
          expect(pieces).toHaveLength(1);
        }
      });
    });

    it('opens the groove upwards and closes it by a stop below the seated tongue', () => {
      withScope((track) => {
        const partB = manifoldOf(track, b.mesh);
        const inGroove = (z: number): Vec3 => [cx + section.lean * 0, t + h / 2, z];
        // Empty beside the seated tongue and from there upwards, as far as the channel stays in the section.
        expect(hasMaterialAt(track, partB, inGroove(cz))).toBe(false);
        expect(hasMaterialAt(track, partB, inGroove(cz + L / 2 + 0.2))).toBe(false);
        expect(hasMaterialAt(track, partB, inGroove(closedEnd + 0.1))).toBe(false);
        // Material below the closed end: the stop.
        expect(hasMaterialAt(track, partB, inGroove(closedEnd - 0.2))).toBe(true);
        expect(closedEnd).toBeGreaterThanOrEqual(WALL - 1e-9);
      });
    });

    it('lets part 1 rise straight up and out, with nothing in the way over the whole path', () => {
      withScope((track) => {
        const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
        for (let step = 1; step <= 12; step += 1) {
          const moved = track(partA.translate(up((step / 12) * exitDistance)));
          expect(volumeOf(track, moved.intersect(partB))).toBeLessThan(VOLUME_TOLERANCE);
        }
        // At the end of the path the tongue has left part 2 entirely, by the margin too.
        expect(cz - L / 2 + exitDistance).toBeGreaterThan(section.height);
      });
    });

    it('stops part 1 going down past the seated position, and holds it along the normal', () => {
      withScope((track) => {
        const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
        // Within the clearance it moves freely, at the stop it does not.
        expect(volumeOf(track, track(partA.translate(up(-(c - 0.02)))).intersect(partB))).toBeLessThan(VOLUME_TOLERANCE);
        expect(volumeOf(track, track(partA.translate(up(-(c + 0.05)))).intersect(partB))).toBeGreaterThan(VOLUME_TOLERANCE);
        // Pulled along −n the head meets the groove's neck, once the clearance is taken up.
        const pulled = (distance: number) => track(partA.translate([0, -distance, 0])).intersect(partB);
        expect(volumeOf(track, pulled(normalPlay - 0.02))).toBeLessThan(VOLUME_TOLERANCE);
        expect(volumeOf(track, pulled(normalPlay + 0.05))).toBeGreaterThan(VOLUME_TOLERANCE);
      });
    });

    it('keeps the wall around the engaged groove from the actual surface', () => {
      const whole = generateModel(kernel, { shape, scale }).solids[0]?.mesh as TriangleMesh;
      const { grooveProfile } = details;
      // Over the engaged length, from the tongue's top to the stop, the part of the profile that lies in part 2.
      const corners = grooveProfile.filter(([, n]) => n >= 0).map(([across]) => across);
      const points: Vec3[] = [cz + L / 2, closedEnd].flatMap((z) =>
        corners.map(
          (across, index): Vec3 => [cx + across, t + (grooveProfile.filter(([, n]) => n >= 0)[index]?.[1] as number), z],
        ),
      );
      expect(distanceToSurface(points, whole)).toBeGreaterThanOrEqual(WALL - 1e-3);
    });
  });

  it('opens through the upper base of a right cylinder, across the channel’s whole width', () => {
    const smooth = parts(build(cylinder(2), 0)).b;
    const model = build(cylinder(2), 0, dovetail());
    const details = model.section?.connector as DovetailPlan;
    withScope((track) => {
      const partB = manifoldOf(track, parts(model).b.mesh);
      const atTop = (across: number): Vec3 => [across, details.height / 2, 80 - 0.1];
      expect(hasMaterialAt(track, partB, atTop(0))).toBe(false);
      expect(hasMaterialAt(track, partB, atTop(details.headWidth / 2 + 2))).toBe(true);
      // Without the connector that place is solid.
      expect(hasMaterialAt(track, manifoldOf(track, smooth.mesh), atTop(0))).toBe(true);
    });
  });

  it('refuses a tongue that the lean would carry through the side of the section, without tilting the slide', () => {
    // k = 2: over the 13,3 mm tongue's half length the section moves 13,3 mm sideways, past the groove's own width.
    const leaning = cylinder(2, 4);
    const refused = plan(leaning, 0);
    expect(refused.issues.map(({ code }) => code)).toContain('groove-wall-thin');
    expect(refused.frame.u).toEqual([-0, -0, -1]);
    expect(() => build(leaning, 0, dovetail())).toThrow(ConnectorUnsuitableError);
    // A short one stays clear of the side, and its channel leaves the section there, above the seated tongue.
    const short = dovetail({ sizeFactor: 0.75, lengthPercent: 15 });
    const details = plan(leaning, 0, short);
    expect(details.issues).toEqual([]);
    const model = build(leaning, 0, short);
    withScope((track) => {
      const [partA, partB] = [manifoldOf(track, parts(model).a.mesh), manifoldOf(track, parts(model).b.mesh)];
      for (let step = 1; step <= 12; step += 1) {
        const moved = track(partA.translate([0, 0, (step / 12) * details.exitDistance]));
        expect(volumeOf(track, moved.intersect(partB))).toBeLessThan(VOLUME_TOLERANCE);
      }
      expect(volumeOf(track, track(partA.translate([0, 0, -(details.clearance + 0.05)])).intersect(partB))).toBeGreaterThan(
        VOLUME_TOLERANCE,
      );
    });
  });

  it('refuses a stop without its wall, and a part too thin behind the tongue', () => {
    // H = 80 mm: L/2 + c ≤ 40 − 1,2 mm.
    const { height: H } = roundDimensionsMm(cylinder(2), scale);
    const maxLength = 2 * (H / 2 - WALL - 0.2);
    const longest = dovetail({ lengthPercent: (maxLength / H) * 100 });
    expect(plan(cylinder(2), 0, longest).issues).toEqual([]);
    const tooLong = dovetail({ lengthPercent: ((maxLength + 0.1) / H) * 100 });
    expect(plan(cylinder(2), 0, tooLong).issues.map(({ code }) => code)).toEqual(['stop-thin']);
    // r = 10 mm at 80 %: part 2 is 2 mm thick, too little behind a 2 mm tongue's groove.
    expect(plan(cylinder(8), 80).issues.map(({ code }) => code)).toContain('groove-wall-thin');
  });

  describe('bounds', () => {
    const shape = cylinder(2);
    const { inradius } = verticalCylinderSection(shape, scale, 0);
    const range = (key: DovetailParameter, connector = dovetail(), offsetPercent = 0, target = shape) =>
      dovetailFeasibility(target, scale, { offsetPercent }, connector).parameters[key].bounds;

    it('take the length up to the stop’s wall, from the straight working length', () => {
      expect(range('length').max).toBeCloseTo(80 - 2 * WALL - 2 * 0.2, 9);
      expect(range('length').min).toBeCloseTo(WALL + DOVETAIL_LEAD_IN_RELATIVE * 2, 9);
      // A flat cylinder has less height: the length follows it, not the diameter.
      expect(range('length', dovetail(), 0, cylinder(0.5)).max).toBeCloseTo(20 - 2 * WALL - 2 * 0.2, 9);
    });

    it('take the height up to the wall at the groove’s corners, and the clearance within its window', () => {
      // A right axial cut: (2,5·h + c·(1 + √2))² + (h + c)² ≤ (R − w)²; the closed end adds nothing without a lean.
      const { max } = range('height');
      const a = 2.5 * max + 0.2 * (1 + Math.SQRT2);
      expect(Math.hypot(a, max + 0.2)).toBeCloseTo(inradius - WALL, 6);
      expect(range('height').min).toBeCloseTo(1.2, 9);
      expect(range('clearance')).toEqual({ ...DOVETAIL_CLEARANCE_LIMITS, blocked: false });
    });

    const cases: readonly (readonly [string, CylinderShape, number, DovetailConnector])[] = [
      ['right, axial', cylinder(2), 0, dovetail()],
      ['right, displaced towards part 2', cylinder(2), 40, dovetail()],
      ['right, displaced towards part 1', cylinder(2), -40, dovetail()],
      ['oblique', cylinder(2, 1), 0, dovetail()],
      ['oblique, displaced', cylinder(2, 1), -30, dovetail({ lengthPercent: 30 })],
      ['flat', cylinder(0.5), 20, dovetail()],
    ];

    describe.each(cases)('of %s', (_, target, offsetPercent, connector) => {
      const section = verticalCylinderSection(target, scale, offsetPercent);
      const dimensions = dovetailDimensions(connector, M, section.span / 2);
      const { issues, parameters } = dovetailFeasibility(target, scale, { offsetPercent }, connector);
      const entries = Object.entries(parameters) as [DovetailParameter, { bounds: ParameterBounds }][];
      const probe = (key: DovetailParameter, value: number) => dovetailChecks(section, { ...dimensions, [key]: value });

      it('are tight', () => {
        expect(issues).toEqual([]);
        for (const [key, { bounds: limits }] of entries) {
          expect(hasFeasibleValues(limits)).toBe(true);
          for (const fraction of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
            const value = limits.min + fraction * (limits.max - limits.min);
            expect(probe(key, value).every(satisfies)).toBe(true);
          }
          const window = key === 'clearance' ? DOVETAIL_CLEARANCE_LIMITS : undefined;
          if (window === undefined || limits.min > window.min) expect(probe(key, limits.min - 1e-6).every(satisfies)).toBe(false);
          if (window === undefined || limits.max < window.max) expect(probe(key, limits.max + 1e-6).every(satisfies)).toBe(false);
        }
      });

      it('build at their ends and pass the 3D checks', () => {
        const { height, length } = parameters;
        for (const changed of [
          { sizeFactor: (height.bounds.max - 1e-6) / (0.025 * M) },
          { lengthPercent: ((length.bounds.max - 1e-6) / section.span) * 100 },
          { lengthPercent: ((length.bounds.min + 1e-6) / section.span) * 100 },
        ]) {
          expect(() => build(target, offsetPercent, { ...connector, ...changed })).not.toThrow();
        }
      });
    });

    it('find an interior interval when both ends of the search fail', () => {
      // Near the side of part 1 the head moves towards the axis as it grows, so a taller tongue can fit where a low one
      // does not, as long as its neck stays clear; the bounds then have both a lower and an upper end.
      const section = verticalCylinderSection(cylinder(2), scale, -80);
      const dimensions = dovetailDimensions(dovetail(), M, section.span / 2);
      const { bounds: limits } = dovetailFeasibility(cylinder(2), scale, { offsetPercent: -80 }, dovetail()).parameters.height;
      expect(hasFeasibleValues(limits)).toBe(true);
      for (const value of [limits.min, (limits.min + limits.max) / 2, limits.max]) {
        expect(dovetailChecks(section, { ...dimensions, height: value }).every(satisfies)).toBe(true);
      }
    });
  });
});

describe('an invalid vertical cut refuses to build before any geometry is made', () => {
  it('for the offset or the connector, without shrinking or moving anything', () => {
    const cylinderBuild = vi.spyOn(kernel.Manifold, 'cylinder');
    expect(() => build(cylinder(2), 90)).toThrow(InvalidModelSpecError);
    expect(() => build(cylinder(8), 79, plug(1, { depthFactor: 3 }))).toThrow(ConnectorUnsuitableError);
    expect(cylinderBuild).not.toHaveBeenCalled();
    cylinderBuild.mockRestore();
  });
});
