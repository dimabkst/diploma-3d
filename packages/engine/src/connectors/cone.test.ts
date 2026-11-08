import type { ConeShape, Connector, DovetailConnector, DowelConnector, PlugConnector } from '@diploma-3d/schema';
import { DEFAULT_DOVETAIL } from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts, previewSeparation } from '../artifacts.ts';
import { ConnectorUnsuitableError } from '../errors.ts';
import { toGltfPosition } from '../export/glb.ts';
import { readThreeMf } from '../export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  findMeshDefects,
  measureMesh,
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
import { coneSection, facesOfPart, pointWall, satisfies } from './frame.ts';
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
const scale = { longestDimensionMm: M } as const;
const WALL = 1.2;
const VOLUME_TOLERANCE = 1e-3;

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

const specOf = (shape: ConeShape, positionPercent: number, connector?: Connector, longestDimensionMm = M) => ({
  shape,
  scale: { longestDimensionMm },
  section: { type: 'parallel-to-bases', positionPercent, ...(connector === undefined ? {} : { connector }) } as const,
});
const build = (shape: ConeShape, positionPercent: number, connector?: Connector, longest = M): GeneratedModel =>
  generateModel(kernel, specOf(shape, positionPercent, connector, longest));

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const hasMaterialAt = (track: Track, solid: Manifold, point: Vec3, side = 0.1): boolean =>
  track(
    solid.intersect(track(track(kernel.Manifold.cube([side, side, side], true)).translate([...point] as KernelVec3))),
  ).volume() >
  0.9 * side ** 3;

const partsOf = (model: GeneratedModel) => {
  const [lower, upper, ...pins] = model.solids as [Solid, Solid, ...Solid[]];
  expect([lower.part, upper.part]).toEqual(['lower', 'upper']);
  return { lower, upper, pins };
};

const CONES: readonly (readonly [string, ConeShape])[] = [
  ['a right cone', cone(2)],
  ['a slim right cone', cone(8)],
  ['a flat right cone', cone(0.5)],
  ['an oblique cone', cone(2, 1)],
  ['a cone with its apex over the base’s rim', cone(2, 2)],
  ['a cone with its apex beyond the base', cone(4, 3)],
];
const POSITIONS = [10, 25, 50, 75, 90];
const triangleArea = (mesh: TriangleMesh, triangle: number) => Math.hypot(...triangleAreaVector(mesh, triangle)) / 2;
const corners = (mesh: TriangleMesh, triangle: number) => triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));

describe.each(CONES)('the parallel section of %s', (_, shape) => {
  const { radius: R, height: H, offset: d } = roundDimensionsMm(shape, scale);

  it.each(POSITIONS)('at %d % has the height, centre and radius of the base scaled towards the apex', (positionPercent) => {
    const t = positionPercent / 100;
    const section = coneSection(shape, scale, positionPercent);
    expect(section.plane.normal).toEqual([0, 0, 1]);
    expect(section.plane.offset).toBeCloseTo(t * H, 10);
    // The centre follows the line from the base's centre to the apex, also of an oblique cone.
    expect(section.frame.origin[0]).toBeCloseTo(t * d, 9);
    expect(section.frame.origin[1]).toBeCloseTo(0, 9);
    expect(section.frame.origin[2]).toBeCloseTo(t * H, 9);
    for (const [x, y, z] of section.contour) {
      expect(z).toBeCloseTo(t * H, 9);
      expect(Math.hypot(x - t * d, y)).toBeCloseTo(R * (1 - t), 9);
    }
    expect(section.span).toBeCloseTo(2 * R * (1 - t), 9);
    // The frame of a parallel cut: u is perpendicular to the lean.
    expect(section.frame.u).toEqual([0, 1, 0]);
    expect(section.frame.v[0]).toBeCloseTo(1, 12);
  });

  it.each(POSITIONS)('at %d % matches the cut face of the actual mesh', (positionPercent) => {
    const section = coneSection(shape, scale, positionPercent);
    const { lower } = partsOf(build(shape, positionPercent));
    let [area, x, y] = [0, 0, 0];
    for (let triangle = 0; triangle < triangleCount(lower.mesh); triangle += 1) {
      if (lower.newFaces?.[triangle] !== 1) continue;
      const [a, b, c] = corners(lower.mesh, triangle) as [Vec3, Vec3, Vec3];
      const size = triangleArea(lower.mesh, triangle);
      area += size;
      x += (size * (a[0] + b[0] + c[0])) / 3;
      y += (size * (a[1] + b[1] + c[1])) / 3;
    }
    expect(area).toBeCloseTo(section.area, 1);
    expect(x / area).toBeCloseTo(section.frame.origin[0], 2);
    expect(y / area).toBeCloseTo(section.frame.origin[1], 2);
  });

  it.each(POSITIONS)(
    'at %d % splits into a closed frustum and a smaller cone, with the cubic volume fractions',
    (positionPercent) => {
      const t = positionPercent / 100;
      const whole = generateModel(kernel, { shape, scale }).solids[0] as Solid;
      const model = build(shape, positionPercent);
      const { lower, upper } = partsOf(model);
      for (const part of [lower, upper]) {
        expect(findMeshDefects(part.mesh)).toEqual([]);
        expect(part.measurements.volume).toBeGreaterThan(0);
        withScope((track) => {
          const pieces = manifoldOf(track, part.mesh).decompose();
          for (const piece of pieces) track(piece);
          expect(pieces).toHaveLength(1);
        });
      }
      const V = whole.measurements.volume;
      expect(upper.measurements.volume / V).toBeCloseTo((1 - t) ** 3, 5);
      expect(lower.measurements.volume / V).toBeCloseTo(1 - (1 - t) ** 3, 5);
      expect(lower.measurements.volume + upper.measurements.volume).toBeCloseTo(V, 1);
      // The part with the apex is the upper one, above the plane; the base stays with the frustum.
      expect(upper.measurements.bounds.min[2]).toBeCloseTo(t * H, 3);
      expect(upper.measurements.bounds.max[2]).toBeCloseTo(H, 3);
      expect(lower.measurements.bounds.min[2]).toBeCloseTo(0, 3);
      expect(lower.measurements.bounds.max[2]).toBeCloseTo(t * H, 3);
      // Neither part was rescaled: together they fill the whole's box.
      for (const axis of [0, 1, 2] as const) expect(model.size[axis]).toBeCloseTo(whole.measurements.size[axis], 3);
      expect(model.name).toBe('cone-parallel-section');
      expect(lower.name).toBe('cone-lower-part');
      expect(upper.name).toBe('cone-upper-part');
    },
  );

  it('gives 1/8 and 7/8 of the volume at half the height', () => {
    const { lower, upper } = partsOf(build(shape, 50));
    expect(upper.measurements.volume / (lower.measurements.volume + upper.measurements.volume)).toBeCloseTo(1 / 8, 5);
  });

  it('scales the whole cone first, so that both parts keep its scale', () => {
    const [small, large] = [build(shape, 30, undefined, 80), build(shape, 30, undefined, 160)].map(partsOf) as [
      ReturnType<typeof partsOf>,
      ReturnType<typeof partsOf>,
    ];
    for (const axis of [0, 1, 2] as const) {
      expect(large.upper.measurements.size[axis]).toBeCloseTo(2 * small.upper.measurements.size[axis], 2);
      expect(large.lower.measurements.size[axis]).toBeCloseTo(2 * small.lower.measurements.size[axis], 2);
    }
    expect(coneSection(shape, { longestDimensionMm: 160 }, 30).plane.offset).toBeCloseTo(
      2 * coneSection(shape, scale, 30).plane.offset,
      9,
    );
  });
});

describe('connector proportions', () => {
  it('follow the model’s longest side, not the section, which only sets a pair’s spacing and a tongue’s length', () => {
    const planAt = (positionPercent: number, longest = M) =>
      planRoundConnectors(cone(2), { longestDimensionMm: longest }, positionPercent, plug(2));
    const [low, high] = [planAt(20), planAt(60)];
    expect(high.sites[0]?.pinDiameter).toBe(low.sites[0]?.pinDiameter);
    expect(high.insertion).toBe(low.insertion);
    expect(low.sites[0]?.pinDiameter).toBeCloseTo(5, 12);
    expect(low.insertion).toBeCloseTo(4, 12);
    expect(planAt(20, 160).sites[0]?.pinDiameter).toBeCloseTo(10, 12);
    // 45 % of the section's half span.
    expect(low.sites[0]?.along).toBeCloseTo(0.45 * 40 * 0.8, 9);
    expect(high.sites[0]?.along).toBeCloseTo(0.45 * 40 * 0.4, 9);
    const dove = (positionPercent: number) => planDovetail(cone(2), scale, positionPercent, dovetail());
    expect(dove(20).height).toBe(dove(60).height);
    expect(dove(20).length).toBeCloseTo(0.5 * 2 * 40 * 0.8, 9);
  });
});

const FEASIBLE: readonly (readonly [string, ConeShape, number])[] = [
  ['a right cone at 50 %', cone(2), 50],
  ['a right cone at 25 %', cone(2), 25],
  ['a slim cone at 40 %', cone(4), 40],
  ['an oblique cone at 30 %', cone(2, 1), 30],
  ['a strongly leaning cone at 25 %', cone(2, 2), 25],
];

describe.each(FEASIBLE)('connectors on %s', (_, shape, positionPercent) => {
  const section = coneSection(shape, scale, positionPercent);

  it.each([
    ['a plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['a dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
    ['a dovetail', dovetail(), 2],
  ] as const)('%s builds separate closed objects, verified in three dimensions', (__, connector, objects) => {
    const model = build(shape, positionPercent, connector);
    expect(model.solids).toHaveLength(objects);
    for (const solid of model.solids) {
      expect(findMeshDefects(solid.mesh)).toEqual([]);
      withScope((track) => {
        const pieces = manifoldOf(track, solid.mesh).decompose();
        for (const piece of pieces) track(piece);
        expect(pieces).toHaveLength(1);
      });
    }
  });

  it('stands one plug on the centroid along n, and a keyed pair symmetric along u', () => {
    const one = planRoundConnectors(shape, scale, positionPercent, plug(1));
    expect(one.frame.n).toEqual([0, 0, 1]);
    expect(one.sites[0]?.centre).toEqual(section.frame.origin);
    const two = planRoundConnectors(shape, scale, positionPercent, dowel(2));
    const [first, second] = two.sites as [(typeof two.sites)[number], (typeof two.sites)[number]];
    expect(first.along).toBeCloseTo(-second.along, 12);
    expect(first.centre[1] - second.centre[1]).toBeCloseTo(2 * first.along, 9);
    expect(first.centre[0]).toBeCloseTo(second.centre[0], 12);
    expect(second.pinDiameter).toBeCloseTo(ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * first.pinDiameter, 12);
  });

  it.each([
    ['plugs', plug(2)],
    ['dowels', dowel(2)],
  ] as const)('solves exact bounds for %s: each end passes the plan’s checks, past it they fail', (__, connector) => {
    const { parameters, issues } = roundConnectorFeasibility(shape, scale, positionPercent, connector);
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

  it('builds at the ends of the diameter and the depth', () => {
    const { diameter, insertion } = roundConnectorFeasibility(shape, scale, positionPercent, plug(1)).parameters;
    const diameterFactor = diameter.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.diameter * M);
    expect(() => build(shape, positionPercent, plug(1, { diameterFactor }))).not.toThrow();
    const depthFactor = insertion.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);
    expect(() => build(shape, positionPercent, plug(1, { depthFactor }))).not.toThrow();
    expect(() => build(shape, positionPercent, plug(1, { depthFactor: depthFactor * 1.01 }))).toThrow(ConnectorUnsuitableError);
  });
});

describe('a cavity in the narrowing upper cone', () => {
  // R = 40 mm, H = 80 mm, t = 0,8: the section's radius is 8 mm; a hole 5,2 mm wide and 12,3 mm deep.
  const [shape, t] = [cone(2), 80] as const;
  const deep = plug(1, { depthFactor: 3 });

  it('that fits at the entrance but not at its blind end is refused, even before any minimum wall', () => {
    const plan = planRoundConnectors(shape, scale, t, deep);
    expect(plan.holeDepth).toBeCloseTo(12.3, 12);
    const codes = plan.issues.map(({ code }) => code);
    expect(codes).toEqual(['hole-bottom-thin']);
    // At the blind end the cone's radius is 8 − 12,3/2 = 1,85 mm against the hole's 2,6 mm: measured normal to the surface.
    const slant = 2 / Math.sqrt(5);
    const bottom = plan.issues[0]?.valueMm as number;
    expect(bottom).toBeLessThan(0);
    expect(bottom).toBeCloseTo((1.85 - 2.6) * slant, 1);
    expect(() => build(shape, t, deep)).toThrow(ConnectorUnsuitableError);
    // Measured as a mouth only, the same hole would look fine: the entrance keeps its wall.
    expect((8 - 2.6 - 0.4) * slant).toBeGreaterThan(WALL);
  });

  it('really leaves the cone: the cutter sticks out of the actual solid', () => {
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, shape, scale);
      const { plane } = coneSection(shape, scale, t);
      const split = splitByPlane(track, solid, plane);
      const plan = planRoundConnectors(shape, scale, t, deep);
      const built = buildRoundConnectors(kernel, track, { lower: split.negative, upper: split.positive }, plan);
      const cutter = built.sites[0]?.cutters.upper as Manifold;
      expect(track(cutter.subtract(solid)).volume()).toBeGreaterThan(1);
    });
  });

  it('gets a depth bound that shrinks towards the apex, unlike a cylinder’s constant radius', () => {
    const depthAt = (position: number) =>
      roundConnectorFeasibility(shape, scale, position, plug(1)).parameters.insertion.bounds.max;
    expect(depthAt(50)).toBeGreaterThan(depthAt(60));
    expect(depthAt(60)).toBeGreaterThan(depthAt(70));
    expect(depthAt(70)).toBeGreaterThan(depthAt(80));
  });

  it('in the lower part of a dowel widens downwards, so the upper hole alone decides', () => {
    const { issues } = planRoundConnectors(shape, scale, t, dowel(1, { depthFactor: 3 }));
    const bottoms = issues.filter(({ code }) => code === 'hole-bottom-thin');
    expect(bottoms.map((issue) => ('part' in issue ? issue.part : undefined))).toEqual(['upper']);
  });

  it('in the lower part is checked against the base as well', () => {
    // At 10 % the frustum is 8 mm thick: a dowel entering it 8 mm reaches through the base.
    const { issues } = planRoundConnectors(shape, scale, 10, dowel(1, { depthFactor: 2 }));
    expect(issues.some((issue) => issue.code === 'hole-bottom-thin' && 'part' in issue && issue.part === 'lower')).toBe(true);
  });

  it('that a right cone would hold breaks out of an oblique one, whose section moves off the hole’s fixed axis', () => {
    // d = H: R = 80/3 mm, H = 160/3 mm, and at 60 % the section's radius is 32/3 mm. A right cone of the same R and H takes
    // the same hole of diameter 5 mm and 6,3 mm deep: its surface recedes by R/H per millimetre, the oblique one's near side by R/H + d/H.
    const oblique = cone(2, 2);
    const { radius, height } = roundDimensionsMm(oblique, scale);
    const [right, rightScale] = [cone(2), { longestDimensionMm: 2 * radius }] as const;
    expect(roundDimensionsMm(right, rightScale).height).toBeCloseTo(height, 9);
    const hole = (longest: number) =>
      plug(1, {
        diameterFactor: 5 / (ROUND_CONNECTOR_PROPORTIONS.diameter * longest),
        depthFactor: 6 / (ROUND_CONNECTOR_PROPORTIONS.insertion * longest),
      });
    expect(planRoundConnectors(right, rightScale, 60, hole(rightScale.longestDimensionMm)).issues).toEqual([]);
    const leaning = planRoundConnectors(oblique, scale, 60, hole(M));
    expect(leaning.issues.map(({ code }) => code)).toEqual(['hole-bottom-thin']);
    // The entrance alone is fine: the mouth keeps its wall.
    const section = coneSection(oblique, scale, 60);
    expect(section.frame.origin[0]).toBeCloseTo(0.6 * (2 * radius), 9);
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, oblique, scale);
      const split = splitByPlane(track, solid, section.plane);
      const built = buildRoundConnectors(kernel, track, { lower: split.negative, upper: split.positive }, leaning);
      const outside = track(((built.sites[0] as (typeof built.sites)[number]).cutters.upper as Manifold).subtract(solid));
      // It leaves on the side away from the lean, towards −X.
      expect(outside.volume()).toBeGreaterThan(VOLUME_TOLERANCE);
      expect(outside.boundingBox().max[0]).toBeLessThan(section.frame.origin[0]);
    });
  });
});

describe('an empty feasible interval', () => {
  it('near the apex is reported with no value to pick, not as reversed bounds', () => {
    const { parameters, issues } = roundConnectorFeasibility(cone(2), scale, 90, plug(1));
    expect(issues.length).toBeGreaterThan(0);
    const { diameter, insertion } = parameters;
    expect(hasFeasibleValues(diameter.bounds)).toBe(false);
    expect(hasFeasibleValues(insertion.bounds)).toBe(false);
    expect(() => build(cone(2), 90, plug(1))).toThrow(ConnectorUnsuitableError);
    // Smooth surfaces stay available there.
    expect(() => build(cone(2), 90)).not.toThrow();
  });
});

const DOVETAILS: readonly (readonly [string, ConeShape, number])[] = [
  ['a right cone at 50 %', cone(2), 50],
  ['a right cone at 30 %', cone(2), 30],
  ['an oblique cone at 40 %', cone(2, 1), 40],
];

describe.each(DOVETAILS)('a dovetail on %s', (_, shape, positionPercent) => {
  const section = coneSection(shape, scale, positionPercent);
  const connector = dovetail({ lengthPercent: 40 });
  const model = build(shape, positionPercent, connector);
  const plan = (model.section as ModelSection).connector as DovetailPlan;
  const { lower, upper } = partsOf(model);
  const { n, u } = plan.frame;
  const inTongue: Vec3 = [
    section.frame.origin[0] + (plan.height / 2) * n[0],
    section.frame.origin[1],
    section.frame.origin[2] + plan.height / 2,
  ];
  const along = (point: Vec3, distance: number): Vec3 => [
    point[0] + distance * u[0],
    point[1] + distance * u[1],
    point[2] + distance * u[2],
  ];

  it('keeps the horizontal cut’s convention: tongue below, stop at +u, entrance at −u, not a slope’s rule', () => {
    expect(plan.frame.u).toEqual([0, 1, 0]);
    expect(plan.frame.n).toEqual([0, 0, 1]);
    withScope((track) => {
      const [partLower, partUpper] = [manifoldOf(track, lower.mesh), manifoldOf(track, upper.mesh)];
      expect(hasMaterialAt(track, partLower, inTongue)).toBe(true);
      expect(hasMaterialAt(track, partUpper, inTongue)).toBe(false);
      // Past the closed end, the stop.
      expect(hasMaterialAt(track, partUpper, along(inTongue, plan.length / 2 + plan.clearance + 0.3))).toBe(true);
      // Towards the entrance the channel is open up to the surface.
      expect(hasMaterialAt(track, partUpper, along(inTongue, -(plan.length / 2 + 0.5)))).toBe(false);
      expect(hasMaterialAt(track, partUpper, along(inTongue, -section.span / 2 + 0.5))).toBe(false);
    });
  });

  it('clears the whole path, and is held at the stop and along the normal', () => {
    withScope((track) => {
      const [partLower, partUpper] = [manifoldOf(track, lower.mesh), manifoldOf(track, upper.mesh)];
      const overlapAfter = (move: Vec3) =>
        track(track(partLower.translate([...move] as KernelVec3)).intersect(partUpper)).volume();
      // The upper part comes off along +u: the lower one, seen from it, along −u.
      for (const share of [0, 0.2, 0.5, 0.8, 1]) {
        const distance = share * plan.exitDistance;
        expect(overlapAfter([-u[0] * distance, -u[1] * distance, -u[2] * distance])).toBeLessThan(VOLUME_TOLERANCE);
      }
      expect(overlapAfter([u[0] * (plan.clearance + 0.1), u[1] * (plan.clearance + 0.1), 0])).toBeGreaterThan(VOLUME_TOLERANCE);
      expect(overlapAfter([0, 0, plan.normalPlay + 0.1])).toBeGreaterThan(VOLUME_TOLERANCE);
    });
  });

  it('has the groove’s one opening beyond the seated tongue, towards the entrance', () => {
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, shape, scale);
      const outside = track(grooveCutter(kernel, track, plan).subtract(solid));
      const pieces = outside.decompose();
      for (const piece of pieces) track(piece);
      expect(pieces).toHaveLength(1);
      expect(outside.boundingBox().max[1]).toBeLessThan(section.frame.origin[1] - plan.length / 2);
    });
  });

  it('keeps the roof and the stop that the plan reports, to the actual surface', () => {
    const issues = dovetailChecks(section, dovetailDimensions(connector, M, section.span / 2));
    const roof = issues.find(({ code }) => code === 'backing-thin') as { valueMm: number };
    const stop = issues.find(({ code }) => code === 'stop-thin') as { valueMm: number };
    expect(roof.valueMm).toBeGreaterThanOrEqual(WALL);
    expect(stop.valueMm).toBeGreaterThanOrEqual(WALL);
    // Every point of the groove's top corners keeps at least that distance to the upper part's faces.
    const faces = facesOfPart(section, 'positive');
    const halfWidth = plan.grooveProfile.reduce((largest, [x]) => Math.max(largest, Math.abs(x)), 0);
    const top = plan.height + plan.clearance;
    const closest = Math.min(
      ...faces.flatMap((face) =>
        [-plan.length / 2, plan.length / 2 + plan.clearance].flatMap((position) =>
          [-halfWidth, halfWidth].map((across) => pointWall(face, position, across, top)),
        ),
      ),
    );
    expect(closest).toBeCloseTo(Math.min(roof.valueMm, stop.valueMm), 6);
  });

  it('solves bounds from the full profile: a taller tongue, with its wider groove, leaves less room along the plane', () => {
    const { length } = dovetailFeasibility(shape, scale, positionPercent, connector).parameters;
    const taller = dovetailFeasibility(shape, scale, positionPercent, dovetail({ lengthPercent: 40, sizeFactor: 2 })).parameters
      .length;
    expect(taller.bounds.max).toBeLessThan(length.bounds.max);
    const percent = (100 * length.bounds.max) / section.span;
    expect(() => build(shape, positionPercent, dovetail({ lengthPercent: percent }))).not.toThrow();
    expect(() => build(shape, positionPercent, dovetail({ lengthPercent: percent + 1 }))).toThrow(ConnectorUnsuitableError);
  });
});

describe('a dovetail near the apex', () => {
  it('whose footprint fits the section but whose expanded groove does not is refused for its roof', () => {
    // At 80 % the section's radius is 8 mm. h = 4 mm: the neck is 12 mm wide, the top 20 mm, wider than the whole section.
    const connector = dovetail({ sizeFactor: 2, lengthPercent: 18.75 });
    const plan = planDovetail(cone(2), scale, 80, connector);
    expect(plan.length).toBeCloseTo(3, 9);
    expect(plan.issues.map(({ code }) => code)).toContain('backing-thin');
    expect(plan.issues.map(({ code }) => code)).not.toContain('groove-wall-thin');
    expect(() => build(cone(2), 80, connector)).toThrow(ConnectorUnsuitableError);
  });

  it('whose stop would break through the surface is refused for its stop', () => {
    const plan = planDovetail(cone(2), scale, 50, dovetail({ lengthPercent: 95 }));
    expect(plan.issues.map(({ code }) => code)).toContain('stop-thin');
  });

  it('that leaves no room at this position is refused, smooth surfaces staying available', () => {
    expect(() => build(cone(2), 90, dovetail())).toThrow(ConnectorUnsuitableError);
    expect(() => build(cone(2), 90)).not.toThrow();
  });
});

describe('the print file of a cone’s section', () => {
  const objectsOf = async (shape: ConeShape, positionPercent: number, connector?: Connector) => {
    const { printFile, model } = await buildModelArtifacts(kernel, specOf(shape, positionPercent, connector));
    const { unit, objects } = readThreeMf(printFile.bytes).model;
    expect(unit).toBe('millimeter');
    expect(printFile.fileName).toBe('cone-parallel-section.3mf');
    return { objects, model };
  };
  const bedDownArea = (mesh: TriangleMesh) => {
    let area = 0;
    for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
      if (corners(mesh, triangle).every(([, , z]) => Math.abs(z) < 1e-3)) area += triangleArea(mesh, triangle);
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
  ] as const)('with %s holds independent objects on the bed, apart, at their own scale', async (_, connector, count) => {
    for (const shape of [cone(2), cone(2, 1)]) {
      const { objects, model } = await objectsOf(shape, 40, connector);
      expect(objects).toHaveLength(count);
      objects.forEach(({ mesh, name }, index) => {
        const solid = model.solids[index] as Solid;
        expect(name).toBe(solid.name);
        expect(findMeshDefects(mesh)).toEqual([]);
        const measured = measureMesh(mesh);
        expect(measured.volume).toBeCloseTo(solid.measurements.volume, 0);
        for (const axis of [0, 1, 2] as const) {
          expect(Math.max(...measured.size)).toBeCloseTo(Math.max(...solid.measurements.size), 3);
          expect(measured.size[axis]).toBeGreaterThan(0);
        }
        expect(measured.bounds.min[2]).toBeCloseTo(0, 4);
        if (index > 0) {
          const previous = measureMesh((objects[index - 1] as (typeof objects)[number]).mesh).bounds.max[0];
          expect(measured.bounds.min[0] - previous).toBeCloseTo(5, 3);
        }
      });
    }
  });

  it('stands the frustum on the original base and the upper cone on its cut face, apex up', async () => {
    const [R, H] = [40, 80];
    const { objects } = await objectsOf(cone(2), 50);
    const [lower, upper] = objects as [(typeof objects)[number], (typeof objects)[number]];
    expect(bedDownArea(lower.mesh)).toBeCloseTo(Math.PI * R ** 2, -2);
    expect(bedDownArea(upper.mesh)).toBeCloseTo(Math.PI * (R / 2) ** 2, -1);
    const { bounds } = measureMesh(upper.mesh);
    expect(bounds.max[2]).toBeCloseTo(H / 2, 3);
    // A single vertex, the apex, at the top: not turned over onto a face it does not have.
    const top = Array.from({ length: vertexCount(upper.mesh) }, (_, vertex) => vertexAt(upper.mesh, vertex)).filter(
      ([, , z]) => Math.abs(z - bounds.max[2]) < 1e-3,
    );
    expect(top).toHaveLength(1);
  });

  it('opens the upper part’s holes and groove towards the bed', async () => {
    for (const connector of [plug(1), dovetail()]) {
      const { objects } = await objectsOf(cone(2), 50, connector);
      const upper = (objects[1] as (typeof objects)[number]).mesh;
      // The cut face rests on the bed with the cavity's opening missing from it.
      const full = Math.PI * 20 ** 2;
      expect(bedDownArea(upper)).toBeLessThan(full - 10);
      expect(bedDownArea(upper)).toBeGreaterThan(0.5 * full);
      expect(measureMesh(upper).size[2]).toBeCloseTo(40, 3);
    }
  });

  it('stands the dowels upright on an end face', async () => {
    const { objects } = await objectsOf(cone(2), 40, dowel(2));
    for (const { mesh } of objects.slice(2)) expect(measureMesh(mesh).size[2]).toBeCloseTo(8, 3);
  });
});

describe('the separated preview of a cone’s section', () => {
  const nodeOffsets = async (glb: Uint8Array) => {
    const root = (await new WebIO().readBinary(glb)).getRoot();
    return Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()]));
  };

  it.each([
    ['flat faces', undefined],
    ['plugs', plug(1)],
    ['dowels', dowel(2)],
  ] as const)('lifts the upper part along the normal with %s, without changing the print file', async (_, connector) => {
    const spec = specOf(cone(2, 1), 40, connector);
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

  it('slides the upper part off the tongue along +u with a dovetail', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(cone(2), 50, dovetail()));
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

describe('whatever the cone', () => {
  it('builds at a solved end where a part’s coincident surface once left a Boolean sliver in a check', () => {
    expect(() => build(cone(0.5), 60, dovetail({ sizeFactor: 1.2930328940008298, lengthPercent: 20 }))).not.toThrow();
  });

  it('builds or refuses each of a seeded sample, and never fails its three-dimensional checks', { timeout: 60_000 }, () => {
    let seed = 20261109;
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
        const { solids } = build(shape, 10 + 80 * random(), connector, pick([40, 80, 120]));
        for (const solid of solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
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
