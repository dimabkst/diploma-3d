import type { BallShape, Connector, DovetailConnector, DowelConnector, PlugConnector } from '@diploma-3d/schema';
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
  findMeshDefects,
  measureMesh,
  meshFromManifold,
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
import { ballCentreMm, ballInradiusMm, ballPolyhedron, ballRadiusMm, ballSegments, buildBall } from '../shapes/ball.ts';
import { hasFeasibleValues } from './bounds.ts';
import {
  type DovetailPlan,
  dovetailChecks,
  dovetailDimensions,
  dovetailFeasibility,
  grooveCutter,
  planDovetail,
} from './dovetail.ts';
import { ballOffsetLimitPercent, ballSection, satisfies } from './frame.ts';
import {
  buildRoundConnectors,
  planRoundConnectors,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorParameter,
  roundConnectorChecks,
  roundConnectorDimensions,
  roundConnectorFeasibility,
} from './round.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

const M = 80;
const R = 40;
const scale = { longestDimensionMm: M } as const;
const ball: BallShape = { kind: 'ball' };
const VOLUME_TOLERANCE = 1e-3;
// The polyhedron lies inside the ideal ball, by at most 0,05 mm.
const SHELL = 0.05;

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

const specOf = (offsetPercent: number, connector?: Connector, longestDimensionMm = M) => ({
  shape: ball,
  scale: { longestDimensionMm },
  section: { type: 'horizontal', offsetPercent, ...(connector === undefined ? {} : { connector }) } as const,
});
const build = (offsetPercent = 0, connector?: Connector, longest = M): GeneratedModel =>
  generateModel(kernel, specOf(offsetPercent, connector, longest));

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const hasMaterialAt = (track: Track, solid: Manifold, at: Vec3, side = 0.1): boolean =>
  track(solid.intersect(track(track(kernel.Manifold.cube([side, side, side], true)).translate([...at] as KernelVec3)))).volume() >
  0.9 * side ** 3;
const partsOf = (model: GeneratedModel) => {
  const [lower, upper, ...pins] = model.solids as [Solid, Solid, ...Solid[]];
  expect([lower.part, upper.part]).toEqual(['lower', 'upper']);
  return { lower, upper, pins };
};
const pieces = (track: Track, mesh: TriangleMesh) => {
  const parts = manifoldOf(track, mesh).decompose();
  for (const part of parts) track(part);
  return parts.length;
};
const triangleArea = (mesh: TriangleMesh, triangle: number) => Math.hypot(...triangleAreaVector(mesh, triangle)) / 2;
const corners = (mesh: TriangleMesh, triangle: number) => triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));
const wholeVolume = () => (generateModel(kernel, { shape: ball, scale }).solids[0] as Solid).measurements.volume;

const OFFSETS = [-80, -50, -25, 0, 25, 50, 80];

describe('the polyhedron behind the plan', () => {
  it.each([80, 200, 1000])(
    'is the kernel’s at M = %d mm, corner for corner, and holds the inner sphere',
    (longestDimensionMm) => {
      const size = { longestDimensionMm };
      const radius = ballRadiusMm(size);
      const { vertices } = ballPolyhedron(radius);
      // Rounded to a hundredth, a float32 coordinate may fall on either side of a boundary: its neighbours count too.
      const key = ([x, y, z]: Vec3) => `${Math.round(x * 100)} ${Math.round(y * 100)} ${Math.round(z * 100)}`;
      const mesh = withScope((track) => meshFromManifold(buildBall(kernel, track, size)));
      const centre = ballCentreMm(size);
      const actual = new Set<string>();
      for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
        const [x, y, z] = vertexAt(mesh, vertex);
        actual.add(key([x - centre[0], y - centre[1], z - centre[2]]));
      }
      const parts = ballSegments(radius) / 4;
      expect(vertexCount(mesh)).toBe(4 * parts ** 2 + 2);
      const nearby = ([x, y, z]: Vec3) =>
        [-0.01, 0, 0.01].some((dx) =>
          [-0.01, 0, 0.01].some((dy) => [-0.01, 0, 0.01].some((dz) => actual.has(key([x + dx, y + dy, z + dz])))),
        );
      for (const vertex of vertices) expect(nearby(vertex)).toBe(true);
      // No face plane comes closer to the centre than the inner sphere, and that sphere is close to the ideal one.
      const inner = ballInradiusMm(size);
      expect(inner).toBeGreaterThan(radius - 0.051);
      let nearest = Number.POSITIVE_INFINITY;
      for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
        const [a] = corners(mesh, triangle) as [Vec3, Vec3, Vec3];
        const area = triangleAreaVector(mesh, triangle);
        const size2 = Math.hypot(...area);
        const distance = (area[0] * (a[0] - centre[0]) + area[1] * (a[1] - centre[1]) + area[2] * (a[2] - centre[2])) / size2;
        nearest = Math.min(nearest, distance);
      }
      expect(nearest).toBeGreaterThanOrEqual(inner - 1e-3);
      expect(ballSegments(radius) % 4).toBe(0);
    },
  );
});

describe.each(OFFSETS)('a plane %d % of r from the centre', (offsetPercent) => {
  const offsetMm = (offsetPercent / 100) * R;
  const section = ballSection(scale, offsetPercent);

  it('lies where it should, horizontal, with the frame of a parallel cut', () => {
    expect(section.plane.normal).toEqual([0, 0, 1]);
    expect(section.plane.offset).toBeCloseTo(R + offsetMm, 12);
    expect(section.offset).toBeCloseTo(offsetMm, 12);
    expect(section.frame.u).toEqual([0, 1, 0]);
    expect(section.frame.n).toEqual([0, 0, 1]);
    expect(section.frame.v[0]).toBe(1);
    expect(section.frame.origin[0]).toBeCloseTo(0, 9);
    expect(section.frame.origin[1]).toBeCloseTo(0, 9);
    expect(section.frame.origin[2]).toBeCloseTo(R + offsetMm, 9);
  });

  it('cuts the ideal circle within the tessellation', () => {
    const ideal = Math.sqrt(R ** 2 - offsetMm ** 2);
    // At the plane's height the polygon lies inside the circle, by what the slope makes of the shell.
    const slack = (SHELL * R) / ideal;
    expect(Math.abs(section.span / 2 - ideal)).toBeLessThan(slack);
    for (const [x, y] of section.contour) {
      const distance = Math.hypot(x, y);
      expect(distance).toBeLessThanOrEqual(ideal + 1e-6);
      expect(distance).toBeGreaterThan(ideal - slack);
    }
    expect(Math.abs(section.area - Math.PI * ideal ** 2)).toBeLessThan(2 * Math.PI * ideal * slack);
  });

  it('matches the actual mesh’s cut face in area and centroid', () => {
    const { lower, upper } = partsOf(build(offsetPercent));
    for (const part of [lower, upper]) {
      let [area, x, y, z] = [0, 0, 0, 0];
      for (let triangle = 0; triangle < triangleCount(part.mesh); triangle += 1) {
        if (part.newFaces?.[triangle] !== 1) continue;
        const [a, b, c] = corners(part.mesh, triangle) as [Vec3, Vec3, Vec3];
        const size = triangleArea(part.mesh, triangle);
        area += size;
        x += (size * (a[0] + b[0] + c[0])) / 3;
        y += (size * (a[1] + b[1] + c[1])) / 3;
        z += (size * (a[2] + b[2] + c[2])) / 3;
      }
      expect(area).toBeCloseTo(section.area, 1);
      expect(x / area).toBeCloseTo(section.frame.origin[0], 2);
      expect(y / area).toBeCloseTo(section.frame.origin[1], 2);
      expect(z / area).toBeCloseTo(section.frame.origin[2], 2);
    }
  });

  it('gives closed, connected parts that fill the ball, with the ideal caps’ volumes within the tessellation', () => {
    const whole = wholeVolume();
    const model = build(offsetPercent);
    expect(model.name).toBe('ball-horizontal-section');
    const { lower, upper } = partsOf(model);
    for (const part of [lower, upper]) {
      expect(findMeshDefects(part.mesh)).toEqual([]);
      expect(part.measurements.volume).toBeGreaterThan(0);
      withScope((track) => expect(pieces(track, part.mesh)).toBe(1));
    }
    expect(lower.measurements.volume + upper.measurements.volume).toBeCloseTo(whole, 1);
    const [upperHeight, lowerHeight] = [R - offsetMm, R + offsetMm];
    const cap = (height: number) => Math.PI * height ** 2 * (R - height / 3);
    // A shell of 0,05 mm over the cap's area 2πRh.
    expect(Math.abs(upper.measurements.volume - cap(upperHeight))).toBeLessThan(SHELL * 2 * Math.PI * R * upperHeight + 1);
    expect(Math.abs(lower.measurements.volume - cap(lowerHeight))).toBeLessThan(SHELL * 2 * Math.PI * R * lowerHeight + 1);
    // Heights, in the ball that rests on z = 0, and nothing rescaled.
    expect(lower.measurements.bounds.max[2]).toBeCloseTo(R + offsetMm, 3);
    expect(upper.measurements.bounds.min[2]).toBeCloseTo(R + offsetMm, 3);
    for (const axis of [0, 1, 2] as const) expect(model.size[axis]).toBeCloseTo(80, 2);
  });
});

describe('the ideal reference', () => {
  it('at R = 40 mm and 20 mm off the centre: a circle of 20√3 mm, and 5/32 and 27/32 of the volume', () => {
    const offsetPercent = 50;
    const { lower, upper } = partsOf(build(offsetPercent));
    const section = ballSection(scale, offsetPercent);
    expect(Math.abs(section.span / 2 - 20 * Math.sqrt(3))).toBeLessThan(0.1);
    const whole = lower.measurements.volume + upper.measurements.volume;
    expect(upper.measurements.volume / whole).toBeCloseTo(5 / 32, 3);
    expect(lower.measurements.volume / whole).toBeCloseTo(27 / 32, 3);
  });

  it('through the centre gives two equal halves of the symmetric mesh', () => {
    const { lower, upper } = partsOf(build(0));
    expect(lower.measurements.volume / upper.measurements.volume).toBeCloseTo(1, 6);
  });
});

describe('the offset’s limits', () => {
  it('are ±80 % at ordinary sizes, narrower where a wall takes more, and keep the percentage under scaling', () => {
    expect(ballOffsetLimitPercent(scale)).toBe(80);
    expect(ballOffsetLimitPercent({ longestDimensionMm: 400 })).toBe(80);
    expect(ballOffsetLimitPercent({ longestDimensionMm: 10 })).toBeCloseTo(76, 9);
    expect(ballOffsetLimitPercent({ longestDimensionMm: 2 })).toBe(0);
    expect(() => build(80)).not.toThrow();
    expect(() => build(-80)).not.toThrow();
    expect(() => build(80.1)).toThrow(InvalidModelSpecError);
    expect(() => build(77, undefined, 10)).toThrow(InvalidModelSpecError);
    const [small, large] = [80, 200].map((longestDimensionMm) => ballSection({ longestDimensionMm }, 30));
    expect(large?.offset).toBeCloseTo(2.5 * (small?.offset as number), 9);
    expect(large?.plane.offset).toBeCloseTo(2.5 * (small?.plane.offset as number), 9);
  });
});

describe.each([0, 25, -25, 50])('connectors on a plane %d % from the centre', (offsetPercent) => {
  const section = ballSection(scale, offsetPercent);
  const cut = { offsetPercent };

  it.each([
    ['a plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['a dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
    ['a dovetail', dovetail(), 2],
  ] as const)('%s builds separate closed connected objects', (_, connector, count) => {
    const model = build(offsetPercent, connector);
    expect(model.solids).toHaveLength(count);
    for (const solid of model.solids) {
      expect(findMeshDefects(solid.mesh)).toEqual([]);
      withScope((track) => expect(pieces(track, solid.mesh)).toBe(1));
    }
  });

  it('stand on the centroid along n, or symmetric along u with the keyed diameters', () => {
    const one = planRoundConnectors(ball, scale, cut, plug(1));
    expect(one.frame.n).toEqual([0, 0, 1]);
    expect(one.sites[0]?.centre).toEqual(section.frame.origin);
    const two = planRoundConnectors(ball, scale, cut, dowel(2));
    const [first, second] = two.sites as [(typeof two.sites)[number], (typeof two.sites)[number]];
    expect(first.along).toBeCloseTo((0.45 * section.span) / 2, 9);
    expect(second.along).toBeCloseTo(-first.along, 12);
    expect(first.centre[1] - second.centre[1]).toBeCloseTo(2 * first.along, 9);
    expect(second.pinDiameter).toBeCloseTo(ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * first.pinDiameter, 12);
  });

  it('put a plug on the lower part and its hole in the upper one', () => {
    const { lower, upper } = partsOf(build(offsetPercent, plug(1)));
    const plan = planRoundConnectors(ball, scale, cut, plug(1));
    const [x, y, z] = section.frame.origin;
    const inPlug: Vec3 = [x, y, z + plan.insertion / 2];
    withScope((track) => {
      expect(hasMaterialAt(track, manifoldOf(track, lower.mesh), inPlug)).toBe(true);
      expect(hasMaterialAt(track, manifoldOf(track, upper.mesh), inPlug)).toBe(false);
    });
  });

  it('solve exact bounds, each end passing the plan’s checks, past it failing', () => {
    const connector = plug(2);
    const { parameters, issues } = roundConnectorFeasibility(ball, scale, cut, connector);
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

  it('build at the solved ends, verified in three dimensions on the actual mesh', () => {
    const { diameter, insertion } = roundConnectorFeasibility(ball, scale, cut, plug(1)).parameters;
    const diameterFactor = diameter.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.diameter * M);
    expect(() => build(offsetPercent, plug(1, { diameterFactor }))).not.toThrow();
    const depthFactor = insertion.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);
    expect(() => build(offsetPercent, plug(1, { depthFactor }))).not.toThrow();
    expect(() => build(offsetPercent, plug(1, { depthFactor: depthFactor * 1.01 }))).toThrow(ConnectorUnsuitableError);
  });
});

describe('a whole cavity', () => {
  // R = 40 mm, 32 mm off the centre; the hole's axis 12 mm from the centre, its straight radius 5 mm, 4,3 mm deep.
  const section = ballSection(scale, 80);
  const spacingPercent = (100 * 12) / (section.span / 2);
  const connector = plug(2, {
    spacingPercent,
    diameterFactor: 9.8 / (ROUND_CONNECTOR_PROPORTIONS.diameter * M),
    holeClearanceMm: 0.2,
  });

  it('whose farthest edge at the blind end leaves the ball is refused, though the entrance fits and the centreline stays inside', () => {
    expect((12 + 5) ** 2 + (32 + 4.3) ** 2).toBeCloseTo(1606.69, 6);
    const plan = planRoundConnectors(ball, scale, { offsetPercent: 80 }, connector);
    expect(plan.holeDepth).toBeCloseTo(4.3, 12);
    expect(plan.sites[0]?.along).toBeCloseTo(12, 9);
    expect(plan.issues.map(({ code }) => code)).toContain('hole-bottom-thin');
    expect(plan.issues.map(({ code }) => code)).not.toContain('hole-wall-thin');
    const bottom = plan.issues.find(({ code }) => code === 'hole-bottom-thin') as { valueMm: number };
    expect(bottom.valueMm).toBeLessThan(0);
    expect(bottom.valueMm).toBeCloseTo(ballInradiusMm(scale) - Math.sqrt(1606.69), 2);
    expect(Math.hypot(12, 36.3)).toBeLessThan(40);
    expect(() => build(80, connector)).toThrow(ConnectorUnsuitableError);
  });

  it('that leaves the ball does so on the actual solid as well', () => {
    const plan = planRoundConnectors(ball, scale, { offsetPercent: 80 }, connector);
    withScope((track) => {
      const solid = buildBall(kernel, track, scale);
      const split = splitByPlane(track, solid, section.plane);
      const built = buildRoundConnectors(kernel, track, { lower: split.negative, upper: split.positive }, plan);
      const cutter = (built.sites[0] as (typeof built.sites)[number]).cutters.upper as Manifold;
      expect(track(cutter.subtract(solid)).volume()).toBeGreaterThan(VOLUME_TOLERANCE);
    });
  });

  it('is limited by the side wall of an off-centre hole long before the pole', () => {
    // 8 mm off the axis it may reach about as far as the pole allows; 30 mm off it, the curving wall stops it far earlier.
    const depthAt = (spacing: number) =>
      roundConnectorFeasibility(ball, scale, { offsetPercent: 0 }, plug(2, { spacingPercent: spacing })).parameters.insertion
        .bounds.max;
    const span = ballSection(scale, 0).span / 2;
    expect(depthAt((100 * 8) / span)).toBeGreaterThan(30);
    expect(depthAt((100 * 30) / span)).toBeLessThan(25);
    expect(depthAt((100 * 30) / span)).toBeLessThan(depthAt((100 * 8) / span));
  });

  it('shrinks with the distance from the centre, on either side, for the hole on the small cap', () => {
    const depthAt = (offsetPercent: number) =>
      roundConnectorFeasibility(ball, scale, { offsetPercent }, plug(1)).parameters.insertion.bounds.max;
    expect(depthAt(25)).toBeLessThan(depthAt(0));
    expect(depthAt(60)).toBeLessThan(depthAt(25));
    // A plug's hole lies in the upper part, so a lower plane only gives it room.
    expect(depthAt(-25)).toBeGreaterThan(depthAt(0));
  });

  it('is checked in both parts for dowels: on a low plane, in the thin lower cap', () => {
    const { issues } = planRoundConnectors(ball, scale, { offsetPercent: -80 }, dowel(1, { depthFactor: 2 }));
    const parts = issues.flatMap((issue) => (issue.code === 'hole-bottom-thin' && 'part' in issue ? [issue.part] : []));
    expect(parts).toEqual(['lower']);
  });

  it('leaves a thin cap with no value to choose, and smooth surfaces stay', () => {
    // M = 20 mm at 80 %: the cap is 2 mm high, less than any hole.
    const { parameters, issues } = roundConnectorFeasibility(ball, { longestDimensionMm: 20 }, { offsetPercent: 80 }, plug(1));
    expect(issues.length).toBeGreaterThan(0);
    expect(hasFeasibleValues(parameters.insertion.bounds)).toBe(false);
    expect(() => build(80, plug(1), 20)).toThrow(ConnectorUnsuitableError);
    expect(() => build(80, undefined, 20)).not.toThrow();
  });

  it('keeps the lower part’s material behind an integrated plug’s root', () => {
    // At −80 % the lower cap is 8 mm high; a wide plug's root corners run out of it.
    const { issues } = planRoundConnectors(ball, scale, { offsetPercent: -80 }, plug(1, { diameterFactor: 10 }));
    expect(issues.map(({ code }) => code)).toContain('base-thin');
  });
});

describe.each([0, 25, -25, 50])('a dovetail on a plane %d % from the centre', (offsetPercent) => {
  const section = ballSection(scale, offsetPercent);
  const cut = { offsetPercent };
  const connector = dovetail({ lengthPercent: 35 });
  const model = build(offsetPercent, connector);
  const plan = (model.section as ModelSection).connector as DovetailPlan;
  const { lower, upper } = partsOf(model);
  const [x, y, z] = section.frame.origin;
  const inTongue: Vec3 = [x, y, z + plan.height / 2];
  const along = (distance: number): Vec3 => [x, y + distance, z + plan.height / 2];

  it('keeps the horizontal cut’s convention: tongue below, stop at +u, entrance at −u, with no uphill to compute', () => {
    expect(plan.frame.u).toEqual([0, 1, 0]);
    expect(plan.frame.n).toEqual([0, 0, 1]);
    withScope((track) => {
      const [partLower, partUpper] = [manifoldOf(track, lower.mesh), manifoldOf(track, upper.mesh)];
      expect(hasMaterialAt(track, partLower, inTongue)).toBe(true);
      expect(hasMaterialAt(track, partUpper, inTongue)).toBe(false);
      expect(hasMaterialAt(track, partUpper, along(plan.length / 2 + plan.clearance + 0.3))).toBe(true);
      expect(hasMaterialAt(track, partUpper, along(-(plan.length / 2 + 0.5)))).toBe(false);
      expect(hasMaterialAt(track, partUpper, along(-section.span / 2 + 0.5))).toBe(false);
    });
  });

  it('clears the whole path, and is held by the stop and against perpendicular withdrawal', () => {
    withScope((track) => {
      const [partLower, partUpper] = [manifoldOf(track, lower.mesh), manifoldOf(track, upper.mesh)];
      const overlapAfter = (move: Vec3) =>
        track(track(partLower.translate([...move] as KernelVec3)).intersect(partUpper)).volume();
      for (const share of [0, 0.2, 0.5, 0.8, 1]) {
        expect(overlapAfter([0, -share * plan.exitDistance, 0])).toBeLessThan(VOLUME_TOLERANCE);
      }
      expect(overlapAfter([0, plan.clearance + 0.1, 0])).toBeGreaterThan(VOLUME_TOLERANCE);
      expect(overlapAfter([0, 0, plan.normalPlay + 0.1])).toBeGreaterThan(VOLUME_TOLERANCE);
    });
  });

  it('opens only through its entrance, beyond the seated tongue, with nothing detached', () => {
    withScope((track) => {
      const solid = buildBall(kernel, track, scale);
      const outside = track(grooveCutter(kernel, track, plan).subtract(solid));
      const parts = outside.decompose();
      for (const part of parts) track(part);
      expect(parts).toHaveLength(1);
      expect(outside.boundingBox().max[1]).toBeLessThan(y - plan.length / 2);
      expect(pieces(track, lower.mesh)).toBe(1);
      expect(pieces(track, upper.mesh)).toBe(1);
    });
  });

  it('keeps the walls, stop and roof on the sphere inside the polyhedron', () => {
    const checks = dovetailChecks(section, dovetailDimensions(connector, M, section.span / 2));
    for (const code of ['groove-wall-thin', 'stop-thin', 'backing-thin', 'base-thin']) {
      expect(checks.find((entry) => entry.code === code)?.valueMm).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('solves length bounds from the full profile, and refuses what does not fit', () => {
    const { length, height } = dovetailFeasibility(ball, scale, cut, connector).parameters;
    const taller = dovetailFeasibility(ball, scale, cut, dovetail({ lengthPercent: 35, sizeFactor: 2 })).parameters.length;
    expect(taller.bounds.max).toBeLessThan(length.bounds.max);
    const percent = (100 * length.bounds.max) / section.span;
    const atEnd = partsOf(build(offsetPercent, dovetail({ lengthPercent: percent })));
    withScope((track) => expect(pieces(track, atEnd.upper.mesh)).toBe(1));
    expect(() => build(offsetPercent, dovetail({ lengthPercent: percent + 1 }))).toThrow(ConnectorUnsuitableError);
    const sizeFactor = height.bounds.max / (0.025 * M);
    expect(() => build(offsetPercent, dovetail({ lengthPercent: 35, sizeFactor }))).not.toThrow();
  });
});

describe('a dovetail near a pole', () => {
  it('whose footprint fits the section but whose groove does not is refused for its roof', () => {
    // At 80 % the section's radius is 24 mm and the cap 8 mm high: h = 6 mm leaves no roof over the groove's top.
    const { issues } = planDovetail(ball, scale, { offsetPercent: 80 }, dovetail({ sizeFactor: 3, lengthPercent: 20 }));
    expect(issues.map(({ code }) => code)).toEqual(expect.arrayContaining(['backing-thin']));
    expect(() => build(80, dovetail({ sizeFactor: 3, lengthPercent: 20 }))).toThrow(ConnectorUnsuitableError);
  });

  it('whose stop would run out of the section is refused, not reversed', () => {
    const { issues, frame } = planDovetail(ball, scale, { offsetPercent: 0 }, dovetail({ lengthPercent: 99 }));
    expect(issues.map(({ code }) => code)).toContain('stop-thin');
    expect(frame.u).toEqual([0, 1, 0]);
  });
});

describe('the print file', () => {
  const objectsOf = async (offsetPercent: number, connector?: Connector) => {
    const { printFile, model } = await buildModelArtifacts(kernel, specOf(offsetPercent, connector));
    const { unit, objects } = readThreeMf(printFile.bytes).model;
    expect(unit).toBe('millimeter');
    expect(printFile.fileName).toBe('ball-horizontal-section.3mf');
    return { objects, model };
  };
  const areaOnBed = (mesh: TriangleMesh) => {
    let area = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      if (corners(mesh, triangle).every(([, , value]) => Math.abs(value) < 1e-3)) area += triangleArea(mesh, triangle);
    }
    return area;
  };
  /** The flat disc at the top of a part that kept its cut face up. */
  const areaOnTop = (mesh: TriangleMesh) => {
    const { max } = measureMesh(mesh).bounds;
    let area = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      if (corners(mesh, triangle).every(([, , value]) => Math.abs(value - max[2]) < 1e-3)) area += triangleArea(mesh, triangle);
    }
    return area;
  };

  it.each([
    ['flat faces', undefined, 2],
    ['a dovetail', dovetail(), 2],
    ['a plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['a dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
  ] as const)('with %s holds independent objects above the bed, apart, at their own scale', async (_, connector, count) => {
    const { objects, model } = await objectsOf(25, connector);
    expect(objects).toHaveLength(count);
    objects.forEach(({ mesh, name }, index) => {
      const solid = model.solids[index] as Solid;
      expect(name).toBe(solid.name);
      expect(findMeshDefects(mesh)).toEqual([]);
      const measured = measureMesh(mesh);
      expect(measured.volume).toBeCloseTo(solid.measurements.volume, 0);
      expect(measured.surfaceArea).toBeCloseTo(solid.measurements.surfaceArea, 0);
      expect(measured.bounds.min[2]).toBeCloseTo(0, 4);
      for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1)
        expect(vertexAt(mesh, vertex)[2]).toBeGreaterThanOrEqual(-1e-4);
      if (index > 0) {
        const previous = measureMesh((objects[index - 1] as (typeof objects)[number]).mesh).bounds.max[0];
        expect(measured.bounds.min[0] - previous).toBeCloseTo(5, 3);
      }
    });
  });

  it('rests both parts on their cut faces with flat surfaces and dowels: the lower one turned over', async () => {
    for (const connector of [undefined, dowel(1)] as const) {
      const { objects, model } = await objectsOf(25, connector);
      const section = ballSection(scale, 25);
      const [first, second] = objects as [(typeof objects)[number], (typeof objects)[number]];
      // The holes are missing from the bed's area when there are any.
      const least = connector === undefined ? section.area - 1 : section.area - 60;
      expect(areaOnBed(first.mesh)).toBeGreaterThan(least);
      expect(areaOnBed(first.mesh)).toBeLessThan(section.area + 1);
      expect(areaOnBed(second.mesh)).toBeGreaterThan(least);
      const { lower, upper } = partsOf(model);
      expect(measureMesh(first.mesh).size[2]).toBeCloseTo(lower.measurements.size[2], 3);
      expect(measureMesh(second.mesh).size[2]).toBeCloseTo(upper.measurements.size[2], 3);
    }
  });

  it.each([
    ['a plug', plug(1)],
    ['a dovetail', dovetail()],
  ] as const)(
    'keeps the part with %s face up on its curved side, and the receiving part on its cut face',
    async (_, connector) => {
      const { objects } = await objectsOf(0, connector);
      const [first, second] = objects as [(typeof objects)[number], (typeof objects)[number]];
      // No flat face on the bed: only the pole's facets touch it.
      expect(areaOnBed(first.mesh)).toBeLessThan(1);
      expect(measureMesh(first.mesh).bounds.min[2]).toBeCloseTo(0, 4);
      // The lower part reaches the plug's or tongue's top, above the disc of the cut.
      expect(measureMesh(first.mesh).size[2]).toBeGreaterThan(40);
      expect(areaOnBed(second.mesh)).toBeGreaterThan(0.5 * Math.PI * 40 ** 2);
      expect(areaOnTop(first.mesh)).toBeGreaterThan(0);
    },
  );

  it('does not touch the exterior for the bed: the polyhedron’s own surface stays, nothing flattened or added', async () => {
    const whole = (generateModel(kernel, { shape: ball, scale }).solids[0] as Solid).measurements;
    const { model } = await objectsOf(0, plug(1));
    const { lower, upper } = partsOf(model);
    const original = (solid: Solid) => {
      let area = 0;
      for (let triangle = 0; triangle < triangleCount(solid.mesh); triangle += 1) {
        if (solid.newFaces?.[triangle] !== 1) area += triangleArea(solid.mesh, triangle);
      }
      return area;
    };
    expect(original(lower) + original(upper)).toBeCloseTo(whole.surfaceArea, 0);
    for (const solid of [lower, upper]) {
      for (let vertex = 0; vertex < vertexCount(solid.mesh); vertex += 1) {
        const [x, y, z] = vertexAt(solid.mesh, vertex);
        expect(Math.hypot(x, y, z - R)).toBeLessThanOrEqual(R + 1e-3);
      }
    }
  });

  it('stands the dowels upright on an end face', async () => {
    const { objects } = await objectsOf(0, dowel(2));
    for (const { mesh } of objects.slice(2)) expect(measureMesh(mesh).size[2]).toBeCloseTo(8, 3);
  });
});

describe('the separated preview', () => {
  const nodeOffsets = async (glb: Uint8Array) => {
    const root = (await new WebIO().readBinary(glb)).getRoot();
    return Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()]));
  };

  it.each([
    ['flat faces', undefined],
    ['plugs', plug(1)],
    ['dowels', dowel(2)],
  ] as const)('lifts the upper part along the normal with %s, leaving the print file alone', async (_, connector) => {
    const spec = specOf(25, connector);
    const artifacts = await buildModelArtifacts(kernel, spec);
    const { model } = artifacts;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const expected = toGltfPosition([0, 0, previewSeparation(model)]);
    (offsets[(model.solids[1] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[0] as Solid).name]).toEqual([0, 0, 0]);
    expect((await buildModelArtifacts(kernel, spec)).printFile.bytes).toEqual(artifacts.printFile.bytes);
  });

  it('slides the upper part off the tongue in the plane with a dovetail, as a horizontal cut does', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(25, dovetail()));
    const { model } = artifacts;
    const plan = (model.section as ModelSection).connector as DovetailPlan;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const expected = toGltfPosition([0, plan.exitDistance + previewSeparation(model), 0]);
    (offsets[(model.solids[1] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[0] as Solid).name]).toEqual([0, 0, 0]);
  });
});

describe('whatever the plane', () => {
  it.each([
    [80, -5, undefined],
    [120, -5, undefined],
    [80, -5, plug(2, { spacingPercent: 15 })],
    [80, 75, dovetail({ sizeFactor: 2.734879945222463, lengthPercent: 20 })],
  ] as const)(
    'builds at M = %d mm, %d %, where a plane just above a vertex leaves a tiny, well-shaped corner',
    (longest, offset, connector) => {
      const { solids } = build(offset, connector, longest);
      for (const solid of solids) {
        expect(findMeshDefects(solid.mesh)).toEqual([]);
        withScope((track) => expect(pieces(track, solid.mesh)).toBe(1));
      }
    },
  );

  it('builds or refuses each of a seeded sample, and never fails its three-dimensional checks', { timeout: 120_000 }, () => {
    let seed = 20261109;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <Value>(values: readonly Value[]) => values[Math.floor(random() * values.length)] as Value;
    const outcomes = { built: 0, refused: 0 };
    for (let sample = 0; sample < 60; sample += 1) {
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
        const { solids } = build((random() - 0.5) * 160, connector, pick([40, 80, 120]));
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
    expect(outcomes.built).toBeGreaterThan(20);
  });
});
