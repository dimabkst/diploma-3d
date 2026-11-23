import {
  type ConeShape,
  type CylinderShape,
  DEFAULT_MAGNET,
  LEGACY_MAGNET_FIELDS,
  type MagnetConnector,
  type ModelSpecInput,
  magnetConnectorSchema,
  type Section,
} from '@diploma-3d/schema';
import type { Manifold, Mat4 } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from '../artifacts.ts';
import { ConnectorUnsuitableError } from '../errors.ts';
import { MODEL_SETTINGS_PATH } from '../export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from '../export/three-mf.test-helper.ts';
import { loadGeometryKernel } from '../kernel.ts';
import { dot, findMeshDefects, measureMesh, type TriangleMesh, type Vec3 } from '../mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import type { RoundShape } from '../shapes/round.ts';
import { cutOfSection, facetedCut, type PlaneCut, type SectionedShape, solidCut } from './frame.ts';
import {
  MAGNET_PLACEMENT_POLICY,
  type MagnetPlan,
  type MagnetSite,
  magnetChamferMm,
  magnetPocketGeometry,
  planMagnets,
} from './magnet.ts';

const kernel = await loadGeometryKernel();
const M80 = { longestDimensionMm: 80 };

const cylinder = (heightRatio = 1.5, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const cone = (heightRatio = 2, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
const BALL = { kind: 'ball' } as const;
const magnet = (overrides: Partial<Omit<MagnetConnector, 'type'>> = {}): MagnetConnector => ({
  type: 'magnet',
  ...DEFAULT_MAGNET,
  ...overrides,
});
const PLATE = { thicknessMm: 1.6, marginMm: 10 };

type Cut = Exclude<Section, { connector: unknown }> | Section;

const specOf = (shape: SectionedShape, section: Cut, connector?: MagnetConnector, scale = M80): ModelSpecInput => ({
  shape,
  scale,
  section: { ...section, ...(connector === undefined ? {} : { connector }) } as Section,
});

/** Every cut every solid offers, each without and with a section plate. */
const combinations: readonly (readonly [string, SectionedShape, Section])[] = (
  [
    ['a right cylinder cut parallel to its bases', cylinder(), { type: 'parallel-to-bases', positionPercent: 50 }],
    ['a leaning cylinder cut vertically off its axis', cylinder(1.5, 0.6), { type: 'vertical', offsetPercent: 30 }],
    ['a right cylinder cut obliquely', cylinder(), { type: 'oblique', positionPercent: 50, inclinationDeg: 45, directionDeg: 0 }],
    ['a cone cut parallel to its base', cone(), { type: 'parallel-to-bases', positionPercent: 30 }],
    ['a cone cut vertically through its axis', cone(), { type: 'vertical', offsetPercent: 0 }],
    ['a leaning cone cut obliquely', cone(2, 0.5), { type: 'oblique', positionPercent: 30, inclinationDeg: 30, directionDeg: 0 }],
    ['a cone cut through its apex', cone(), { type: 'oblique-apex', inclinationDeg: 80, directionDeg: 0 }],
    ['a ball cut horizontally', BALL, { type: 'horizontal', offsetPercent: 0 }],
  ] as const
).flatMap(([name, shape, section]) => [
  [name, shape, section as Section] as const,
  [`${name}, with a section plate`, shape, { ...section, plate: PLATE } as Section] as const,
]);

const negativePart = (section: Section) =>
  section.type === 'parallel-to-bases' || section.type === 'horizontal' ? 'lower' : 'part-1';
const positivePart = (section: Section) =>
  section.type === 'parallel-to-bases' || section.type === 'horizontal' ? 'upper' : 'part-2';
const partOf = (model: GeneratedModel, part: string): Solid => model.solids.find((solid) => solid.part === part) as Solid;
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));

const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** A pocket's opening on its part's face and the axis into the part, from the plan's shared centre. */
function pocketAxis(plan: MagnetPlan, site: MagnetSite, side: 'lower' | 'upper') {
  const sign = side === 'upper' ? 1 : -1;
  return { face: plus(site.centre, times(plan.frame.n, sign * plan.faceGap)), inward: times(plan.frame.n, sign) };
}

/** The matrix that takes the model to a pocket's local frame: x along u, y along v, z into the part from its opening. */
function toPocket(plan: MagnetPlan, face: Vec3, inward: Vec3): Mat4 {
  const { u, v } = plan.frame;
  const [x, y, z] = [
    u,
    inward[0] * plan.frame.n[0] + inward[1] * plan.frame.n[1] + inward[2] * plan.frame.n[2] > 0 ? v : times(v, -1),
    inward,
  ];
  // A proper rotation: (u, ±v, ±n).
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, face), -dot(y, face), -dot(z, face), 1] as Mat4;
}

/** A probe cylinder of `radius` along the pocket's axis, from `from` to `to` millimetres into the part. */
function probe(track: Track, plan: MagnetPlan, face: Vec3, inward: Vec3, radius: number, from: number, to: number): Manifold {
  const local = track(kernel.Manifold.cylinder(to - from, radius, radius, 32).translate([0, 0, from]));
  const { u, v } = plan.frame;
  const y = dot(inward, plan.frame.n) > 0 ? v : times(v, -1);
  return track(local.transform([...u, 0, ...y, 0, ...inward, 0, ...face, 1] as Mat4));
}

/** The pockets' shape in one part, read off its mesh: the hole's contour around the axis at a depth, if any. */
function holeAt(track: Track, part: Manifold, plan: MagnetPlan, face: Vec3, inward: Vec3, depth: number) {
  const polygons = track(track(part.transform(toPocket(plan, face, inward))).slice(depth)).toPolygons() as [number, number][][];
  const around = polygons.filter((polygon) => Math.max(...polygon.map(([x, y]) => Math.hypot(x, y))) < plan.holeDiameter);
  if (around.length === 0) return undefined;
  const ring = around[0] as [number, number][];
  // The least distance from the axis to the contour's edges: the flats of the circumscribed polygon, the nominal radius.
  const flats = ring.map(([x0, y0], index) => {
    const [x1, y1] = ring[(index + 1) % ring.length] as [number, number];
    return Math.abs(x0 * y1 - x1 * y0) / Math.hypot(x1 - x0, y1 - y0);
  });
  return { inner: Math.min(...flats), outer: Math.max(...ring.map(([x, y]) => Math.hypot(x, y))) };
}

/** The pocket polygon's area for its inscribed radius, and the pocket's volume: the chamfer's frustum and the straight rest. */
const polygonArea = (plan: MagnetPlan, inradius: number) => plan.segments * inradius ** 2 * Math.tan(Math.PI / plan.segments);
const pocketVolume = (plan: MagnetPlan) => {
  const radius = plan.holeDiameter / 2;
  const [wide, narrow] = [polygonArea(plan, radius + plan.chamfer), polygonArea(plan, radius)];
  return (plan.chamfer * (wide + narrow + Math.sqrt(wide * narrow))) / 3 + narrow * (plan.holeDepth - plan.chamfer);
};

describe('magnet pockets on every cut', () => {
  it.each(combinations)('%s: N matching blind pockets in each part, on shared axes', (_, shape, section) => {
    const connector = magnet();
    const model = generateModel(kernel, specOf(shape, section, connector));
    const plain = generateModel(kernel, specOf(shape, section));
    const plan = (model.section as ModelSection).connector as MagnetPlan;
    expect(plan.type).toBe('magnet');
    expect(plan.issues).toEqual([]);
    expect(plan.sites).toHaveLength(3);
    // Only the parts change; a section plate stays whole, and no placeholder is exported.
    expect(model.solids.map((solid) => solid.part)).toEqual(plain.solids.map((solid) => solid.part));
    for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
    const plate = model.solids.find((solid) => solid.part === 'plate');
    if (plate !== undefined) expect(plate.mesh.positions).toEqual((partOf(plain, 'plate') as Solid).mesh.positions);
    // The pockets' centres lie on the cut's middle plane, the shared axis is its normal.
    for (const site of plan.sites) {
      expect(dot(site.centre, plan.frame.n)).toBeCloseTo((model.section as ModelSection).plane.offset, 9);
    }
    // Each part lost exactly N pockets of the planned polygon and depth.
    for (const part of [negativePart(section), positivePart(section)]) {
      const lost = partOf(plain, part).measurements.volume - partOf(model, part).measurements.volume;
      expect(lost / (3 * pocketVolume(plan))).toBeCloseTo(1, 3);
    }
    // At every centre, from both faces: empty along the opposite inward directions down to the depth, material beneath.
    withScope((track) => {
      for (const [side, name] of [
        ['lower', negativePart(section)],
        ['upper', positivePart(section)],
      ] as const) {
        const solid = manifoldOf(track, partOf(model, name).mesh);
        expect(solid.genus()).toBe(0);
        expect(solid.decompose().map(track)).toHaveLength(1);
        for (const site of plan.sites) {
          const { face, inward } = pocketAxis(plan, site, side);
          const radius = plan.holeDiameter / 2;
          const hole = probe(track, plan, face, inward, 0.99 * radius, 0.02, plan.holeDepth - 0.02);
          expect(track(hole.intersect(solid)).volume()).toBeLessThan(1e-3);
          const beneath = probe(
            track,
            plan,
            face,
            inward,
            0.5 * radius,
            plan.holeDepth + 0.05,
            plan.holeDepth + plan.wall - 0.05,
          );
          expect(track(beneath.intersect(solid)).volume()).toBeCloseTo(beneath.volume(), 2);
        }
      }
    });
    // Apart by the spacing between their openings, and not all on one line.
    const { opening } = magnetPocketGeometry(connector);
    const [a, b, c] = plan.sites as [MagnetSite, MagnetSite, MagnetSite];
    for (const [first, second] of [
      [a, b],
      [b, c],
      [a, c],
    ] as const) {
      expect(Math.hypot(first.along - second.along, first.across - second.across)).toBeGreaterThanOrEqual(
        2 * opening + MAGNET_PLACEMENT_POLICY.spacingMm - 1e-9,
      );
    }
    const area = Math.abs((b.along - a.along) * (c.across - a.across) - (c.along - a.along) * (b.across - a.across)) / 2;
    expect(area).toBeGreaterThan(opening ** 2);
  });
});

describe('the pocket’s size', () => {
  it('is the magnet plus its allowances, in printed millimetres, whatever the model’s size', () => {
    const connector = magnet({ count: 1 });
    for (const longestDimensionMm of [60, 80, 160]) {
      const scale = { longestDimensionMm };
      const section: Section = { type: 'parallel-to-bases', positionPercent: 50 };
      const model = generateModel(kernel, specOf(cylinder(), section, connector, scale));
      const plan = (model.section as ModelSection).connector as MagnetPlan;
      expect(plan.holeDiameter).toBeCloseTo(6.2, 12);
      expect(plan.holeDepth).toBeCloseTo(2.1, 12);
      withScope((track) => {
        for (const [side, name] of [
          ['lower', 'lower'],
          ['upper', 'upper'],
        ] as const) {
          const solid = manifoldOf(track, partOf(model, name).mesh);
          const { face, inward } = pocketAxis(plan, plan.sites[0] as MagnetSite, side);
          // The flats of the pocket's polygon lie on the 6,2 mm circle; its corners just outside it.
          const middle = holeAt(track, solid, plan, face, inward, 1.05);
          expect(middle?.inner).toBeCloseTo(3.1, 3);
          expect(middle?.outer).toBeLessThan(3.1 + 0.05);
          // 2,1 mm deep, closed beneath.
          expect(holeAt(track, solid, plan, face, inward, 2.08)).toBeDefined();
          expect(holeAt(track, solid, plan, face, inward, 2.12)).toBeUndefined();
        }
      });
    }
  });

  it('opens through a small automatic chamfer, which leaves most of the magnet in the cylindrical seat', () => {
    // min(0,2 mm, t/4), shortened to keep three quarters of the thickness in the seat, and none below 0,05 mm.
    expect(magnetChamferMm(2, 2.1)).toBeCloseTo(0.2, 12);
    expect(magnetChamferMm(0.5, 0.6)).toBeCloseTo(0.125, 12);
    expect(magnetChamferMm(6, 6)).toBeCloseTo(0.2, 12);
    const model = generateModel(kernel, specOf(BALL, { type: 'horizontal', offsetPercent: 0 }, magnet({ count: 1 })));
    const plan = (model.section as ModelSection).connector as MagnetPlan;
    expect(plan.chamfer).toBeCloseTo(0.2, 12);
    withScope((track) => {
      const solid = manifoldOf(track, partOf(model, 'upper').mesh);
      const { face, inward } = pocketAxis(plan, plan.sites[0] as MagnetSite, 'upper');
      expect(holeAt(track, solid, plan, face, inward, 0.02)?.inner).toBeCloseTo(3.1 + 0.18, 2);
      // From the chamfer's end down, 1,9 of the 2 mm magnet sit against the 6,2 mm wall.
      expect(holeAt(track, solid, plan, face, inward, 0.21)?.inner).toBeCloseTo(3.1, 3);
      expect(holeAt(track, solid, plan, face, inward, 2.09)?.inner).toBeCloseTo(3.1, 3);
    });
  });
});

describe('placement', () => {
  it('is deterministic, and keeps every opening the edge clearance inside the faces', () => {
    for (const [, shape, section] of combinations) {
      const cut = cutOfSection(section);
      const first = planMagnets(shape, M80, cut, magnet({ count: 5 }));
      expect(planMagnets(shape, M80, cut, magnet({ count: 5 }))).toEqual(first);
      expect(first.issues).toEqual([]);
      expect(first.sites).toHaveLength(5);
      if ('plate' in section) continue;
      // Each opening, by its polygon's corners, keeps the clearance to the section's own contour.
      const contour = (
        shape.kind === 'ball' ? solidCut(shape, M80, cut) : facetedCut(shape as RoundShape, M80, cut as PlaneCut)
      ) as {
        contour: readonly Vec3[];
      };
      const { opening } = magnetPocketGeometry(magnet({ count: 5 }));
      for (const site of first.sites) {
        const edge = Math.min(
          ...contour.contour.map((a, index) => {
            const b = contour.contour[(index + 1) % contour.contour.length] as Vec3;
            const along: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const to: Vec3 = [site.centre[0] - a[0], site.centre[1] - a[1], site.centre[2] - a[2]];
            const cross = [
              along[1] * to[2] - along[2] * to[1],
              along[2] * to[0] - along[0] * to[2],
              along[0] * to[1] - along[1] * to[0],
            ] as Vec3;
            return Math.hypot(...cross) / Math.hypot(...along);
          }),
        );
        expect(edge - opening).toBeGreaterThanOrEqual(MAGNET_PLACEMENT_POLICY.minimumEdgeGapMm - 1e-6);
      }
    }
  }, 120_000);

  it('puts one pair at the centroid and two on opposite sides of it, at 0,6 of the radius', () => {
    const single = planMagnets(cylinder(), M80, 50, magnet({ count: 1 }));
    expect(Math.hypot((single.sites[0] as MagnetSite).along, (single.sites[0] as MagnetSite).across)).toBeLessThan(1e-6);
    const pair = planMagnets(cylinder(), M80, 50, magnet({ count: 2 }));
    const [a, b] = pair.sites as [MagnetSite, MagnetSite];
    expect(Math.hypot(a.along + b.along, a.across + b.across) / 2).toBeLessThan(1e-6);
    // r = 40 mm: both on the 24 mm ring, the same for any magnet that fits there.
    expect(Math.hypot(a.along - b.along, a.across - b.across)).toBeCloseTo(48, 1);
  });

  it('measures the whole pocket against a curved surface, not just its opening', () => {
    // A thin cap of a ball at 60 mm: the opening fits on the cut, but deeper inside the cap curves in over a pocket near its edge.
    const plan = planMagnets(BALL, { longestDimensionMm: 60 }, { offsetPercent: 60 }, magnet({ count: 1 }));
    expect(plan.issues).toEqual([]);
    const site = plan.sites[0] as MagnetSite;
    // A single pocket takes the place with the most material: on the axis of the cap.
    expect(Math.hypot(site.along, site.across)).toBeLessThan(1);
    const crowded = planMagnets(BALL, { longestDimensionMm: 60 }, { offsetPercent: 60 }, magnet({ count: 4 }));
    // r = 30 mm at 60 %: the cap's face has a radius of 24 mm; four pockets near its edge would break through the cap's dome.
    for (const pocket of crowded.sites) {
      const reach = Math.hypot(pocket.along, pocket.across);
      const radius = 3.1 + 2;
      // The dome at the pocket's outer side keeps 2 mm over the bottom: (reach + r)² + (18 + 2,1 + 2)² ≤ 30².
      expect(Math.hypot(reach + radius - 2, 18 + 2.1 + 2)).toBeLessThanOrEqual(30 + 1e-6);
    }
  });
});

describe('where the magnets do not fit', () => {
  const codes = (plan: MagnetPlan) => plan.issues.map((issue) => ('part' in issue ? `${issue.code}:${issue.part}` : issue.code));

  it('names the part too thin for the pocket and its bottom, beside an otherwise large section', () => {
    // H = 60 mm: 10 % leaves the lower part 6 mm, less than 4 + 0,1 + 2 mm.
    const plan = planMagnets(cylinder(), M80, 10, magnet({ magnetThicknessMm: 4 }));
    expect(codes(plan)).toEqual(['too-shallow:lower']);
    expect(plan.sites).toEqual([]);
    expect(() =>
      generateModel(
        kernel,
        specOf(cylinder(), { type: 'parallel-to-bases', positionPercent: 10 }, magnet({ magnetThicknessMm: 4 })),
      ),
    ).toThrow(ConnectorUnsuitableError);
  });

  it('a thin spherical cap, a cut near a cone’s tip, an oblique cut, and oversized or too many magnets', () => {
    expect(codes(planMagnets(BALL, M80, { offsetPercent: 80 }, magnet({ magnetThicknessMm: 8 })))).toEqual(['too-shallow:upper']);
    // The cap at 80 % takes four 10 mm magnets but not six: the search says it could not place all, and places none.
    const cap = planMagnets(BALL, M80, { offsetPercent: 80 }, magnet({ count: 6, magnetDiameterMm: 10 }));
    expect(cap.issues).toEqual([{ code: 'no-arrangement', placed: expect.any(Number) }]);
    expect((cap.issues[0] as { placed: number }).placed).toBeLessThan(6);
    expect(cap.sites).toEqual([]);
    expect(planMagnets(BALL, M80, { offsetPercent: 80 }, magnet({ count: 4, magnetDiameterMm: 10 })).issues).toEqual([]);
    expect(codes(planMagnets(cone(), M80, 90, magnet({ count: 1 })))).toEqual(['face-too-small']);
    expect(codes(planMagnets(cone(), M80, 85, magnet({ count: 1 })))).toEqual(['wall-thin:upper']);
    // An oblique cut high on a leaning cone: a 6 mm pocket's opening fits on the face, but a 6 mm deep one leaves too little
    // under the narrowing cone, whereas a 2 mm one fits.
    const oblique = { positionPercent: 80, inclinationDeg: 20, directionDeg: 0 };
    expect(codes(planMagnets(cone(2, 0.5), M80, oblique, magnet({ count: 1, magnetThicknessMm: 6 })))).toEqual([
      'wall-thin:upper',
    ]);
    expect(planMagnets(cone(2, 0.5), M80, oblique, magnet({ count: 1 })).issues).toEqual([]);
    expect(codes(planMagnets(cylinder(), M80, 50, magnet({ count: 12, magnetDiameterMm: 20 })))).toEqual(['no-arrangement']);
    expect(codes(planMagnets(cylinder(), { longestDimensionMm: 20 }, 50, magnet({ count: 1, magnetDiameterMm: 25 })))).toEqual([
      'face-too-small',
    ]);
    expect(codes(planMagnets(cylinder(), { longestDimensionMm: 40 }, 50, magnet({ count: 1, magnetThicknessMm: 20 })))).toEqual([
      'too-shallow:lower',
      'too-shallow:upper',
    ]);
  });

  it('refuses settings outside their windows in the shared schema', () => {
    for (const invalid of [
      { count: 0 },
      { count: 13 },
      { count: 2.5 },
      { magnetDiameterMm: Number.NaN },
      { magnetDiameterMm: -6 },
      { magnetThicknessMm: Number.POSITIVE_INFINITY },
      { diameterAllowanceMm: 1.5 },
      { diameterAllowanceMm: -0.05 },
      { depthAllowanceMm: 1.05 },
    ]) {
      expect(magnetConnectorSchema.safeParse(magnet(invalid)).success).toBe(false);
    }
    expect(magnetConnectorSchema.safeParse(magnet()).success).toBe(true);
    // The settings the placement now decides itself are refused rather than read: none of them can override it unseen.
    for (const legacy of LEGACY_MAGNET_FIELDS) {
      expect(magnetConnectorSchema.safeParse({ ...magnet(), [legacy]: 2 }).success).toBe(false);
    }
  });
});

describe('the download of magnet pockets', () => {
  it('holds the parts as built, and records the pockets, both centres and the magnets needed', async () => {
    const section: Section = { type: 'oblique', positionPercent: 50, inclinationDeg: 45, directionDeg: 0, plate: PLATE };
    const artifacts = await buildModelArtifacts(kernel, specOf(cylinder(), section, magnet({ count: 4 })));
    const { model } = artifacts;
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(file.model.objects.map((object) => object.name)).toEqual([
      'cylinder-part-1',
      'cylinder-part-2',
      'cylinder-section-plate',
    ]);
    file.model.objects.forEach((object, index) => {
      expect(measureMesh(object.mesh).volume).toBeCloseTo((model.solids[index] as Solid).measurements.volume, 1);
      expect(findMeshDefects(object.mesh)).toEqual([]);
    });
    expect(artifacts.pinsFile).toBeUndefined();
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.connector.settings).toEqual(magnet({ count: 4 }));
    expect(json.sourceModel.connector.dimensions).toMatchObject({ holeDiameterMm: 6.2, holeDepthMm: 2.1, magnetsTotal: 8 });
    const plan = (model.section as ModelSection).connector as MagnetPlan;
    expect(json.sourceModel.connector.dimensions.pairs.map((pair: { centreMm: Vec3 }) => pair.centreMm)).toEqual(
      plan.sites.map((site) => site.centre),
    );
  });
});
