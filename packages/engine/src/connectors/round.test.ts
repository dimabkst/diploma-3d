import {
  type CylinderShape,
  type DowelConnector,
  type ModelSpecInput,
  type PlugConnector,
  type RoundConnector,
} from '@diploma-3d/schema';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorUnsuitableError, ConnectorVerificationError } from '../errors.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects, type TriangleMesh, type Vec3, vertexAt, vertexCount } from '../mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import { roundDimensionsMm } from '../shapes/round.ts';
import { cylinderSection } from './frame.ts';
import {
  planRoundConnectors,
  ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM,
  type RoundConnectorPlan,
  roundConnectorDimensionsMm,
} from './round.ts';

// Loaded before collection: the cases below are built while the suites are defined.
const kernel: GeometryKernel = await loadGeometryKernel();

afterEach(() => {
  vi.restoreAllMocks();
});

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
const spec = (shape: CylinderShape, positionPercent: number, connector: RoundConnector, longest = 80): ModelSpecInput => ({
  shape,
  scale: { longestDimensionMm: longest },
  section: { type: 'parallel-to-bases', positionPercent, connector },
});

const VOLUME_TOLERANCE = 1e-3;

function joined(model: GeneratedModel) {
  const plan = model.section?.connector;
  const [lower, upper, ...dowels] = model.solids;
  if (lower === undefined || upper === undefined || plan === undefined || (plan.type !== 'plug' && plan.type !== 'dowel')) {
    throw new Error('Expected parts joined by plugs or dowels');
  }
  return { lower, upper, dowels, plan };
}

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const volumeOf = (track: Track, manifold: Manifold) => track(manifold).volume();
const shifted = (vector: Vec3, distance: number): KernelVec3 => [
  vector[0] * distance,
  vector[1] * distance,
  vector[2] * distance,
];

/** The mesh's vertices as (distance from the axis through `centre` along n, height along n above the cut). */
function axial(mesh: TriangleMesh, centre: Vec3) {
  return Array.from({ length: vertexCount(mesh) }, (_, vertex) => {
    const [x, y, z] = vertexAt(mesh, vertex);
    return { radial: Math.hypot(x - centre[0], y - centre[1]), height: z - centre[2] };
  });
}

/**
 * A blind hole around the axis: its depth from the bottom's vertex on the axis, and its radius from the hole's own
 * vertex rings between the entrance and the bottom. The part's outer walls stay more than the minimum wall away, so a
 * search radius 0,5 mm wider than the hole does not reach them.
 */
function holeOf(mesh: TriangleMesh, centre: Vec3, expectedRadius: number, direction: 1 | -1) {
  const points = axial(mesh, centre).map(({ radial, height }) => ({ radial, height: direction * height }));
  const depth = Math.max(...points.filter(({ radial, height }) => radial < 1e-3 && height > 0).map(({ height }) => height));
  const radius = Math.max(
    ...points
      .filter(({ radial, height }) => radial <= expectedRadius + 0.5 && height > 0.01 && height <= depth + 1e-4)
      .map(({ radial }) => radial),
  );
  return { radius, depth };
}

describe('round connector dimensions', () => {
  it.each([
    [60, 3.75, 3],
    [80, 5, 4],
    [120, 7.5, 6],
  ])('at M = %s mm with both multipliers 1: d = %s mm, e = %s mm', (longest, d, e) => {
    const dimensions = roundConnectorDimensionsMm(1, 1, longest);
    expect(dimensions.diameter).toBeCloseTo(d, 12);
    expect(dimensions.insertion).toBeCloseTo(e, 12);
  });

  it('gives a pair d and 0,8d, holes e + 0,3 mm deep and chamfers min(0,08·d, 0,2·e) at M = 80 mm', () => {
    const plan = planRoundConnectors(cylinder(2), { longestDimensionMm: 80 }, 50, dowel(2));
    expect(plan.sites.map(({ pinDiameter }) => pinDiameter)).toEqual([5, 4]);
    expect(plan.insertion).toBe(4);
    expect(plan.holeDepth).toBeCloseTo(4.3, 12);
    expect(plan.sites.map(({ chamfer }) => Number(chamfer.toFixed(12)))).toEqual([0.4, 0.32]);
    expect(plan.clearance).toEqual({ lower: 0.1, upper: 0.2 });
    // e − 0,3 mm of play − both 0,4 mm chamfers.
    expect(plan.straightEngagement).toBeCloseTo(2.9, 12);
    expect(planRoundConnectors(cylinder(2), { longestDimensionMm: 80 }, 50, plug(1)).straightEngagement).toBeCloseTo(3.2, 12);
  });

  it('keeps d, e, the depth and the chamfers when only the cylinder’s proportions change', () => {
    const plans = [0.5, 2, 4, 8].map((ratio) => planRoundConnectors(cylinder(ratio), { longestDimensionMm: 80 }, 50, dowel(1)));
    for (const plan of plans) {
      expect(plan.sites.map(({ pinDiameter, chamfer }) => [pinDiameter, chamfer])).toEqual(
        plans[0]?.sites.map(({ pinDiameter, chamfer }) => [pinDiameter, chamfer]),
      );
      expect([plan.insertion, plan.holeDepth]).toEqual([plans[0]?.insertion, plans[0]?.holeDepth]);
    }
  });

  it('centres one connector on the section and puts a pair at C ± ρ·r along u, perpendicular to the lean', () => {
    const shape = cylinder(2, 1);
    const scale = { longestDimensionMm: 80 };
    const { radius: r, height: H, offset: d } = roundDimensionsMm(shape, scale);
    const { frame } = cylinderSection(shape, scale, 30);
    expect(frame.origin).toEqual([0.3 * d, 0, 0.3 * H]);
    expect(frame.u).toEqual([0, 1, 0]);
    expect(frame.n).toEqual([0, 0, 1]);
    expect(planRoundConnectors(shape, scale, 30, plug(1)).sites.map(({ centre }) => centre)).toEqual([frame.origin]);
    const [first, second] = planRoundConnectors(shape, scale, 30, plug(2, { spacingPercent: 60 })).sites;
    expect(first?.centre[0]).toBeCloseTo(0.3 * d, 12);
    expect(first?.centre[1]).toBeCloseTo(0.6 * r, 12);
    expect(second?.centre[1]).toBeCloseTo(-0.6 * r, 12);
    expect([first?.pinDiameter, second?.pinDiameter]).toEqual([5, 4]);
  });
});

describe('planRoundConnectors rejects', () => {
  it.each([
    [
      'too thin a pin at M = 48 mm, kd = 0,75',
      'plug',
      cylinder(0.5),
      50,
      plug(1, { diameterFactor: 0.75 }),
      48,
      ['pin-too-thin'],
    ],
    [
      'too short an engagement at M = 48 mm, ke = 0,75',
      'dowel',
      cylinder(0.5),
      50,
      dowel(1, { depthFactor: 0.75 }),
      48,
      ['engagement-short'],
    ],
    [
      'a pair that a 0,4 mm clearance no longer keys',
      'plug',
      cylinder(0.5),
      50,
      plug(2, { spacingPercent: 25, holeClearanceMm: 0.4 }),
      60,
      ['keying-lost'],
    ],
    [
      'the same pair of dowels',
      'dowel',
      cylinder(0.5),
      50,
      dowel(2, { spacingPercent: 25, upperClearanceMm: 0.4 }),
      60,
      ['keying-lost'],
    ],
    [
      'holes too close to the side of a slim cylinder',
      'plug',
      cylinder(8),
      10,
      plug(2, { spacingPercent: 65, diameterFactor: 1.5, depthFactor: 1.5 }),
      48,
      ['hole-wall-thin/upper'],
    ],
    [
      'holes too close to each other',
      'plug',
      cylinder(8),
      10,
      plug(2, { spacingPercent: 25, diameterFactor: 1.5, depthFactor: 1.5 }),
      48,
      ['holes-too-close/upper'],
    ],
    [
      'dowel holes too close to each other in both parts',
      'dowel',
      cylinder(8),
      50,
      dowel(2, { spacingPercent: 25, diameterFactor: 1.5, depthFactor: 1.5 }),
      48,
      ['holes-too-close/upper', 'holes-too-close/lower'],
    ],
    [
      'a thin floor under the upper hole',
      'plug',
      cylinder(0.5),
      90,
      plug(1, { depthFactor: 1.5 }),
      48,
      ['hole-bottom-thin/upper'],
    ],
    [
      'a thin floor under the lower dowel hole',
      'dowel',
      cylinder(0.5),
      10,
      dowel(1, { depthFactor: 1.5 }),
      48,
      ['hole-bottom-thin/lower'],
    ],
    ['a thin lower part under a plug', 'plug', cylinder(0.5), 10, plug(1, { depthFactor: 1.5 }), 48, ['base-thin']],
  ] as const)('%s', (_, __, shape, position, connector, longest, codes) => {
    const { issues } = planRoundConnectors(shape, { longestDimensionMm: longest }, position, connector);
    expect(issues.map((issue) => issue.code + ('part' in issue ? `/${issue.part}` : ''))).toEqual(codes);
    for (const issue of issues) expect(issue.valueMm).toBeLessThan(issue.minimumMm);
  });

  it('accounts for the lean: holes that fit a right cylinder are refused near the oblique side walls', () => {
    const connector = plug(2, { spacingPercent: 65 });
    expect(planRoundConnectors(cylinder(2), { longestDimensionMm: 80 }, 50, connector).issues).toEqual([]);
    const issues = planRoundConnectors(
      cylinder(0.5, 1.866),
      { longestDimensionMm: 80 },
      50,
      plug(2, { spacingPercent: 65, depthFactor: 0.75 }),
    ).issues;
    expect(issues.map((issue) => issue.code)).toContain('hole-wall-thin');
  });

  it('before building anything, without shrinking, moving or dropping a connector', () => {
    const cylinderBuild = vi.spyOn(kernel.Manifold, 'cylinder');
    expect(() => generateModel(kernel, spec(cylinder(0.5), 90, plug(1, { depthFactor: 1.5 }), 48))).toThrow(
      ConnectorUnsuitableError,
    );
    expect(cylinderBuild).not.toHaveBeenCalled();
  });
});

const cases: readonly (readonly [string, CylinderShape, number, RoundConnector])[] = [
  ['one plug in a right cylinder', cylinder(2), 50, plug(1)],
  ['two plugs in a right cylinder', cylinder(2), 50, plug(2)],
  ['two plugs in an oblique cylinder at 30 %', cylinder(2, 1), 30, plug(2, { spacingPercent: 60, holeClearanceMm: 0 })],
  ['one plug in a slim cylinder', cylinder(8), 50, plug(1, { diameterFactor: 1.5, depthFactor: 1.5 })],
  ['one dowel in a right cylinder', cylinder(2), 50, dowel(1)],
  ['two dowels in a right cylinder', cylinder(2), 50, dowel(2)],
  [
    'two dowels in an oblique cylinder at 70 %',
    cylinder(2, 1),
    70,
    dowel(2, { spacingPercent: 30, lowerClearanceMm: 0, upperClearanceMm: 0.4 }),
  ],
  ['one plug in the flattest oblique cylinder', cylinder(0.5, 1.866), 50, plug(1, { depthFactor: 0.75 })],
];

describe.each(cases)('%s', (_, shape, position, connector) => {
  const model = generateModel(kernel, spec(shape, position, connector));
  const whole = generateModel(kernel, { shape, scale: { longestDimensionMm: 80 } });
  const { lower, upper, dowels, plan } = joined(model);
  const { n } = plan.frame;
  const clearance = plan.clearance;

  it('leaves closed, connected solids: two parts, and one dowel per site', () => {
    expect(plan.issues).toEqual([]);
    expect(dowels).toHaveLength(connector.type === 'dowel' ? connector.count : 0);
    expect(model.solids.map((solid) => [solid.name, solid.part])).toEqual([
      ['cylinder-lower-part', 'lower'],
      ['cylinder-upper-part', 'upper'],
      ...dowels.map((__, index) => [`cylinder-dowel-${index + 1}`, 'dowel']),
    ]);
    withScope((track) => {
      for (const solid of model.solids) {
        expect(findMeshDefects(solid.mesh)).toEqual([]);
        expect(solid.measurements.volume).toBeGreaterThan(0);
        const pieces = manifoldOf(track, solid.mesh).decompose();
        for (const piece of pieces) track(piece);
        expect(pieces).toHaveLength(1);
      }
    });
    expect(model.size).toEqual(whole.size);
  });

  it('has the nominal diameters and lengths, the diametral clearances and the depths, along axes normal to the cut', () => {
    plan.sites.forEach(({ centre, pinDiameter, chamfer }, index) => {
      if (connector.type === 'plug') {
        // The plug: e above the cut, d wide, chamfered to d − 2c at its end.
        const points = axial(lower.mesh, centre).filter(({ radial, height }) => radial < pinDiameter && height > 1e-4);
        expect(Math.max(...points.map(({ height }) => height))).toBeCloseTo(plan.insertion, 4);
        expect(Math.max(...points.map(({ radial }) => radial))).toBeCloseTo(pinDiameter / 2, 4);
        const end = points.filter(({ height }) => Math.abs(height - plan.insertion) < 1e-4);
        expect(Math.max(...end.map(({ radial }) => radial))).toBeCloseTo(pinDiameter / 2 - chamfer, 4);
      } else {
        // The dowel: 2e long from −e to e, d wide, chamfered at both ends.
        const points = axial((dowels[index] as Solid).mesh, centre);
        expect(Math.min(...points.map(({ height }) => height))).toBeCloseTo(-plan.insertion, 4);
        expect(Math.max(...points.map(({ height }) => height))).toBeCloseTo(plan.insertion, 4);
        expect(Math.max(...points.map(({ radial }) => radial))).toBeCloseTo(pinDiameter / 2, 4);
        // Every vertex lies on the axis's cylinder or inside it at every height: the axis is n.
        for (const { radial } of points) expect(radial).toBeLessThanOrEqual(pinDiameter / 2 + 1e-4);
        const lowerHole = holeOf(lower.mesh, centre, (pinDiameter + (clearance.lower ?? 0)) / 2, -1);
        expect(2 * lowerHole.radius - pinDiameter).toBeCloseTo(clearance.lower ?? Number.NaN, 4);
        expect(lowerHole.depth).toBeCloseTo(plan.holeDepth, 4);
      }
      const upperHole = holeOf(upper.mesh, centre, (pinDiameter + clearance.upper) / 2, 1);
      expect(2 * upperHole.radius - pinDiameter).toBeCloseTo(clearance.upper, 4);
      expect(upperHole.depth).toBeCloseTo(plan.insertion + ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM, 4);
    });
  });

  it('fits assembled without overlap, also with a dowel against either hole’s bottom, inside the cylinder', () => {
    withScope((track) => {
      const [lowerM, upperM, wholeM] = [lower.mesh, upper.mesh, whole.solids[0]?.mesh as TriangleMesh].map((mesh) =>
        manifoldOf(track, mesh),
      ) as [Manifold, Manifold, Manifold];
      expect(volumeOf(track, lowerM.subtract(wholeM))).toBeLessThan(VOLUME_TOLERANCE);
      expect(volumeOf(track, upperM.subtract(wholeM))).toBeLessThan(VOLUME_TOLERANCE);
      expect(volumeOf(track, lowerM.intersect(upperM))).toBeLessThan(VOLUME_TOLERANCE);
      for (const solid of dowels) {
        const pin = manifoldOf(track, solid.mesh);
        for (const shift of [-ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM, 0, ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM]) {
          const moved = track(pin.translate(shifted(n, shift)));
          expect(volumeOf(track, moved.intersect(lowerM))).toBeLessThan(VOLUME_TOLERANCE);
          expect(volumeOf(track, moved.intersect(upperM))).toBeLessThan(VOLUME_TOLERANCE);
        }
        // One step further the dowel would hit a bottom: the holes are only the allowance deeper.
        const pushed = track(pin.translate(shifted(n, ROUND_CONNECTOR_DEPTH_ALLOWANCE_MM + 0.05)));
        expect(volumeOf(track, pushed.intersect(upperM))).toBeGreaterThan(VOLUME_TOLERANCE);
      }
    });
  });

  it('comes apart along n: the upper part lifts off, and each dowel leaves the lower part', () => {
    withScope((track) => {
      const lowerM = manifoldOf(track, lower.mesh);
      const upperM = manifoldOf(track, upper.mesh);
      const seated = dowels.map((solid) => manifoldOf(track, solid.mesh));
      // The swept connectors prove the paths clear in the engine; these positions guard against regressions.
      for (let step = 0; step <= 10; step += 1) {
        const lifted = track(upperM.translate(shifted(n, ((plan.holeDepth + 1) * step) / 10)));
        for (const solid of [lowerM, ...seated]) {
          expect(volumeOf(track, lifted.intersect(solid))).toBeLessThan(VOLUME_TOLERANCE);
        }
        for (const pin of seated) {
          const raised = track(pin.translate(shifted(n, ((2 * plan.insertion + 1) * step) / 10)));
          expect(volumeOf(track, raised.intersect(lowerM))).toBeLessThan(VOLUME_TOLERANCE);
        }
      }
    });
  });

  it.runIf(plan.sites.length === 2)('keys a pair: turned by 180° about the section’s axis, the parts do not mate', () => {
    withScope((track) => {
      const upperM = manifoldOf(track, upper.mesh);
      const [cx, cy] = plan.frame.origin;
      const turned = track(track(track(upperM.translate([-cx, -cy, 0])).rotate([0, 0, 180])).translate([cx, cy, 0]));
      const mating =
        connector.type === 'plug' ? [manifoldOf(track, lower.mesh)] : dowels.map((solid) => manifoldOf(track, solid.mesh));
      const interference = mating.reduce((sum, solid) => sum + volumeOf(track, turned.intersect(solid)), 0);
      expect(interference).toBeGreaterThan(1);
    });
  });
});

describe('round connectors and the print size', () => {
  it.each([60, 120])('scale with M = %s mm while the clearances stay in millimetres', (longest) => {
    const model = generateModel(kernel, spec(cylinder(2), 50, dowel(1), longest));
    const { upper, dowels, plan } = joined(model);
    const [site] = plan.sites as [RoundConnectorPlan['sites'][number]];
    const factor = longest / 80;
    expect(site.pinDiameter).toBeCloseTo(5 * factor, 12);
    const pin = axial((dowels[0] as Solid).mesh, site.centre);
    expect(Math.max(...pin.map(({ height }) => height)) - Math.min(...pin.map(({ height }) => height))).toBeCloseTo(
      8 * factor,
      4,
    );
    const hole = holeOf(upper.mesh, site.centre, (site.pinDiameter + 0.2) / 2, 1);
    expect(2 * hole.radius - site.pinDiameter).toBeCloseTo(0.2, 4);
    expect(hole.depth).toBeCloseTo(4 * factor + 0.3, 4);
  });

  it.each([0.5, 2, 4, 8])('keep d = 5 mm and a 8 mm dowel when only h/r changes, here %s', (heightRatio) => {
    const { dowels, plan } = joined(generateModel(kernel, spec(cylinder(heightRatio), 50, dowel(1))));
    const pin = axial((dowels[0] as Solid).mesh, plan.sites[0]?.centre as Vec3);
    expect(Math.max(...pin.map(({ radial }) => radial))).toBeCloseTo(2.5, 4);
    expect(Math.max(...pin.map(({ height }) => height)) - Math.min(...pin.map(({ height }) => height))).toBeCloseTo(8, 4);
  });
});

describe('round connectors release their Manifold objects', () => {
  const methods = ['add', 'subtract', 'intersect', 'translate', 'transform', 'splitByPlane', 'decompose'] as const;
  const isDeleted = (manifold: Manifold) => (manifold as unknown as { isDeleted(): boolean }).isDeleted();

  function trackAll() {
    const created: Manifold[] = [];
    const record = <T>(result: T): T => {
      if (Array.isArray(result)) created.push(...(result as Manifold[]));
      else created.push(result as Manifold);
      return result;
    };
    const instance = kernel.Manifold.cube(1);
    const prototype = Object.getPrototypeOf(instance) as Manifold;
    instance.delete();
    for (const method of methods) {
      const original = prototype[method] as (...args: unknown[]) => unknown;
      vi.spyOn(prototype, method).mockImplementation(function (this: Manifold, ...args: unknown[]) {
        return record(original.apply(this, args));
      } as never);
    }
    for (const method of ['cylinder', 'hull', 'revolve'] as const) {
      const original = kernel.Manifold[method] as (...args: unknown[]) => unknown;
      vi.spyOn(kernel.Manifold, method).mockImplementation(((...args: unknown[]) =>
        record(original.apply(kernel.Manifold, args))) as never);
    }
    return { created, prototype };
  }

  it.each([
    ['two plugs', plug(2)],
    ['two dowels', dowel(2)],
  ] as const)('after building and verifying %s', (_, connector) => {
    const { created } = trackAll();
    generateModel(kernel, spec(cylinder(2, 1), 50, connector));
    expect(created.length).toBeGreaterThan(20);
    expect(created.every(isDeleted)).toBe(true);
  });

  it('when a verification fails', () => {
    const { created, prototype } = trackAll();
    vi.spyOn(prototype, 'volume').mockReturnValue(1e9);
    expect(() => generateModel(kernel, spec(cylinder(2), 50, dowel(2)))).toThrow(ConnectorVerificationError);
    expect(created.every(isDeleted)).toBe(true);
  });

  it('when drilling throws', () => {
    const { created, prototype } = trackAll();
    vi.spyOn(prototype, 'subtract').mockImplementation(() => {
      throw new Error('out of memory');
    });
    expect(() => generateModel(kernel, spec(cylinder(2), 50, plug(2)))).toThrow('out of memory');
    expect(created.length).toBeGreaterThan(3);
    expect(created.every(isDeleted)).toBe(true);
  });
});
