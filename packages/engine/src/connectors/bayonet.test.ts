import { BAYONET_LIMITS, type BayonetConnector, DEFAULT_BAYONET, modelSpecSchema } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModelArtifacts } from '../artifacts.ts';
import { ConnectorUnsuitableError } from '../errors.ts';
import { readThreeMf } from '../export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects, type TriangleMesh, triangleAreaVector, triangleCount, vertexAt } from '../mesh.ts';
import { generateModel, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import {
  BAYONET_FLEXURE,
  BAYONET_MINIMUMS_MM,
  BAYONET_TRAVEL_DEG,
  type BayonetDimensions,
  type BayonetLayout,
  bayonetChecks,
  bayonetDimensions,
  bayonetFeasibility,
  bayonetFlexureStrain,
  bayonetFlexureTravel,
  bayonetLayout,
  bayonetSupported,
  buildBayonetCavity,
  buildBayonetCorridor,
  buildBayonetMale,
  buildBayonetRigidBody,
  buildBayonetSweeps,
  buildBayonetTrial,
  leastBayonetProjection,
  planBayonet,
} from './bayonet.ts';
import { defaultBayonet, normalizeBayonet } from './bayonet-capacity.ts';
import { CONNECTOR_MIN_WALL_MM, cylinderSection, satisfies } from './frame.ts';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

/** The reference: 100 mm high, 60 mm in diameter, cut halfway. */
const cylinder = (heightRatio = 100 / 30, offsetRatio = 0) => ({ kind: 'cylinder', heightRatio, offsetRatio }) as const;
const scale = { longestDimensionMm: 100 };
const connector = (overrides: Partial<BayonetConnector> = {}): BayonetConnector => ({
  type: 'bayonet',
  stemDiameterMm: 15,
  projectionMm: 15,
  ...DEFAULT_BAYONET,
  ...overrides,
});
const dimensions = (overrides: Partial<BayonetConnector> = {}): BayonetDimensions => bayonetDimensions(connector(overrides));
const spec = (bayonet: BayonetConnector, position = 50, shape = cylinder(), size = scale) => ({
  shape,
  scale: size,
  section: { type: 'parallel-to-bases' as const, positionPercent: position, connector: bayonet },
});

const LARGEST_DELTA = BAYONET_LIMITS.holeClearanceMm.max;
const BLOCKED = 0.01;
const FREE = 1e-3;

/** Everything at the cut plane's frame: the male, and the upper part around the socket in a block far larger than it. */
function mechanism(kernelTrack: Track, layout: BayonetLayout) {
  const block = kernelTrack(kernel.Manifold.cylinder(60, 40, 40, 128));
  const upper = kernelTrack(block.subtract(buildBayonetCavity(kernel, kernelTrack, layout)));
  return { male: buildBayonetMale(kernel, kernelTrack, layout), upper };
}

const overlap = (track: Track, a: Manifold, b: Manifold) => track(a.intersect(b)).volume();

/** The male in the upper part's coordinates for its pose φ: turned by −φ. */
const atPose = (track: Track, male: Manifold, poseDeg: number, lift = 0) =>
  track(track(male.rotate([0, 0, -poseDeg])).translate([0, 0, lift]));

const rigidOf = (track: Track, layout: BayonetLayout) => buildBayonetRigidBody(kernel, track, layout);

describe('poses of the mechanism', () => {
  it.each([
    ['provisional', dimensions()],
    [
      'tightest',
      dimensions({ holeClearanceMm: BAYONET_LIMITS.holeClearanceMm.min, axialClearanceMm: BAYONET_LIMITS.axialClearanceMm.min }),
    ],
    ['loosest', dimensions({ holeClearanceMm: LARGEST_DELTA, axialClearanceMm: BAYONET_LIMITS.axialClearanceMm.max })],
    ['thick stem', dimensions({ stemDiameterMm: 30, projectionMm: 24 })],
  ])('%s: inserted at −45° and locked at 0°, with nothing rigid in the way', (_, given) => {
    withScope((track) => {
      const layout = bayonetLayout(given);
      const { male, upper } = mechanism(track, layout);
      expect(overlap(track, male, upper)).toBeLessThan(FREE);
      expect(overlap(track, atPose(track, male, -BAYONET_TRAVEL_DEG), upper)).toBeLessThan(FREE);
      const corridor = atPose(track, buildBayonetCorridor(kernel, track, layout), -BAYONET_TRAVEL_DEG);
      expect(overlap(track, corridor, upper)).toBeLessThan(FREE);
      const sweeps = buildBayonetSweeps(kernel, track, layout);
      expect(overlap(track, sweeps.rigid, upper)).toBeLessThan(FREE);
      expect(overlap(track, sweeps.deflectedBump, upper)).toBeLessThan(FREE);
    });
  });

  it('the exact swept volume holds the actual stem and lugs at every sampled pose, each of them free', () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions());
      const { upper } = mechanism(track, layout);
      const body = rigidOf(track, layout);
      const { rigid } = buildBayonetSweeps(kernel, track, layout);
      for (let pose = -BAYONET_TRAVEL_DEG; pose <= 0; pose += 2.5) {
        const placed = atPose(track, body, pose);
        expect(overlap(track, placed, upper), `pose ${pose}°`).toBeLessThan(FREE);
        expect(track(placed.subtract(rigid)).volume(), `pose ${pose}°`).toBeLessThan(FREE);
      }
    });
  });

  it('the insertion is possible only at −45°, within the play of its clearance', () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions({ holeClearanceMm: LARGEST_DELTA }));
      const { upper } = mechanism(track, layout);
      const corridor = buildBayonetCorridor(kernel, track, layout);
      const free: number[] = [];
      for (let pose = -180; pose < 180; pose += 5) {
        if (overlap(track, atPose(track, corridor, pose), upper) < FREE) free.push(pose);
      }
      expect(free).toEqual([-BAYONET_TRAVEL_DEG]);
    });
  });
});

describe('what holds it together', () => {
  const cases = [
    ['provisional', dimensions()],
    ['largest clearance', dimensions({ holeClearanceMm: LARGEST_DELTA })],
    ['largest axial clearance', dimensions({ axialClearanceMm: BAYONET_LIMITS.axialClearanceMm.max })],
  ] as const;

  it.each(cases)('%s: pulling straight out while locked meets the ledges, after exactly the axial gap', (_, given) => {
    withScope((track) => {
      const layout = bayonetLayout(given);
      const { upper } = mechanism(track, layout);
      const male = rigidOf(track, layout);
      expect(overlap(track, atPose(track, male, 0, -layout.axialClearance + 0.01), upper)).toBeLessThan(FREE);
      expect(overlap(track, atPose(track, male, 0, -layout.axialClearance - 0.1), upper)).toBeGreaterThan(BLOCKED);
      for (const lift of [1, 2, layout.lugTipHeight]) {
        expect(overlap(track, atPose(track, male, 0, -lift), upper), `${lift} mm out`).toBeGreaterThan(BLOCKED);
      }
    });
  });

  it.each(cases)('%s: the stop blocks any rotation past the locked pose, at the original orientation', (_, given) => {
    withScope((track) => {
      const layout = bayonetLayout(given);
      const { upper } = mechanism(track, layout);
      const male = rigidOf(track, layout);
      expect(overlap(track, atPose(track, male, 0), upper)).toBeLessThan(FREE);
      expect(overlap(track, atPose(track, male, 0.5), upper)).toBeGreaterThan(BLOCKED);
      expect(overlap(track, atPose(track, male, 5), upper)).toBeGreaterThan(BLOCKED);
    });
  });

  it('a clearance never moves the stop', () => {
    const stopPoint = (delta: number) => {
      const layout = bayonetLayout(dimensions({ holeClearanceMm: delta }));
      return withScope((track) => {
        const { upper } = mechanism(track, layout);
        const male = rigidOf(track, layout);
        return { free: overlap(track, atPose(track, male, 0), upper), past: overlap(track, atPose(track, male, 0.1), upper) };
      });
    };
    for (const delta of [0.2, 0.5, 1]) {
      const { free, past } = stopPoint(delta);
      expect(free).toBeLessThan(FREE);
      expect(past).toBeGreaterThan(free);
    }
  });

  it('the two axial gaps are each the clearance, not its double', () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions({ axialClearanceMm: 0.3 }));
      const { upper } = mechanism(track, layout);
      const male = rigidOf(track, layout);
      expect(overlap(track, atPose(track, male, 0, 0.29), upper)).toBeLessThan(FREE);
      expect(overlap(track, atPose(track, male, 0, 0.35), upper)).toBeGreaterThan(FREE);
      expect(overlap(track, atPose(track, male, 0, -0.29), upper)).toBeLessThan(FREE);
      expect(overlap(track, atPose(track, male, 0, -0.35), upper)).toBeGreaterThan(FREE);
    });
  });

  it.each([
    ['smallest clearance', BAYONET_LIMITS.holeClearanceMm.min],
    ['provisional clearance', DEFAULT_BAYONET.holeClearanceMm],
    ['largest clearance', LARGEST_DELTA],
  ])('the parts turned by 180° are rejected, at the %s', (_, delta) => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions({ holeClearanceMm: delta }));
      const { upper } = mechanism(track, layout);
      const corridor = buildBayonetCorridor(kernel, track, layout);
      expect(overlap(track, atPose(track, corridor, -BAYONET_TRAVEL_DEG + 180), upper)).toBeGreaterThan(BLOCKED);
      expect(layout.wideHalfWidth - layout.narrowHalfWidth - LARGEST_DELTA / 2).toBeGreaterThan(BAYONET_MINIMUMS_MM.keying);
    });
  });
});

describe('the detent', () => {
  const printed = (layout: BayonetLayout) => ({
    crest: layout.crestRadius,
    groove: layout.grooveRadius,
    bore: layout.boreRadius,
  });

  it('has real room to deflect, and a pocket where it rests unloaded', () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions());
      const { male, upper } = mechanism(track, layout);
      const { crest, groove, bore } = printed(layout);
      expect(crest).toBeCloseTo(bore + DEFAULT_BAYONET.detentInterferenceMm, 9);
      expect(groove - crest).toBeCloseTo(layout.sideClearance, 9);
      expect(overlap(track, male, upper)).toBeLessThan(FREE);
      expect(BAYONET_FLEXURE.relief - DEFAULT_BAYONET.detentInterferenceMm).toBeGreaterThan(BAYONET_FLEXURE.travelMargin);
      expect(layout.travel).toBeLessThanOrEqual(BAYONET_FLEXURE.relief - BAYONET_FLEXURE.travelMargin);
    });
  });

  it('the tongue is a connected flexure: the male is one piece, and the relief separates all but its root', () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions());
      const male = buildBayonetMale(kernel, track, layout);
      const pieces = male.decompose();
      for (const piece of pieces) track(piece);
      expect(pieces).toHaveLength(1);
      // A radial probe at mid-length passes the tongue's wall, then an empty relief, then the core.
      const middle = (layout.tipAngle + layout.rootAngle) / 2;
      const z = layout.projection - 0.5;
      const probe = (radius: number) => {
        const box = track(
          track(kernel.Manifold.cube([0.05, 0.05, 0.05], true)).translate([
            radius * Math.cos(middle),
            radius * Math.sin(middle),
            z,
          ]),
        );
        return overlap(track, box, male);
      };
      const r = layout.stemRadius;
      expect(probe(r - BAYONET_FLEXURE.thickness / 2)).toBeGreaterThan(1e-5);
      expect(probe(r - BAYONET_FLEXURE.thickness - BAYONET_FLEXURE.relief / 2)).toBeLessThan(1e-9);
      expect(probe(layout.coreRadius - 0.3)).toBeGreaterThan(1e-5);
    });
  });

  it('reports the strain and travel it is sized by, without claiming a force or a life', () => {
    expect(bayonetFlexureStrain(DEFAULT_BAYONET.detentInterferenceMm)).toBeLessThan(BAYONET_FLEXURE.strainLimit);
    expect(bayonetFlexureStrain(bayonetFlexureTravel())).toBeCloseTo(BAYONET_FLEXURE.strainLimit, 9);
    expect(bayonetFlexureTravel()).toBeGreaterThanOrEqual(BAYONET_LIMITS.detentInterferenceMm.max);
  });

  it('the free bump meets the cam alone, elastically, and resists turning back', () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions());
      const { upper } = mechanism(track, layout);
      const sweeps = buildBayonetSweeps(kernel, track, layout);
      expect(overlap(track, sweeps.freeBump, upper)).toBeGreaterThan(FREE);
      expect(overlap(track, sweeps.deflectedBump, upper)).toBeLessThan(FREE);
      // Turning back from the locked pose meets the cam within a few degrees; the bump is unloaded before that.
      const male = buildBayonetMale(kernel, track, layout);
      const played = (0.2 / layout.stemRadius) * (180 / Math.PI);
      expect(overlap(track, atPose(track, male, -played * 0.25), upper)).toBeLessThan(FREE);
      const [, camCrest, camCrestEnd] = layout.cam as readonly [number, number, number, number];
      const overCam = (((camCrest + camCrestEnd) / 2 - layout.crestAngle) * 180) / Math.PI;
      expect(overlap(track, atPose(track, male, -overCam), upper)).toBeGreaterThan(FREE);
      // At the insertion angle it has passed the cam again, and nothing holds it.
      expect(overlap(track, atPose(track, male, -BAYONET_TRAVEL_DEG), upper)).toBeLessThan(FREE);
    });
  });

  it('zero interference leaves no cam, and with it no reverse retention, while the lugs still hold axially', () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions({ detentInterferenceMm: 0 }));
      expect(layout.cam).toBeUndefined();
      const { male, upper } = mechanism(track, layout);
      const sweeps = buildBayonetSweeps(kernel, track, layout);
      expect(overlap(track, sweeps.freeBump, upper)).toBeLessThan(FREE);
      for (let pose = -BAYONET_TRAVEL_DEG; pose <= 0; pose += 5) {
        expect(overlap(track, atPose(track, male, pose), upper), `pose ${pose}°`).toBeLessThan(FREE);
      }
      expect(overlap(track, atPose(track, male, 0, -layout.axialClearance - 0.1), upper)).toBeGreaterThan(BLOCKED);
      expect(overlap(track, atPose(track, male, 1), upper)).toBeGreaterThan(BLOCKED);
    });
  });
});

// Facets smaller than this, a fifth of a nozzle's line on each side, are the clipping's slivers: no slicer prints them as faces.
const SMALLEST_PRINTED_FACET_MM2 = 0.02;

/** For every downward facet off the bed that a slicer can see: its angle from straight down, 45° or more needing no support. */
const downwardOverhangs = (mesh: TriangleMesh, bedZ: number): number[] => {
  const angles: number[] = [];
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [x, y, z] = triangleAreaVector(mesh, triangle);
    const doubleArea = Math.hypot(x, y, z);
    if (doubleArea / 2 < SMALLEST_PRINTED_FACET_MM2 || z >= 0) continue;
    const corners = [0, 1, 2].map((corner) => vertexAt(mesh, mesh.triangles[3 * triangle + corner] as number)[2]);
    if (corners.every((height) => Math.abs(height - bedZ) < 1e-3)) continue;
    angles.push((Math.acos(Math.abs(z) / doubleArea) * 180) / Math.PI);
  }
  return angles;
};

describe('the whole model', () => {
  const generated = (bayonet: BayonetConnector) => generateModel(kernel, spec(bayonet));

  it('exports two closed, connected parts: no separate pin, and the upper part with its mouth on the cut face', async () => {
    const artifacts = await buildModelArtifacts(kernel, spec(connector()));
    expect(artifacts.model.solids.map(({ part }) => part)).toEqual(['lower', 'upper']);
    for (const { mesh } of artifacts.model.solids) expect(findMeshDefects(mesh)).toEqual([]);
    const { objects } = readThreeMf(artifacts.printFile.bytes).model;
    expect(objects).toHaveLength(2);
    for (const { mesh } of objects) expect(findMeshDefects(mesh)).toEqual([]);
  });

  it('prints without support in the file’s orientation: nothing faces down steeper than 45° off the bed', async () => {
    const { model } = await buildModelArtifacts(kernel, spec(connector()));
    const [lower, upper] = model.solids as [(typeof model.solids)[0], (typeof model.solids)[0]];
    // In these parts' own coordinates the bed lies under the lower base and under the upper part's cut face.
    for (const [mesh, bed] of [
      [lower.mesh, 0],
      [upper.mesh, 50],
    ] as const) {
      const angles = downwardOverhangs(mesh, bed);
      // A degree of twist in the entries' lead-in facets, whose arcs widen with their height, is nothing a layer can show.
      expect(Math.min(...angles), 'least angle from straight down').toBeGreaterThanOrEqual(43.5);
    }
  });

  it('the socket stays blind: the upper part keeps its uncut top and side at the tightest allowed wall', () => {
    const section = cylinderSection(cylinder(), scale, 50);
    const thick = connector({ stemDiameterMm: 36, projectionMm: 24 });
    const checks = bayonetChecks(section, bayonetDimensions(thick));
    expect(checks.every(satisfies)).toBe(true);
    const model = generated(thick);
    const upper = (model.solids[1] as (typeof model.solids)[0]).measurements;
    expect(upper.size[0]).toBeCloseTo(60, 3);
    expect(upper.bounds.max[2]).toBeCloseTo(100, 3);
  });

  it('measures the walls on the actual cavity, reliefs and all', () => {
    const section = cylinderSection(cylinder(), scale, 50);
    const layout = bayonetLayout(dimensions());
    const values = Object.fromEntries(bayonetChecks(section, layout).map((check) => [check.code, check.valueMm]));
    withScope((track) => {
      const cavity = buildBayonetCavity(kernel, track, layout);
      const { min, max } = cavity.boundingBox();
      // The cutter continues past the cut; above it, the deepest and the widest points are the checked ones.
      expect(section.upperThickness - max[2]).toBeCloseTo(values['socket-roof-thin'] as number, 6);
      const widest = Math.max(...[min[0], min[1]].map(Math.abs), max[0], max[1]);
      expect(section.inradius - widest).toBeGreaterThanOrEqual((values['socket-wall-thin'] as number) - 1);
      expect(values['socket-wall-thin'] as number).toBeGreaterThan(CONNECTOR_MIN_WALL_MM);
    });
  });

  it('refuses every other solid and cut before building anything', () => {
    expect(bayonetSupported(cylinder(), 50)).toBe(true);
    expect(bayonetSupported(cylinder(2, 0.5), 50)).toBe(false);
    expect(bayonetSupported(cylinder(), { offsetPercent: 10 })).toBe(false);
    expect(bayonetSupported({ kind: 'cone', heightRatio: 2, offsetRatio: 0 }, 50)).toBe(false);
    expect(() => planBayonet(cylinder(2, 0.5), scale, 50, connector())).toThrow(ConnectorUnsuitableError);
    expect(() =>
      generateModel(kernel, {
        shape: cylinder(),
        scale,
        section: { type: 'vertical', offsetPercent: 0, connector: connector() },
      }),
    ).toThrow(ConnectorUnsuitableError);
  });

  it('keeps the settings within their trial windows in the specification', () => {
    const parsed = (overrides: Partial<BayonetConnector>) => modelSpecSchema.safeParse(spec(connector(overrides))).success;
    expect(parsed({})).toBe(true);
    expect(parsed({ holeClearanceMm: 0.1 })).toBe(false);
    expect(parsed({ axialClearanceMm: 0.6 })).toBe(false);
    expect(parsed({ detentInterferenceMm: 0.35 })).toBe(false);
    expect(parsed({ detentInterferenceMm: 0 })).toBe(true);
  });
});

describe('capacity', () => {
  const base = connector({ stemDiameterMm: 1, projectionMm: 1 });

  it('gives the reference case a usable prototype at the printable minimum it prefers', () => {
    const outcome = defaultBayonet(cylinder(), scale, 50, base);
    expect(outcome.status).toBe('available');
    if (outcome.status !== 'available') return;
    const { stemDiameterMm, projectionMm } = outcome.connector;
    // A quarter of the largest stem lies below what the lugs and the tongue need, which bounds it.
    expect(stemDiameterMm).toBeGreaterThan(12);
    expect(stemDiameterMm).toBeLessThan(15);
    expect(projectionMm).toBeGreaterThanOrEqual(leastBayonetProjection(bayonetDimensions(outcome.connector)));
    expect(projectionMm).toBeLessThan(stemDiameterMm + 1);
    expect(outcome.adjusted).toBe(false);
    expect(findMeshDefects((generateModel(kernel, spec(outcome.connector)).solids[0] as { mesh: TriangleMesh }).mesh)).toEqual(
      [],
    );
  });

  it('prefers a quarter of the largest stem where that is above its minimum, and a height of about one stem', () => {
    const large = { longestDimensionMm: 300 };
    const outcome = defaultBayonet(cylinder(2), large, 50, base);
    if (outcome.status !== 'available') throw new Error('expected a fit');
    const section = cylinderSection(cylinder(2), large, 50);
    const fits = (diameter: number) => {
      const stem = dimensions({ stemDiameterMm: diameter });
      return bayonetChecks(section, { ...stem, projection: leastBayonetProjection(stem) }).every(satisfies);
    };
    expect(fits(4 * outcome.connector.stemDiameterMm - 1)).toBe(true);
    expect(fits(4 * outcome.connector.stemDiameterMm + 1)).toBe(false);
    expect(outcome.connector.projectionMm).toBeCloseTo(outcome.connector.stemDiameterMm, 0);
  });

  it('solves stem and height jointly: each default fits with the other', () => {
    for (const [height, size, position] of [
      [2, 80, 50],
      [100 / 30, 100, 20],
      [100 / 30, 100, 70],
      [2, 200, 50],
    ] as const) {
      const outcome = defaultBayonet(cylinder(height), { longestDimensionMm: size }, position, base);
      expect(outcome.status).toBe('available');
      if (outcome.status !== 'available') continue;
      const issues = bayonetChecks(
        cylinderSection(cylinder(height), { longestDimensionMm: size }, position),
        bayonetDimensions(outcome.connector),
      );
      expect(issues.filter((check) => !satisfies(check))).toEqual([]);
    }
  });

  it('reports what falls short in a part too thin or too narrow, instead of shrinking the mechanism', () => {
    const thin = defaultBayonet(cylinder(), scale, 90, base);
    expect(thin.status).toBe('unavailable');
    if (thin.status === 'unavailable') expect(thin.issues.map(({ code }) => code)).toContain('socket-roof-thin');
    const narrow = defaultBayonet(cylinder(4), { longestDimensionMm: 40 }, 50, base);
    expect(narrow.status).toBe('unavailable');
    if (narrow.status === 'unavailable') expect(narrow.issues.map(({ code }) => code)).toContain('socket-wall-thin');
  });

  it('keeps valid manual values as they are', () => {
    const manual = connector({ stemDiameterMm: 18.3, projectionMm: 17.1, detentInterferenceMm: 0.05 });
    expect(normalizeBayonet(cylinder(), scale, 50, manual)).toEqual({
      status: 'available',
      connector: manual,
      adjusted: false,
      issues: [],
    });
  });

  it('adjusts values the figure no longer allows, coherently, keeps clearances and is idempotent', () => {
    const stated = connector({ stemDiameterMm: 50, projectionMm: 38, holeClearanceMm: 0.7, axialClearanceMm: 0.3 });
    const outcome = normalizeBayonet(cylinder(), scale, 50, stated);
    if (outcome.status !== 'available') throw new Error('expected a fit');
    expect(outcome.adjusted).toBe(true);
    expect(outcome.issues.length).toBeGreaterThan(0);
    expect(outcome.connector.stemDiameterMm).toBeLessThan(50);
    expect(outcome.connector.holeClearanceMm).toBe(0.7);
    expect(outcome.connector.axialClearanceMm).toBe(0.3);
    expect(normalizeBayonet(cylinder(), scale, 50, outcome.connector)).toEqual({
      status: 'available',
      connector: outcome.connector,
      adjusted: false,
      issues: [],
    });
    expect(() => generateModel(kernel, spec(outcome.connector))).not.toThrow();
  });

  it('solves one field’s feasible values with the others fixed, from the same checks', () => {
    const feasibility = bayonetFeasibility(cylinder(), scale, 50, connector());
    const section = cylinderSection(cylinder(), scale, 50);
    const passes = (overrides: Partial<BayonetDimensions>) =>
      bayonetChecks(section, { ...dimensions(), ...overrides }).every(satisfies);
    const { diameter, projection, holeClearance, interference } = feasibility.parameters;
    expect(feasibility.issues).toEqual([]);
    expect(passes({ diameter: diameter.bounds.min })).toBe(true);
    expect(passes({ diameter: diameter.bounds.min - 0.05 })).toBe(false);
    expect(passes({ diameter: diameter.bounds.max })).toBe(true);
    expect(passes({ diameter: diameter.bounds.max + 0.05 })).toBe(false);
    expect(passes({ projection: projection.bounds.min })).toBe(true);
    expect(passes({ projection: projection.bounds.min - 0.05 })).toBe(false);
    expect(passes({ projection: projection.bounds.max + 0.05 })).toBe(false);
    expect(holeClearance.bounds.min).toBe(BAYONET_LIMITS.holeClearanceMm.min);
    expect(interference.bounds).toMatchObject({ min: 0, max: BAYONET_LIMITS.detentInterferenceMm.max });
  });
});

describe('the trial holders', () => {
  it('hold the same interface as the model, unscaled by its size', () => {
    const bayonet = connector();
    for (const size of [100, 300]) {
      const model = generateModel(kernel, spec(bayonet, 50, cylinder(size === 100 ? 100 / 30 : 2), { longestDimensionMm: size }));
      const origin = size === 100 ? 50 : 150;
      withScope((track) => {
        const layout = bayonetLayout(bayonetDimensions(bayonet));
        const trial = buildBayonetTrial(kernel, track, layout);
        const asManifold = (mesh: TriangleMesh) =>
          track(
            new kernel.Manifold(
              new kernel.Mesh({
                numProp: 3,
                vertProperties: Float32Array.from(mesh.positions),
                triVerts: Uint32Array.from(mesh.triangles),
              }),
            ),
          );
        const [lower, upper] = model.solids as readonly Solid[] as [Solid, Solid];
        const modelMale = track(track(asManifold(lower.mesh).translate([0, 0, -origin])).trimByPlane([0, 0, 1], 0.01));
        const trialMale = track(trial.male.trimByPlane([0, 0, 1], 0.01));
        expect(modelMale.volume()).toBeCloseTo(trialMale.volume(), 1);
        expect(track(modelMale.subtract(trialMale)).volume()).toBeLessThan(0.02);
        expect(track(trialMale.subtract(modelMale)).volume()).toBeLessThan(0.02);
        const socketOf = (part: Manifold, height: number) => {
          const reach = layout.trackRadius + 1;
          const core = track(kernel.Manifold.cylinder(height, reach, reach, 128));
          return track(core.subtract(part));
        };
        const height = layout.socketDepth + 1;
        const modelSocket = socketOf(track(asManifold(upper.mesh).translate([0, 0, -origin])), height);
        const trialSocket = socketOf(trial.female, height);
        expect(modelSocket.volume()).toBeCloseTo(trialSocket.volume(), 1);
        expect(track(modelSocket.subtract(trialSocket)).volume()).toBeLessThan(0.02);
      });
    }
  });

  it('export as two separate, closed, non-overlapping objects, named for the settings', async () => {
    const bayonet = connector({
      stemDiameterMm: 14.5,
      projectionMm: 14.25,
      holeClearanceMm: 0.6,
      axialClearanceMm: 0.25,
      detentInterferenceMm: 0.1,
    });
    const { trialFile, model } = await buildModelArtifacts(kernel, spec(bayonet));
    expect(trialFile?.fileName).toBe('bayonet-trial-d14.5-H14.25-c0.6-a0.25-i0.1mm.3mf');
    const { objects } = readThreeMf(trialFile?.bytes as Uint8Array).model;
    expect(objects.map(({ name }) => name)).toEqual(['bayonet-trial-male', 'bayonet-trial-female']);
    const boxes = objects.map(({ mesh }) => {
      expect(findMeshDefects(mesh)).toEqual([]);
      const xs = Array.from(mesh.positions).filter((_, index) => index % 3 === 0);
      const zs = Array.from(mesh.positions).filter((_, index) => index % 3 === 2);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs) };
    }) as [{ minX: number; maxX: number; minZ: number }, { minX: number; maxX: number; minZ: number }];
    expect(boxes[0].maxX).toBeLessThan(boxes[1].minX);
    for (const { minZ } of boxes) expect(minZ).toBeCloseTo(0, 6);
    expect(model.section?.connector?.type).toBe('bayonet');
  });

  it('pass the fit checks with their own surroundings, also where the model itself would not fit', async () => {
    withScope((track) => {
      const layout = bayonetLayout(dimensions({ holeClearanceMm: LARGEST_DELTA, detentInterferenceMm: 0.3 }));
      const { male, female } = buildBayonetTrial(kernel, track, layout);
      for (const solid of [male, female]) {
        const pieces = solid.decompose();
        for (const piece of pieces) track(piece);
        expect(pieces).toHaveLength(1);
      }
      expect(overlap(track, male, female)).toBeLessThan(FREE);
    });
    const artifacts = await buildModelArtifacts(kernel, spec(connector({ detentInterferenceMm: 0 })));
    expect(artifacts.trialFile).toBeDefined();
  });
});

describe('the preview', () => {
  it('shows the upper part turned to its insertion angle and withdrawn in the separated view, in the display nodes only', async () => {
    const { previewGlb, separatedPreviewGlb, model, printFile } = await buildModelArtifacts(kernel, spec(connector()));
    expect(previewGlb.length).toBeGreaterThan(0);
    const { WebIO } = await import('@gltf-transform/core');
    const nodeOf = async (bytes: Uint8Array) => {
      const document = await new WebIO().readBinary(bytes);
      return document.getRoot().listNodes();
    };
    const assembled = await nodeOf(previewGlb);
    for (const node of assembled) expect(node.getRotation()).toEqual([0, 0, 0, 1]);
    const [lower, upper] = (await nodeOf(separatedPreviewGlb as Uint8Array)) as [
      Awaited<ReturnType<typeof nodeOf>>[0],
      Awaited<ReturnType<typeof nodeOf>>[0],
    ];
    expect(lower.getRotation()).toEqual([0, 0, 0, 1]);
    // −45° about +Z is −45° about the glTF frame's +Y.
    const half = (-BAYONET_TRAVEL_DEG * Math.PI) / 360;
    expect(upper.getRotation()[1]).toBeCloseTo(Math.sin(half), 6);
    expect(upper.getRotation()[3]).toBeCloseTo(Math.cos(half), 6);
    // The rotation about the axis, which passes through the origin here, needs no sideways shift.
    expect(Math.hypot(upper.getTranslation()[0], upper.getTranslation()[2])).toBeLessThan(1e-9);
    const layout = bayonetLayout(dimensions());
    expect(upper.getTranslation()[1] * 1000).toBeGreaterThan(layout.projection);
    const { objects } = readThreeMf(printFile.bytes).model;
    expect(objects[1]?.mesh.positions.length).toBe(model.solids[1]?.mesh.positions.length);
  });
});
