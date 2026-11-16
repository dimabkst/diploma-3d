import type {
  DovetailConnector,
  DowelConnector,
  ModelSpecInput,
  PlugConnector,
  RoundConnector,
  Section,
} from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Manifold, Mat4 } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import type { DovetailPlan } from './connectors/dovetail.ts';
import {
  type BallPlateSection,
  type PlateCut,
  plateSection,
  plateThicknessRange,
  satisfies,
  sectionOffsetMm,
  solidCut,
} from './connectors/frame.ts';
import {
  dowelLength,
  plugHeight,
  type RoundConnectorPlan,
  roundConnectorChecks,
  roundConnectorDimensions,
} from './connectors/round.ts';
import { defaultRoundConnector, normalizeRoundConnector } from './connectors/round-capacity.ts';
import { InvalidModelSpecError } from './errors.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { findMeshDefects, measureMesh, type TriangleMesh, type Vec3, vertexAt, vertexCount } from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type SectionPart, type Solid } from './model.ts';
import type { SectionPlateGeometry } from './plate.ts';
import { type Track, withScope } from './scope.ts';
import { ballCentreMm, ballInradiusMm, ballRadiusMm } from './shapes/ball.ts';

const kernel = await loadGeometryKernel();
const BALL = { kind: 'ball' } as const;
const plate = (thicknessMm: number, marginMm = 8) => ({ thicknessMm, marginMm });

/** Float32 positions of a model some 100 mm across: a few micrometres. */
const POSITION_TOLERANCE_MM = 1e-4;
/** Touching faces of meshes read back from float32 overlap by their rounding, see plate-cuts.test.ts. */
const FLOAT32_CONTACT_MM3 = 0.02;

type Connector = NonNullable<Section['connector']>;

const specOf = (offsetPercent: number, withPlate?: ReturnType<typeof plate>, connector?: Connector, longestDimensionMm = 80) =>
  ({
    shape: BALL,
    scale: { longestDimensionMm },
    section: {
      type: 'horizontal',
      offsetPercent,
      ...(withPlate === undefined ? {} : { plate: withPlate }),
      ...(connector === undefined ? {} : { connector }),
    },
  }) as ModelSpecInput;

const cutOf = (offsetPercent: number, withPlate: ReturnType<typeof plate>): PlateCut => ({ offsetPercent, plate: withPlate });

const partOf = (model: GeneratedModel, part: SectionPart): Solid => {
  const found = model.solids.filter((solid) => solid.part === part);
  if (found.length !== 1) throw new Error(`Expected one ${part}`);
  return found[0] as Solid;
};
const vertices = (mesh: TriangleMesh): Vec3[] => Array.from({ length: vertexCount(mesh) }, (_, index) => vertexAt(mesh, index));
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const volumeOf = (track: Track, manifold: Manifold) => track(manifold).volume();

/** How far the vertices at this height reach from the vertical through the centre: the contact circle's radius. */
function circleAt(mesh: TriangleMesh, height: number, centre: Vec3): number {
  const reach = vertices(mesh)
    .filter((vertex) => Math.abs(vertex[2] - height) <= POSITION_TOLERANCE_MM)
    .map((vertex) => Math.hypot(vertex[0] - centre[0], vertex[1] - centre[1]));
  if (reach.length === 0) throw new Error('No face at that height');
  return Math.max(...reach);
}

describe('a ball without a plate', () => {
  it('is cut into the two parts it always was', () => {
    const model = generateModel(kernel, specOf(30));
    expect(model.name).toBe('ball-horizontal-section');
    expect(model.solids.map((solid) => solid.part)).toEqual(['lower', 'upper']);
    expect(model.section?.plate).toBeUndefined();
  });
});

describe('a section plate on a ball', () => {
  const cases = [
    [0, 2, 80],
    [0, 4, 120],
    [30, 1.6, 80],
    [-30, 3, 60],
    [70, 2, 80],
    [-75, 1.2, 120],
    [3, 4, 80],
  ] as const;

  it.each(cases)(
    'at %s percent of r, T = %s mm, M = %s mm: the slab between the parts, nothing moved',
    (offsetPercent, thickness, longest) => {
      const scale = { longestDimensionMm: longest };
      const model = generateModel(kernel, specOf(offsetPercent, plate(thickness, 8), undefined, longest));
      const radius = ballRadiusMm(scale);
      const centre = ballCentreMm(scale);
      const deviation = radius - ballInradiusMm(scale);
      const d = sectionOffsetMm(offsetPercent, radius);
      const half = thickness / 2;
      const middle = centre[2] + d;
      const section = model.section as ModelSection;
      const geometry = section.plate as SectionPlateGeometry;
      expect(model.name).toBe('ball-horizontal-section-plate');
      expect(model.solids.map((solid) => [solid.part, solid.name])).toEqual([
        ['lower', 'ball-lower-part'],
        ['upper', 'ball-upper-part'],
        ['plate', 'ball-section-plate'],
      ]);
      for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
      // The cut in the middle, each part's face T/2 from it, the ball where it was.
      expect(section.plane.offset).toBeCloseTo(middle, 9);
      const [lower, upper, slab] = (['lower', 'upper', 'plate'] as const).map((part) => partOf(model, part).measurements.bounds);
      expect(lower?.max[2]).toBeCloseTo(middle - half, 4);
      expect(upper?.min[2]).toBeCloseTo(middle + half, 4);
      expect(slab?.min[2]).toBeCloseTo(middle - half, 4);
      expect(slab?.max[2]).toBeCloseTo(middle + half, 4);
      expect(lower?.min[2]).toBeCloseTo(centre[2] - radius, 4);
      expect(upper?.max[2]).toBeCloseTo(centre[2] + radius, 4);
      // The contact circles: √(R² − (d ∓ T/2)²) of the ideal sphere, within the polyhedron's deviation.
      const ideal = (height: number) => Math.sqrt(radius ** 2 - height ** 2);
      const lowerCircle = circleAt(partOf(model, 'lower').mesh, middle - half, centre);
      const upperCircle = circleAt(partOf(model, 'upper').mesh, middle + half, centre);
      expect(lowerCircle).toBeLessThanOrEqual(ideal(d - half) + POSITION_TOLERANCE_MM);
      expect(lowerCircle).toBeGreaterThanOrEqual(ideal(d - half) - 2 * deviation - POSITION_TOLERANCE_MM);
      expect(upperCircle).toBeLessThanOrEqual(ideal(d + half) + POSITION_TOLERANCE_MM);
      expect(upperCircle).toBeGreaterThanOrEqual(ideal(d + half) - 2 * deviation - POSITION_TOLERANCE_MM);
      if (d !== 0) expect(Math.abs(lowerCircle - upperCircle)).toBeGreaterThan(0.01);
      // The plate covers the ball's widest point within the slab, √(R² − q²) with q = max(|d| − T/2, 0): R itself when the
      // slab holds the centre, although both contact circles are smaller then.
      const widest = ideal(Math.max(Math.abs(d) - half, 0));
      const { origin } = geometry.frame;
      for (const [axis, extent, at] of [
        [0, geometry.extent.v, origin[0]],
        [1, geometry.extent.u, origin[1]],
      ] as const) {
        expect(at + extent.max - centre[axis]).toBeGreaterThanOrEqual(widest + 8 - 2 * deviation - POSITION_TOLERANCE_MM);
        expect(centre[axis] - (at + extent.min)).toBeGreaterThanOrEqual(widest + 8 - 2 * deviation - POSITION_TOLERANCE_MM);
        expect(at + extent.max - centre[axis]).toBeLessThanOrEqual(widest + 8 + POSITION_TOLERANCE_MM);
      }
      if (Math.abs(d) < half) {
        expect(lowerCircle).toBeLessThan(radius - 0.01);
        expect(upperCircle).toBeLessThan(radius - 0.01);
      }
      // A horizontal plate never reaches the ball's lowest point, its standing level.
      expect(geometry.standingLevel).toBeCloseTo(centre[2] - radius, 9);
      expect(geometry.clippedAtBase).toBe(false);
      withScope((track) => {
        const pieces = model.solids.map((solid) => manifoldOf(track, solid.mesh));
        for (const piece of pieces) {
          expect(piece.decompose().map(track)).toHaveLength(1);
          expect(piece.genus()).toBe(0);
        }
        const [a, b, c] = pieces as [Manifold, Manifold, Manifold];
        expect(volumeOf(track, a.intersect(b))).toBeLessThan(FLOAT32_CONTACT_MM3);
        expect(volumeOf(track, a.intersect(c))).toBeLessThan(FLOAT32_CONTACT_MM3);
        expect(volumeOf(track, b.intersect(c))).toBeLessThan(FLOAT32_CONTACT_MM3);
        // The parts and the ball's slab between the faces fill the ball, and the plate holds all of that slab.
        const whole = manifoldOf(track, (generateModel(kernel, { shape: BALL, scale }).solids[0] as Solid).mesh);
        const between = track(track(whole.trimByPlane([0, 0, 1], middle - half)).trimByPlane([0, 0, -1], -(middle + half)));
        const parts = partOf(model, 'lower').measurements.volume + partOf(model, 'upper').measurements.volume;
        expect((parts + between.volume()) / whole.volume()).toBeCloseTo(1, 5);
        expect(volumeOf(track, between.subtract(c))).toBeLessThan(FLOAT32_CONTACT_MM3);
      });
    },
  );

  it('a plate needs both parts to keep their wall beyond its faces, and is refused otherwise', () => {
    // R = 5 mm at 10 mm: at 70 % of r the upper cap reaches 1,5 mm, less than T/2 + 1,2 mm for any T.
    const small = { longestDimensionMm: 10 };
    const range = plateThicknessRange(BALL, small, { offsetPercent: 70 });
    expect(range.max).toBeLessThan(range.min);
    expect(() => generateModel(kernel, specOf(70, plate(1.2), undefined, 10))).toThrow(InvalidModelSpecError);
    // At 80 mm, 75 % of r leaves the cap 10 mm high: the schema's 4 mm fits, and the ideal sphere's |d| + T/2 < R holds.
    const room = plateThicknessRange(BALL, { longestDimensionMm: 80 }, { offsetPercent: 75 });
    expect(room.max).toBe(4);
    expect(sectionOffsetMm(75, 40) + 2).toBeLessThan(40);
    // At 20 mm (R = 10 mm) and 75 %: the cap reaches 2,5 mm, room for 2 × 1,3 = 2,6 mm.
    const tight = plateThicknessRange(BALL, { longestDimensionMm: 20 }, { offsetPercent: 75 });
    expect(tight.max).toBeCloseTo(2.6, 9);
    expect(() => generateModel(kernel, specOf(75, plate(2.6), undefined, 20))).not.toThrow();
    expect(() => generateModel(kernel, specOf(75, plate(2.8), undefined, 20))).toThrow(InvalidModelSpecError);
    const thin = generateModel(kernel, specOf(75, plate(2.6), undefined, 20));
    expect(partOf(thin, 'upper').measurements.size[2]).toBeCloseTo(1.2, 4);
  });
});

const roundConnector = (type: 'plug' | 'dowel', count: 1 | 2, profile: RoundConnector['profile']): RoundConnector =>
  (type === 'plug'
    ? {
        type,
        count,
        profile,
        diameterFactor: 1,
        depthFactor: 1,
        ...(count === 2 ? { spacingPercent: 40 } : {}),
        holeClearanceMm: 0.4,
      }
    : {
        type,
        count,
        profile,
        diameterFactor: 1,
        depthFactor: 1,
        ...(count === 2 ? { spacingPercent: 40 } : {}),
        lowerClearanceMm: 0.3,
        upperClearanceMm: 0.5,
      }) as PlugConnector | DowelConnector;

function fitted(offsetPercent: number, withPlate: ReturnType<typeof plate>, connector: RoundConnector): RoundConnector {
  const outcome = defaultRoundConnector(BALL, { longestDimensionMm: 80 }, cutOf(offsetPercent, withPlate), connector);
  if (outcome.status !== 'available') throw new Error(`No ${connector.type} fits: ${JSON.stringify(outcome.issues)}`);
  return outcome.connector as RoundConnector;
}

/** The quarter or half turn about the vertical through `centre`. */
function turnAboutZ(centre: Vec3, angle: number): Mat4 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return [
    c,
    s,
    0,
    0,
    -s,
    c,
    0,
    0,
    0,
    0,
    1,
    0,
    centre[0] - c * centre[0] + s * centre[1],
    centre[1] - s * centre[0] - c * centre[1],
    0,
    1,
  ] as Mat4;
}

describe('plugs and dowels through a ball’s plate', () => {
  const cases = [0, 50, -60].flatMap((offset) =>
    (
      [
        ['plug', 1, 'flatted-circle'],
        ['plug', 2, 'triangle'],
        ['dowel', 1, 'hexagon'],
        ['dowel', 2, 'flatted-circle'],
      ] as const
    ).map(([type, count, profile]) => [offset, type, count, profile] as const),
  );

  it.each(cases)('at %s percent of r: %s × %s, %s', (offsetPercent, type, count, profile) => {
    const withPlate = plate(2.4, 8);
    const connector = fitted(offsetPercent, withPlate, roundConnector(type, count, profile));
    const model = generateModel(kernel, specOf(offsetPercent, withPlate, connector));
    const section = model.section as ModelSection;
    const plan = section.connector as RoundConnectorPlan;
    const middle = section.plane.offset;
    expect(plan.plateThickness).toBe(2.4);
    if (type === 'plug') {
      expect(plugHeight(plan)).toBeCloseTo(plan.insertion + 2.4, 12);
      expect(partOf(model, 'lower').measurements.bounds.max[2]).toBeCloseTo(middle - 1.2 + plugHeight(plan), 4);
    } else {
      for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
        expect(dowel.measurements.size[2]).toBeCloseTo(dowelLength(plan), 4);
      }
      expect(dowelLength(plan)).toBeCloseTo(2 * plan.insertion + 2.4, 12);
    }
    withScope((track) => {
      const [lower, upper, slab] = (['lower', 'upper', 'plate'] as const).map((part) =>
        manifoldOf(track, partOf(model, part).mesh),
      ) as [Manifold, Manifold, Manifold];
      // Blind holes in both parts, through-holes in the plate, all within the ball.
      expect(lower.genus()).toBe(0);
      expect(upper.genus()).toBe(0);
      expect(slab.genus()).toBe(count);
      const whole = manifoldOf(
        track,
        (generateModel(kernel, { shape: BALL, scale: { longestDimensionMm: 80 } }).solids[0] as Solid).mesh,
      );
      const grown = track(whole.scale(1 + 1e-6));
      expect(volumeOf(track, lower.subtract(grown))).toBeLessThan(FLOAT32_CONTACT_MM3);
      for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
        const pin = manifoldOf(track, dowel.mesh);
        expect(volumeOf(track, pin.subtract(grown))).toBeLessThan(FLOAT32_CONTACT_MM3);
        for (const piece of [lower, upper, slab]) expect(volumeOf(track, pin.intersect(piece))).toBeLessThan(FLOAT32_CONTACT_MM3);
      }
      if (type === 'plug' && profile === 'flatted-circle') {
        const site = plan.sites[0]?.centre as Vec3;
        expect(volumeOf(track, slab.intersect(lower))).toBeLessThan(FLOAT32_CONTACT_MM3);
        for (const angle of [Math.PI / 2, Math.PI]) {
          expect(volumeOf(track, slab.intersect(track(lower.transform(turnAboutZ(site, angle)))))).toBeGreaterThan(0.01);
        }
      }
    });
  });

  it('follows the plate: a hole too deep for the thinner cap beside a thick plate is corrected once, and kept', () => {
    const scale = { longestDimensionMm: 80 };
    const base = fitted(60, plate(1.2), roundConnector('dowel', 1, 'circle'));
    const deep = { ...base, depthFactor: base.depthFactor * 2.5 } as RoundConnector;
    const corrected = normalizeRoundConnector(BALL, scale, cutOf(60, plate(4)), deep);
    if (corrected.status !== 'available') throw new Error('expected a connector');
    expect(corrected.adjusted).toBe(true);
    const section = solidCut(BALL, scale, cutOf(60, plate(4)));
    const dimensions = roundConnectorDimensions(corrected.connector as RoundConnector, 80, section.span / 2);
    expect(roundConnectorChecks(section, dimensions).every(satisfies)).toBe(true);
    expect(normalizeRoundConnector(BALL, scale, cutOf(60, plate(4)), corrected.connector as RoundConnector)).toMatchObject({
      status: 'available',
      adjusted: false,
    });
    // The upper hole is measured from the upper face, T/2 above the cut, where the cap is thinner.
    const bottom = (thickness: number) => {
      const plated = solidCut(BALL, scale, cutOf(60, plate(thickness)));
      const sized = roundConnectorDimensions(base, 80, plated.span / 2);
      return roundConnectorChecks(plated, sized).find(
        (issue) => issue.code === 'hole-bottom-thin' && 'part' in issue && issue.part === 'upper',
      )?.valueMm as number;
    };
    expect(bottom(4)).toBeLessThan(bottom(1.2));
  });
});

describe('a dovetail on both faces of a ball’s plate', () => {
  const cases = [0, 40, -50].flatMap((offset) =>
    (['standard', 'opposite'] as const).map((entrance) => [offset, entrance] as const),
  );

  it.each(cases)('at %s percent of r, %s entrance: each part slides off on its own', (offsetPercent, entrance) => {
    const connector: DovetailConnector = { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 35, clearanceMm: 0.2, entrance };
    const model = generateModel(kernel, specOf(offsetPercent, plate(2), connector));
    const plain = generateModel(kernel, specOf(offsetPercent, plate(2)));
    const section = model.section as ModelSection;
    const plan = section.connector as DovetailPlan;
    const middle = section.plane.offset;
    const interfaces = plan.interfaces ?? [];
    expect(interfaces.map((face) => face.part)).toEqual(['lower', 'upper']);
    for (const face of interfaces) {
      face.frame.u.forEach((value, axis) => {
        expect(value).toBeCloseTo(axis === 1 ? (entrance === 'standard' ? 1 : -1) : 0, 12);
      });
    }
    expect(interfaces[0]?.frame.n).toEqual([0, 0, -1]);
    const slab = partOf(model, 'plate').measurements.bounds;
    expect(slab.min[2]).toBeCloseTo(middle - 1 - plan.height, 4);
    expect(slab.max[2]).toBeCloseTo(middle + 1 + plan.height, 4);
    expect(partOf(model, 'lower').measurements.volume).toBeLessThan(partOf(plain, 'lower').measurements.volume);
    expect(partOf(model, 'upper').measurements.volume).toBeLessThan(partOf(plain, 'upper').measurements.volume);
    withScope((track) => {
      const [lower, upper, plateSolid] = (['lower', 'upper', 'plate'] as const).map((part) =>
        manifoldOf(track, partOf(model, part).mesh),
      ) as [Manifold, Manifold, Manifold];
      expect(plateSolid.decompose().map(track)).toHaveLength(1);
      const moved = (solid: Manifold, direction: Vec3, distance: number) =>
        track(solid.translate([direction[0] * distance, direction[1] * distance, direction[2] * distance]));
      for (const face of interfaces) {
        const part = face.part === 'lower' ? lower : upper;
        const other = face.part === 'lower' ? upper : lower;
        const { u, n } = face.frame;
        for (let step = 0; step <= 20; step += 1) {
          const shifted = moved(part, u, (step / 20) * face.exitDistance);
          expect(volumeOf(track, shifted.intersect(plateSolid))).toBeLessThan(FLOAT32_CONTACT_MM3);
          expect(volumeOf(track, shifted.intersect(other))).toBeLessThan(FLOAT32_CONTACT_MM3);
        }
        const off = moved(part, u, face.exitDistance);
        expect(volumeOf(track, moved(off, n, plan.normalPlay + 0.05).intersect(plateSolid))).toBeLessThan(FLOAT32_CONTACT_MM3);
        expect(volumeOf(track, moved(part, n, plan.normalPlay + 0.05).intersect(plateSolid))).toBeGreaterThan(
          FLOAT32_CONTACT_MM3,
        );
        expect(volumeOf(track, moved(part, u, -(plan.clearance + 0.05)).intersect(plateSolid))).toBeGreaterThan(
          FLOAT32_CONTACT_MM3,
        );
      }
    });
  });

  it('its walls are both parts’, named by part, without a wall under the tongues', () => {
    const section = plateSection(BALL, { longestDimensionMm: 80 }, cutOf(70, plate(4))) as BallPlateSection;
    expect(section.interfaces.upper.offset).toBeCloseTo(sectionOffsetMm(70, 40) + 2, 9);
    expect(section.interfaces.lower.offset).toBeCloseTo(-(sectionOffsetMm(70, 40) - 2), 9);
    expect(section.interfaces.lower.plane.normal).toEqual([0, 0, -1]);
  });
});

describe('a ball’s plate in the files', () => {
  it('previews, prints and records the assembly as generated', async () => {
    const connector = fitted(-30, plate(2), roundConnector('dowel', 2, 'square'));
    const artifacts = await buildModelArtifacts(kernel, specOf(-30, plate(2), connector));
    const { model } = artifacts;
    const plan = (model.section as ModelSection).connector as RoundConnectorPlan;
    const root = (await new WebIO().readBinary(artifacts.separatedPreviewGlb as Uint8Array)).getRoot();
    const lift = Object.fromEntries(root.listNodes().map((node) => [node.getName(), (node.getTranslation()[1] ?? 0) * 1000]));
    const slab = partOf(model, 'plate').measurements.bounds;
    expect(lift[partOf(model, 'plate').name]).toBe(0);
    expect(partOf(model, 'lower').measurements.bounds.max[2] + (lift[partOf(model, 'lower').name] ?? 0)).toBeLessThan(
      slab.min[2],
    );
    expect(partOf(model, 'upper').measurements.bounds.min[2] + (lift[partOf(model, 'upper').name] ?? 0)).toBeGreaterThan(
      slab.max[2],
    );
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(file.model.objects.map((object) => object.name)).toEqual(model.solids.map((solid) => solid.name));
    file.model.objects.forEach((object, index) => {
      expect(measureMesh(object.mesh).volume).toBeCloseTo((model.solids[index] as Solid).measurements.volume, 1);
    });
    const printed = file.model.objects.find((object) => object.name === 'ball-section-plate') as { mesh: TriangleMesh };
    expect(measureMesh(printed.mesh).size[2]).toBeCloseTo(2, 4);
    const pins = readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model.objects;
    expect(pins).toHaveLength(2);
    for (const pin of pins) expect(measureMesh(pin.mesh).size[2]).toBeCloseTo(dowelLength(plan), 4);
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.shape).toEqual({ kind: 'ball' });
    expect(json.sourceModel.section).toEqual({ type: 'horizontal', offsetPercent: -30, plate: { thicknessMm: 2, marginMm: 8 } });
    expect(json.sourceModel.sectionPlate.outlineLengthMm).toBeCloseTo(slab.max[1] - slab.min[1], 3);
    expect(json.sourceModel.sectionPlate.outlineWidthMm).toBeCloseTo(slab.max[0] - slab.min[0], 3);
    expect(json.sourceModel.connector.dimensions.dowelLengthMm).toBe(dowelLength(plan));
    const pinsJson = JSON.parse(readThreeMfPart(artifacts.pinsFile?.bytes as Uint8Array, MODEL_SETTINGS_PATH) as string);
    expect(pinsJson.exportedParts.pins.map((pin: { lengthMm: number }) => pin.lengthMm)).toEqual([
      dowelLength(plan),
      dowelLength(plan),
    ]);
    // A plate with tongues stands on its edge.
    const withTongues = await buildModelArtifacts(
      kernel,
      specOf(0, plate(2), { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 35, clearanceMm: 0.2 }),
    );
    const standing = readThreeMf(withTongues.printFile.bytes).model.objects.find(
      (object) => object.name === 'ball-section-plate',
    ) as {
      mesh: TriangleMesh;
    };
    const extent = ((withTongues.model.section as ModelSection).plate as SectionPlateGeometry).extent;
    expect(measureMesh(standing.mesh).size[2]).toBeCloseTo(extent.u.max - extent.u.min, 3);
  });
});
