import type {
  Connector,
  CylinderShape,
  DovetailConnector,
  DowelConnector,
  PlugConnector,
  RoundConnector,
} from '@diploma-3d/schema';
import { DEFAULT_DOVETAIL, DIAMETRAL_CLEARANCE_LIMITS, modelSpecSchema } from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts, previewSeparation } from '../artifacts.ts';
import { ConnectorUnsuitableError, InvalidModelSpecError } from '../errors.ts';
import { toGltfPosition } from '../export/glb.ts';
import { readThreeMf } from '../export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  cross,
  dot,
  findMeshDefects,
  measureMesh,
  subtract,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
  vertexCount,
} from '../mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import { roundDimensionsMm } from '../shapes/round.ts';
import { hasFeasibleValues } from './bounds.ts';
import {
  type DovetailIssue,
  type DovetailPlan,
  dovetailChecks,
  dovetailDimensions,
  dovetailFeasibility,
  planDovetail,
} from './dovetail.ts';
import {
  facesOfPart,
  type ObliqueCut,
  obliqueAxes,
  obliqueCylinderSection,
  obliquePlaneContainsAxis,
  satisfies,
} from './frame.ts';
import {
  planRoundConnectors,
  ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorIssue,
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
const COPLANAR_NOISE_MM3 = 0.02;
const Z: Vec3 = [0, 0, 1];

const cylinder = (heightRatio: number, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const cutOf = (positionPercent = 50, inclinationDeg = 45, directionDeg = 0): ObliqueCut => ({
  positionPercent,
  inclinationDeg,
  directionDeg,
});
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

const specOf = (shape: CylinderShape, cut: ObliqueCut, connector?: Connector, longestDimensionMm = M) => ({
  shape,
  scale: { longestDimensionMm },
  section: { type: 'oblique', ...cut, ...(connector === undefined ? {} : { connector }) } as const,
});
const build = (shape: CylinderShape, cut: ObliqueCut, connector?: Connector, longestDimensionMm = M): GeneratedModel =>
  generateModel(kernel, specOf(shape, cut, connector, longestDimensionMm));

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const add = (a: Vec3, b: Vec3, factor = 1): Vec3 => [a[0] + factor * b[0], a[1] + factor * b[1], a[2] + factor * b[2]];
const scaled = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];

/** Whether a small cube at the point lies in the solid's material. */
const hasMaterialAt = (track: Track, solid: Manifold, point: Vec3, side = 0.1): boolean =>
  track(
    solid.intersect(track(track(kernel.Manifold.cube([side, side, side], true)).translate([...point] as KernelVec3))),
  ).volume() >
  0.9 * side ** 3;

const partsOf = (model: GeneratedModel) => {
  const [a, b, ...pins] = model.solids as [Solid, Solid, ...Solid[]];
  expect([a.part, b.part]).toEqual(['part-1', 'part-2']);
  return { a, b, pins };
};

/** The area vector is the edges' cross product, twice as long as the triangle's area. */
const triangleArea = (mesh: TriangleMesh, triangle: number) => Math.hypot(...triangleAreaVector(mesh, triangle)) / 2;

/** The triangles of the flat cut face of a part without a connector: its area, area centroid and corners. */
function capOf({ mesh, newFaces }: Solid) {
  let area = 0;
  let centroid: Vec3 = [0, 0, 0];
  const corners: Vec3[] = [];
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    if (newFaces?.[triangle] !== 1) continue;
    const [a, b, c] = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex)) as [Vec3, Vec3, Vec3];
    const size = triangleArea(mesh, triangle);
    area += size;
    centroid = add(centroid, scaled(add(add(a, b), c), size / 3));
    corners.push(a, b, c);
  }
  return { area, centroid: scaled(centroid, 1 / area), corners };
}

const SHAPES: readonly (readonly [string, CylinderShape])[] = [
  ['a right cylinder', cylinder(2)],
  ['a slim right cylinder', cylinder(4)],
  ['a flat right cylinder', cylinder(0.5)],
  ['an oblique cylinder', cylinder(2, 1)],
  ['a strongly leaning cylinder', cylinder(2, 2)],
  ['a tall oblique cylinder', cylinder(4, 2)],
];
const CUTS: readonly ObliqueCut[] = [
  cutOf(),
  cutOf(50, 5, 0),
  cutOf(50, 85, 0),
  cutOf(50, 45, 90),
  cutOf(50, 45, 180),
  cutOf(20, 30, 37),
  cutOf(80, 60, 200),
  cutOf(10, 70, 315),
  cutOf(90, 15, 275),
];

describe('the oblique plane', () => {
  it.each(CUTS)('passes through P with a unit normal at the angle to the base: %j', (cut) => {
    for (const [, shape] of SHAPES) {
      const { height: H, offset: d } = roundDimensionsMm(shape, scale);
      const { plane, axisPoint, frame } = obliqueCylinderSection(shape, scale, cut);
      const t = cut.positionPercent / 100;
      // P follows the actual axis, also of a leaning cylinder, at t·H above the lower base.
      expect(axisPoint[0]).toBeCloseTo(t * d, 10);
      expect(axisPoint[1]).toBe(0);
      expect(axisPoint[2]).toBeCloseTo(t * H, 10);
      expect(dot(plane.normal, axisPoint)).toBeCloseTo(plane.offset, 10);
      expect(Math.hypot(...plane.normal)).toBeCloseTo(1, 12);
      expect((Math.acos(dot(plane.normal, Z)) * 180) / Math.PI).toBeCloseTo(cut.inclinationDeg, 9);
      expect(frame.n).toEqual(plane.normal);
    }
  });

  it.each(CUTS)('has the frame the specification defines: %j', ({ inclinationDeg, directionDeg }) => {
    const { n, u, v } = obliqueAxes(inclinationDeg, directionDeg);
    const zAlongN = dot(Z, n);
    const direct = subtract(Z, scaled(n, zAlongN));
    const expectedU = scaled(direct, 1 / Math.hypot(...direct));
    u.forEach((value, axis) => {
      expect(value).toBeCloseTo(expectedU[axis] as number, 12);
    });
    cross(u, n).forEach((value, axis) => {
      expect(value).toBeCloseTo(v[axis] as number, 12);
    });
    // (v, u, n) is right-handed, u climbs, and v is level.
    expect(dot(v, cross(u, n))).toBeCloseTo(1, 12);
    expect(u[2]).toBeGreaterThan(0);
    expect(v[2]).toBe(0);
    expect(dot(u, n)).toBeCloseTo(0, 12);
  });

  it('rises along the direction, measured from +X towards +Y, independently of the camera', () => {
    const rise = (directionDeg: number) => obliqueAxes(30, directionDeg).u;
    expect(rise(0)[0]).toBeGreaterThan(0);
    expect(rise(0)[1]).toBeCloseTo(0, 12);
    expect(rise(90)[0]).toBeCloseTo(0, 12);
    expect(rise(90)[1]).toBeGreaterThan(0);
    expect(rise(180)[0]).toBeLessThan(0);
    expect(rise(270)[1]).toBeLessThan(0);
    // The right cylinder's equivalent equation, z − P.z = tan α·(cos φ·(x − P.x) + sin φ·(y − P.y)), holds on the plane.
    const { plane, axisPoint, contour } = obliqueCylinderSection(cylinder(2), scale, cutOf(40, 30, 60));
    expect(plane.normal[2]).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    const tangent = Math.tan(Math.PI / 6);
    for (const [x, y, z] of contour) {
      const rising = Math.cos(Math.PI / 3) * (x - axisPoint[0]) + Math.sin(Math.PI / 3) * (y - axisPoint[1]);
      expect(z - axisPoint[2]).toBeCloseTo(tangent * rising, 9);
    }
  });

  it('turns the plane with the direction, not the cylinder', () => {
    const uncut = generateModel(kernel, { shape: cylinder(2, 1), scale }).solids[0] as Solid;
    for (const directionDeg of [0, 90, 215]) {
      const model = build(cylinder(2, 1), cutOf(50, 45, directionDeg));
      expect(model.size[0]).toBeCloseTo(uncut.measurements.size[0], 3);
      expect(model.size[1]).toBeCloseTo(uncut.measurements.size[1], 3);
      expect(model.size[2]).toBeCloseTo(uncut.measurements.size[2], 3);
      expect(model.bounds.min[0]).toBeCloseTo(uncut.measurements.bounds.min[0], 3);
      expect(model.solids.reduce((sum, solid) => sum + solid.measurements.volume, 0)).toBeCloseTo(uncut.measurements.volume, 0);
    }
  });

  it('treats 0° and 360° as one direction, down to the meshes', () => {
    const [start, end] = [build(cylinder(2), cutOf(50, 45, 0)), build(cylinder(2), cutOf(50, 45, 360))];
    expect(end.section?.plane).toEqual(start.section?.plane);
    (start.solids as Solid[]).forEach((solid, index) => {
      expect((end.solids[index] as Solid).mesh.positions).toEqual(solid.mesh.positions);
    });
  });

  it('keeps the same relative plane under uniform scaling', () => {
    const cut = cutOf(35, 55, 120);
    for (const [, shape] of SHAPES) {
      const [small, large] = [{ longestDimensionMm: 80 }, { longestDimensionMm: 200 }].map((size) =>
        obliqueCylinderSection(shape, size, cut),
      ) as [ReturnType<typeof obliqueCylinderSection>, ReturnType<typeof obliqueCylinderSection>];
      expect(large.plane.normal).toEqual(small.plane.normal);
      expect(large.plane.offset).toBeCloseTo(small.plane.offset * 2.5, 9);
      expect(large.axisPoint[2]).toBeCloseTo(small.axisPoint[2] * 2.5, 9);
    }
  });

  it('contains the whole axis of a suitably leaning cylinder, without dividing by n·a', () => {
    // a = (d, 0, H) with d = H and a plane at 45° rising along +X.
    const shape = cylinder(2, 2);
    expect(obliquePlaneContainsAxis(shape, 45, 0)).toBe(true);
    expect(obliquePlaneContainsAxis(shape, 45, 360)).toBe(true);
    expect(obliquePlaneContainsAxis(shape, 45, 180)).toBe(false);
    expect(obliquePlaneContainsAxis(shape, 50, 0)).toBe(false);
    expect(obliquePlaneContainsAxis(cylinder(2), 85, 0)).toBe(false);
    const [low, high] = [obliqueCylinderSection(shape, scale, cutOf(10)), obliqueCylinderSection(shape, scale, cutOf(90))];
    expect(low.containsAxis).toBe(true);
    expect(low.plane.offset).toBeCloseTo(0, 10);
    expect(high.plane.offset).toBeCloseTo(0, 10);
    // The point differs along the axis, the plane and its section do not.
    expect(high.axisPoint[2]).not.toBeCloseTo(low.axisPoint[2], 3);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(high.frame.origin[axis]).toBeCloseTo(low.frame.origin[axis] as number, 9);
    }
    expect(high.area).toBeCloseTo(low.area, 9);
    const { a, b } = partsOf(build(shape, cutOf(10)));
    expect(findMeshDefects(a.mesh)).toEqual([]);
    expect(findMeshDefects(b.mesh)).toEqual([]);
    // Each part is half the cylinder.
    expect(a.measurements.volume).toBeCloseTo(b.measurements.volume, -1);
  });
});

describe('the actual section', () => {
  it('of the right cylinder R = 20 mm, H = 80 mm at t = 0,5 and 45° is the ellipse with semi-axes 20 and 28,284 mm', () => {
    const shape = cylinder(4);
    const { radius, height } = roundDimensionsMm(shape, scale);
    expect([radius, height]).toEqual([20, 80]);
    const { a, b } = partsOf(build(shape, cutOf(50, 45, 0)));
    const { n, u, v } = obliqueAxes(45, 0);
    const P: Vec3 = [0, 0, 40];
    // The polygon's sides deviate from the circle by at most 0,05 mm, stretched by 1/cos α along u.
    const tolerance = 0.05 * Math.SQRT2 + 1e-3;
    for (const part of [a, b]) {
      const { corners, area } = capOf(part);
      const relative = corners.map((corner) => subtract(corner, P));
      for (const corner of relative) expect(Math.abs(dot(corner, n))).toBeLessThan(1e-3);
      const alongU = relative.map((corner) => dot(corner, u));
      const alongV = relative.map((corner) => dot(corner, v));
      expect(Math.max(...alongU)).toBeCloseTo(28.284, 2);
      expect(Math.min(...alongU)).toBeCloseTo(-28.284, 2);
      expect(Math.abs(Math.max(...alongV) - 20)).toBeLessThan(tolerance);
      expect(Math.abs(Math.min(...alongV) + 20)).toBeLessThan(tolerance);
      expect(area).toBeCloseTo(Math.PI * 20 * 28.284, -1);
      // Unclipped: both ends of the ellipse clear the bases, R·tan α < min(t, 1 − t)·H.
      for (const [, , z] of corners) {
        expect(z).toBeGreaterThan(19.9);
        expect(z).toBeLessThan(60.1);
      }
    }
  });

  it.each(SHAPES.flatMap(([name, shape]) => CUTS.map((cut) => [name, shape, cut] as const)))(
    'of %s matches the mesh in area and centroid: %j',
    (_, shape, cut) => {
      const { contour, area, frame, span } = obliqueCylinderSection(shape, scale, cut);
      const { a, b } = partsOf(build(shape, cut));
      for (const part of [a, b]) {
        const cap = capOf(part);
        expect(cap.area).toBeCloseTo(area, 1);
        for (let axis = 0; axis < 3; axis += 1) expect(cap.centroid[axis]).toBeCloseTo(frame.origin[axis] as number, 2);
        const alongU = cap.corners.map((corner) => dot(corner, frame.u));
        expect(Math.max(...alongU) - Math.min(...alongU)).toBeCloseTo(span, 2);
      }
      expect(contour.length).toBeGreaterThanOrEqual(3);
    },
  );

  it('may meet one base, both bases or neither, and is not a complete ellipse then', () => {
    const levels = (cut: ObliqueCut, shape = cylinder(2)) => {
      const zs = obliqueCylinderSection(shape, scale, cut).contour.map(([, , z]) => z);
      return { atLower: zs.filter((z) => Math.abs(z) < 1e-6).length, atUpper: zs.filter((z) => Math.abs(z - 80) < 1e-6).length };
    };
    // r = 40 mm, H = 80 mm: R·tan α against t·H and (1 − t)·H.
    expect(levels(cutOf(50, 30))).toEqual({ atLower: 0, atUpper: 0 });
    // A base contributes one straight chord: two corners at its level.
    expect(levels(cutOf(25, 45))).toEqual({ atLower: 2, atUpper: 0 });
    expect(levels(cutOf(50, 75))).toEqual({ atLower: 2, atUpper: 2 });
  });

  it('has its area centroid, neither P nor the average of the corners, when a base clips it', () => {
    const { frame, axisPoint, contour } = obliqueCylinderSection(cylinder(2), scale, cutOf(25, 45, 90));
    const average = scaled(
      contour.reduce<Vec3>((sum, corner) => add(sum, corner), [0, 0, 0]),
      1 / contour.length,
    );
    expect(Math.hypot(...subtract(frame.origin, axisPoint))).toBeGreaterThan(1);
    expect(Math.hypot(...subtract(frame.origin, average))).toBeGreaterThan(0.5);
    // The chord of the base and the rest of the contour are spaced unevenly: the mesh agrees with the area centroid.
    const cap = capOf(partsOf(build(cylinder(2), cutOf(25, 45, 90))).a);
    expect(Math.hypot(...subtract(cap.centroid, frame.origin))).toBeLessThan(0.01);
  });

  it('lists its corners counter-clockwise seen along −n, on the plane', () => {
    const { contour, plane, frame } = obliqueCylinderSection(cylinder(2, 1), scale, cutOf(30, 40, 70));
    contour.forEach((corner, index) => {
      expect(dot(plane.normal, corner)).toBeCloseTo(plane.offset, 9);
      const next = contour[(index + 1) % contour.length] as Vec3;
      const after = contour[(index + 2) % contour.length] as Vec3;
      expect(dot(cross(subtract(next, corner), subtract(after, next)), frame.n)).toBeGreaterThan(0);
    });
  });
});

describe.each(SHAPES)('the parts of %s', (_, shape) => {
  it.each(CUTS)('are closed, connected and fill the solid exactly: %j', (cut) => {
    const whole = generateModel(kernel, { shape, scale }).solids[0] as Solid;
    const model = build(shape, cut);
    const { a, b } = partsOf(model);
    const { normal, offset } = (model.section as ModelSection).plane;
    for (const part of [a, b]) {
      expect(findMeshDefects(part.mesh)).toEqual([]);
      expect(part.measurements.volume).toBeGreaterThan(0);
      withScope((track) => {
        const pieces = manifoldOf(track, part.mesh).decompose();
        for (const piece of pieces) track(piece);
        expect(pieces).toHaveLength(1);
      });
    }
    // Part A on the negative side, part B on the positive side.
    for (let vertex = 0; vertex < vertexCount(a.mesh); vertex += 1) {
      expect(dot(normal, vertexAt(a.mesh, vertex)) - offset).toBeLessThan(1e-3);
    }
    for (let vertex = 0; vertex < vertexCount(b.mesh); vertex += 1) {
      expect(dot(normal, vertexAt(b.mesh, vertex)) - offset).toBeGreaterThan(-1e-3);
    }
    expect(a.measurements.volume + b.measurements.volume).toBeCloseTo(whole.measurements.volume, 0);
    // The original tessellation stays: the parts' own surface adds up to the uncut solid's, and the scale is the same.
    const original = (solid: Solid) => {
      let area = 0;
      for (let triangle = 0; triangle < triangleCount(solid.mesh); triangle += 1) {
        if (solid.newFaces?.[triangle] !== 1) area += triangleArea(solid.mesh, triangle);
      }
      return area;
    };
    expect(original(a) + original(b)).toBeCloseTo(whole.measurements.surfaceArea, 0);
    expect(model.size[0]).toBeCloseTo(whole.measurements.size[0], 3);
    expect(model.size[2]).toBeCloseTo(whole.measurements.size[2], 3);
  });
});

describe('usable parts', () => {
  it('refuses a plane that leaves a part thinner than a wall, as a body that cannot be split', () => {
    // M = 2 mm: r = 1 mm, H = 2 mm; at 10 % and 45° the lower part reaches only 0,2·cos 45° + sin 45° ≈ 0,85 mm.
    const tiny = { shape: cylinder(2), cut: cutOf(10, 45, 0) };
    expect(() => build(tiny.shape, tiny.cut, undefined, 2)).toThrow(InvalidModelSpecError);
    // The same plane is fine at a larger size: only the physical wall decided.
    expect(() => build(tiny.shape, tiny.cut, undefined, 80)).not.toThrow();
  });

  it('tells a body it can split from a split that cannot take the connector', () => {
    expect(() => build(cylinder(2), cutOf(), plug(1, { diameterFactor: 40 }))).toThrow(ConnectorUnsuitableError);
    expect(() => build(cylinder(2), cutOf(), undefined)).not.toThrow();
  });

  it('accepts only the application’s ranges in the specification, with defaults', () => {
    const section = (values: object) =>
      modelSpecSchema.safeParse({ shape: cylinder(2), scale, section: { type: 'oblique', ...values } });
    expect(section({}).data?.section).toEqual({ type: 'oblique', positionPercent: 50, inclinationDeg: 45, directionDeg: 0 });
    for (const valid of [
      { inclinationDeg: 5 },
      { inclinationDeg: 85 },
      { directionDeg: 0 },
      { directionDeg: 360 },
      { positionPercent: 10 },
      { positionPercent: 90 },
    ]) {
      expect(section(valid).success).toBe(true);
    }
    for (const invalid of [
      { inclinationDeg: 4.9 },
      { inclinationDeg: 85.1 },
      { inclinationDeg: Number.NaN },
      { inclinationDeg: Number.POSITIVE_INFINITY },
      { directionDeg: -1 },
      { directionDeg: 360.1 },
      { positionPercent: 9.9 },
      { positionPercent: 90.1 },
      { offsetPercent: 0 },
    ]) {
      expect(section(invalid).success).toBe(false);
    }
  });
});

const ROUND_CASES: readonly (readonly [string, CylinderShape, ObliqueCut])[] = [
  ['the default plane', cylinder(2), cutOf()],
  ['a plane clipped by one base', cylinder(2), cutOf(25, 45, 90)],
  ['a plane clipped by both bases', cylinder(2), cutOf(50, 75, 30)],
  ['a leaning cylinder', cylinder(2, 1), cutOf(40, 35, 200)],
  ['a leaning cylinder whose upper base lies under the plane', cylinder(2, 2), cutOf(50, 70, 0)],
  ['the plane that contains the axis', cylinder(2, 2), cutOf(50, 45, 0)],
];

describe.each(ROUND_CASES)('round connectors on %s', (_, shape, cut) => {
  const section = obliqueCylinderSection(shape, scale, cut);

  it('stand on the area centroid along n, or symmetric along u in a keyed pair', () => {
    const one = planRoundConnectors(shape, scale, cut, plug(1));
    expect(one.frame.n).toEqual(section.plane.normal);
    expect(one.sites).toHaveLength(1);
    expect(one.sites[0]?.centre).toEqual(section.frame.origin);
    const two = planRoundConnectors(shape, scale, cut, dowel(2));
    const [first, second] = two.sites as [RoundConnectorPlan['sites'][number], RoundConnectorPlan['sites'][number]];
    expect(first.along).toBeCloseTo(-second.along, 12);
    expect(first.along).toBeCloseTo((0.45 * section.span) / 2, 9);
    expect(second.pinDiameter).toBeCloseTo(ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * first.pinDiameter, 12);
    const between = subtract(first.centre, second.centre);
    const expected = scaled(section.frame.u, 2 * first.along);
    for (let axis = 0; axis < 3; axis += 1) expect(between[axis]).toBeCloseTo(expected[axis] as number, 9);
  });

  it.each([
    ['one plug', plug(1)],
    ['a pair of plugs', plug(2)],
    ['one dowel', dowel(1)],
    ['a pair of dowels', dowel(2)],
  ] as const)('%s: solved bounds are exact, each end passes the same checks as the build', (__, connector) => {
    const { parameters, issues } = roundConnectorFeasibility(shape, scale, cut, connector);
    const dimensions = roundConnectorDimensions(connector, M, section.span / 2);
    const withValue: Record<RoundConnectorParameter, (value: number) => typeof dimensions> = {
      diameter: (diameter) => ({ ...dimensions, diameter }),
      insertion: (insertion) => ({ ...dimensions, insertion }),
      spacing: (spacing) => ({ ...dimensions, spacing }),
      upperClearance: (upper) => ({ ...dimensions, clearance: { ...dimensions.clearance, upper } }),
      lowerClearance: (lower) => ({ ...dimensions, clearance: { ...dimensions.clearance, lower } }),
    };
    const fails = (value: number, key: RoundConnectorParameter) =>
      roundConnectorChecks(section, withValue[key](value)).filter((check) => !satisfies(check));
    const currentCodes = new Set(issues.map(({ code }) => code));
    for (const [key, { bounds }] of Object.entries(parameters) as [RoundConnectorParameter, (typeof parameters)['diameter']][]) {
      if (!hasFeasibleValues(bounds)) continue;
      // Only what this dimension can repair counts: another's failure stays whatever this one is.
      const own = (value: number) => fails(value, key).filter((check) => !currentCodes.has(check.code));
      expect(own(bounds.min)).toEqual([]);
      expect(own(bounds.max)).toEqual([]);
      const windowEnd =
        key === 'upperClearance' || key === 'lowerClearance'
          ? DIAMETRAL_CLEARANCE_LIMITS.max
          : key === 'spacing'
            ? section.span / 2
            : Math.max(2 * section.radius, section.span, section.depthExtent);
      if (bounds.max < windowEnd - 1e-6) expect(fails(bounds.max + 1e-3, key).length).toBeGreaterThan(0);
    }
  });

  it('builds at the feasible ends of the diameter and the insertion, verified in three dimensions', () => {
    const connector = plug(1);
    const { parameters } = roundConnectorFeasibility(shape, scale, cut, connector);
    const { diameter, insertion } = parameters;
    expect(hasFeasibleValues(diameter.bounds)).toBe(true);
    const diameterFactor = diameter.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.diameter * M);
    expect(() => build(shape, cut, plug(1, { diameterFactor }))).not.toThrow();
    const depthFactor = insertion.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);
    expect(() => build(shape, cut, plug(1, { depthFactor }))).not.toThrow();
  });

  it.each([
    ['plugs', plug(2), 2],
    ['dowels', dowel(2), 4],
  ] as const)('%s make valid separate objects', (__, connector, objects) => {
    let model: GeneratedModel;
    try {
      model = build(shape, cut, connector);
    } catch (error) {
      // A plane may leave no room for this pair at this size; that is reported, not bent to fit.
      expect(error).toBeInstanceOf(ConnectorUnsuitableError);
      return;
    }
    expect(model.solids).toHaveLength(objects);
    for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
  });
});

describe('a round connector’s whole cavity', () => {
  // r = 40 mm, H = 80 mm, at 90 % and 15°: the mouth is far from the rim, but the part thins out behind it.
  const [shape, cut] = [cylinder(2), cutOf(90, 15, 0)] as const;
  const section = obliqueCylinderSection(shape, scale, cut);

  it('is checked behind the mouth: a hole that fits at the cut may still pierce the far base', () => {
    const { issues } = planRoundConnectors(shape, scale, cut, plug(2));
    const codes = issues.map(({ code }) => code);
    expect(codes).toContain('hole-bottom-thin');
    expect(codes).not.toContain('hole-wall-thin');
    expect(() => build(shape, cut, plug(2))).toThrow(ConnectorUnsuitableError);
  });

  it('keeps the minimum wall to the actual surface at the depth bound', () => {
    const connector = plug(2);
    const { insertion } = roundConnectorFeasibility(shape, scale, cut, connector).parameters;
    const dimensions = roundConnectorDimensions(connector, M, section.span / 2);
    const depth = insertion.bounds.max + ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM;
    const sites = planRoundConnectors(
      shape,
      scale,
      cut,
      plug(2, { depthFactor: insertion.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.insertion * M) }),
    ).sites;
    // The holes' bottoms as true circles: their least distance to the part's faces, without the cut face.
    const faces = facesOfPart(section, 'positive');
    const distance = Math.min(
      ...sites.flatMap((site) =>
        Array.from({ length: 180 }, (_, index) => {
          const angle = (2 * Math.PI * index) / 180;
          const radius = (site.pinDiameter + dimensions.clearance.upper) / 2;
          return faces.map(
            (face) =>
              face.clearance -
              (site.along + radius * Math.sin(angle)) * face.alongU -
              radius * Math.cos(angle) * face.alongV -
              depth * face.alongN,
          );
        }).flat(),
      ),
    );
    expect(distance).toBeGreaterThanOrEqual(WALL - 1e-3);
    expect(distance).toBeLessThan(WALL + 0.01);
  });

  it('counts only the faces that bound the part: a plane close to a base it never reaches leaves that part alone', () => {
    // t·H = 16 mm against R·tan α = 40·tan 20° ≈ 14,6 mm: the lower base stays below the whole plane, in part 1 alone.
    const near = obliqueCylinderSection(cylinder(2), scale, cutOf(20, 20, 0));
    expect(near.contour.every(([, , z]) => z > 1)).toBe(true);
    const lowerBase = near.faces[0];
    expect(lowerBase?.boundsNegative).toBe(true);
    expect(lowerBase?.boundsPositive).toBe(false);
    const upperBase = near.faces[1];
    expect(upperBase?.boundsNegative).toBe(false);
    expect(upperBase?.boundsPositive).toBe(true);
    // Clipped at the lower base, that base bounds both parts.
    const clipped = obliqueCylinderSection(cylinder(2), scale, cutOf(10, 60, 0));
    expect(clipped.faces[0]?.boundsNegative).toBe(true);
    expect(clipped.faces[0]?.boundsPositive).toBe(true);
  });
});

const DOVETAIL_CASES: readonly (readonly [string, CylinderShape, ObliqueCut])[] = [
  ['the default plane', cylinder(2), cutOf()],
  ['a turned plane', cylinder(2), cutOf(50, 45, 130)],
  ['a plane clipped by both bases', cylinder(2), cutOf(50, 75, 30)],
  ['a flat plane', cylinder(2), cutOf(50, 10, 250)],
  ['a leaning cylinder', cylinder(2, 1), cutOf(40, 35, 200)],
  ['the plane that contains the axis', cylinder(2, 2), cutOf(50, 45, 0)],
];

describe.each(DOVETAIL_CASES)('a dovetail on %s', (_, shape, cut) => {
  const section = obliqueCylinderSection(shape, scale, cut);
  const connector = dovetail({ lengthPercent: 35 });
  const model = build(shape, cut, connector);
  const plan = (model.section as ModelSection).connector as DovetailPlan;
  const { a, b } = partsOf(model);
  const uphill = section.frame.u;
  const { n } = section.frame;
  const centre = section.frame.origin;

  it('slides along the plane: the frame’s u points downhill, towards the stop', () => {
    expect(plan.frame.u).toEqual(scaled(uphill, -1));
    expect(plan.frame.n).toEqual(n);
    expect(plan.frame.origin).toEqual(centre);
    expect(plan.frame.u[2]).toBeLessThan(0);
    // Still right-handed with the turned axes.
    expect(dot(plan.frame.v, cross(plan.frame.u, plan.frame.n))).toBeCloseTo(1, 12);
  });

  it('has the tongue on part 1 and the groove in part 2, with the stop downhill and the entrance uphill', () => {
    withScope((track) => {
      const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
      const inTongue = add(centre, n, plan.height / 2);
      expect(hasMaterialAt(track, partA, inTongue)).toBe(true);
      expect(hasMaterialAt(track, partB, inTongue)).toBe(false);
      const beyond = plan.length / 2 + plan.clearance;
      // Past the closed end, downhill, part 2 is solid at the groove's mid-height.
      expect(hasMaterialAt(track, partB, add(inTongue, uphill, -(beyond + 0.3)))).toBe(true);
      // Uphill of the tongue, the channel is open all the way to where part 2 ends.
      const reach = section.uphillReachWithin(plan.height + plan.clearance);
      for (const share of [0.25, 0.5, 0.75, 0.95]) {
        const along = plan.length / 2 + share * (reach - plan.length / 2);
        expect(hasMaterialAt(track, partB, add(inTongue, uphill, along))).toBe(false);
      }
    });
  });

  it('comes off uphill along the whole path, and neither downhill nor along the normal', () => {
    withScope((track) => {
      const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
      const overlapAfter = (move: Vec3) => track(track(partA.translate([...move] as KernelVec3)).intersect(partB)).volume();
      // The cut faces stay coplanar along the way, so float32 noise of about 1e-6 mm over their area shows as overlap.
      for (const share of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        expect(overlapAfter(scaled(uphill, share * plan.exitDistance))).toBeLessThan(COPLANAR_NOISE_MM3);
      }
      // Downhill, the stop meets the tongue once the clearance is used up.
      expect(overlapAfter(scaled(uphill, -(plan.clearance + 0.1)))).toBeGreaterThan(VOLUME_TOLERANCE);
      // Along the normal, the undercut retains.
      expect(overlapAfter(scaled(n, plan.normalPlay + 0.1))).toBeGreaterThan(VOLUME_TOLERANCE);
      // At the end of the path the tongue is entirely beyond part 2.
      const out = track(partA.translate([...scaled(uphill, plan.exitDistance)] as KernelVec3));
      const inTongue = add(add(centre, n, plan.height / 2), uphill, plan.exitDistance);
      expect(hasMaterialAt(track, out, inTongue)).toBe(true);
      expect(hasMaterialAt(track, partB, inTongue)).toBe(false);
    });
  });

  it('keeps the groove’s full width in its length bounds, and refuses rather than reverses what does not fit', () => {
    const { length } = dovetailFeasibility(shape, scale, cut, connector).parameters;
    expect(hasFeasibleValues(length.bounds)).toBe(true);
    const dimensions = dovetailDimensions(connector, M, section.span / 2);
    const failing = (value: number): DovetailIssue[] =>
      dovetailChecks(section, { ...dimensions, length: value }).filter((check) => !satisfies(check));
    expect(failing(length.bounds.max)).toEqual([]);
    expect(failing(length.bounds.min)).toEqual([]);
    expect(failing(length.bounds.max + 1e-3).length).toBeGreaterThan(0);
    expect(failing(length.bounds.min - 1e-3).length).toBeGreaterThan(0);
    // A wider tongue, with its wider groove, leaves less room along the plane.
    const wider = dovetailFeasibility(shape, scale, cut, dovetail({ lengthPercent: 35, sizeFactor: 2 })).parameters.length;
    expect(wider.bounds.max).toBeLessThan(length.bounds.max);
    const lengthPercent = (100 * length.bounds.max) / section.span;
    const atEnd = build(shape, cut, dovetail({ lengthPercent }));
    expect(((atEnd.section as ModelSection).connector as DovetailPlan).frame.u).toEqual(scaled(uphill, -1));
    expect(() => build(shape, cut, dovetail({ lengthPercent: lengthPercent + 1 }))).toThrow(ConnectorUnsuitableError);
  });

  it('builds with every solved end of the height and the clearance', () => {
    const { height, clearance } = dovetailFeasibility(shape, scale, cut, connector).parameters;
    const factor = (millimetres: number) => millimetres / (0.025 * M);
    expect(() => build(shape, cut, dovetail({ lengthPercent: 35, sizeFactor: factor(height.bounds.max) }))).not.toThrow();
    expect(() => build(shape, cut, dovetail({ lengthPercent: 35, sizeFactor: factor(height.bounds.min) }))).not.toThrow();
    expect(() => build(shape, cut, dovetail({ lengthPercent: 35, clearanceMm: clearance.bounds.max }))).not.toThrow();
  });
});

describe('whatever the plane', () => {
  it('builds the default dovetail where a convex hull used to lose the groove’s middle', () => {
    // At 60° the hull of the sweep's positions dropped part of the groove, and the tongue met its wall.
    const model = build(cylinder(2), cutOf(50, 45, 60), dovetail());
    const plan = (model.section as ModelSection).connector as DovetailPlan;
    withScope((track) => {
      const { a, b } = partsOf(model);
      const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
      expect(track(partA.intersect(partB)).volume()).toBeLessThan(COPLANAR_NOISE_MM3);
      const inTongue = add(plan.frame.origin, plan.frame.n, plan.height / 2);
      // All along the tongue the groove is open.
      for (const along of [-0.45, -0.25, 0, 0.25, 0.45]) {
        expect(hasMaterialAt(track, partB, add(inTongue, plan.frame.u, along * plan.length))).toBe(false);
      }
    });
  });

  it('builds or refuses each of a seeded sample of planes and connectors, and never fails its three-dimensional checks', () => {
    let seed = 20261108;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <Value>(values: readonly Value[]) => values[Math.floor(random() * values.length)] as Value;
    const outcomes = { built: 0, refused: 0 };
    for (let sample = 0; sample < 120; sample += 1) {
      const heightRatio = pick([0.5, 1, 2, 3, 4, 8]);
      const offsetRatio = pick([0, 0, 0.5, 1, 1.5]);
      const cut = cutOf(10 + 80 * random(), 5 + 80 * random(), 360 * random());
      const connector = pick<Connector | undefined>([
        undefined,
        dovetail(),
        dovetail({ lengthPercent: 25 }),
        plug(1),
        plug(2),
        dowel(1),
        dowel(2),
      ]);
      try {
        const { solids } = build(cylinder(heightRatio, offsetRatio), cut, connector, pick([40, 80, 120]));
        for (const solid of solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
        outcomes.built += 1;
      } catch (error) {
        // Only a planned refusal: an error of the checks after building would mean the plan missed something.
        expect(error).toBeInstanceOf(ConnectorUnsuitableError);
        outcomes.refused += 1;
      }
    }
    expect(outcomes.built).toBeGreaterThan(60);
    expect(outcomes.refused).toBeGreaterThan(0);
  }, 60_000);
});

describe('the dovetail’s stop', () => {
  it('is measured to the faces ahead of it: too long a tongue thins it out at the downhill end', () => {
    const shape = cylinder(2);
    const cut = cutOf(50, 75, 0);
    const { issues } = planDovetail(shape, scale, cut, dovetail({ lengthPercent: 99 }));
    expect(issues.map(({ code }) => code)).toContain('stop-thin');
  });
});

describe('the print file of an oblique section', () => {
  const objectsOf = async (shape: CylinderShape, cut: ObliqueCut, connector?: Connector, longest = M) => {
    const { printFile, model } = await buildModelArtifacts(kernel, specOf(shape, cut, connector, longest));
    return { objects: readThreeMf(printFile.bytes).model.objects, model, printFile };
  };

  const areaOnBed = (mesh: TriangleMesh) => {
    let area = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      const corners = triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));
      if (corners.every(([, , z]) => Math.abs(z) < 1e-3)) area += triangleArea(mesh, triangle);
    }
    return area;
  };

  it.each([
    ['flat faces', undefined, 2],
    ['a dovetail', dovetail({ lengthPercent: 35 }), 2],
    ['one plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['one dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
  ] as const)('with %s holds separate, closed objects on the bed, apart, at their own scale', async (_, connector, count) => {
    const { objects, model, printFile } = await objectsOf(cylinder(2), cutOf(), connector);
    expect(printFile.fileName).toBe('cylinder-oblique-section.3mf');
    expect(objects).toHaveLength(count);
    expect(objects.map(({ name }) => name)).toEqual(model.solids.map(({ name }) => name));
    objects.forEach(({ mesh }, index) => {
      expect(findMeshDefects(mesh)).toEqual([]);
      const measured = measureMesh(mesh);
      const original = (model.solids[index] as Solid).measurements;
      // Rotations and translations only: the scale stays.
      expect(measured.volume).toBeCloseTo(original.volume, 0);
      expect(measured.surfaceArea).toBeCloseTo(original.surfaceArea, 0);
      expect(measured.bounds.min[2]).toBeCloseTo(0, 4);
      if (index > 0) {
        const previous = measureMesh((objects[index - 1] as (typeof objects)[number]).mesh).bounds.max[0];
        expect(measured.bounds.min[0] - previous).toBeCloseTo(5, 3);
      }
    });
  });

  it('puts each part on the larger of the bases it kept, with the cut face up', async () => {
    const { objects } = await objectsOf(cylinder(2), cutOf(50, 30));
    const baseArea = Math.PI * 40 ** 2;
    const { n } = obliqueAxes(30, 0);
    for (const { mesh } of objects) expect(areaOnBed(mesh)).toBeCloseTo(baseArea, -2);
    // Part 2, turned: its upper base is down, so its height is the same and the cut, whose outward normal was −n, faces up.
    const [first, second] = objects as [(typeof objects)[number], (typeof objects)[number]];
    const heights = [first, second].map(({ mesh }) => measureMesh(mesh).size[2]);
    const cutFaceUp = (mesh: TriangleMesh) => {
      let along = 0;
      for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
        const area = triangleAreaVector(mesh, triangle);
        const size = Math.hypot(...area);
        // The cut is the only large face that leans by the plane's angle.
        if (Math.abs(Math.abs(area[2]) / size - n[2]) < 1e-3) along += area[2];
      }
      return along;
    };
    expect(cutFaceUp(first.mesh)).toBeGreaterThan(0);
    expect(cutFaceUp(second.mesh)).toBeGreaterThan(0);
    expect(heights[0]).toBeCloseTo(heights[1] as number, 3);
  });

  it('keeps a part on a clipped base when that is the larger one, as each part decides for itself', async () => {
    const { objects, model } = await objectsOf(cylinder(2), cutOf(30, 50));
    const { a, b } = partsOf(model);
    for (const { mesh } of objects) expect(areaOnBed(mesh)).toBeGreaterThan(0.45 * Math.PI * 40 ** 2);
    // t·H = 24 mm < R·tan 50° ≈ 47,7 mm < (1 − t)·H = 56 mm: part 1 keeps most of the lower base, part 2 the whole upper one.
    expect(areaOnBed(objects[0]?.mesh as TriangleMesh)).toBeLessThan(Math.PI * 40 ** 2);
    expect(areaOnBed(objects[1]?.mesh as TriangleMesh)).toBeCloseTo(Math.PI * 40 ** 2, -2);
    expect(a.measurements.volume).toBeLessThan(b.measurements.volume);
  });

  it('turns part 1 onto the upper base when the plane climbs past a leaning axis', async () => {
    // n·a < 0: the upper base's centre lies under the plane, in part 1, and the lower base's in part 2.
    const shape = cylinder(2, 1);
    const cut = cutOf(50, 80, 0);
    const { plane, faces } = obliqueCylinderSection(shape, scale, cut);
    const { height, offset } = roundDimensionsMm(shape, scale);
    expect(dot(plane.normal, [offset, 0, height])).toBeLessThan(0);
    expect(faces[1]?.boundsNegative).toBe(true);
    const { objects } = await objectsOf(shape, cut);
    for (const { mesh } of objects) {
      expect(findMeshDefects(mesh)).toEqual([]);
      expect(measureMesh(mesh).bounds.min[2]).toBeCloseTo(0, 4);
    }
  });

  it('stands the dowels on an end face, along the plane’s normal whatever its direction', async () => {
    const { objects, model } = await objectsOf(cylinder(2), cutOf(50, 45, 60), dowel(2));
    const dowels = objects.slice(2);
    expect(dowels).toHaveLength(2);
    const lengths = model.solids.slice(2).map((solid) => {
      const { normal } = (model.section as ModelSection).plane;
      const along = Array.from({ length: vertexCount(solid.mesh) }, (_, vertex) => dot(normal, vertexAt(solid.mesh, vertex)));
      return Math.max(...along) - Math.min(...along);
    });
    dowels.forEach(({ mesh }, index) => {
      expect(measureMesh(mesh).size[2]).toBeCloseTo(lengths[index] as number, 3);
    });
  });
});

describe('the separated preview of an oblique section', () => {
  const nodeOffsets = async (glb: Uint8Array) => {
    const root = (await new WebIO().readBinary(glb)).getRoot();
    return Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()]));
  };

  it.each([
    ['flat faces', undefined],
    ['plugs', plug(1)],
    ['dowels', dowel(2)],
  ] as const)('moves part 2 along n with %s, and leaves the meshes and the print file alone', async (_, connector) => {
    const spec = specOf(cylinder(2), cutOf(50, 45, 60), connector);
    const artifacts = await buildModelArtifacts(kernel, spec);
    const { model } = artifacts;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const { normal } = (model.section as ModelSection).plane;
    const expected = toGltfPosition(scaled(normal, previewSeparation(model)));
    (offsets[(model.solids[1] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[0] as Solid).name]).toEqual([0, 0, 0]);
    for (const dowelSolid of model.solids.slice(2)) expect(offsets[dowelSolid.name]).toEqual([0, 0, 0]);
    const assembled = await nodeOffsets(artifacts.previewGlb);
    for (const solid of model.solids) expect(assembled[solid.name]).toEqual([0, 0, 0]);
    expect((await buildModelArtifacts(kernel, spec)).printFile.bytes).toEqual(artifacts.printFile.bytes);
  });

  it('moves the tongue’s part uphill, past the end of the groove, and leaves part 2 in place', async () => {
    const shape = cylinder(2);
    const cut = cutOf(50, 45, 60);
    const artifacts = await buildModelArtifacts(kernel, specOf(shape, cut, dovetail({ lengthPercent: 35 })));
    const { model } = artifacts;
    const plan = (model.section as ModelSection).connector as DovetailPlan;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const uphill = obliqueAxes(45, 60).u;
    const expected = toGltfPosition(scaled(uphill, plan.exitDistance + previewSeparation(model)));
    (offsets[(model.solids[0] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[1] as Solid).name]).toEqual([0, 0, 0]);
    expect(plan.exitDistance).toBeGreaterThan(plan.length);
  });
});

describe('the connector’s scale', () => {
  it('follows M with the plane, so that a larger model has the same relative connector', () => {
    const cut = cutOf(40, 50, 25);
    const shape = cylinder(3);
    const connector: RoundConnector = plug(2);
    const [small, large] = [80, 160].map((longestDimensionMm) =>
      planRoundConnectors(shape, { longestDimensionMm }, cut, connector),
    ) as [RoundConnectorPlan, RoundConnectorPlan];
    expect(large.sites[0]?.pinDiameter).toBeCloseTo(2 * (small.sites[0]?.pinDiameter as number), 9);
    // The larger circle has more sides, which moves the section's actual ends by less than the circle's own deviation.
    expect(Math.abs((large.sites[0]?.along as number) - 2 * (small.sites[0]?.along as number))).toBeLessThan(0.1);
    expect(large.insertion).toBeCloseTo(2 * small.insertion, 9);
    const checks: RoundConnectorIssue[] = roundConnectorChecks(
      obliqueCylinderSection(shape, { longestDimensionMm: 160 }, cut),
      roundConnectorDimensions(connector, 160, obliqueCylinderSection(shape, { longestDimensionMm: 160 }, cut).span / 2),
    );
    expect(checks.every(satisfies)).toBe(true);
  });
});
