import {
  type ConeShape,
  type ConnectorProfile,
  type DovetailConnector,
  type DowelConnector,
  type ModelSpecInput,
  type PlugConnector,
  type RoundConnector,
  sectionSchema,
} from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import { type DovetailPlan, dovetailFeasibility } from './connectors/dovetail.ts';
import {
  type ConePlateSection,
  conePlateSection,
  conePlateThicknessRange,
  connectorVolumeTolerance,
  type PlateCut,
  satisfies,
  solidCut,
} from './connectors/frame.ts';
import {
  dowelLength,
  plateHoleClearance,
  plugHeight,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorPlan,
  roundConnectorChecks,
  roundConnectorDimensions,
  roundConnectorFeasibility,
} from './connectors/round.ts';
import { defaultRoundConnector, normalizeRoundConnector } from './connectors/round-capacity.ts';
import { InvalidModelSpecError } from './errors.ts';
import { MODEL_SETTINGS_PATH, modelSettingsDocument } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { findMeshDefects, measureMesh, type TriangleMesh, type Vec3 } from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type SectionPart, type Solid } from './model.ts';
import { PLATE_CORNER_RADIUS_MM, plateOutline } from './plate.ts';
import { type Track, withScope } from './scope.ts';
import { MAX_CIRCLE_DEVIATION_MM, roundDimensionsMm } from './shapes/round.ts';

const kernel = await loadGeometryKernel();

const cone = (heightRatio = 2, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
const plate = (thicknessMm = 1.6, marginMm = 10) => ({ thicknessMm, marginMm });

function specOf(
  shape: ConeShape,
  positionPercent: number,
  withPlate: ReturnType<typeof plate> | undefined,
  connector?: ModelSpecInput['section'] extends infer S ? (S extends { connector?: infer C } ? C : never) : never,
  longestDimensionMm = 80,
): ModelSpecInput {
  return {
    shape,
    scale: { longestDimensionMm },
    section: {
      type: 'parallel-to-bases',
      positionPercent,
      ...(withPlate === undefined ? {} : { plate: withPlate }),
      ...(connector === undefined ? {} : { connector }),
    },
  };
}

const partOf = (model: GeneratedModel, part: SectionPart): Solid => {
  const found = model.solids.filter((solid) => solid.part === part);
  if (found.length !== 1) throw new Error(`Expected one ${part}, found ${found.length}`);
  return found[0] as Solid;
};

const boundsOf = (solid: Solid) => solid.measurements.bounds;

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));

const volumeOf = (track: Track, manifold: Manifold) => track(manifold).volume();

/** Float32 positions of a model some 100 mm across: a few micrometres. */
const POSITION_TOLERANCE_MM = 1e-4;

const plateCut = (positionPercent: number, thicknessMm = 1.6, marginMm = 10): PlateCut => ({
  positionPercent,
  plate: { thicknessMm, marginMm },
});

/** The signed distance of a point inside the rounded rectangle to its boundary, in the frame's (v, u) plane. */
function insideRoundedRectangle(
  [x, y]: readonly [number, number],
  outline: { u: { min: number; max: number }; v: { min: number; max: number } },
  radius: number,
): number {
  const [cx, cy] = [(outline.v.min + outline.v.max) / 2, (outline.u.min + outline.u.max) / 2];
  const [hx, hy] = [(outline.v.max - outline.v.min) / 2 - radius, (outline.u.max - outline.u.min) / 2 - radius];
  const [dx, dy] = [Math.abs(x - cx) - hx, Math.abs(y - cy) - hy];
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  return radius - outside;
}

const shoelace = (points: readonly (readonly [number, number])[]) =>
  points.reduce((sum, [x0, y0], index) => {
    const [x1, y1] = points[(index + 1) % points.length] as readonly [number, number];
    return sum + (x0 * y1 - x1 * y0) / 2;
  }, 0);

describe('the plate is optional', () => {
  it('a section without a plate builds the two parts it always did, and no plan carries a plate', () => {
    const dowel: DowelConnector = {
      type: 'dowel',
      count: 1,
      profile: 'circle',
      diameterFactor: 1,
      depthFactor: 1,
      lowerClearanceMm: 0.4,
      upperClearanceMm: 0.5,
    };
    const model = generateModel(kernel, specOf(cone(), 40, undefined, dowel));
    expect(model.name).toBe('cone-parallel-section');
    expect(model.solids.map((solid) => solid.part)).toEqual(['lower', 'upper', 'dowel']);
    expect(model.section?.plate).toBeUndefined();
    const plan = model.section?.connector as RoundConnectorPlan;
    expect(plan).not.toHaveProperty('plateThickness');
    expect(dowelLength(plan)).toBe(2 * plan.insertion);
    const dovetail = generateModel(
      kernel,
      specOf(cone(), 40, undefined, { type: 'dovetail', sizeFactor: 1, lengthPercent: 50, clearanceMm: 0.2 }),
    );
    expect(dovetail.section?.connector).not.toHaveProperty('interfaces');
    // The plain parts meet at the cut, as before.
    expect(boundsOf(partOf(model, 'lower')).max[2]).toBeCloseTo(32, 4);
  });

  it('the schema keeps the plate within its windows', () => {
    const parse = (thicknessMm: number, marginMm: number) =>
      sectionSchema.safeParse({ type: 'parallel-to-bases', positionPercent: 50, plate: { thicknessMm, marginMm } }).success;
    expect(parse(1.2, 3)).toBe(true);
    expect(parse(4, 30)).toBe(true);
    expect(parse(1.19, 10)).toBe(false);
    expect(parse(4.01, 10)).toBe(false);
    expect(parse(1.6, 2.9)).toBe(false);
    expect(parse(1.6, 30.1)).toBe(false);
    expect(parse(Number.NaN, 10)).toBe(false);
  });

  it('the engine refuses a plate where it does not apply', () => {
    const cylinder = { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 } as const;
    expect(() =>
      generateModel(kernel, {
        shape: cylinder,
        scale: { longestDimensionMm: 80 },
        section: { type: 'parallel-to-bases', positionPercent: 50, plate: plate() },
      }),
    ).toThrow(InvalidModelSpecError);
    expect(() =>
      generateModel(
        kernel,
        specOf(cone(), 50, plate(), { type: 'twist', sizeMm: 14, holeClearanceMm: 0.5, axialClearanceMm: 0.2 }),
      ),
    ).toThrow(InvalidModelSpecError);
  });
});

describe('a plain plate', () => {
  const cases = [15, 50, 85].flatMap((position) =>
    [
      [cone(2), 80],
      [cone(0.8), 40],
      [cone(3, 1.5), 120],
      [cone(1, 2.5), 80],
    ].map(([shape, longest]) => [position, shape as ConeShape, longest as number] as const),
  );

  it.each(cases)(
    'at %s percent of %o, M = %s mm: the slab between the parts, nothing moved or rescaled',
    (position, shape, longest) => {
      const scale = { longestDimensionMm: longest };
      const thickness = Math.min(2.4, conePlateThicknessRange(shape, scale, position).max);
      const model = generateModel(kernel, specOf(shape, position, plate(thickness, 6), undefined, longest));
      const { height, radius } = roundDimensionsMm(shape, scale);
      const middle = (position / 100) * height;
      const half = thickness / 2;
      expect(model.name).toBe('cone-parallel-section-plate');
      expect(model.solids.map((solid) => [solid.part, solid.name])).toEqual([
        ['lower', 'cone-lower-part'],
        ['upper', 'cone-upper-part'],
        ['plate', 'cone-section-plate'],
      ]);
      for (const solid of model.solids) {
        expect(findMeshDefects(solid.mesh)).toEqual([]);
        expect(solid.measurements.volume).toBeGreaterThan(0);
      }
      const [lower, upper, slab] = (['lower', 'upper', 'plate'] as const).map((part) => boundsOf(partOf(model, part)));
      const section = model.section as ModelSection;
      // The cut stays in the middle of the plate, at its own height, and the solid keeps its size.
      expect(section.plane.offset).toBeCloseTo(middle, 9);
      expect(lower?.max[2]).toBeCloseTo(middle - half, 4);
      expect(upper?.min[2]).toBeCloseTo(middle + half, 4);
      expect(slab?.min[2]).toBeCloseTo(middle - half, 4);
      expect(slab?.max[2]).toBeCloseTo(middle + half, 4);
      expect(lower?.min[2]).toBeCloseTo(0, 6);
      expect(upper?.max[2]).toBeCloseTo(height, 4);
      expect((lower?.max[1] ?? 0) - (lower?.min[1] ?? 0)).toBeCloseTo(2 * radius, 3);
      // The parts and the slab fill the solid: its volume less the frustum between the plate's faces.
      const geometry = conePlateSection(shape, scale, plateCut(position, thickness, 6));
      const [a1, a2] = [geometry.interfaces.lower.area, geometry.interfaces.upper.area];
      const slabVolume = (thickness / 3) * (a1 + a2 + Math.sqrt(a1 * a2));
      const whole = generateModel(kernel, { shape, scale }).solids[0] as Solid;
      const parts = partOf(model, 'lower').measurements.volume + partOf(model, 'upper').measurements.volume;
      expect(parts + slabVolume).toBeCloseTo(whole.measurements.volume, 0);
      // A rounded rectangle T thick, which covers the slab by at least the margin.
      const outline = section.plate?.outline as NonNullable<ModelSection['plate']>['outline'];
      expect(partOf(model, 'plate').measurements.volume).toBeCloseTo(
        shoelace(plateOutline(section.plate as NonNullable<ModelSection['plate']>)) * thickness,
        1,
      );
      const { origin } = geometry.frame;
      for (const point of [...geometry.interfaces.lower.contour, ...geometry.interfaces.upper.contour]) {
        const local: [number, number] = [point[0] - origin[0], point[1] - origin[1]];
        expect(insideRoundedRectangle(local, outline, PLATE_CORNER_RADIUS_MM)).toBeGreaterThanOrEqual(
          6 - MAX_CIRCLE_DEVIATION_MM,
        );
      }
      expect(slab?.min[0]).toBeCloseTo(origin[0] + outline.v.min, 3);
      expect(slab?.max[0]).toBeCloseTo(origin[0] + outline.v.max, 3);
      expect(slab?.min[1]).toBeCloseTo(origin[1] + outline.u.min, 3);
      expect(slab?.max[1]).toBeCloseTo(origin[1] + outline.u.max, 3);
      // The plate may make the assembly larger than the solid, never smaller, and the assembly's bounds hold it.
      model.size.forEach((extent, axis) => {
        expect(extent).toBeGreaterThanOrEqual((whole.measurements.size[axis] as number) - POSITION_TOLERANCE_MM);
      });
      expect(model.bounds.min[0]).toBeLessThanOrEqual((slab?.min[0] ?? 0) + POSITION_TOLERANCE_MM);
      expect(model.bounds.max[1]).toBeGreaterThanOrEqual((slab?.max[1] ?? 0) - POSITION_TOLERANCE_MM);
      withScope((track) => {
        for (const solid of model.solids) {
          const manifold = manifoldOf(track, solid.mesh);
          const pieces = manifold.decompose().map(track);
          expect(pieces).toHaveLength(1);
          expect(manifold.genus()).toBe(0);
        }
        const [first, second, third] = model.solids.map((solid) => manifoldOf(track, solid.mesh)) as [
          Manifold,
          Manifold,
          Manifold,
        ];
        const tolerance = connectorVolumeTolerance(longest);
        expect(volumeOf(track, first.intersect(second))).toBeLessThan(tolerance);
        expect(volumeOf(track, first.intersect(third))).toBeLessThan(tolerance);
        expect(volumeOf(track, second.intersect(third))).toBeLessThan(tolerance);
      });
    },
  );

  it('the plate’s faces meet sections of different sizes, and in a leaning cone of different centres', () => {
    const shape = cone(2, 1.5);
    const scale = { longestDimensionMm: 80 };
    const { height, offset } = roundDimensionsMm(shape, scale);
    const geometry = conePlateSection(shape, scale, plateCut(50, 4));
    const { lower, upper } = geometry.interfaces;
    const [z1, z2] = [height / 2 - 2, height / 2 + 2];
    // Similar sections about the apex: their areas go with the square of the distance from it.
    expect(lower.area / upper.area).toBeCloseTo(((height - z1) / (height - z2)) ** 2, 9);
    expect(lower.span).toBeGreaterThan(upper.span);
    expect(lower.frame.origin[0]).toBeCloseTo((offset * z1) / height, 6);
    expect(upper.frame.origin[0]).toBeCloseTo((offset * z2) / height, 6);
    expect(lower.frame.origin[2]).toBeCloseTo(z1, 9);
    expect(upper.frame.origin[2]).toBeCloseTo(z2, 9);
    // Below the plate n points down into the lower part; u stays, and v turns over with n.
    expect(lower.frame.n).toEqual([0, 0, -1]);
    expect(lower.frame.u).toEqual(upper.frame.u);
    expect(lower.frame.v[0]).toBeCloseTo(-upper.frame.v[0], 12);
    // The slab's outline is that of the wider face along u, and of both faces' reach along v.
    expect(geometry.slab.u.max - geometry.slab.u.min).toBeCloseTo(lower.span, 9);
    const model = generateModel(kernel, specOf(shape, 50, plate(4)));
    const top = boundsOf(partOf(model, 'lower'));
    const bottom = boundsOf(partOf(model, 'upper'));
    expect(top.max[1] - top.min[1]).toBeGreaterThan(bottom.max[1] - bottom.min[1]);
  });

  it('a plate thicker than both parts allow is refused, and none fits where even the thinnest would not', () => {
    // r = 10 mm, H = 5 mm: at 50 % each part may keep 1,2 mm of the 2,5 mm on either side.
    const flat = cone(0.5);
    const scale = { longestDimensionMm: 20 };
    expect(conePlateThicknessRange(flat, scale, 50).max).toBeCloseTo(2.6, 9);
    expect(() => generateModel(kernel, specOf(flat, 50, plate(2.6), undefined, 20))).not.toThrow();
    expect(() => generateModel(kernel, specOf(flat, 50, plate(2.8), undefined, 20))).toThrow(InvalidModelSpecError);
    const range = conePlateThicknessRange(flat, scale, 10);
    expect(range.max).toBeLessThan(range.min);
    expect(() => generateModel(kernel, specOf(flat, 10, plate(1.2), undefined, 20))).toThrow(InvalidModelSpecError);
    // The schema's window caps it where the solid would allow more.
    expect(conePlateThicknessRange(cone(), { longestDimensionMm: 80 }, 50).max).toBe(4);
  });
});

const roundConnector = (type: 'plug' | 'dowel', count: 1 | 2, profile: ConnectorProfile): RoundConnector =>
  type === 'plug'
    ? ({
        type,
        count,
        profile,
        diameterFactor: 1,
        depthFactor: 1,
        ...(count === 2 ? { spacingPercent: 45 } : {}),
        holeClearanceMm: 0.4,
      } as PlugConnector)
    : ({
        type,
        count,
        profile,
        diameterFactor: 1,
        depthFactor: 1,
        ...(count === 2 ? { spacingPercent: 45 } : {}),
        lowerClearanceMm: 0.3,
        upperClearanceMm: 0.5,
      } as DowelConnector);

/** A connector of these settings at the dimensions the section offers, as the interface starts one. */
function fitted(shape: ConeShape, cut: PlateCut, connector: RoundConnector, longest = 80): RoundConnector {
  const outcome = defaultRoundConnector(shape, { longestDimensionMm: longest }, cut, connector);
  if (outcome.status !== 'available') throw new Error(`No ${connector.type} fits: ${JSON.stringify(outcome.issues)}`);
  return outcome.connector as RoundConnector;
}

describe('plugs and dowels through the plate', () => {
  const profiles: ConnectorProfile[] = ['circle', 'triangle', 'square', 'hexagon', 'flatted-circle'];
  const cases = (['plug', 'dowel'] as const).flatMap((type) =>
    profiles.flatMap((profile) => ([1, 2] as const).map((count) => [type, profile, count] as const)),
  );

  it.each(cases)('%s, %s, %s: through-holes in the plate, blind holes in the parts', (type, profile, count) => {
    const shape = cone(2, type === 'dowel' ? 0.8 : 0);
    const cut = plateCut(40, 2);
    const connector = fitted(shape, cut, roundConnector(type, count, profile));
    const model = generateModel(kernel, specOf(shape, 40, plate(2), connector));
    const plan = (model.section as ModelSection).connector as RoundConnectorPlan;
    const middle = (model.section as ModelSection).plane.offset;
    expect(plan.plateThickness).toBe(2);
    expect(model.solids.filter((solid) => solid.part === 'dowel')).toHaveLength(type === 'dowel' ? count : 0);
    if (type === 'plug') {
      // An integral plug stands T + e above the lower part's face; the field's e is its engagement in the upper part.
      expect(plugHeight(plan)).toBeCloseTo(2 + plan.insertion, 12);
      expect(boundsOf(partOf(model, 'lower')).max[2]).toBeCloseTo(middle - 1 + plugHeight(plan), 4);
    } else {
      expect(dowelLength(plan)).toBeCloseTo(2 * plan.insertion + 2, 12);
      for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
        expect(dowel.measurements.size[2]).toBeCloseTo(dowelLength(plan), 4);
      }
      expect(plateHoleClearance(plan)).toBe(0.5);
    }
    withScope((track) => {
      const [lower, upper, plateSolid] = (['lower', 'upper', 'plate'] as const).map((part) =>
        manifoldOf(track, partOf(model, part).mesh),
      ) as [Manifold, Manifold, Manifold];
      // Blind holes keep the parts simply connected; each through-hole adds one to the plate's genus.
      expect(upper.genus()).toBe(0);
      expect(lower.genus()).toBe(0);
      expect(plateSolid.genus()).toBe(count);
      const whole = manifoldOf(
        track,
        (generateModel(kernel, { shape, scale: { longestDimensionMm: 80 } }).solids[0] as Solid).mesh,
      );
      const tolerance = connectorVolumeTolerance(80);
      const grown = track(whole.scale(1 + 1e-6));
      expect(volumeOf(track, lower.subtract(grown))).toBeLessThan(tolerance);
      for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
        const pin = manifoldOf(track, dowel.mesh);
        expect(volumeOf(track, pin.subtract(grown))).toBeLessThan(tolerance);
        expect(volumeOf(track, pin.intersect(plateSolid))).toBeLessThan(tolerance);
      }
    });
  });

  it('an asymmetric profile keeps one orientation through the plate', () => {
    const shape = cone();
    const cut = plateCut(40, 1.6);
    const connector = fitted(shape, cut, roundConnector('plug', 1, 'flatted-circle'));
    const model = generateModel(kernel, specOf(shape, 40, plate(1.6), connector));
    const centre = ((model.section as ModelSection).connector as RoundConnectorPlan).sites[0]?.centre as Vec3;
    withScope((track) => {
      const lower = manifoldOf(track, partOf(model, 'lower').mesh);
      const plateSolid = manifoldOf(track, partOf(model, 'plate').mesh);
      const turned = (angle: number) =>
        track(track(track(lower.translate([-centre[0], -centre[1], -centre[2]])).rotate([0, 0, angle])).translate([...centre]));
      const tolerance = connectorVolumeTolerance(80);
      expect(volumeOf(track, plateSolid.intersect(lower))).toBeLessThan(tolerance);
      // The 64-gon of the cone maps onto itself by a quarter turn; only the plug's flat side does not.
      expect(volumeOf(track, plateSolid.intersect(turned(90)))).toBeGreaterThan(0.01);
      expect(volumeOf(track, plateSolid.intersect(turned(180)))).toBeGreaterThan(0.01);
    });
  });

  it('the walls are measured from each part’s own face, half the plate away from the cut', () => {
    // A low, wide cone, where the base under a centred plug limits its backing: r = 40 mm, H = 20 mm, cut at 3 mm.
    const shape = cone(0.5);
    const scale = { longestDimensionMm: 80 };
    const connector = roundConnector('plug', 1, 'circle') as PlugConnector;
    const backing = (cut: PlateCut | number) => {
      const section = solidCut(shape, scale, cut);
      const dimensions = roundConnectorDimensions(connector, 80, section.span / 2);
      return roundConnectorChecks(section, dimensions).find(({ code }) => code === 'base-thin')?.valueMm as number;
    };
    expect(backing(15)).toBeCloseTo(3 - 0.2, 9);
    expect(backing(plateCut(15, 1.6))).toBeCloseTo(3 - 0.8 - 0.2, 9);
    const bottom = (cut: PlateCut | number) => {
      const section = solidCut(shape, scale, cut);
      const dimensions = roundConnectorDimensions(connector, 80, section.span / 2);
      return roundConnectorChecks(section, dimensions).find(
        (issue) => issue.code === 'hole-bottom-thin' && issue.part === 'upper',
      )?.valueMm as number;
    };
    // The upper hole starts T/2 higher, where the cone has narrowed: its bottom keeps less wall.
    expect(bottom(plateCut(15, 3.6))).toBeLessThan(bottom(plateCut(15, 1.2)));
  });
});

describe('a dovetail on both faces of the plate', () => {
  const dovetail = (entrance: 'standard' | 'opposite'): DovetailConnector => ({
    type: 'dovetail',
    sizeFactor: 1,
    lengthPercent: 45,
    clearanceMm: 0.2,
    entrance,
  });

  it.each([
    ['standard', 0],
    ['opposite', 0],
    ['standard', 1.2],
    ['opposite', 1.2],
  ] as const)('%s entrance, lean %s: two tongues, two grooves, each part slides off on its own', (entrance, lean) => {
    const shape = cone(2, lean);
    const model = generateModel(kernel, specOf(shape, 40, plate(1.6), dovetail(entrance)));
    const plain = generateModel(kernel, specOf(shape, 40, plate(1.6)));
    const plan = (model.section as ModelSection).connector as DovetailPlan;
    const middle = (model.section as ModelSection).plane.offset;
    const interfaces = plan.interfaces ?? [];
    expect(interfaces.map((face) => face.part)).toEqual(['lower', 'upper']);
    // Both grooves open on the same side: u is the same below and above, whichever way n points.
    const [below, above] = interfaces as [
      NonNullable<DovetailPlan['interfaces']>[number],
      NonNullable<DovetailPlan['interfaces']>[number],
    ];
    expect(below.frame.u).toEqual(above.frame.u);
    expect(below.frame.u[1]).toBe(entrance === 'standard' ? 1 : -1);
    expect(below.frame.n).toEqual([0, 0, -1]);
    expect(above.frame.n).toEqual([0, 0, 1]);
    expect(plan.frame).toEqual(above.frame);
    // The tongues stand on the plate, the grooves are cut into both parts.
    const slab = boundsOf(partOf(model, 'plate'));
    expect(slab.min[2]).toBeCloseTo(middle - 0.8 - plan.height, 4);
    expect(slab.max[2]).toBeCloseTo(middle + 0.8 + plan.height, 4);
    expect(partOf(model, 'plate').measurements.volume).toBeGreaterThan(partOf(plain, 'plate').measurements.volume);
    expect(partOf(model, 'lower').measurements.volume).toBeLessThan(partOf(plain, 'lower').measurements.volume);
    expect(partOf(model, 'upper').measurements.volume).toBeLessThan(partOf(plain, 'upper').measurements.volume);
    expect(boundsOf(partOf(model, 'lower')).max[2]).toBeCloseTo(middle - 0.8, 4);
    expect(boundsOf(partOf(model, 'upper')).min[2]).toBeCloseTo(middle + 0.8, 4);
    withScope((track) => {
      const [lower, upper, plateSolid] = (['lower', 'upper', 'plate'] as const).map((part) =>
        manifoldOf(track, partOf(model, part).mesh),
      ) as [Manifold, Manifold, Manifold];
      expect(plateSolid.decompose().map(track)).toHaveLength(1);
      const tolerance = connectorVolumeTolerance(80);
      const moved = (solid: Manifold, direction: Vec3, distance: number) =>
        track(solid.translate([direction[0] * distance, direction[1] * distance, direction[2] * distance]));
      for (const face of interfaces) {
        const part = face.part === 'lower' ? lower : upper;
        const other = face.part === 'lower' ? upper : lower;
        const { u, n } = face.frame;
        // Holding the plate, the part slides along +u off its tongue without touching the plate or the other part.
        for (let step = 0; step <= 20; step += 1) {
          const shifted = moved(part, u, (step / 20) * face.exitDistance);
          expect(volumeOf(track, shifted.intersect(plateSolid))).toBeLessThan(tolerance);
          expect(volumeOf(track, shifted.intersect(other))).toBeLessThan(tolerance);
        }
        // Once off, it lifts away freely; engaged, the undercut holds it and the stop ends the slide.
        const off = moved(part, u, face.exitDistance);
        expect(volumeOf(track, moved(off, n, plan.normalPlay + 0.05).intersect(plateSolid))).toBeLessThan(tolerance);
        expect(volumeOf(track, moved(part, n, plan.normalPlay + 0.05).intersect(plateSolid))).toBeGreaterThan(tolerance);
        expect(volumeOf(track, moved(part, u, -(plan.clearance + 0.05)).intersect(plateSolid))).toBeGreaterThan(tolerance);
      }
    });
  });

  it('the ranges are those both grooves allow together, and a thicker plate leaves less room above', () => {
    const shape = cone(2);
    const scale = { longestDimensionMm: 80 };
    const connector = dovetail('standard');
    const thin = dovetailFeasibility(shape, scale, plateCut(70, 1.2), connector);
    const thick = dovetailFeasibility(shape, scale, plateCut(70, 4), connector);
    expect(thick.parameters.length.bounds.max).toBeLessThan(thin.parameters.length.bounds.max);
    expect(thick.parameters.height.bounds.max).toBeLessThanOrEqual(thin.parameters.height.bounds.max);
    // Each issue names its part; the plate itself needs no wall under the tongues.
    const tooLong = dovetailFeasibility(shape, scale, plateCut(70, 4), { ...connector, lengthPercent: 95 });
    expect(tooLong.issues.length).toBeGreaterThan(0);
    for (const issue of tooLong.issues.filter(({ code }) => code.endsWith('-thin'))) {
      expect(issue.part).toMatch(/^(lower|upper)$/);
      expect(issue.code).not.toBe('base-thin');
    }
  });
});

describe('the connector follows the plate', () => {
  const shape = cone(2);
  const scale = { longestDimensionMm: 80 };

  it('keeps a fitting connector, corrects one that no longer fits, and comes back unchanged without the plate', () => {
    // As deep as the upper cone allows without a plate: a 4 mm plate moves the hole's bottom 2 mm towards the apex.
    const base = fitted(shape, plateCut(70, 1.2), roundConnector('dowel', 1, 'circle'));
    const insertion = roundConnectorFeasibility(shape, scale, 70, base).parameters.insertion.bounds.max;
    const deep = { ...base, depthFactor: insertion / (ROUND_CONNECTOR_PROPORTIONS.insertion * 80) } as RoundConnector;
    const atCut = normalizeRoundConnector(shape, scale, 70, deep);
    const withPlate = normalizeRoundConnector(shape, scale, plateCut(70, 4), deep);
    if (atCut.status !== 'available' || withPlate.status !== 'available') throw new Error('expected a connector');
    expect(withPlate.adjusted).toBe(true);
    expect(withPlate.connector.depthFactor).toBeLessThan(deep.depthFactor);
    const section = solidCut(shape, scale, plateCut(70, 4)) as ConePlateSection;
    const dimensions = roundConnectorDimensions(withPlate.connector as RoundConnector, 80, section.span / 2);
    expect(roundConnectorChecks(section, dimensions).every(satisfies)).toBe(true);
    // Corrected once, then kept: nothing oscillates between the plate and the connector.
    const again = normalizeRoundConnector(shape, scale, plateCut(70, 4), withPlate.connector as RoundConnector);
    expect(again).toMatchObject({ status: 'available', adjusted: false, connector: withPlate.connector });
    // The stored settings are not the corrected ones: without the plate the deep connector is checked as it was.
    expect(normalizeRoundConnector(shape, scale, 70, deep)).toEqual(atCut);
  });

  it('a new connector takes its dimensions from the assembly with the plate', () => {
    const connector = roundConnector('plug', 1, 'circle');
    const plain = defaultRoundConnector(shape, scale, 80, connector);
    const plated = defaultRoundConnector(shape, scale, plateCut(80, 4), connector);
    if (plain.status !== 'available' || plated.status !== 'available') throw new Error('expected a connector');
    expect(plated.connector).not.toEqual(plain.connector);
    const section = solidCut(shape, scale, plateCut(80, 4));
    const dimensions = roundConnectorDimensions(plated.connector as RoundConnector, 80, section.span / 2);
    expect(roundConnectorChecks(section, dimensions).every(satisfies)).toBe(true);
  });
});

describe('preview, files and settings', () => {
  const nodeOffsets = async (glb: Uint8Array) => {
    const root = (await new WebIO().readBinary(glb)).getRoot();
    return {
      offsets: Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()])),
      materials: root.listMaterials().map((material) => material.getName()),
    };
  };

  it('shows the plate in its own colour, and moves the parts apart around it without changing the files', async () => {
    const shape = cone(2);
    const connector = fitted(shape, plateCut(40, 1.6), roundConnector('dowel', 2, 'circle'));
    const spec = specOf(shape, 40, plate(1.6), connector);
    const artifacts = await buildModelArtifacts(kernel, spec);
    const { model } = artifacts;
    const assembled = await nodeOffsets(artifacts.previewGlb);
    expect(assembled.materials).toContain('plate');
    for (const offset of Object.values(assembled.offsets)) expect(offset).toEqual([0, 0, 0]);
    const { offsets } = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    // glTF is Y-up: a model's z is the node's y.
    const lift = (part: SectionPart) => (offsets[partOf(model, part).name] as number[])[1] as number;
    expect(offsets[partOf(model, 'plate').name]).toEqual([0, 0, 0]);
    const lower = boundsOf(partOf(model, 'lower'));
    const upper = boundsOf(partOf(model, 'upper'));
    const slab = boundsOf(partOf(model, 'plate'));
    expect(lower.max[2] + lift('lower') * 1000).toBeLessThan(slab.min[2]);
    expect(upper.min[2] + lift('upper') * 1000).toBeGreaterThan(slab.max[2]);
    for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
      expect((offsets[dowel.name] as number[])[1]).toBeCloseTo(lift('lower'), 9);
      expect(boundsOf(dowel).max[2] + lift('lower') * 1000).toBeLessThan(slab.min[2]);
    }
    // The print file holds every object with its own volume: the layout only turns and moves them.
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(file.model.objects.map((object) => object.name)).toEqual(model.solids.map((solid) => solid.name));
    file.model.objects.forEach((object, index) => {
      expect(measureMesh(object.mesh).volume).toBeCloseTo((model.solids[index] as Solid).measurements.volume, 1);
    });
    expect((await buildModelArtifacts(kernel, spec)).printFile.bytes).toEqual(artifacts.printFile.bytes);
  });

  it('the dowels alone are the assembly’s own, as long as the plate is thick', async () => {
    const shape = cone(2);
    const connector = fitted(shape, plateCut(40, 3), roundConnector('dowel', 1, 'square'));
    const artifacts = await buildModelArtifacts(kernel, specOf(shape, 40, plate(3), connector));
    const plan = (artifacts.model.section as ModelSection).connector as RoundConnectorPlan;
    const length = dowelLength(plan);
    expect(artifacts.pinsFile?.fileName).toBe(
      `dowels-square-d${Number(plan.sites[0]?.pinDiameter.toFixed(3))}-L${Number(length.toFixed(3))}mm.3mf`,
    );
    const pins = readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model.objects;
    expect(pins).toHaveLength(1);
    expect(measureMesh((pins[0] as (typeof pins)[number]).mesh).size[2]).toBeCloseTo(length, 4);
    const settings = JSON.parse(readThreeMfPart(artifacts.pinsFile?.bytes as Uint8Array, MODEL_SETTINGS_PATH) as string);
    expect(settings.exportedParts.pins[0].lengthMm).toBe(length);
    expect(settings.sourceModel.connector.dimensions.dowelLengthMm).toBe(length);
    expect(settings.sourceModel.connector.dimensions.engagementMm).toBe(plan.insertion);
  });

  it('a plate with tongues stands on its edge for printing, a flat one lies flat', async () => {
    const shape = cone(2);
    const withTongues = await buildModelArtifacts(
      kernel,
      specOf(shape, 40, plate(1.6), { type: 'dovetail', sizeFactor: 1, lengthPercent: 45, clearanceMm: 0.2 }),
    );
    const flat = await buildModelArtifacts(kernel, specOf(shape, 40, plate(1.6)));
    const objectOf = (bytes: Uint8Array) =>
      readThreeMf(bytes).model.objects.find((object) => object.name === 'cone-section-plate')?.mesh as TriangleMesh;
    const standing = measureMesh(objectOf(withTongues.printFile.bytes));
    const lying = measureMesh(objectOf(flat.printFile.bytes));
    const outline = (withTongues.model.section as ModelSection).plate?.outline as NonNullable<ModelSection['plate']>['outline'];
    expect(lying.size[2]).toBeCloseTo(1.6, 4);
    expect(standing.size[2]).toBeCloseTo(outline.u.max - outline.u.min, 3);
    expect(standing.bounds.min[2]).toBeCloseTo(0, 6);
  });

  it('the settings record the plate and match the geometry', async () => {
    const shape = cone(2, 1);
    const connector = fitted(shape, plateCut(40, 2.2, 12), roundConnector('plug', 1, 'circle'));
    const artifacts = await buildModelArtifacts(kernel, specOf(shape, 40, plate(2.2, 12), connector));
    const { model } = artifacts;
    const plan = (model.section as ModelSection).connector as RoundConnectorPlan;
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json).toEqual(JSON.parse(JSON.stringify(modelSettingsDocument(model, 'model'))));
    expect(json.sourceModel.section).toEqual({
      type: 'parallel-to-bases',
      positionPercent: 40,
      plate: { thicknessMm: 2.2, marginMm: 12 },
    });
    const slab = boundsOf(partOf(model, 'plate'));
    expect(json.sourceModel.sectionPlate.outlineLengthMm).toBeCloseTo(slab.max[1] - slab.min[1], 4);
    expect(json.sourceModel.sectionPlate.outlineWidthMm).toBeCloseTo(slab.max[0] - slab.min[0], 4);
    expect(json.sourceModel.sectionPlate.cornerRadiusMm).toBe(PLATE_CORNER_RADIUS_MM);
    expect(json.sourceModel.connector.dimensions.plugHeightMm).toBe(plugHeight(plan));
    expect(json.sourceModel.connector.dimensions.engagementMm).toBe(plan.insertion);
    expect(json.sourceModel.connector.dimensions.plugHeightMm).toBeCloseTo(plan.insertion + 2.2, 12);
    // Without a plate nothing of it is recorded.
    const plain = await buildModelArtifacts(kernel, { ...specOf(shape, 40, undefined) });
    const plainJson = JSON.parse(readThreeMfPart(plain.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(plainJson.sourceModel).not.toHaveProperty('sectionPlate');
    expect(plainJson.sourceModel.section).toEqual({ type: 'parallel-to-bases', positionPercent: 40 });
  });
});
