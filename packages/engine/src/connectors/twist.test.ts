import { DEFAULT_TWIST, modelSpecSchema, TWIST_CLEARANCE_LIMITS, type TwistConnector } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModelArtifacts } from '../artifacts.ts';
import { ConnectorUnsuitableError } from '../errors.ts';
import { readThreeMf } from '../export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { findMeshDefects, type TriangleMesh, triangleAreaVector, triangleCount, vertexAt } from '../mesh.ts';
import { generateModel, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import { CONNECTOR_MIN_WALL_MM, cylinderSection, satisfies } from './frame.ts';
import {
  buildTwistCavity,
  buildTwistCorridor,
  buildTwistMale,
  buildTwistSweep,
  buildTwistTrial,
  planTwist,
  seenFromUpper,
  TWIST_MINIMUMS_MM,
  TWIST_TRAVEL_DEG,
  type TwistDimensions,
  type TwistLayout,
  twistChecks,
  twistDimensions,
  twistFeasibility,
  twistLayout,
  twistSupported,
} from './twist.ts';
import { defaultTwist, normalizeTwist } from './twist-capacity.ts';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await loadGeometryKernel();
});

/** The reference: 100 mm high, 60 mm in diameter, cut halfway. */
const cylinder = (heightRatio = 100 / 30, offsetRatio = 0) => ({ kind: 'cylinder', heightRatio, offsetRatio }) as const;
const scale = { longestDimensionMm: 100 };
const connector = (overrides: Partial<TwistConnector> = {}): TwistConnector => ({
  type: 'twist',
  sizeMm: 18,
  ...DEFAULT_TWIST,
  ...overrides,
});
const dimensions = (overrides: Partial<TwistConnector> = {}): TwistDimensions => twistDimensions(connector(overrides));
const spec = (twist: TwistConnector, position = 50, shape = cylinder(), size = scale) => ({
  shape,
  scale: size,
  section: { type: 'parallel-to-bases' as const, positionPercent: position, connector: twist },
});

const BLOCKED = 0.01;
const FREE = 2e-3;

/** The upper part around the recess, in a block far larger than it, and the male: all at the cut plane's frame. */
function mechanism(track: Track, layout: TwistLayout) {
  const block = track(kernel.Manifold.cylinder(40, 30, 30, 128));
  return { male: buildTwistMale(kernel, track, layout), upper: track(block.subtract(buildTwistCavity(kernel, track, layout))) };
}

const overlap = (track: Track, a: Manifold, b: Manifold) => track(a.intersect(b)).volume();

/** The largest clearance this size allows, which the slider ends at. */
const largestKeyedClearance = (size: number) =>
  twistFeasibility(cylinder(), scale, 50, connector({ sizeMm: size })).parameters.holeClearance.bounds.max;
const LEAST_DELTA = TWIST_CLEARANCE_LIMITS.min;

describe('the motion', () => {
  it.each([
    ['provisional', dimensions()],
    ['least clearances', dimensions({ holeClearanceMm: LEAST_DELTA, axialClearanceMm: 0.1 })],
    ['largest clearances', dimensions({ holeClearanceMm: 1, axialClearanceMm: 0.5, sizeMm: 24 })],
    ['smallest size', dimensions({ sizeMm: 16 })],
    ['large size', dimensions({ sizeMm: 40 })],
  ])('%s: inserted at −45°, turned to 0° and back, with nothing rigid in the way', (_, given) => {
    withScope((track) => {
      const layout = twistLayout(given);
      const { male, upper } = mechanism(track, layout);
      expect(overlap(track, male, upper)).toBeLessThan(FREE);
      expect(overlap(track, seenFromUpper(track, male, -TWIST_TRAVEL_DEG), upper)).toBeLessThan(FREE);
      const corridor = seenFromUpper(track, buildTwistCorridor(kernel, track, layout), -TWIST_TRAVEL_DEG);
      expect(overlap(track, corridor, upper)).toBeLessThan(FREE);
      expect(overlap(track, buildTwistSweep(kernel, track, layout), upper)).toBeLessThan(FREE);
    });
  });

  it('the swept envelope holds the male at every sampled pose, each of them free: closing and opening alike', () => {
    withScope((track) => {
      const layout = twistLayout(dimensions());
      const { male, upper } = mechanism(track, layout);
      const sweep = buildTwistSweep(kernel, track, layout);
      for (let pose = -TWIST_TRAVEL_DEG; pose <= 0; pose += 2.5) {
        const placed = seenFromUpper(track, male, pose);
        expect(overlap(track, placed, upper), `pose ${pose}°`).toBeLessThan(FREE);
        expect(track(placed.subtract(sweep)).volume(), `pose ${pose}°`).toBeLessThan(FREE);
      }
    });
  });

  it('comes apart only at −45°: turned back and withdrawn, without deforming anything', () => {
    withScope((track) => {
      const layout = twistLayout(dimensions({ holeClearanceMm: largestKeyedClearance(18) }));
      const { upper } = mechanism(track, layout);
      const corridor = buildTwistCorridor(kernel, track, layout);
      const free: number[] = [];
      for (let pose = -180; pose < 180; pose += 5) {
        if (overlap(track, seenFromUpper(track, corridor, pose), upper) < FREE) free.push(pose);
      }
      expect(free).toEqual([-TWIST_TRAVEL_DEG]);
    });
  });

  it.each([
    ['provisional clearance', DEFAULT_TWIST.holeClearanceMm],
    ['least clearance', LEAST_DELTA],
    ['largest clearance', largestKeyedClearance(18)],
  ])('rejects the 120° and 240° orientations, at the %s', (_, delta) => {
    withScope((track) => {
      const layout = twistLayout(dimensions({ holeClearanceMm: delta }));
      const { upper } = mechanism(track, layout);
      const corridor = buildTwistCorridor(kernel, track, layout);
      for (const wrong of [120, 240]) {
        expect(overlap(track, seenFromUpper(track, corridor, -TWIST_TRAVEL_DEG + wrong), upper)).toBeGreaterThan(BLOCKED);
      }
    });
  });

  it('keeps the wide lug wider than a narrow entry on the actual flanks, over the whole window, at the least size', () => {
    const section = cylinderSection(cylinder(), scale, 50);
    const least = twistFeasibility(cylinder(), scale, 50, connector()).parameters.size.bounds.min;
    const keying = (delta: number) =>
      twistChecks(section, dimensions({ sizeMm: least, holeClearanceMm: delta })).find(({ code }) => code === 'keying-lost') as {
        valueMm: number;
        minimumMm: number;
      };
    expect(satisfies(keying(TWIST_CLEARANCE_LIMITS.max))).toBe(true);
    expect(keying(TWIST_CLEARANCE_LIMITS.max).valueMm).toBeLessThan(keying(LEAST_DELTA).valueMm);
    // Beyond the window it would not hold: the check reads the clearance, and would narrow the slider.
    expect(satisfies(keying(1.2))).toBe(false);
    expect(largestKeyedClearance(least)).toBe(TWIST_CLEARANCE_LIMITS.max);
  });
});

describe('what holds it, and what does not', () => {
  it('in the locked pose all of every lug bears on its ledge, and reaches well over it', () => {
    withScope((track) => {
      const layout = twistLayout(dimensions());
      const { male } = mechanism(track, layout);
      const cavity = buildTwistCavity(kernel, track, layout);
      const opening = track(kernel.CrossSection.circle(layout.openingRadius, 256));
      const lugs = track(track(male.slice(layout.neckHeight + 1)).subtract(opening));
      const ledges = track(
        track(kernel.CrossSection.circle(layout.radius + 2, 256)).subtract(track(cavity.slice(layout.ledgeTop - 0.05))),
      );
      const bearing = track(lugs.intersect(ledges)).area();
      expect(bearing / lugs.area()).toBeGreaterThan(0.99);
      expect(layout.radius - layout.openingRadius).toBeGreaterThan(TWIST_MINIMUMS_MM.bearing);
      // Each of the three bears: at each lug, the bearing is a solid patch, not a corner.
      expect(track(lugs.intersect(ledges)).decompose().length).toBe(3);
    });
  });

  it.each([
    ['provisional', dimensions()],
    ['largest axial gap', dimensions({ axialClearanceMm: 0.5 })],
  ])('%s: pulling straight out while locked meets the ledges after exactly the axial gap', (_, given) => {
    withScope((track) => {
      const layout = twistLayout(given);
      const { male, upper } = mechanism(track, layout);
      const gap = layout.axialClearance;
      expect(overlap(track, seenFromUpper(track, male, 0, -gap + 0.02), upper)).toBeLessThan(FREE);
      expect(overlap(track, seenFromUpper(track, male, 0, -gap - 0.1), upper)).toBeGreaterThan(BLOCKED);
      expect(overlap(track, seenFromUpper(track, male, 0, -layout.neckHeight), upper)).toBeGreaterThan(BLOCKED);
      // Above the head the same gap, and then the roof's printing relief: the cut faces limit that direction anyway.
      expect(overlap(track, seenFromUpper(track, male, 0, gap - 0.02), upper)).toBeLessThan(FREE);
    });
  });

  it('the stop blocks closing further, at the original orientation whatever the clearance', () => {
    for (const delta of [LEAST_DELTA, 0.5, largestKeyedClearance(18)]) {
      withScope((track) => {
        const layout = twistLayout(dimensions({ holeClearanceMm: delta }));
        const { male, upper } = mechanism(track, layout);
        expect(overlap(track, male, upper), `Δ ${delta}`).toBeLessThan(FREE);
        expect(overlap(track, seenFromUpper(track, male, 0.5), upper), `Δ ${delta}`).toBeGreaterThan(BLOCKED);
        expect(overlap(track, seenFromUpper(track, male, 5), upper), `Δ ${delta}`).toBeGreaterThan(BLOCKED);
      });
    }
  });

  it('nothing resists turning back: no pose between locked and open meets the recess', () => {
    withScope((track) => {
      const layout = twistLayout(dimensions({ holeClearanceMm: LEAST_DELTA }));
      const { male, upper } = mechanism(track, layout);
      for (let pose = 0; pose >= -TWIST_TRAVEL_DEG; pose -= 1) {
        expect(overlap(track, seenFromUpper(track, male, pose), upper), `pose ${pose}°`).toBeLessThan(FREE);
      }
    });
  });

  it('does not leave an annular groove: the male turned the other way past the insertion pose meets ribs', () => {
    withScope((track) => {
      const layout = twistLayout(dimensions());
      const { male, upper } = mechanism(track, layout);
      expect(overlap(track, seenFromUpper(track, male, -TWIST_TRAVEL_DEG - 10, 0), upper)).toBeGreaterThan(BLOCKED);
    });
  });
});

/** For every downward facet off the bed that a slicer sees: its angle from straight down, 45° or more printing without support. */
function downwardFacets(mesh: TriangleMesh, bedZ: number): { angle: number; z: number }[] {
  const facets: { angle: number; z: number }[] = [];
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const [x, y, z] = triangleAreaVector(mesh, triangle);
    const doubleArea = Math.hypot(x, y, z);
    if (doubleArea / 2 < 0.02 || z >= 0) continue;
    const heights = [0, 1, 2].map((corner) => vertexAt(mesh, mesh.triangles[3 * triangle + corner] as number)[2]);
    if (heights.every((height) => Math.abs(height - bedZ) < 1e-3)) continue;
    facets.push({ angle: (Math.acos(Math.abs(z) / doubleArea) * 180) / Math.PI, z: Math.min(...heights) });
  }
  return facets;
}

describe('the whole model', () => {
  it('exports two closed, connected parts, the upper one with its recess on the bed', async () => {
    const artifacts = await buildModelArtifacts(kernel, spec(connector()));
    expect(artifacts.model.solids.map(({ part }) => part)).toEqual(['lower', 'upper']);
    const { objects } = readThreeMf(artifacts.printFile.bytes).model;
    expect(objects).toHaveLength(2);
    for (const { mesh } of objects) expect(findMeshDefects(mesh)).toEqual([]);
  });

  it('prints the recess without support, and has flat overhangs only under the lugs, as short as they are', async () => {
    const { model } = await buildModelArtifacts(kernel, spec(connector()));
    const [lower, upper] = model.solids as readonly Solid[] as [Solid, Solid];
    const layout = twistLayout(dimensions());
    // The upper part lies on its cut face at z = 50: the ledges are its first layers, the roof a 45° cone.
    const recess = downwardFacets(upper.mesh, 50);
    expect(Math.min(...recess.map(({ angle }) => angle))).toBeGreaterThanOrEqual(43.5);
    // The lower part stands on its base: below the head only the lugs' undersides are flat, at the neck's height.
    const flat = downwardFacets(lower.mesh, 0).filter(({ angle }) => angle < 43.5);
    expect(flat.length).toBeGreaterThan(0);
    for (const { z } of flat) expect(z).toBeCloseTo(50 + layout.neckHeight, 3);
    expect(layout.radius - layout.discRadius).toBeLessThan(3);
  });

  it('keeps the recess blind and the walls the checks measure, on the actual cavity with its lead-ins and roof', () => {
    const section = cylinderSection(cylinder(), scale, 50);
    const largest = twistFeasibility(cylinder(), scale, 50, connector()).parameters.size.bounds.max;
    const widest = connector({ sizeMm: Math.floor(largest * 10) / 10 });
    expect(twistChecks(section, twistDimensions(widest)).every(satisfies)).toBe(true);
    const model = generateModel(kernel, spec(widest));
    const upper = (model.solids[1] as Solid).measurements;
    expect(upper.size[0]).toBeCloseTo(60, 3);
    expect(upper.bounds.max[2]).toBeCloseTo(100, 3);
    withScope((track) => {
      const layout = twistLayout(twistDimensions(widest));
      // Above the cut: below it the cutters only continue past the cut face.
      const { min, max } = track(buildTwistCavity(kernel, track, layout).trimByPlane([0, 0, 1], 0)).boundingBox();
      const reach = Math.max(-min[0], -min[1], max[0], max[1]);
      expect(reach).toBeLessThanOrEqual(layout.mouthRadius + 1e-6);
      expect(section.inradius - layout.mouthRadius).toBeGreaterThanOrEqual(CONNECTOR_MIN_WALL_MM - 1e-9);
      expect(max[2]).toBeCloseTo(layout.recessDepth, 6);
    });
  });

  it('is a low disc: neck and head 2 mm each at 16–20 mm, and the male never grows with the part', () => {
    for (const size of [16, 18, 20]) {
      const layout = twistLayout(dimensions({ sizeMm: size }));
      expect(layout.neckHeight).toBe(2);
      expect(layout.headThickness).toBe(2);
    }
    for (const position of [20, 50, 80]) {
      const model = generateModel(kernel, spec(connector({ sizeMm: 16 }), position));
      const lower = (model.solids[0] as Solid).measurements;
      expect(lower.bounds.max[2] - position).toBeCloseTo(4, 3);
    }
  });

  it('refuses every other solid and cut before building anything', () => {
    expect(twistSupported(cylinder(), 50)).toBe(true);
    expect(twistSupported(cylinder(2, 0.5), 50)).toBe(false);
    expect(twistSupported(cylinder(), { offsetPercent: 10 })).toBe(false);
    expect(twistSupported({ kind: 'cone', heightRatio: 2, offsetRatio: 0 }, 50)).toBe(false);
    expect(() => planTwist(cylinder(2, 0.5), scale, 50, connector())).toThrow(ConnectorUnsuitableError);
    expect(() =>
      generateModel(kernel, {
        shape: cylinder(),
        scale,
        section: { type: 'vertical', offsetPercent: 0, connector: connector() },
      }),
    ).toThrow(ConnectorUnsuitableError);
  });

  it('keeps the clearances within their windows in the specification', () => {
    const parsed = (overrides: Partial<TwistConnector>) => modelSpecSchema.safeParse(spec(connector(overrides))).success;
    expect(parsed({})).toBe(true);
    expect(parsed({ holeClearanceMm: 1.05 })).toBe(false);
    expect(parsed({ holeClearanceMm: 0.05 })).toBe(false);
    expect(parsed({ axialClearanceMm: 0.05 })).toBe(false);
    expect(parsed({ axialClearanceMm: 0.55 })).toBe(false);
  });
});

describe('capacity', () => {
  const base = connector({ sizeMm: 1 });

  it('gives the reference a 16 mm connector: a quarter of the largest, 14 mm, is below its printable minimum', () => {
    const outcome = defaultTwist(cylinder(), scale, 50, base);
    if (outcome.status !== 'available') throw new Error('expected a fit');
    expect(outcome.connector).toEqual({ type: 'twist', sizeMm: 16, holeClearanceMm: 0.5, axialClearanceMm: 0.2 });
    const { size } = twistFeasibility(cylinder(), scale, 50, outcome.connector).parameters;
    expect(size.bounds.min).toBeCloseTo(16, 1);
    expect(size.bounds.max).toBeGreaterThan(55);
  });

  it('prefers a quarter of the largest size where that is above the minimum, not a share of the model', () => {
    const large = { longestDimensionMm: 300 };
    const outcome = defaultTwist(cylinder(2), large, 50, base);
    if (outcome.status !== 'available') throw new Error('expected a fit');
    const { max } = twistFeasibility(cylinder(2), large, 50, outcome.connector).parameters.size.bounds;
    expect(outcome.connector.sizeMm).toBeCloseTo(max / 4, 0);
    // A flat cylinder of the same longest dimension has less room around the recess and over it, so a smaller connector.
    const flat = defaultTwist(cylinder(0.5), large, 50, base);
    if (flat.status !== 'available') throw new Error('expected a fit');
    expect(flat.connector.sizeMm).not.toBe(outcome.connector.sizeMm);
  });

  it('takes the clearances as they are: the reference keeps its 16 mm at the largest, every check holding', () => {
    const loose = defaultTwist(cylinder(), scale, 50, connector({ sizeMm: 1, holeClearanceMm: 1, axialClearanceMm: 0.5 }));
    if (loose.status !== 'available') throw new Error('expected a fit');
    expect(loose.connector).toMatchObject({ holeClearanceMm: 1, axialClearanceMm: 0.5 });
    const section = cylinderSection(cylinder(), scale, 50);
    expect(twistChecks(section, twistDimensions(loose.connector)).every(satisfies)).toBe(true);
    expect(() => generateModel(kernel, spec(loose.connector))).not.toThrow();
  });

  it('reports what falls short in a part too thin or too narrow, rather than building slivers', () => {
    const thin = defaultTwist(cylinder(), { longestDimensionMm: 40 }, 90, base);
    expect(thin.status).toBe('unavailable');
    if (thin.status === 'unavailable') expect(thin.issues.map(({ code }) => code)).toContain('recess-roof-thin');
    const narrow = defaultTwist(cylinder(8), { longestDimensionMm: 60 }, 50, base);
    expect(narrow.status).toBe('unavailable');
    if (narrow.status === 'unavailable') expect(narrow.issues.map(({ code }) => code)).toContain('recess-wall-thin');
  });

  it('keeps a valid manual size, adjusts one that no longer fits to the nearest that does, and is idempotent', () => {
    const manual = connector({ sizeMm: 23.7, holeClearanceMm: 0.35, axialClearanceMm: 0.3 });
    expect(normalizeTwist(cylinder(), scale, 50, manual)).toEqual({
      status: 'available',
      connector: manual,
      adjusted: false,
      issues: [],
    });
    const narrower = normalizeTwist(cylinder(), { longestDimensionMm: 60 }, 50, connector({ sizeMm: 40, holeClearanceMm: 0.35 }));
    if (narrower.status !== 'available') throw new Error('expected a fit');
    expect(narrower.adjusted).toBe(true);
    expect(narrower.issues.map(({ code }) => code)).toContain('recess-wall-thin');
    expect(narrower.connector.holeClearanceMm).toBe(0.35);
    const { max } = twistFeasibility(cylinder(), { longestDimensionMm: 60 }, 50, narrower.connector).parameters.size.bounds;
    expect(narrower.connector.sizeMm).toBeLessThanOrEqual(max);
    expect(max - narrower.connector.sizeMm).toBeLessThan(0.1);
    expect(normalizeTwist(cylinder(), { longestDimensionMm: 60 }, 50, narrower.connector)).toMatchObject({ adjusted: false });
    expect(() => generateModel(kernel, spec(narrower.connector, 50, cylinder(), { longestDimensionMm: 60 }))).not.toThrow();
    // Too small grows to the minimum.
    const grown = normalizeTwist(cylinder(), scale, 50, connector({ sizeMm: 10 }));
    expect(grown).toMatchObject({ status: 'available', adjusted: true, connector: { sizeMm: 16 } });
  });
});

describe('the trial holders', () => {
  it('hold the same interface as the model, unscaled by its size', () => {
    const twist = connector();
    for (const [size, ratio, cut] of [
      [100, 100 / 30, 50],
      [300, 2, 150],
    ] as const) {
      const model = generateModel(kernel, spec(twist, 50, cylinder(ratio), { longestDimensionMm: size }));
      withScope((track) => {
        const layout = twistLayout(twistDimensions(twist));
        const trial = buildTwistTrial(kernel, track, layout);
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
        const modelMale = track(track(asManifold(lower.mesh).translate([0, 0, -cut])).trimByPlane([0, 0, 1], 0.01));
        const trialMale = track(trial.male.trimByPlane([0, 0, 1], 0.01));
        expect(track(modelMale.subtract(trialMale)).volume()).toBeLessThan(0.02);
        expect(track(trialMale.subtract(modelMale)).volume()).toBeLessThan(0.02);
        const reach = layout.mouthRadius + 0.5;
        const core = track(kernel.Manifold.cylinder(layout.recessDepth + 0.5, reach, reach, 128));
        const modelRecess = track(core.subtract(track(asManifold(upper.mesh).translate([0, 0, -cut]))));
        const trialRecess = track(core.subtract(trial.female));
        expect(track(modelRecess.subtract(trialRecess)).volume()).toBeLessThan(0.02);
        expect(track(trialRecess.subtract(modelRecess)).volume()).toBeLessThan(0.02);
      });
    }
  });

  it('export as two low, separate, closed objects, named for the size and both clearances', async () => {
    const twist = connector({ sizeMm: 17.3, holeClearanceMm: 0.45, axialClearanceMm: 0.25 });
    const { trialFile } = await buildModelArtifacts(kernel, spec(twist));
    expect(trialFile?.fileName).toBe('twist-trial-S17.3-d0.45-a0.25mm.3mf');
    const { objects } = readThreeMf(trialFile?.bytes as Uint8Array).model;
    expect(objects.map(({ name }) => name)).toEqual(['twist-trial-male', 'twist-trial-female']);
    const boxes = objects.map(({ mesh }) => {
      expect(findMeshDefects(mesh)).toEqual([]);
      const axis = (offset: number) => Array.from(mesh.positions).filter((_, index) => index % 3 === offset);
      return { minX: Math.min(...axis(0)), maxX: Math.max(...axis(0)), minZ: Math.min(...axis(2)), maxZ: Math.max(...axis(2)) };
    }) as [
      { minX: number; maxX: number; minZ: number; maxZ: number },
      { minX: number; maxX: number; minZ: number; maxZ: number },
    ];
    expect(boxes[0].maxX).toBeLessThan(boxes[1].minX);
    for (const { minZ, maxZ } of boxes) {
      expect(minZ).toBeCloseTo(0, 6);
      expect(maxZ).toBeLessThan(20);
    }
  });

  it('are connected solids that fit each other', () => {
    withScope((track) => {
      const layout = twistLayout(dimensions());
      const { male, female } = buildTwistTrial(kernel, track, layout);
      for (const solid of [male, female]) {
        const pieces = solid.decompose();
        for (const piece of pieces) track(piece);
        expect(pieces).toHaveLength(1);
      }
      expect(overlap(track, male, female)).toBeLessThan(FREE);
    });
  });

  it('have plain round outsides, without grooves', () => {
    withScope((track) => {
      const layout = twistLayout(dimensions());
      const { male, female, whole } = buildTwistTrial(kernel, track, layout);
      const outside = (solid: Manifold, z: number) => {
        const contours = solid.slice(z).toPolygons();
        return Math.min(
          ...contours
            .flatMap((contour) => contour.map(([x, y]) => Math.hypot(x, y)))
            .filter((radius) => radius > layout.mouthRadius + 1),
        );
      };
      // Within the kernel's polygon roundoff of the outer circle; the former marks were 0,6 mm deep.
      const { max } = whole.boundingBox();
      for (const z of [-2.9, -1.5, -0.1]) expect(outside(male, z)).toBeGreaterThan(max[0] - 0.05);
      for (const z of [0.1, 5, max[2] - 0.1]) expect(outside(female, z)).toBeGreaterThan(max[0] - 0.05);
    });
  });
});

describe('the preview', () => {
  it('shows the upper part turned to −45° and withdrawn when separated, in the display nodes only', async () => {
    const { previewGlb, separatedPreviewGlb, model, printFile } = await buildModelArtifacts(kernel, spec(connector()));
    const { WebIO } = await import('@gltf-transform/core');
    const nodesOf = async (bytes: Uint8Array) => (await new WebIO().readBinary(bytes)).getRoot().listNodes();
    for (const node of await nodesOf(previewGlb)) expect(node.getRotation()).toEqual([0, 0, 0, 1]);
    const [lower, upper] = (await nodesOf(separatedPreviewGlb as Uint8Array)) as [
      Awaited<ReturnType<typeof nodesOf>>[number],
      Awaited<ReturnType<typeof nodesOf>>[number],
    ];
    expect(lower.getRotation()).toEqual([0, 0, 0, 1]);
    // −45° about +Z is −45° about the glTF frame's +Y; the axis passes through the origin, so it needs no sideways shift.
    const half = (-TWIST_TRAVEL_DEG * Math.PI) / 360;
    expect(upper.getRotation()[1]).toBeCloseTo(Math.sin(half), 6);
    expect(upper.getRotation()[3]).toBeCloseTo(Math.cos(half), 6);
    expect(Math.hypot(upper.getTranslation()[0], upper.getTranslation()[2])).toBeLessThan(1e-9);
    expect(upper.getTranslation()[1] * 1000).toBeGreaterThan(twistLayout(dimensions()).neckHeight * 2);
    const { objects } = readThreeMf(printFile.bytes).model;
    expect(objects[1]?.mesh.positions.length).toBe(model.solids[1]?.mesh.positions.length);
  });
});
