import { type ConeShape, type CylinderShape, DEFAULT_MAGNET, type MagnetConnector } from '@diploma-3d/schema';
import { describe, expect, it } from 'vitest';
import { loadGeometryKernel } from '../kernel.ts';
import type { Vec3 } from '../mesh.ts';
import { generateModel } from '../model.ts';
import { cutOfSection, facetedCut, type PlaneCut, type SectionedShape } from './frame.ts';
import { MAGNET_PLACEMENT_POLICY, type MagnetPlan, type MagnetSite, magnetPocketGeometry, planMagnets } from './magnet.ts';

const kernel = await loadGeometryKernel();
const cylinder = (heightRatio = 1.5): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio: 0 });
const cone = (heightRatio = 2, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
/** Magnets without allowances, as in the reference example; the automatic chamfer is part of every opening all the same. */
const bare = (count: number, magnetDiameterMm: number, magnetThicknessMm = 2): MagnetConnector => ({
  type: 'magnet',
  count,
  magnetDiameterMm,
  magnetThicknessMm,
  diameterAllowanceMm: 0,
  depthAllowanceMm: 0,
});
const magnet = (count: number): MagnetConnector => ({ type: 'magnet', ...DEFAULT_MAGNET, count });

/** A cylinder of radius R cut parallel to its bases at half its height: a round section of radius R. */
const round = (radius: number, connector: MagnetConnector) =>
  planMagnets(cylinder(), { longestDimensionMm: 2 * radius }, 50, connector);

const polar = (site: MagnetSite) => ({ radius: Math.hypot(site.along, site.across), angle: Math.atan2(site.across, site.along) });
const degrees = (angle: number) => (angle * 180) / Math.PI;

/** Each opening's outer edge's distance from the section's own contour, on the actual polygonal section. */
function edgeGaps(plan: MagnetPlan, shape: CylinderShape | ConeShape, cut: PlaneCut, connector: MagnetConnector): number[] {
  const { contour } = facetedCut(shape, { longestDimensionMm: 80 }, cut);
  const { opening } = magnetPocketGeometry(connector);
  return plan.sites.map(
    (site) =>
      Math.min(
        ...contour.map((a, index) => {
          const b = contour[(index + 1) % contour.length] as Vec3;
          const edge: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const to: Vec3 = [site.centre[0] - a[0], site.centre[1] - a[1], site.centre[2] - a[2]];
          const cross = [edge[1] * to[2] - edge[2] * to[1], edge[2] * to[0] - edge[0] * to[2], edge[0] * to[1] - edge[1] * to[0]];
          return Math.hypot(...cross) / Math.hypot(...edge);
        }),
      ) - opening,
  );
}

const spacings = (plan: MagnetPlan) =>
  plan.sites.flatMap((first, index) =>
    plan.sites.slice(index + 1).map((second) => Math.hypot(first.along - second.along, first.across - second.across)),
  );

describe('three pairs on a round section', () => {
  it('form an equilateral triangle of circumradius 0,6·R about the centre, whatever the magnets’ diameter', () => {
    // R = 50 mm: 6 mm and 30 mm holes both stay on the 30 mm ring, which keeps 2 mm to the edge and between the holes.
    for (const diameter of [6, 30]) {
      const plan = round(50, bare(3, diameter));
      expect(plan.issues).toEqual([]);
      for (const site of plan.sites) expect(polar(site).radius).toBeCloseTo(30, 1);
      expect(plan.sites.map((site) => degrees(polar(site).angle))).toEqual([
        expect.closeTo(0, 6),
        expect.closeTo(120, 6),
        expect.closeTo(-120, 6),
      ]);
    }
  });

  it('keeps the same centres and orientation over a sweep of diameters that all fit there', () => {
    const reference = round(50, bare(3, 4)).sites;
    for (const diameter of [5, 6, 8, 10, 14, 18, 22, 26, 30]) {
      const plan = round(50, bare(3, diameter, 3));
      expect(plan.issues).toEqual([]);
      plan.sites.forEach((site, index) => {
        expect(site.along).toBeCloseTo((reference[index] as MagnetSite).along, 9);
        expect(site.across).toBeCloseTo((reference[index] as MagnetSite).across, 9);
      });
    }
  });

  it('move inwards, together, where the outer material would be too thin on the ring', () => {
    // R = 30 mm: ρ = clamp(0,6·R, (2r + g)/√3, R − r − w) falls below 18 mm once the opening's radius r passes about 10 mm.
    for (const diameter of [20, 22]) {
      const connector = bare(3, diameter);
      const plan = round(30, connector);
      const { opening } = magnetPocketGeometry(connector);
      const outer = 30 - opening - MAGNET_PLACEMENT_POLICY.minimumEdgeGapMm;
      expect(outer).toBeLessThan(18);
      const radii = plan.sites.map((site) => polar(site).radius);
      // The polygon of the cylinder lies within the circle of radius R, by up to its 0,05 mm deviation.
      for (const radius of radii) {
        expect(radius).toBeLessThanOrEqual(outer + 1e-6);
        expect(radius).toBeGreaterThan(outer - 0.1);
      }
      expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.05);
      expect(plan.sites.map((site) => degrees(polar(site).angle))).toEqual([
        expect.closeTo(0, 0),
        expect.closeTo(120, 0),
        expect.closeTo(-120, 0),
      ]);
    }
  });
});

describe('six pairs on a round section', () => {
  it('move outwards, together, where neighbouring openings would come too close on the ring', () => {
    // A hexagon's side is its circumradius: ρ ≥ 2r + g, above 0,6·R = 30 mm for openings over 14 mm in radius.
    for (const diameter of [28, 29]) {
      const connector = bare(6, diameter);
      const plan = round(50, connector);
      expect(plan.issues).toEqual([]);
      const least = 2 * magnetPocketGeometry(connector).opening + MAGNET_PLACEMENT_POLICY.spacingMm;
      expect(least).toBeGreaterThan(30);
      for (const site of plan.sites) expect(polar(site).radius).toBeCloseTo(least, 1);
      for (const spacing of spacings(plan)) expect(spacing).toBeGreaterThanOrEqual(least - 1e-9);
      // The hexagon keeps its orientation, corners straddling the frame's u.
      const preferred = round(50, bare(6, 10)).sites.map((site) => polar(site).angle);
      plan.sites.forEach((site, index) => {
        expect(degrees(polar(site).angle)).toBeCloseTo(degrees(preferred[index] as number), 0);
      });
    }
  });
});

describe('where they do not fit', () => {
  it('says so, keeping the count and the dimensions, rather than placing fewer or smaller pockets', () => {
    // R = 30 mm, three 30 mm holes: the spacing needs a ring of about 18,7 mm, the outer material one below 13 mm.
    const plan = round(30, bare(3, 30));
    expect(plan.issues.map((issue) => issue.code)).toEqual(['no-arrangement']);
    expect(plan.sites).toEqual([]);
    expect(plan.count).toBe(3);
    expect(plan.holeDiameter).toBe(30);
  });
});

describe('other sections', () => {
  it('a rectangle: four pairs symmetric, one in each quarter, well inside the outline', () => {
    // The axial vertical cut of a cylinder 80 mm wide and 60 mm high.
    const cut = { offsetPercent: 0 };
    const plan = planMagnets(cylinder(), { longestDimensionMm: 80 }, cut, magnet(4));
    const alongs = new Set(plan.sites.map((site) => Math.abs(site.along).toFixed(6)));
    const acrosses = new Set(plan.sites.map((site) => Math.abs(site.across).toFixed(6)));
    expect([alongs.size, acrosses.size]).toEqual([1, 1]);
    expect(new Set(plan.sites.map((site) => `${Math.sign(site.along)}${Math.sign(site.across)}`)).size).toBe(4);
    for (const gap of edgeGaps(plan, cylinder(), cut, magnet(4))) expect(gap).toBeGreaterThan(5);
  });

  it('an elongated strip: three pairs along its length, evenly, and eight still fit spaced along it', () => {
    // H = 12 mm: the axial vertical section is an 80 × 12 mm strip.
    const cut = { offsetPercent: 0 };
    const three = planMagnets(cylinder(0.3), { longestDimensionMm: 80 }, cut, magnet(3));
    expect(three.sites.map((site) => [site.along, site.across])).toEqual([
      [expect.closeTo(0, 6), expect.closeTo(24, 1)],
      [expect.closeTo(0, 6), expect.closeTo(0, 6)],
      [expect.closeTo(0, 6), expect.closeTo(-24, 1)],
    ]);
    const eight = planMagnets(cylinder(0.3), { longestDimensionMm: 80 }, cut, magnet(8));
    expect(eight.issues).toEqual([]);
    const least = 2 * magnetPocketGeometry(magnet(8)).opening + MAGNET_PLACEMENT_POLICY.spacingMm;
    for (const spacing of spacings(eight)) expect(spacing).toBeGreaterThanOrEqual(least - 1e-9);
    for (const gap of edgeGaps(eight, cylinder(0.3), cut, magnet(8))) expect(gap).toBeGreaterThanOrEqual(2 - 1e-6);
  });

  it('an asymmetric section: a leaning cone’s oblique cut takes its pairs about the centroid and within the outline', () => {
    const shape = cone(2, 0.5);
    const cut = { positionPercent: 30, inclinationDeg: 30, directionDeg: 0 };
    for (const count of [1, 2, 3, 5]) {
      const plan = planMagnets(shape, { longestDimensionMm: 80 }, cut, magnet(count));
      expect(plan.issues).toEqual([]);
      expect(plan.sites).toHaveLength(count);
      for (const gap of edgeGaps(plan, shape, cut, magnet(count))) expect(gap).toBeGreaterThanOrEqual(2 - 1e-6);
      const mean = plan.sites.reduce<[number, number]>(
        ([x, y], site) => [x + site.along / count, y + site.across / count],
        [0, 0],
      );
      expect(Math.hypot(...mean)).toBeLessThan(count === 1 ? 0.5 : 10);
    }
  });

  it('a thin cap of a ball: thicker magnets move inwards under its dome, and the whole pockets are checked', () => {
    const shape: SectionedShape = { kind: 'ball' };
    const cut = { offsetPercent: 70 };
    const thin = planMagnets(shape, { longestDimensionMm: 80 }, cut, magnet(3));
    const thick = planMagnets(shape, { longestDimensionMm: 80 }, cut, { ...magnet(3), magnetThicknessMm: 5 });
    expect(thin.issues).toEqual([]);
    expect(thick.issues).toEqual([]);
    const radiusOf = (plan: MagnetPlan) => Math.max(...plan.sites.map((site) => polar(site).radius));
    expect(radiusOf(thick)).toBeLessThan(radiusOf(thin) - 0.5);
    // The engine verifies the pockets in three dimensions as it builds them.
    expect(() =>
      generateModel(kernel, {
        shape,
        scale: { longestDimensionMm: 80 },
        section: { type: 'horizontal', offsetPercent: 70, connector: { ...magnet(3), magnetThicknessMm: 5 } },
      }),
    ).not.toThrow();
  });

  it('is the same every time, and settles the same way after a small change of the magnets', () => {
    for (let count = 1; count <= 8; count += 1) {
      expect(planMagnets(cylinder(), { longestDimensionMm: 80 }, 40, magnet(count))).toEqual(
        planMagnets(cylinder(), { longestDimensionMm: 80 }, 40, magnet(count)),
      );
    }
    const cut = cutOfSection({ type: 'vertical', offsetPercent: 0 });
    const before = planMagnets(cone(), { longestDimensionMm: 80 }, cut, magnet(3));
    const after = planMagnets(cone(), { longestDimensionMm: 80 }, cut, { ...magnet(3), magnetDiameterMm: 6.5 });
    before.sites.forEach((site, index) => {
      expect(
        Math.hypot(
          site.along - (after.sites[index] as MagnetSite).along,
          site.across - (after.sites[index] as MagnetSite).across,
        ),
      ).toBeLessThan(1);
    });
  });
});
