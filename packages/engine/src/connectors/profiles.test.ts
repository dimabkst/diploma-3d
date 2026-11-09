import {
  CONNECTOR_PROFILES,
  type ConnectorProfile,
  type CylinderShape,
  DEFAULT_DOWEL_CLEARANCES_MM,
  DEFAULT_PLUG_CLEARANCE_MM,
  type DowelConnector,
  type ModelSpecInput,
  type PlugConnector,
  type RoundConnector,
  type Section,
} from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from '../artifacts.ts';
import { readThreeMf } from '../export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import { dot, findMeshDefects, type TriangleMesh, type Vec3, vertexAt, vertexCount } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { withScope } from '../scope.ts';
import { cylinderSection, satisfies, solidCut } from './frame.ts';
import { profileArcAngles, profileMinWidth, profileReach, profileRing, profileSupport } from './profile.ts';
import {
  planRoundConnectors,
  type RoundConnectorPlan,
  type RoundConnectorSite,
  roundConnectorChecks,
  roundConnectorDimensions,
} from './round.ts';
import { defaultRoundConnector, normalizeRoundConnector, ROUND_CONNECTOR_STEPS_MM } from './round-capacity.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

const cylinder = (heightRatio = 2, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const scale = { longestDimensionMm: 80 };
// d = 10 mm, e = 8 mm at M = 80 mm, with chamfers of at most 0,8 mm.
const dims = { diameterFactor: 2, depthFactor: 2 };
const plug = (profile: ConnectorProfile, overrides: Partial<PlugConnector> = {}) =>
  ({ type: 'plug', count: 1, profile, ...dims, holeClearanceMm: DEFAULT_PLUG_CLEARANCE_MM, ...overrides }) as PlugConnector;
const dowel = (profile: ConnectorProfile, overrides: Partial<DowelConnector> = {}) =>
  ({
    type: 'dowel',
    count: 1,
    profile,
    ...dims,
    lowerClearanceMm: DEFAULT_DOWEL_CLEARANCES_MM.lower,
    upperClearanceMm: DEFAULT_DOWEL_CLEARANCES_MM.upper,
    ...overrides,
  }) as DowelConnector;

const CUTS: readonly (readonly [string, (connector: RoundConnector) => Section])[] = [
  ['horizontal', (connector) => ({ type: 'parallel-to-bases', positionPercent: 50, connector })],
  ['vertical', (connector) => ({ type: 'vertical', offsetPercent: 0, connector })],
  ['inclined', (connector) => ({ type: 'oblique', positionPercent: 50, inclinationDeg: 40, directionDeg: 30, connector })],
];

const spec = (section: Section, shape: CylinderShape = cylinder()): ModelSpecInput => ({ shape, scale, section });

/** A vertex in the site's own coordinates: (x along v, y along u, height along n from the cut). */
function local({ frame }: RoundConnectorPlan, { centre }: RoundConnectorSite, point: Vec3): Vec3 {
  const relative: Vec3 = [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]];
  return [dot(relative, frame.v), dot(relative, frame.u), dot(relative, frame.n)];
}

const pointsOf = (mesh: TriangleMesh) => Array.from({ length: vertexCount(mesh) }, (_, index) => vertexAt(mesh, index));

/** The vertices of a hole's straight wall: from the end of the entrance chamfer down to the bottom, near the axis. */
function holeWall(mesh: TriangleMesh, plan: RoundConnectorPlan, site: RoundConnectorSite, towards: 1 | -1, reach: number) {
  return pointsOf(mesh)
    .map((point) => local(plan, site, point))
    .filter(
      ([x, y, height]) =>
        towards * height >= site.chamfer - 1e-3 && towards * height <= plan.holeDepth + 1e-3 && Math.hypot(x, y) <= reach,
    );
}

const extent = (points: readonly Vec3[], [dx, dy]: readonly [number, number]) =>
  Math.max(...points.map(([x, y]) => x * dx + y * dy));

function plannedSite(plan: RoundConnectorPlan, index = 0): RoundConnectorSite {
  const site = plan.sites[index];
  if (site === undefined) throw new Error('No such site.');
  return site;
}

const manifoldOf = (mesh: TriangleMesh) =>
  new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles }));

/** Whether the mesh, turned about the site's axis, overlaps the receiving part in more than a sliver. */
function overlapWhenTurned(pin: TriangleMesh, part: TriangleMesh, plan: RoundConnectorPlan, degrees: number): number {
  return withScope((track) => {
    const { centre } = plannedSite(plan);
    const { n } = plan.frame;
    if (Math.abs(n[2]) !== 1) throw new Error('These cases turn pins of a horizontal cut about Z.');
    const moved = (solid: Manifold) =>
      track(track(track(solid.translate([-centre[0], -centre[1], -centre[2]])).rotate([0, 0, degrees])).translate(centre));
    return track(moved(track(manifoldOf(pin))).intersect(track(manifoldOf(part)))).volume();
  });
}

describe('the profile of a plug, a dowel and their holes', () => {
  it('has the size and offsets of its definition, in the cut plane’s coordinates', () => {
    const [r, offset] = [10, 0.25];
    // Corner radii grow by offset/cos(π/n); the apothems by exactly the offset.
    expect(profileSupport('square', r, offset, 1, 0)).toBeCloseTo(r * Math.SQRT1_2 + offset, 12);
    expect(profileSupport('square', r, 0, Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(r, 12);
    expect(profileSupport('hexagon', r, offset, 0, 1)).toBeCloseTo((r * Math.sqrt(3)) / 2 + offset, 12);
    expect(profileSupport('hexagon', r, 0, 1, 0)).toBeCloseTo(r, 12);
    expect(profileSupport('triangle', r, offset, -1, 0)).toBeCloseTo(r / 2 + offset, 12);
    expect(profileSupport('triangle', r, 0, 1, 0)).toBeCloseTo(r, 12);
    expect(profileSupport('circle', r, offset, 3, 4)).toBeCloseTo(5 * (r + offset), 12);
    // x² + y² ≤ r² with x ≤ r/2: the flat side towards +x, and the whole circle opposite it.
    expect(profileSupport('flatted-circle', r, 0, 1, 0)).toBeCloseTo(r / 2, 12);
    expect(profileSupport('flatted-circle', r, offset, 1, 0)).toBeCloseTo(r / 2 + offset, 12);
    expect(profileSupport('flatted-circle', r, offset, -1, 0)).toBeCloseTo(r + offset, 12);
    expect(profileSupport('flatted-circle', r, 0, 0, 1)).toBeCloseTo(r, 12);
  });

  it.each([
    ['circle', 20],
    ['triangle', 15],
    ['square', 20 * Math.SQRT1_2],
    ['hexagon', 10 * Math.sqrt(3)],
    ['flatted-circle', 15],
  ] as const)('measures a %s of nominal size 20 at its narrowest width %d', (profile, width) => {
    expect(profileMinWidth(profile, 10, 0)).toBeCloseTo(width, 12);
    // No direction is narrower, on a fine sweep of the support function.
    const widths = Array.from({ length: 720 }, (_, step) => {
      const angle = (step * Math.PI) / 360;
      const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
      return profileSupport(profile, 10, 0, dx, dy) + profileSupport(profile, 10, 0, -dx, -dy);
    });
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(width - 1e-9);
  });

  it.each(CONNECTOR_PROFILES)('reaches as far from a point as the boundary of a %s does', (profile) => {
    const ring = profileRing(profile, 10, 0.5, profileArcAngles(profile, 10, 0.5, 3600));
    for (const [cx, cy] of [
      [0, 0],
      [3, 0],
      [-4, 5],
      [20, 1],
      [0, -18],
    ] as const) {
      const farthest = Math.max(...ring.map(([x, y]) => Math.hypot(cx + x, cy + y)));
      expect(profileReach(profile, 10, 0.5, cx, cy)).toBeGreaterThanOrEqual(farthest - 1e-9);
      expect(profileReach(profile, 10, 0.5, cx, cy)).toBeCloseTo(farthest, 3);
    }
  });

  it('keeps every corner at least the offset away: the hole holds the pin grown by that clearance', () => {
    for (const profile of CONNECTOR_PROFILES) {
      const angles = Array.from({ length: 720 }, (_, step) => (step * Math.PI) / 360);
      for (const [dx, dy] of angles.map((angle) => [Math.cos(angle), Math.sin(angle)] as const)) {
        const clearance = profileSupport(profile, 10, 0.5, dx, dy) - profileSupport(profile, 10, 0, dx, dy);
        expect(clearance, `${profile} along ${dx}, ${dy}`).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
    }
  });
});

describe('plugs, dowels and matching holes of every profile', () => {
  describe.each(CUTS)('in a %s cut', (_name, section) => {
    it.each(
      CONNECTOR_PROFILES.flatMap((profile) => [
        ['plug', 1, profile],
        ['plug', 2, profile],
        ['dowel', 1, profile],
        ['dowel', 2, profile],
      ]) as ['plug' | 'dowel', 1 | 2, ConnectorProfile][],
    )('builds a %s × %d of a %s as closed, valid solids', (type, count, profile) => {
      // A pair of d and 0,8d needs more than the single connector's room; the triangle's keying needs the most.
      const pair = count === 2 ? { count, spacingPercent: 35, diameterFactor: 2.4 } : {};
      const connector = type === 'plug' ? plug(profile, pair) : dowel(profile, pair);
      const model = generateModel(kernel, spec(section(connector)));
      expect(model.solids).toHaveLength(2 + (type === 'dowel' ? count : 0));
      for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
    });
  });

  it('leaves a saved connector without a profile a circle, exactly as one with it stated', () => {
    const saved = { type: 'plug', count: 1, ...dims, holeClearanceMm: 0.2 } as const;
    const section = (connector: RoundConnector): Section => ({ type: 'parallel-to-bases', positionPercent: 50, connector });
    const without = generateModel(kernel, spec(section(saved)));
    const stated = generateModel(kernel, spec(section({ ...saved, profile: 'circle' })));
    expect(without.section?.connector).toMatchObject({ profile: 'circle' });
    expect(Array.from(without.solids[1]?.mesh.positions ?? [])).toEqual(Array.from(stated.solids[1]?.mesh.positions ?? []));
  });
});

describe('male and female profiles in the assembled position', () => {
  it.each(CUTS.flatMap(([name, section]) => CONNECTOR_PROFILES.map((profile) => [name, section, profile] as const)))(
    '%s cut: the holes of both parts and the dowel keep the orientation of a %s',
    (_name, section, profile) => {
      const model = generateModel(kernel, spec(section(dowel(profile))));
      const plan = model.section?.connector as RoundConnectorPlan;
      const site = plannedSite(plan);
      const r = site.pinDiameter / 2;
      const [lower, upper, pin] = model.solids;
      const directions = Array.from({ length: 24 }, (_, step) => {
        const angle = (step * Math.PI) / 12 + 0.01;
        return [Math.cos(angle), Math.sin(angle)] as const;
      });
      const lowerWall = holeWall(lower?.mesh as TriangleMesh, plan, site, -1, 3 * r);
      const upperWall = holeWall(upper?.mesh as TriangleMesh, plan, site, 1, 3 * r);
      const pinPoints = pointsOf(pin?.mesh as TriangleMesh).map((point) => local(plan, site, point));
      // Every direction, so that neither a mirror image nor a turned profile could pass: the flat side and a triangle's
      // corners are asymmetric. The arc's polygon lies inside the ideal circle, by less than the tolerance here.
      for (const direction of directions) {
        expect(extent(pinPoints, direction)).toBeCloseTo(profileSupport(profile, r, 0, ...direction), 1);
        expect(extent(lowerWall, direction)).toBeCloseTo(
          profileSupport(profile, r, DEFAULT_DOWEL_CLEARANCES_MM.lower / 2, ...direction),
          1,
        );
        expect(extent(upperWall, direction)).toBeCloseTo(
          profileSupport(profile, r, DEFAULT_DOWEL_CLEARANCES_MM.upper / 2, ...direction),
          1,
        );
      }
    },
  );

  it.each(CUTS.map(([name, section]) => [name, section] as const))(
    '%s cut: the flat side of a plug and of its hole face the same way, +v',
    (_name, section) => {
      const model = generateModel(kernel, spec(section(plug('flatted-circle'))));
      const plan = model.section?.connector as RoundConnectorPlan;
      const site = plannedSite(plan);
      const r = site.pinDiameter / 2;
      const hole = holeWall(model.solids[1]?.mesh as TriangleMesh, plan, site, 1, 3 * r);
      expect(extent(hole, [1, 0])).toBeCloseTo(r / 2 + DEFAULT_PLUG_CLEARANCE_MM / 2, 3);
      expect(extent(hole, [-1, 0])).toBeGreaterThan(r);
    },
  );

  it('keeps pins and parts congruent, with their handedness, on the print plate', async () => {
    const artifacts = await buildModelArtifacts(
      kernel,
      spec({ type: 'oblique', positionPercent: 50, inclinationDeg: 40, directionDeg: 30, connector: dowel('flatted-circle') }),
    );
    const printed = readThreeMf(artifacts.printFile.bytes).model.objects;
    const signed = (mesh: TriangleMesh) => {
      const [a, b, c, d] = [0, 1, 2, Math.floor(vertexCount(mesh) / 2)].map((index) => vertexAt(mesh, index)) as [
        Vec3,
        Vec3,
        Vec3,
        Vec3,
      ];
      const [p, q, s] = [b, c, d].map((point): Vec3 => [point[0] - a[0], point[1] - a[1], point[2] - a[2]]) as [Vec3, Vec3, Vec3];
      return p[0] * (q[1] * s[2] - q[2] * s[1]) - p[1] * (q[0] * s[2] - q[2] * s[0]) + p[2] * (q[0] * s[1] - q[1] * s[0]);
    };
    artifacts.model.solids.forEach((solid, index) => {
      const object = printed[index];
      if (object === undefined) throw new Error('A solid is missing from the file.');
      expect(object.mesh.triangles).toHaveLength(solid.mesh.triangles.length);
      expect(signed(object.mesh)).toBeCloseTo(signed(solid.mesh), 0);
    });
  });
});

describe('the wrong orientation of a fully inserted connector', () => {
  const horizontal = (connector: RoundConnector): Section => ({ type: 'parallel-to-bases', positionPercent: 50, connector });
  const built = (connector: RoundConnector) => {
    const model = generateModel(kernel, spec(horizontal(connector)));
    return { model, plan: model.section?.connector as RoundConnectorPlan };
  };
  const SLIVER_MM3 = 0.01;

  it.each(['plug', 'dowel'] as const)('rejects a flat-sided %s at 90° and 180°, and fits it at 0°', (type) => {
    const connector = type === 'plug' ? plug('flatted-circle') : dowel('flatted-circle');
    const { model, plan } = built(connector);
    const [lower, upper, separate] = model.solids;
    // A plug is part of the lower solid: its own shape is tried as a dowel of that size.
    const pin = separate?.mesh ?? (built(dowel('flatted-circle')).model.solids[2]?.mesh as TriangleMesh);
    const receiving = upper?.mesh as TriangleMesh;
    expect(overlapWhenTurned(pin, receiving, plan, 0)).toBeLessThan(SLIVER_MM3);
    expect(overlapWhenTurned(pin, receiving, plan, 90)).toBeGreaterThan(1);
    expect(overlapWhenTurned(pin, receiving, plan, 180)).toBeGreaterThan(1);
    if (type === 'dowel') {
      expect(overlapWhenTurned(pin, lower?.mesh as TriangleMesh, plan, 0)).toBeLessThan(SLIVER_MM3);
      expect(overlapWhenTurned(pin, lower?.mesh as TriangleMesh, plan, 180)).toBeGreaterThan(1);
    }
  });

  it('allows the small rotational play the clearance gives, and no more', () => {
    const { model, plan } = built(dowel('flatted-circle'));
    const [, upper, pin] = model.solids;
    expect(overlapWhenTurned(pin?.mesh as TriangleMesh, upper?.mesh as TriangleMesh, plan, 2)).toBeLessThan(SLIVER_MM3);
    expect(overlapWhenTurned(pin?.mesh as TriangleMesh, upper?.mesh as TriangleMesh, plan, 30)).toBeGreaterThan(1);
  });

  it.each([
    ['square', 90, 45],
    ['hexagon', 60, 30],
    ['triangle', 120, 60],
  ] as const)('lets a %s enter at its own turn of %d° and rejects it at %d°', (profile, fits, rejected) => {
    const { model, plan } = built(dowel(profile));
    const [, upper, pin] = model.solids;
    expect(overlapWhenTurned(pin?.mesh as TriangleMesh, upper?.mesh as TriangleMesh, plan, fits)).toBeLessThan(SLIVER_MM3);
    expect(overlapWhenTurned(pin?.mesh as TriangleMesh, upper?.mesh as TriangleMesh, plan, rejected)).toBeGreaterThan(1);
  });

  it('rejects a triangle at 180° too, which is not one of its symmetries', () => {
    const { model, plan } = built(dowel('triangle'));
    const [, upper, pin] = model.solids;
    expect(overlapWhenTurned(pin?.mesh as TriangleMesh, upper?.mesh as TriangleMesh, plan, 180)).toBeGreaterThan(1);
  });

  it.each(CONNECTOR_PROFILES)('keys a pair of %s: the larger pin fits neither smaller hole at any angle', (profile) => {
    const section = cylinderSection(cylinder(), scale, 50);
    const widest = 1;
    const dimensions = roundConnectorDimensions(
      dowel(profile, { count: 2, spacingPercent: 40, diameterFactor: 3, lowerClearanceMm: widest, upperClearanceMm: 0.2 }),
      80,
      section.span / 2,
    );
    const keying = roundConnectorChecks(section, dimensions).find(({ code }) => code === 'keying-lost');
    const r = dimensions.diameter / 2;
    expect(keying?.valueMm).toBeCloseTo(profileMinWidth(profile, r, 0) - profileMinWidth(profile, 0.8 * r, widest / 2), 9);
  });
});

describe('clearances of every profile', () => {
  const horizontal = (connector: RoundConnector): Section => ({ type: 'parallel-to-bases', positionPercent: 50, connector });
  const measure = (connector: RoundConnector, part: 0 | 1, towards: 1 | -1) => {
    const model = generateModel(kernel, spec(horizontal(connector)));
    const plan = model.section?.connector as RoundConnectorPlan;
    const site = plannedSite(plan);
    return {
      wall: holeWall(model.solids[part]?.mesh as TriangleMesh, plan, site, towards, site.pinDiameter * 1.5),
      r: site.pinDiameter / 2,
    };
  };

  it.each([0, 0.2, 0.4, 0.7, 1])('keeps a circular hole of Δ = %s mm the diameter d + Δ, as before', (clearance) => {
    const { wall, r } = measure(plug('circle', { holeClearanceMm: clearance }), 1, 1);
    const largest = Math.max(...wall.map(([x, y]) => Math.hypot(x, y)));
    expect(largest).toBeCloseTo(r + clearance / 2, 3);
  });

  it.each([
    ['square', [1, 0]],
    ['hexagon', [0, 1]],
    ['triangle', [-1, 0]],
    ['flatted-circle', [1, 0]],
  ] as const)('moves the flat face of a %s by exactly Δ/2, not by a scale of (d + Δ)/d', (profile, face) => {
    const clearance = 0.8;
    const { wall, r } = measure(plug(profile, { holeClearanceMm: clearance }), 1, 1);
    const apothem = profileSupport(profile, r, 0, face[0], face[1]);
    expect(extent(wall, face)).toBeCloseTo(apothem + clearance / 2, 3);
    // A scaled profile would have moved the face by apothem·Δ/d, which differs from Δ/2 on each of these.
    expect(Math.abs((apothem * clearance) / (2 * r) - clearance / 2)).toBeGreaterThan(0.02);
  });

  it('holds both dowel holes to their own values, also above the former 0,4 mm', () => {
    const connector = dowel('square', { lowerClearanceMm: 0.3, upperClearanceMm: 0.9 });
    const lower = measure(connector, 0, -1);
    const upper = measure(connector, 1, 1);
    const apothem = lower.r * Math.SQRT1_2;
    expect(extent(lower.wall, [1, 0])).toBeCloseTo(apothem + 0.15, 3);
    expect(extent(upper.wall, [1, 0])).toBeCloseTo(apothem + 0.45, 3);
  });

  it('counts the expanded hole and its mouth in the wall: a triangle’s corner by twice the offset', () => {
    const section = cylinderSection(cylinder(), scale, 50);
    const connector = plug('triangle', { holeClearanceMm: 1 });
    const dimensions = roundConnectorDimensions(connector, 80, section.span / 2);
    const wall = roundConnectorChecks(section, dimensions).find(({ code }) => code === 'hole-wall-thin');
    const chamfer = Math.min(0.08 * profileMinWidth('triangle', dimensions.diameter / 2, 0), 0.2 * dimensions.insertion);
    expect(wall?.valueMm).toBeCloseTo(section.inradius - (dimensions.diameter / 2 + 2 * (0.5 + chamfer)), 9);
  });

  it('reads the width of the actual profile for the thinnest pin: a 3,9 mm triangle is too thin, a 3,9 mm circle is not', () => {
    const section = cylinderSection(cylinder(), scale, 50);
    const thin = (profile: ConnectorProfile) => {
      const dimensions = { ...roundConnectorDimensions(plug(profile), 80, section.span / 2), diameter: 3.9 };
      return roundConnectorChecks(section, dimensions).find(({ code }) => code === 'pin-too-thin');
    };
    expect(thin('triangle')).toMatchObject({ valueMm: expect.closeTo(2.925, 9), minimumMm: 3 });
    expect(satisfies(thin('triangle') as NonNullable<ReturnType<typeof thin>>)).toBe(false);
    expect(satisfies(thin('circle') as NonNullable<ReturnType<typeof thin>>)).toBe(true);
    expect(
      planRoundConnectors(cylinder(), scale, 50, plug('square', { diameterFactor: 4 / 5 })).issues.map(({ code }) => code),
    ).toContain('pin-too-thin');
  });
});

describe('the chamfers of every profile', () => {
  it.each(CONNECTOR_PROFILES)('chamfers both dowel ends of a %s by the same offset, leaving a printable end face', (profile) => {
    const model = generateModel(kernel, spec({ type: 'parallel-to-bases', positionPercent: 50, connector: dowel(profile) }));
    const plan = model.section?.connector as RoundConnectorPlan;
    const site = plannedSite(plan);
    const points = pointsOf(model.solids[2]?.mesh as TriangleMesh).map((point) => local(plan, site, point));
    const r = site.pinDiameter / 2;
    for (const end of [plan.insertion, -plan.insertion]) {
      const face = points.filter(([, , height]) => Math.abs(height - end) < 1e-3);
      for (const direction of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const satisfies readonly (readonly [number, number])[]) {
        expect(extent(face, direction)).toBeCloseTo(profileSupport(profile, r, -site.chamfer, direction[0], direction[1]), 1);
      }
      // What is left at the end: most of the profile's narrowest width, far more than a line width.
      expect(profileMinWidth(profile, r, -site.chamfer)).toBeGreaterThan(0.5 * profileMinWidth(profile, r, 0));
    }
    expect(plan.straightEngagement).toBeGreaterThanOrEqual(2);
  });

  it('keeps even the thinnest allowed pin’s end face wider than a line', () => {
    for (const profile of CONNECTOR_PROFILES) {
      const width = profileMinWidth(profile, 1, 0);
      const r = 3 / width;
      const chamfer = 0.08 * 3;
      expect(profileMinWidth(profile, r, -chamfer)).toBeGreaterThan(1.2);
    }
  });

  it('leaves a plug attached to its part: one connected solid with a square root under the cut', () => {
    for (const profile of CONNECTOR_PROFILES) {
      const model = generateModel(kernel, spec({ type: 'parallel-to-bases', positionPercent: 50, connector: plug(profile) }));
      withScope((track) => {
        const pieces = track(manifoldOf(model.solids[0]?.mesh as TriangleMesh)).decompose();
        for (const piece of pieces) track(piece);
        expect(pieces).toHaveLength(1);
      });
    }
  });

  it('widens every hole’s mouth by the chamfer around the complete profile', () => {
    const model = generateModel(kernel, spec({ type: 'parallel-to-bases', positionPercent: 50, connector: plug('hexagon') }));
    const plan = model.section?.connector as RoundConnectorPlan;
    const site = plannedSite(plan);
    const mouth = pointsOf(model.solids[1]?.mesh as TriangleMesh)
      .map((point) => local(plan, site, point))
      .filter(([x, y, height]) => Math.abs(height) < 1e-3 && Math.hypot(x, y) < 2 * site.pinDiameter);
    const offset = DEFAULT_PLUG_CLEARANCE_MM / 2 + site.chamfer;
    for (const direction of [
      [1, 0],
      [0.5, Math.sqrt(3) / 2],
      [-1, 0],
      [0, -1],
    ] as const) {
      expect(extent(mouth, direction)).toBeCloseTo(
        profileSupport('hexagon', site.pinDiameter / 2, offset, direction[0], direction[1]),
        3,
      );
    }
  });
});

describe('dimensions from the actual capacity', () => {
  const mm = (connector: RoundConnector, longest: number) => ({
    diameter: connector.diameterFactor * 0.0625 * longest,
    insertion: connector.depthFactor * 0.05 * longest,
  });
  const available = (outcome: ReturnType<typeof defaultRoundConnector>) => {
    if (outcome.status !== 'available') throw new Error(`Expected a connector: ${JSON.stringify(outcome.issues)}`);
    return outcome.connector;
  };
  const tall = { kind: 'cylinder', heightRatio: 100 / 30, offsetRatio: 0 } as const;
  const reference = { longestDimensionMm: 100 };

  it('gives the 100 × 60 mm cylinder cut in half a substantial connector of either type', () => {
    const plugged = mm(available(defaultRoundConnector(tall, reference, 50, plug('flatted-circle'))), 100);
    expect(plugged.diameter).toBeGreaterThan(13.5);
    expect(plugged.diameter).toBeLessThan(15);
    expect(plugged.insertion).toBeGreaterThanOrEqual(24);
    expect(plugged.insertion).toBeLessThanOrEqual(25);
    const dowelled = mm(available(defaultRoundConnector(tall, reference, 50, dowel('flatted-circle'))), 100);
    expect(dowelled.diameter).toBeGreaterThan(13.5);
    expect(dowelled.diameter).toBeLessThan(15);
    expect(2 * dowelled.insertion).toBeGreaterThanOrEqual(48);
    expect(2 * dowelled.insertion).toBeLessThanOrEqual(50);
  });

  it('builds that reference connector, and exposes a size and depth on the controls’ grids', () => {
    for (const connector of [plug('flatted-circle'), dowel('flatted-circle')]) {
      const resolved = available(defaultRoundConnector(tall, reference, 50, connector));
      const { diameter, insertion } = mm(resolved, 100);
      expect(Number((diameter / ROUND_CONNECTOR_STEPS_MM.size).toFixed(6)) % 1).toBe(0);
      const shownLength = connector.type === 'dowel' ? 2 * insertion : insertion;
      expect(Number((shownLength / ROUND_CONNECTOR_STEPS_MM.length).toFixed(6)) % 1).toBe(0);
      const model = generateModel(kernel, {
        shape: tall,
        scale: reference,
        section: { type: 'parallel-to-bases', positionPercent: 50, connector: resolved },
      });
      for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
    }
  });

  it('responds to the material: the same longest dimension gives other dimensions for other proportions and cuts', () => {
    const connector = plug('circle');
    const dimensions = (shape: CylinderShape, position: number) =>
      mm(available(defaultRoundConnector(shape, scale, position, connector)), 80);
    const stout = dimensions(cylinder(1), 50);
    const slender = dimensions(cylinder(8), 50);
    expect(slender.diameter).toBeLessThan(stout.diameter / 2);
    expect(slender.insertion).toBeGreaterThan(stout.insertion);
    const middle = dimensions(cylinder(2), 50);
    const nearTop = dimensions(cylinder(2), 85);
    expect(nearTop.insertion).toBeLessThan(middle.insertion);
    expect(nearTop.diameter).toBeCloseTo(middle.diameter, 0);
  });

  it('follows the actual section of a curved or narrowing solid', () => {
    const connector = plug('flatted-circle');
    const ball = (offsetPercent: number) =>
      mm(available(defaultRoundConnector({ kind: 'ball' }, scale, { offsetPercent }, connector)), 80);
    expect(ball(60).diameter).toBeLessThan(ball(0).diameter);
    expect(ball(60).insertion).toBeLessThan(ball(0).insertion);
    const cone = { kind: 'cone', heightRatio: 2, offsetRatio: 0 } as const;
    const atCut = (position: number) => mm(available(defaultRoundConnector(cone, scale, position, connector)), 80);
    expect(atCut(70).diameter).toBeLessThan(atCut(30).diameter);
  });

  describe.each(CONNECTOR_PROFILES)('for a %s', (profile) => {
    const shapes = [
      [cylinder(2), 50],
      [cylinder(0.5), 30],
      [cylinder(3, 1), { offsetPercent: 20 }],
      [cylinder(2), { positionPercent: 50, inclinationDeg: 50, directionDeg: 90 }],
      [{ kind: 'cone', heightRatio: 2, offsetRatio: 0 }, 40],
      [{ kind: 'cone', heightRatio: 2, offsetRatio: 0.5 }, { offsetPercent: 30 }],
      [{ kind: 'ball' }, { offsetPercent: 40 }],
    ] as const;

    it.each(
      shapes.flatMap((entry) =>
        [1, 2].flatMap((count) => (['plug', 'dowel'] as const).map((type) => [entry, count, type] as const)),
      ),
    )('chooses jointly feasible defaults, also for a pair (%j × %d %s)', ([shape, cut], count, type) => {
      const pair = count === 2 ? { count: 2 as const, spacingPercent: 45 } : {};
      const connector = type === 'plug' ? plug(profile, pair) : dowel(profile, pair);
      const outcome = defaultRoundConnector(shape, scale, cut, connector);
      if (outcome.status === 'unavailable') {
        expect(outcome.issues.length).toBeGreaterThan(0);
        return;
      }
      const section = solidCut(shape, scale, cut);
      const dimensions = roundConnectorDimensions(outcome.connector as RoundConnector, 80, section.span / 2);
      expect(roundConnectorChecks(section, dimensions).filter((check) => !satisfies(check))).toEqual([]);
      // The stated proportions start from the feasible maximum; they bound nothing else.
      const larger = normalizeRoundConnector(shape, scale, cut, outcome.connector as RoundConnector);
      expect(larger).toMatchObject({ status: 'available', adjusted: false });
    });
  });

  it('builds what it chooses: thin and curved parts adjust or stay unavailable, and never break through', () => {
    const cases = [
      [cylinder(0.5), 10],
      [cylinder(0.5), 90],
      [{ kind: 'cone', heightRatio: 2, offsetRatio: 0 }, 85],
      [{ kind: 'cone', heightRatio: 0.5, offsetRatio: 0 }, 15],
      [{ kind: 'ball' }, { offsetPercent: 70 }],
      [{ kind: 'ball' }, { offsetPercent: -75 }],
    ] as const;
    let [built, unavailable] = [0, 0];
    for (const [shape, cut] of cases) {
      for (const connector of [
        plug('flatted-circle'),
        dowel('flatted-circle'),
        dowel('triangle', { count: 2, spacingPercent: 45 }),
      ]) {
        const outcome = defaultRoundConnector(shape, scale, cut, connector);
        if (outcome.status === 'unavailable') {
          unavailable += 1;
          continue;
        }
        const section: Section =
          typeof cut === 'number'
            ? { type: 'parallel-to-bases', positionPercent: cut, connector: outcome.connector as RoundConnector }
            : { type: 'horizontal', offsetPercent: cut.offsetPercent, connector: outcome.connector as RoundConnector };
        const model = generateModel(kernel, { shape, scale, section });
        for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
        built += 1;
      }
    }
    expect(built).toBeGreaterThan(0);
    expect(unavailable).toBeGreaterThan(0);
  });

  it('calls a connector unavailable when even the smallest does not fit, and names what fails', () => {
    const tiny = { longestDimensionMm: 20 };
    const outcome = defaultRoundConnector({ kind: 'ball' }, tiny, { offsetPercent: 76 }, plug('flatted-circle'));
    expect(outcome.status).toBe('unavailable');
    expect(outcome.issues.map(({ code }) => code)).toContain('hole-bottom-thin');
    // A flat cylinder leaves too little even for a dowel's least engagement in each half.
    const flat = { kind: 'cylinder', heightRatio: 0.5, offsetRatio: 0 } as const;
    expect(defaultRoundConnector(flat, { longestDimensionMm: 20 }, 50, dowel('circle')).status).toBe('unavailable');
  });

  it('asks a pair to fit at the same placement, moving it only when the section is too small for that', () => {
    const connector = plug('circle', { count: 2, spacingPercent: 45 });
    expect(available(defaultRoundConnector(cylinder(2), scale, 50, connector)).spacingPercent).toBe(45);
    // 95 % of the half span leaves no wall beside the holes, at any size.
    const moved = available(defaultRoundConnector(cylinder(2), scale, 50, { ...connector, spacingPercent: 95 }));
    expect(moved.spacingPercent).toBeLessThan(95);
    expect(moved.spacingPercent).toBeGreaterThan(70);
  });
});

describe('correcting a connector the model no longer leaves room for', () => {
  const section = (position: number, connector: RoundConnector): Section => ({
    type: 'parallel-to-bases',
    positionPercent: position,
    connector,
  });
  const stable = (shape: CylinderShape, cut: number, connector: RoundConnector) => {
    const first = normalizeRoundConnector(shape, scale, cut, connector);
    if (first.status !== 'available') throw new Error('Expected a connector.');
    const second = normalizeRoundConnector(shape, scale, cut, first.connector as RoundConnector);
    return { first, second };
  };

  it('returns a value that fits exactly as it is, also off the controls’ grid', () => {
    const connector = plug('hexagon', { diameterFactor: 15.05 / 5, depthFactor: 1.2345 });
    const { first } = stable(cylinder(2), 50, connector);
    expect(first).toEqual({ status: 'available', connector, adjusted: false, issues: [] });
  });

  it('shortens only what no longer fits, and says why', () => {
    // 25 mm above an 80 mm tall cut at 70 %: a 20 mm plug needs 21,5 mm, its 16 mm size still fits.
    const connector = plug('flatted-circle', { diameterFactor: 16 / 5, depthFactor: 30 / 4 });
    const outcome = normalizeRoundConnector(cylinder(2), scale, 70, connector);
    if (outcome.status !== 'available') throw new Error('Expected a connector.');
    expect(outcome.adjusted).toBe(true);
    expect(outcome.connector.diameterFactor).toBe(connector.diameterFactor);
    expect(outcome.connector.depthFactor).toBeCloseTo(22.5 / 4, 6);
    expect(outcome.issues.map(({ code }) => code)).toContain('hole-bottom-thin');
    expect(generateModel(kernel, spec(section(70, outcome.connector as RoundConnector))).solids).toHaveLength(2);
  });

  it('keeps the type, count, profile and clearances, and is idempotent', () => {
    const shapes = [cylinder(0.5), cylinder(2), cylinder(8)];
    const connectors = [
      plug('triangle', { diameterFactor: 6, depthFactor: 6 }),
      dowel('square', { diameterFactor: 6, depthFactor: 6, lowerClearanceMm: 0.15, upperClearanceMm: 0.75 }),
      dowel('flatted-circle', { count: 2, spacingPercent: 60, diameterFactor: 8, depthFactor: 8 }),
    ];
    for (const shape of shapes) {
      for (const connector of connectors) {
        for (const position of [20, 50, 85]) {
          const first = normalizeRoundConnector(shape, scale, position, connector);
          if (first.status !== 'available') continue;
          const { diameterFactor: _d, depthFactor: _e, spacingPercent: _s, ...kept } = connector;
          expect(first.connector).toMatchObject(kept);
          const section2 = solidCut(shape, scale, position);
          const dimensions = roundConnectorDimensions(first.connector as RoundConnector, 80, section2.span / 2);
          expect(roundConnectorChecks(section2, dimensions).filter((check) => !satisfies(check))).toEqual([]);
          const second = normalizeRoundConnector(shape, scale, position, first.connector as RoundConnector);
          expect(second).toEqual({ status: 'available', connector: first.connector, adjusted: false, issues: [] });
        }
      }
    }
  });

  it('moves a too large size and a too long depth together rather than leaving the least depth', () => {
    // A 60 mm plug 30 mm long in a part with room for neither: 30 mm of height and only 40 mm of radius near the cut.
    const shape = cylinder(1);
    const connector = plug('circle', { diameterFactor: 200 / 5, depthFactor: 40 / 4 });
    const outcome = normalizeRoundConnector(shape, scale, 50, connector);
    if (outcome.status !== 'available') throw new Error('Expected a connector.');
    const { diameterFactor, depthFactor } = outcome.connector;
    expect(diameterFactor * 5).toBeLessThan(200);
    // More than the 2 mm of straight engagement the very largest size would leave.
    expect(depthFactor * 4).toBeGreaterThan(5);
  });

  it('keeps clearances absolute when the model is resized, and resolves the dimensions against the new size', () => {
    const connector = dowel('square', { lowerClearanceMm: 0.15, upperClearanceMm: 0.75 });
    for (const longest of [40, 80, 160, 320]) {
      const outcome = normalizeRoundConnector(cylinder(2), { longestDimensionMm: longest }, 50, connector);
      if (outcome.status !== 'available') throw new Error(`Expected a connector at ${longest} mm.`);
      const plan = planRoundConnectors(cylinder(2), { longestDimensionMm: longest }, 50, outcome.connector as RoundConnector);
      expect(plan.clearance).toEqual({ lower: 0.15, upper: 0.75 });
      expect(plan.issues).toEqual([]);
      // Stored multipliers still scale what fits with the model.
      expect(plan.sites[0]?.pinDiameter).toBeCloseTo(10 * (longest / 80), 9);
    }
    // At 16 mm the same multipliers leave a pin too thin: it grows to the least width that works.
    const small = normalizeRoundConnector(cylinder(2), { longestDimensionMm: 16 }, 50, connector);
    if (small.status !== 'available') throw new Error('Expected a connector at 16 mm.');
    const plan = planRoundConnectors(cylinder(2), { longestDimensionMm: 16 }, 50, small.connector as RoundConnector);
    expect(plan.clearance).toEqual({ lower: 0.15, upper: 0.75 });
    expect(plan.issues).toEqual([]);
  });

  it('answers unavailable rather than thinning a wall or lengthening beyond the far side', () => {
    const flat = { kind: 'cylinder', heightRatio: 0.5, offsetRatio: 0 } as const;
    const outcome = normalizeRoundConnector(flat, { longestDimensionMm: 12 }, 50, dowel('hexagon'));
    expect(outcome.status).toBe('unavailable');
    expect(outcome.issues.length).toBeGreaterThan(0);
  });
});

describe('the dowels alone', () => {
  const horizontal = (connector: RoundConnector): Section => ({ type: 'parallel-to-bases', positionPercent: 50, connector });
  const pairOfSquares = dowel('square', { count: 2, spacingPercent: 45, diameterFactor: 2.4 });

  it('holds exactly the assembly’s pins, as separate objects that do not overlap', async () => {
    const artifacts = await buildModelArtifacts(kernel, spec(horizontal(pairOfSquares)));
    const assembly = readThreeMf(artifacts.printFile.bytes).model.objects;
    const pins = readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model;
    expect(pins.unit).toBe('millimeter');
    expect(pins.objects).toHaveLength(2);
    expect(pins.buildItems).toEqual(pins.objects.map(({ id }) => ({ objectId: id })));
    const assembled = assembly.slice(-2);
    pins.objects.forEach((pin, index) => {
      const same = assembled[index];
      expect(findMeshDefects(pin.mesh)).toEqual([]);
      expect(pin.name).toBe(same?.name);
      expect(Array.from(pin.mesh.triangles)).toEqual(Array.from(same?.mesh.triangles ?? []));
      // Rigidly moved only: all coordinates differ by the same translation.
      const shift = [0, 1, 2].map((axis) => (pin.mesh.positions[axis] as number) - (same?.mesh.positions[axis] as number));
      Array.from(pin.mesh.positions).forEach((value, coordinate) => {
        expect(value).toBeCloseTo((same?.mesh.positions[coordinate] as number) + (shift[coordinate % 3] as number), 3);
      });
      expect(Math.min(...Array.from(pin.mesh.positions).filter((_, coordinate) => coordinate % 3 === 2))).toBeCloseTo(0, 6);
    });
    const xs = pins.objects.map(({ mesh }) => Array.from(mesh.positions).filter((_, coordinate) => coordinate % 3 === 0));
    expect(Math.max(...(xs[0] as number[]))).toBeLessThan(Math.min(...(xs[1] as number[])));
  });

  it('names the file after the profile and the actual dimensions', async () => {
    const single = await buildModelArtifacts(
      kernel,
      spec(horizontal(dowel('flatted-circle', { diameterFactor: 2.5, depthFactor: 2 }))),
    );
    expect(single.pinsFile?.fileName).toBe('dowels-flatted-circle-d12.5-L16mm.3mf');
    const pair = await buildModelArtifacts(kernel, spec(horizontal(pairOfSquares)));
    expect(pair.pinsFile?.fileName).toBe('dowels-square-d12-d9.6-L16mm.3mf');
  });

  it('keeps a pin’s physical length and profile whatever the model’s largest dimension is', async () => {
    const artifacts = await buildModelArtifacts(kernel, spec(horizontal(dowel('hexagon'))));
    const [pin] = readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model.objects;
    const zs = Array.from(pin?.mesh.positions ?? []).filter((_, coordinate) => coordinate % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(16, 3);
  });

  it('exists for dowels only: plugs belong to their parts', async () => {
    const plugged = await buildModelArtifacts(kernel, spec(horizontal(plug('hexagon'))));
    expect(plugged.pinsFile).toBeUndefined();
    const flatFaced = await buildModelArtifacts(kernel, spec({ type: 'parallel-to-bases', positionPercent: 50 }));
    expect(flatFaced.pinsFile).toBeUndefined();
  });
});
