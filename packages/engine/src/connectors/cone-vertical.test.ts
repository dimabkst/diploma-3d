import type { ConeShape, Connector, DovetailConnector, DowelConnector, PlugConnector } from '@diploma-3d/schema';
import { DEFAULT_DOVETAIL } from '@diploma-3d/schema';
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
import { splitByPlane } from '../section.ts';
import { buildRoundSolid, roundDimensionsMm } from '../shapes/round.ts';
import { hasFeasibleValues } from './bounds.ts';
import {
  type DovetailPlan,
  dovetailChecks,
  dovetailDimensions,
  dovetailFeasibility,
  grooveCutter,
  planDovetail,
} from './dovetail.ts';
import { coneVerticalSection, discWall, facesOfPart, pointWall, satisfies, verticalOffsetLimitPercent } from './frame.ts';
import {
  buildRoundConnectors,
  planRoundConnectors,
  ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorParameter,
  roundConnectorChecks,
  roundConnectorDimensions,
  roundConnectorFeasibility,
} from './round.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

const M = 80;
const scale = { longestDimensionMm: M } as const;
const VOLUME_TOLERANCE = 1e-3;
const COPLANAR_NOISE_MM3 = 0.02;
const UP: Vec3 = [0, 0, 1];

const cone = (heightRatio: number, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
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

const specOf = (shape: ConeShape, offsetPercent: number, connector?: Connector, longestDimensionMm = M) => ({
  shape,
  scale: { longestDimensionMm },
  section: { type: 'vertical', offsetPercent, ...(connector === undefined ? {} : { connector }) } as const,
});
const build = (shape: ConeShape, offsetPercent = 0, connector?: Connector, longest = M): GeneratedModel =>
  generateModel(kernel, specOf(shape, offsetPercent, connector, longest));

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const hasMaterialAt = (track: Track, solid: Manifold, point: Vec3, side = 0.1): boolean =>
  track(
    solid.intersect(track(track(kernel.Manifold.cube([side, side, side], true)).translate([...point] as KernelVec3))),
  ).volume() >
  0.9 * side ** 3;
const add = (a: Vec3, b: Vec3, factor = 1): Vec3 => [a[0] + factor * b[0], a[1] + factor * b[1], a[2] + factor * b[2]];
const scaled = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];

const partsOf = (model: GeneratedModel) => {
  const [a, b, ...pins] = model.solids as [Solid, Solid, ...Solid[]];
  expect([a.part, b.part]).toEqual(['part-1', 'part-2']);
  return { a, b, pins };
};
const pieces = (track: Track, mesh: TriangleMesh) => {
  const parts = manifoldOf(track, mesh).decompose();
  for (const part of parts) track(part);
  return parts.length;
};
const triangleArea = (mesh: TriangleMesh, triangle: number) => Math.hypot(...triangleAreaVector(mesh, triangle)) / 2;
const corners = (mesh: TriangleMesh, triangle: number) => triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));

/** The flat cut face of a part without a connector. */
function capOf({ mesh, newFaces }: Solid) {
  let area = 0;
  let centroid: Vec3 = [0, 0, 0];
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    if (newFaces?.[triangle] !== 1) continue;
    const [a, b, c] = corners(mesh, triangle) as [Vec3, Vec3, Vec3];
    const size = triangleArea(mesh, triangle);
    area += size;
    centroid = add(centroid, scaled(add(add(a, b), c), size / 3));
  }
  return { area, centroid: scaled(centroid, 1 / area) };
}

const CONES: readonly (readonly [string, ConeShape])[] = [
  ['a right cone', cone(2)],
  ['a slim right cone', cone(8)],
  ['a flat right cone', cone(0.5)],
  ['an oblique cone', cone(2, 1)],
  ['a cone with its apex over the base’s rim', cone(2, 2)],
  ['a cone with its apex beyond the base', cone(4, 3)],
];
const OFFSETS = [-60, -25, 0, 25, 60, 80];

describe.each(CONES)('the vertical plane of %s', (_, shape) => {
  const { radius: R, height: H, offset: d } = roundDimensionsMm(shape, scale);

  it('at offset 0 contains the whole axis, is vertical, and keeps its normal whatever the offset’s sign', () => {
    const axial = coneVerticalSection(shape, scale, 0);
    const n = axial.plane.normal;
    expect(n).toEqual([0, 1, 0]);
    expect(dot(n, UP)).toBe(0);
    expect(dot(n, [d, 0, H])).toBeCloseTo(0, 12);
    expect(axial.plane.offset).toBe(0);
    for (const fraction of [0, 0.3, 0.7, 1]) {
      expect(dot(n, [fraction * d, 0, fraction * H]) - axial.plane.offset).toBeCloseTo(0, 12);
    }
    for (const offsetPercent of OFFSETS) {
      const section = coneVerticalSection(shape, scale, offsetPercent);
      expect(section.plane.normal).toEqual(n);
      expect(section.plane.offset).toBeCloseTo((offsetPercent / 100) * R, 10);
      expect(section.frame.u).toEqual(UP);
      expect(section.frame.n).toEqual(n);
      expect(section.frame.v).toEqual(cross(UP, n));
    }
  });

  it.each(OFFSETS)('at %d % keeps part 1 on the negative side and part 2 on the positive one', (offsetPercent) => {
    const { a, b } = partsOf(build(shape, offsetPercent));
    const t = (offsetPercent / 100) * R;
    expect(a.measurements.bounds.max[1]).toBeCloseTo(t, 3);
    expect(a.measurements.bounds.min[1]).toBeCloseTo(-R, 3);
    expect(b.measurements.bounds.min[1]).toBeCloseTo(t, 3);
    expect(b.measurements.bounds.max[1]).toBeCloseTo(R, 3);
    if (offsetPercent !== 0) expect(a.measurements.volume > b.measurements.volume).toBe(offsetPercent > 0);
  });

  it('keeps the percentage under uniform scaling, and the plane scales with the model', () => {
    const large = { longestDimensionMm: 200 };
    expect(coneVerticalSection(shape, large, 25).plane.offset).toBeCloseTo(
      2.5 * coneVerticalSection(shape, scale, 25).plane.offset,
      9,
    );
    expect(verticalOffsetLimitPercent(shape, large)).toBeCloseTo(verticalOffsetLimitPercent(shape, scale), 9);
  });

  it('through the axis is the triangle of the base’s diameter and the apex, its centroid at a third of the way up', () => {
    const { contour, frame, area, span } = coneVerticalSection(shape, scale, 0);
    const near = (point: Vec3) => contour.some((corner) => Math.hypot(...subtract(corner, point)) < 1e-6);
    expect(near([R, 0, 0])).toBe(true);
    expect(near([-R, 0, 0])).toBe(true);
    expect(near([d, 0, H])).toBe(true);
    // Exactly those three corners, whatever the polygon's many sides.
    expect(contour).toHaveLength(3);
    expect(area).toBeCloseTo(R * H, 8);
    expect(span).toBeCloseTo(H, 9);
    expect(frame.origin[0]).toBeCloseTo(d / 3, 9);
    expect(frame.origin[1]).toBeCloseTo(0, 9);
    expect(frame.origin[2]).toBeCloseTo(H / 3, 9);
    // Isosceles only without a lean.
    const [left, right] = [Math.hypot(d + R, H), Math.hypot(d - R, H)];
    expect(left === right).toBe(d === 0);
  });

  it.each(OFFSETS)('at %d % stops below the apex as the ideal cone does, and matches the mesh’s cut face', (offsetPercent) => {
    const { contour, area, frame, span } = coneVerticalSection(shape, scale, offsetPercent);
    const maxZ = H * (1 - Math.abs(offsetPercent) / 100);
    const highest = Math.max(...contour.map(([, , z]) => z));
    // The polygon lies inside the circle by at most 0,05 mm, which the slope scales along the height.
    expect(highest).toBeLessThanOrEqual(maxZ + 1e-9);
    expect(maxZ - highest).toBeLessThan(0.05 * (H / R) + 1e-6);
    expect(span).toBeCloseTo(highest, 9);
    if (offsetPercent !== 0) expect(contour.length).toBeGreaterThan(3);
    const { a, b } = partsOf(build(shape, offsetPercent));
    for (const part of [a, b]) {
      const cap = capOf(part);
      expect(cap.area).toBeCloseTo(area, 1);
      for (let axis = 0; axis < 3; axis += 1) expect(cap.centroid[axis]).toBeCloseTo(frame.origin[axis] as number, 2);
    }
  });

  it('off the axis has its area centroid, neither the box’s centre nor the corners’ average', () => {
    const { contour, frame } = coneVerticalSection(shape, scale, 40);
    const highest = Math.max(...contour.map(([, , z]) => z));
    const average = scaled(
      contour.reduce<Vec3>((sum, corner) => add(sum, corner), [0, 0, 0]),
      1 / contour.length,
    );
    expect(Math.abs(frame.origin[2] - highest / 2)).toBeGreaterThan(0.01 * highest);
    expect(Math.abs(frame.origin[2] - average[2])).toBeGreaterThan(0.001 * highest);
  });

  it.each(OFFSETS)('at %d % splits it into closed, connected parts that fill it exactly', (offsetPercent) => {
    const whole = generateModel(kernel, { shape, scale }).solids[0] as Solid;
    const model = build(shape, offsetPercent);
    expect(model.name).toBe('cone-vertical-section');
    const { a, b } = partsOf(model);
    for (const part of [a, b]) {
      expect(findMeshDefects(part.mesh)).toEqual([]);
      expect(part.measurements.volume).toBeGreaterThan(0);
      withScope((track) => expect(pieces(track, part.mesh)).toBe(1));
    }
    expect(a.measurements.volume + b.measurements.volume).toBeCloseTo(whole.measurements.volume, 1);
    for (const axis of [0, 1, 2] as const) expect(model.size[axis]).toBeCloseTo(whole.measurements.size[axis], 3);
  });

  it('through the axis gives two equal halves of the centrally symmetric base', () => {
    const { a, b } = partsOf(build(shape));
    expect(a.measurements.volume / b.measurements.volume).toBeCloseTo(1, 6);
  });
});

describe('the offset’s limits', () => {
  it('are the vertical cylinder’s: ±80 %, narrower where a wall takes more than that, and no tangent cut', () => {
    expect(verticalOffsetLimitPercent(cone(2), scale)).toBeCloseTo(80, 9);
    expect(verticalOffsetLimitPercent(cone(2, 1), scale)).toBeCloseTo(80, 9);
    expect(verticalOffsetLimitPercent(cone(2), { longestDimensionMm: 10 })).toBeCloseTo(76, 9);
    expect(verticalOffsetLimitPercent(cone(2), { longestDimensionMm: 2 })).toBe(0);
    for (const shape of [cone(2), cone(2, 1), cone(0.5)]) {
      expect(() => build(shape, 80)).not.toThrow();
      expect(() => build(shape, -80)).not.toThrow();
      expect(() => build(shape, 80.01)).toThrow(InvalidModelSpecError);
      expect(() => build(shape, -80.01)).toThrow(InvalidModelSpecError);
    }
  });

  it('tell a plane beyond them from a connector that does not fit', () => {
    expect(() => build(cone(2), 90, plug())).toThrow(InvalidModelSpecError);
    expect(() => build(cone(2), 0, plug(1, { diameterFactor: 40 }))).toThrow(ConnectorUnsuitableError);
  });
});

const FEASIBLE: readonly (readonly [string, ConeShape, number])[] = [
  ['through a right cone’s axis', cone(2), 0],
  ['off a right cone’s axis', cone(2), 25],
  ['on the other side', cone(2), -25],
  ['through an oblique cone’s axis', cone(2, 1), 0],
  ['off an oblique cone’s axis', cone(2, 1), 20],
];

describe.each(FEASIBLE)('connectors %s', (_, shape, offsetPercent) => {
  const section = coneVerticalSection(shape, scale, offsetPercent);

  it.each([
    ['a plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['a dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
    ['a dovetail', dovetail({ lengthPercent: 20 }), 2],
  ] as const)('%s builds separate closed connected objects', (__, connector, objects) => {
    const model = build(shape, offsetPercent, connector);
    expect(model.solids).toHaveLength(objects);
    for (const solid of model.solids) {
      expect(findMeshDefects(solid.mesh)).toEqual([]);
      withScope((track) => expect(pieces(track, solid.mesh)).toBe(1));
    }
  });

  it('stand on the actual area centroid along n, or at C ± s·Z with the keyed diameters', () => {
    const one = planRoundConnectors(shape, scale, { offsetPercent }, plug(1));
    expect(one.frame.n).toEqual(section.plane.normal);
    expect(one.sites[0]?.centre).toEqual(section.frame.origin);
    const two = planRoundConnectors(shape, scale, { offsetPercent }, dowel(2));
    const [first, second] = two.sites as [(typeof two.sites)[number], (typeof two.sites)[number]];
    const s = (0.45 * section.span) / 2;
    expect(first.along).toBeCloseTo(s, 9);
    expect(second.along).toBeCloseTo(-s, 9);
    expect(subtract(first.centre, section.frame.origin)[2]).toBeCloseTo(s, 9);
    expect(subtract(second.centre, section.frame.origin)[2]).toBeCloseTo(-s, 9);
    expect(first.centre[0]).toBeCloseTo(second.centre[0], 12);
    expect(first.centre[1]).toBeCloseTo(second.centre[1], 12);
    expect(second.pinDiameter).toBeCloseTo(ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * first.pinDiameter, 12);
  });

  it('put the plug on part 1 and its hole in part 2', () => {
    const { a, b } = partsOf(build(shape, offsetPercent, plug(1)));
    const plan = planRoundConnectors(shape, scale, { offsetPercent }, plug(1));
    const inPlug = add(section.frame.origin, section.frame.n, plan.insertion / 2);
    withScope((track) => {
      expect(hasMaterialAt(track, manifoldOf(track, a.mesh), inPlug)).toBe(true);
      expect(hasMaterialAt(track, manifoldOf(track, b.mesh), inPlug)).toBe(false);
    });
  });

  it.each([
    ['plugs', plug(2)],
    ['dowels', dowel(2)],
  ] as const)('solve exact bounds for %s: each end passes the plan’s checks, past it they fail', (__, connector) => {
    const { parameters, issues } = roundConnectorFeasibility(shape, scale, { offsetPercent }, connector);
    expect(issues).toEqual([]);
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
    for (const key of ['diameter', 'insertion', 'spacing'] as const) {
      const { bounds } = parameters[key];
      expect(hasFeasibleValues(bounds)).toBe(true);
      expect(fails(bounds.min, key)).toEqual([]);
      expect(fails(bounds.max, key)).toEqual([]);
      expect(fails(bounds.max + 1e-3, key).length).toBeGreaterThan(0);
    }
  });

  it('build at the solved ends of the diameter and the depth', () => {
    const { diameter, insertion } = roundConnectorFeasibility(shape, scale, { offsetPercent }, plug(1)).parameters;
    const diameterFactor = diameter.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.diameter * M);
    expect(() => build(shape, offsetPercent, plug(1, { diameterFactor }))).not.toThrow();
    const depthFactor = insertion.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);
    expect(() => build(shape, offsetPercent, plug(1, { depthFactor }))).not.toThrow();
    expect(() => build(shape, offsetPercent, plug(1, { depthFactor: depthFactor * 1.01 }))).toThrow(ConnectorUnsuitableError);
  });
});

describe('a strongly leaning cone', () => {
  // d = H: the section's edges lean as well, and the centroid's vertical soon leaves the triangle upwards.
  const shape = cone(2, 2);

  it('takes one connector on the centroid, but refuses a pair that the section has moved away from', () => {
    expect(() => build(shape, 0, plug(1))).not.toThrow();
    expect(() => build(shape, 0, dowel(1))).not.toThrow();
    const { issues } = planRoundConnectors(shape, scale, { offsetPercent: 0 }, plug(2));
    expect(issues.map(({ code }) => code)).toContain('hole-wall-thin');
    expect(() => build(shape, 0, plug(2))).toThrow(ConnectorUnsuitableError);
  });

  it('offers the spacing that does fit, keeping the pair on the vertical through the centroid', () => {
    const section = coneVerticalSection(shape, scale, 0);
    const spacing = roundConnectorFeasibility(shape, scale, { offsetPercent: 0 }, plug(2, { spacingPercent: 15 })).parameters
      .spacing;
    expect(hasFeasibleValues(spacing.bounds)).toBe(true);
    const spacingPercent = (100 * spacing.bounds.max) / (section.span / 2);
    const model = build(shape, 0, plug(2, { spacingPercent }));
    expect(model.solids).toHaveLength(2);
    const plan = planRoundConnectors(shape, scale, { offsetPercent: 0 }, plug(2, { spacingPercent }));
    expect(plan.sites[0]?.centre[0]).toBeCloseTo(plan.sites[1]?.centre[0] as number, 12);
  });
});

describe('a whole cavity', () => {
  // R = 40 mm, H = 80 mm: the centroid lies at z = 80/3 mm, where the circle's radius is 80/3 mm.
  const [shape, cut] = [cone(2), { offsetPercent: 0 }] as const;
  const section = coneVerticalSection(shape, scale, 0);
  const radiusAtCentroid = 80 / 3;

  it('is refused where its centreline still lies inside but its rim, higher up on the narrowing cone, does not', () => {
    // Hole 5,2 mm wide and 26 mm deep: the bottom's centre keeps 0,67 mm; its top, 2,6 mm higher, is past the surface.
    const depth = 26;
    const e = depth - ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM;
    const connector = plug(1, { depthFactor: e / (ROUND_CONNECTOR_PROPORTIONS.insertion * M) });
    const plan = planRoundConnectors(shape, scale, cut, connector);
    expect(plan.holeDepth).toBeCloseTo(depth, 9);
    const faces = facesOfPart(section, 'positive');
    const centreline = Math.min(...faces.map((face) => pointWall(face, 0, 0, depth)));
    const whole = Math.min(...faces.map((face) => discWall(face, 0, depth, 2.6)));
    expect(centreline).toBeGreaterThan(0);
    expect(whole).toBeLessThan(0);
    expect(radiusAtCentroid).toBeGreaterThan(depth);
    const codes = plan.issues.map(({ code }) => code);
    expect(codes).toEqual(['hole-bottom-thin']);
    expect(() => build(shape, 0, connector)).toThrow(ConnectorUnsuitableError);
    // And the actual cutter does leave the actual cone.
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, shape, scale);
      const split = splitByPlane(track, solid, section.plane);
      const built = buildRoundConnectors(kernel, track, { lower: split.negative, upper: split.positive }, plan);
      const cutter = (built.sites[0] as (typeof built.sites)[number]).cutters.upper as Manifold;
      expect(track(cutter.subtract(solid)).volume()).toBeGreaterThan(VOLUME_TOLERANCE);
    });
  });

  it('is limited higher up: a pair’s upper hole, on the narrower cone, reaches less deep than one at the centroid', () => {
    const single = roundConnectorFeasibility(shape, scale, cut, plug(1)).parameters.insertion.bounds.max;
    const paired = roundConnectorFeasibility(shape, scale, cut, plug(2)).parameters.insertion.bounds.max;
    expect(paired).toBeLessThan(single);
  });

  it('is limited further from the axis: the same cone holds less depth off its axis', () => {
    const depthAt = (offsetPercent: number) =>
      roundConnectorFeasibility(shape, scale, { offsetPercent }, plug(1)).parameters.insertion.bounds.max;
    expect(depthAt(25)).toBeLessThan(depthAt(0));
    expect(depthAt(50)).toBeLessThan(depthAt(25));
    // Towards the larger part it reaches further: the hole lies in part 2, on the positive side.
    expect(depthAt(-25)).toBeGreaterThan(depthAt(0));
  });

  it('checks dowel holes in both parts', () => {
    const connector = dowel(1, { depthFactor: 8 });
    const issues = planRoundConnectors(shape, scale, { offsetPercent: 25 }, connector).issues;
    const parts = issues.flatMap((issue) => ('part' in issue && issue.code === 'hole-bottom-thin' ? [issue.part] : []));
    // Off the axis towards +Y part 2 is the thin one; at this length part 1 still holds.
    expect(parts).toContain('upper');
    const deeper = planRoundConnectors(shape, scale, { offsetPercent: 0 }, dowel(1, { depthFactor: 8 })).issues;
    const both = deeper.flatMap((issue) => ('part' in issue && issue.code === 'hole-bottom-thin' ? [issue.part] : []));
    expect(both).toEqual(expect.arrayContaining(['lower', 'upper']));
  });

  it('moves away from the fixed axis of a hole in a leaning cone, unlike a right cone of the same size', () => {
    // d = H, with R and H as in the right cone at M = 2R. A pair's upper hole is off the axis by lean·s there.
    const oblique = cone(2, 2);
    const { radius, height } = roundDimensionsMm(oblique, scale);
    const [right, rightScale] = [cone(2), { longestDimensionMm: 2 * radius }] as const;
    expect(roundDimensionsMm(right, rightScale).height).toBeCloseTo(height, 9);
    const sized = (longest: number) =>
      plug(2, {
        spacingPercent: 15,
        diameterFactor: 4 / (ROUND_CONNECTOR_PROPORTIONS.diameter * longest),
        depthFactor: 3 / (ROUND_CONNECTOR_PROPORTIONS.insertion * longest),
      });
    const reach = (shapeOf: ConeShape, size: { longestDimensionMm: number }) =>
      roundConnectorFeasibility(shapeOf, size, { offsetPercent: 0 }, sized(size.longestDimensionMm)).parameters.insertion.bounds
        .max;
    expect(reach(oblique, scale)).toBeLessThan(reach(right, rightScale));
  });
});

describe('an empty feasible interval', () => {
  it('is reported with no value to pick where the thin part has no room, and smooth surfaces stay', () => {
    // M = 20 mm, 80 %: part 2 reaches only 2 mm from the plane, less than a hole's least depth.
    const size = { longestDimensionMm: 20 };
    const { parameters, issues } = roundConnectorFeasibility(cone(2), size, { offsetPercent: 80 }, plug(1));
    expect(issues.length).toBeGreaterThan(0);
    expect(hasFeasibleValues(parameters.insertion.bounds)).toBe(false);
    expect(() => build(cone(2), 80, plug(1), 20)).toThrow(ConnectorUnsuitableError);
    expect(() => build(cone(2), 80, undefined, 20)).not.toThrow();
  });
});

const DOVETAILS: readonly (readonly [string, ConeShape, number])[] = [
  ['through a right cone’s axis', cone(2), 0],
  ['off a right cone’s axis', cone(2), 30],
  ['on its other side', cone(2), -30],
  ['through a slim cone’s axis', cone(4), 0],
  ['through an oblique cone’s axis', cone(2, 1), 0],
  ['off an oblique cone’s axis', cone(2, 1), -20],
  ['through a strongly leaning cone’s axis', cone(2, 2), 0],
];

describe.each(DOVETAILS)('a dovetail %s', (_, shape, offsetPercent) => {
  const section = coneVerticalSection(shape, scale, offsetPercent);
  const connector = dovetail({ lengthPercent: 20 });
  const model = build(shape, offsetPercent, connector);
  const plan = (model.section as ModelSection).connector as DovetailPlan;
  const { a, b } = partsOf(model);
  const { n } = section.frame;
  const centre = section.frame.origin;
  const inTongue = add(centre, n, plan.height / 2);

  it('slides straight up and down, whatever the lean, with the frame’s u pointing at the stop', () => {
    expect(plan.frame.u).toEqual([-0, -0, -1]);
    expect(plan.frame.n).toEqual(n);
    expect(plan.frame.origin).toEqual(centre);
    expect(dot(plan.frame.v, cross(plan.frame.u, plan.frame.n))).toBeCloseTo(1, 12);
  });

  it('has the tongue on part 1, the groove in part 2, the stop below and the entrance above', () => {
    withScope((track) => {
      const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
      expect(hasMaterialAt(track, partA, inTongue)).toBe(true);
      expect(hasMaterialAt(track, partB, inTongue)).toBe(false);
      const below = plan.length / 2 + plan.clearance + 0.3;
      expect(hasMaterialAt(track, partB, add(inTongue, UP, -below))).toBe(true);
      // Above the seated tongue the corridor stays open wherever part 2 still reaches.
      const reach = section.entranceReachWithin(plan.height + plan.clearance, 1);
      for (const share of [0.1, 0.4, 0.7]) {
        const along = plan.length / 2 + share * (reach - plan.length / 2);
        expect(hasMaterialAt(track, partB, add(inTongue, UP, along))).toBe(false);
      }
    });
  });

  it('comes off upwards along the whole path, and is held by the stop and against perpendicular withdrawal', () => {
    withScope((track) => {
      const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
      const overlapAfter = (move: Vec3) => track(track(partA.translate([...move] as KernelVec3)).intersect(partB)).volume();
      for (const share of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        expect(overlapAfter([0, 0, share * plan.exitDistance])).toBeLessThan(COPLANAR_NOISE_MM3);
      }
      expect(overlapAfter([0, 0, -(plan.clearance + 0.1)])).toBeGreaterThan(VOLUME_TOLERANCE);
      expect(overlapAfter(scaled(n, plan.normalPlay + 0.1))).toBeGreaterThan(VOLUME_TOLERANCE);
      // Fully disengaged at the end of the path.
      const out = add(inTongue, UP, plan.exitDistance);
      expect(hasMaterialAt(track, track(partA.translate([0, 0, plan.exitDistance])), out)).toBe(true);
      expect(hasMaterialAt(track, partB, out)).toBe(false);
    });
  });

  it('leaves the solid only through its one entry corridor, above the seated tongue, with nothing floating', () => {
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, shape, scale);
      const outside = track(grooveCutter(kernel, track, plan).subtract(solid));
      const parts = outside.decompose();
      for (const part of parts) track(part);
      expect(parts).toHaveLength(1);
      expect(outside.boundingBox().min[2]).toBeGreaterThan(centre[2] + plan.length / 2);
      expect(pieces(track, a.mesh)).toBe(1);
      expect(pieces(track, b.mesh)).toBe(1);
    });
  });

  it('measures the material around the seated groove and the stop on the part’s faces', () => {
    const checks = dovetailChecks(section, dovetailDimensions(connector, M, section.span / 2));
    for (const code of ['groove-wall-thin', 'stop-thin', 'backing-thin', 'base-thin']) {
      const check = checks.find((entry) => entry.code === code);
      expect(check?.valueMm).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('solves length bounds from the full profile, and refuses what does not fit without moving the entrance', () => {
    const { length } = dovetailFeasibility(shape, scale, { offsetPercent }, connector).parameters;
    const taller = dovetailFeasibility(shape, scale, { offsetPercent }, dovetail({ lengthPercent: 20, sizeFactor: 1.1 }))
      .parameters.length;
    expect(taller.bounds.max).toBeLessThanOrEqual(length.bounds.max);
    const percent = (100 * length.bounds.max) / section.span;
    const atEnd = build(shape, offsetPercent, dovetail({ lengthPercent: percent }));
    expect(((atEnd.section as ModelSection).connector as DovetailPlan).frame.u[2]).toBe(-1);
    const parts = partsOf(atEnd);
    withScope((track) => {
      expect(pieces(track, parts.a.mesh)).toBe(1);
      expect(pieces(track, parts.b.mesh)).toBe(1);
    });
    expect(() => build(shape, offsetPercent, dovetail({ lengthPercent: percent + 1 }))).toThrow(ConnectorUnsuitableError);
  });

  it('builds at the solved ends of its height and clearance', () => {
    const { height, clearance } = dovetailFeasibility(shape, scale, { offsetPercent }, connector).parameters;
    const factor = (millimetres: number) => millimetres / (0.025 * M);
    for (const sizeFactor of [factor(height.bounds.min), factor(height.bounds.max)]) {
      const parts = partsOf(build(shape, offsetPercent, dovetail({ lengthPercent: 20, sizeFactor })));
      withScope((track) => expect(pieces(track, parts.b.mesh)).toBe(1));
    }
    expect(() => build(shape, offsetPercent, dovetail({ lengthPercent: 20, clearanceMm: clearance.bounds.max }))).not.toThrow();
  });
});

describe('the dovetail’s entry notch', () => {
  it('opens where the narrowing cone gets thinner than the groove, below the apex', () => {
    const plan = planDovetail(cone(2), scale, { offsetPercent: 0 }, dovetail({ sizeFactor: 2, lengthPercent: 20 }));
    expect(plan.issues).toEqual([]);
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, cone(2), scale);
      const box = track(grooveCutter(kernel, track, plan).subtract(solid)).boundingBox();
      // Part 2's side leaves the groove at the height where the cone's half width is the groove's: well below z = 80.
      expect(box.min[2]).toBeLessThan(70);
    });
    const { b } = partsOf(build(cone(2), 0, dovetail({ sizeFactor: 2, lengthPercent: 20 })));
    // The apex's tip is gone with the corridor; the part's top is the corridor's rim, not the original apex.
    expect(b.measurements.bounds.max[2]).toBeLessThan(80);
    withScope((track) => expect(pieces(track, b.mesh)).toBe(1));
  });

  it('is told apart from a breakout around the seated tongue: that is refused', () => {
    const tooLong = planDovetail(cone(2), scale, { offsetPercent: 0 }, dovetail({ lengthPercent: 99 }));
    const codes = tooLong.issues.map(({ code }) => code);
    expect(codes).toContain('stop-thin');
    expect(codes.some((code) => code === 'groove-wall-thin' || code === 'backing-thin')).toBe(true);
    expect(() => build(cone(2), 0, dovetail({ lengthPercent: 99 }))).toThrow(ConnectorUnsuitableError);
  });

  it('keeps too wide a groove from cutting into the material behind it', () => {
    const { issues } = planDovetail(cone(2), scale, { offsetPercent: 60 }, dovetail({ sizeFactor: 3, lengthPercent: 30 }));
    expect(issues.map(({ code }) => code)).toContain('backing-thin');
  });
});

describe('the print file of a cone’s vertical section', () => {
  const objectsOf = async (shape: ConeShape, offsetPercent: number, connector?: Connector) => {
    const { printFile, model } = await buildModelArtifacts(kernel, specOf(shape, offsetPercent, connector));
    const { unit, objects } = readThreeMf(printFile.bytes).model;
    expect(unit).toBe('millimeter');
    expect(printFile.fileName).toBe('cone-vertical-section.3mf');
    return { objects, model };
  };
  const areaOnBed = (mesh: TriangleMesh) => {
    let area = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      if (corners(mesh, triangle).every(([, , z]) => Math.abs(z) < 1e-3)) area += triangleArea(mesh, triangle);
    }
    return area;
  };

  it.each([
    ['flat faces', undefined, 2],
    ['a dovetail', dovetail({ lengthPercent: 20 }), 2],
    ['a plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['a dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
  ] as const)('with %s holds independent objects above the bed, apart, at their own scale', async (_, connector, count) => {
    for (const [shape, offset] of [
      [cone(2), 0],
      [cone(2, 1), 15],
    ] as const) {
      const { objects, model } = await objectsOf(shape, offset, connector);
      expect(objects).toHaveLength(count);
      objects.forEach(({ mesh, name }, index) => {
        const solid = model.solids[index] as Solid;
        expect(name).toBe(solid.name);
        expect(findMeshDefects(mesh)).toEqual([]);
        const measured = measureMesh(mesh);
        expect(measured.volume).toBeCloseTo(solid.measurements.volume, 0);
        expect(measured.bounds.min[2]).toBeCloseTo(0, 4);
        for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1)
          expect(vertexAt(mesh, vertex)[2]).toBeGreaterThanOrEqual(-1e-4);
        if (index > 0) {
          const previous = measureMesh((objects[index - 1] as (typeof objects)[number]).mesh).bounds.max[0];
          expect(measured.bounds.min[0] - previous).toBeCloseTo(5, 3);
        }
      });
    }
  });

  it('stands both parts upright on what they keep of the base', async () => {
    const R = 40;
    const { objects } = await objectsOf(cone(2), 0);
    for (const { mesh } of objects) {
      expect(areaOnBed(mesh)).toBeCloseTo((Math.PI * R ** 2) / 2, -1);
      expect(measureMesh(mesh).size[2]).toBeCloseTo(80, 3);
    }
    // Off the axis, each keeps its own share of the base, and the same height as its own reach.
    const off = await objectsOf(cone(2), 50);
    const [larger, smaller] = off.objects as [(typeof off.objects)[number], (typeof off.objects)[number]];
    expect(areaOnBed(larger.mesh)).toBeGreaterThan(areaOnBed(smaller.mesh));
    // Together the base's polygon, inside the circle by at most 0,05 mm.
    expect(Math.abs(areaOnBed(larger.mesh) + areaOnBed(smaller.mesh) - Math.PI * R ** 2)).toBeLessThan(0.05 * 2 * Math.PI * R);
    expect(measureMesh(larger.mesh).size[2]).toBeCloseTo(80, 3);
    expect(measureMesh(smaller.mesh).size[2]).toBeCloseTo(40, 1);
  });

  it('keeps the base down with connectors too, and stands the dowels on an end face', async () => {
    const { objects } = await objectsOf(cone(2), 0, dowel(2));
    for (const { mesh } of objects.slice(0, 2)) expect(areaOnBed(mesh)).toBeGreaterThan(0.45 * Math.PI * 40 ** 2);
    expect(measureMesh((objects[2] as (typeof objects)[number]).mesh).size[2]).toBeCloseTo(8, 3);
    expect(measureMesh((objects[3] as (typeof objects)[number]).mesh).size[2]).toBeCloseTo(8, 3);
  });
});

describe('the separated preview of a cone’s vertical section', () => {
  const nodeOffsets = async (glb: Uint8Array) => {
    const root = (await new WebIO().readBinary(glb)).getRoot();
    return Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()]));
  };

  it.each([
    ['flat faces', undefined],
    ['plugs', plug(1)],
    ['dowels', dowel(2)],
  ] as const)('moves part 2 along n with %s, leaving the meshes and the print file alone', async (_, connector) => {
    const spec = specOf(cone(2, 1), 15, connector);
    const artifacts = await buildModelArtifacts(kernel, spec);
    const { model } = artifacts;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const expected = toGltfPosition(scaled([0, 1, 0], previewSeparation(model)));
    (offsets[(model.solids[1] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[0] as Solid).name]).toEqual([0, 0, 0]);
    for (const pin of model.solids.slice(2)) expect(offsets[pin.name]).toEqual([0, 0, 0]);
    expect((await buildModelArtifacts(kernel, spec)).printFile.bytes).toEqual(artifacts.printFile.bytes);
  });

  it('lifts part 1 straight up with a dovetail, past the groove, while part 2 stays', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(cone(2, 1), 0, dovetail({ lengthPercent: 20 })));
    const { model } = artifacts;
    const plan = (model.section as ModelSection).connector as DovetailPlan;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const expected = toGltfPosition([0, 0, plan.exitDistance + previewSeparation(model)]);
    (offsets[(model.solids[0] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[1] as Solid).name]).toEqual([0, 0, 0]);
  });
});

describe('whatever the cone', () => {
  it('builds or refuses each of a seeded sample, and never fails its three-dimensional checks', { timeout: 60_000 }, () => {
    let seed = 20261110;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <Value>(values: readonly Value[]) => values[Math.floor(random() * values.length)] as Value;
    const outcomes = { built: 0, refused: 0 };
    for (let sample = 0; sample < 150; sample += 1) {
      const shape = cone(pick([0.5, 1, 2, 3, 4, 8]), pick([0, 0, 0.5, 1, 1.5]));
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
        const { solids } = build(shape, (random() - 0.5) * 150, connector, pick([40, 80, 120]));
        for (const solid of solids) {
          expect(findMeshDefects(solid.mesh)).toEqual([]);
          withScope((track) => expect(pieces(track, solid.mesh)).toBe(1));
        }
        outcomes.built += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectorUnsuitableError);
        outcomes.refused += 1;
      }
    }
    expect(outcomes.built).toBeGreaterThan(60);
    expect(outcomes.refused).toBeGreaterThan(0);
  });
});
