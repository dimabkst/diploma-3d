import type {
  ConeShape,
  ConnectorProfile,
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
import { type DovetailPlan, dovetailEntranceDirection } from './connectors/dovetail.ts';
import {
  coneApexAngleBounds,
  conePlateSection,
  conePlateThicknessRange,
  cutOfSection,
  type PlaneCut,
  type PlateCut,
  satisfies,
  solidCut,
} from './connectors/frame.ts';
import { dowelLength, type RoundConnectorPlan, roundConnectorChecks, roundConnectorDimensions } from './connectors/round.ts';
import { defaultRoundConnector, normalizeRoundConnector } from './connectors/round-capacity.ts';
import { InvalidModelSpecError } from './errors.ts';
import { toGltfPosition } from './export/glb.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { dot, findMeshDefects, measureMesh, type TriangleMesh, type Vec3, vertexAt, vertexCount } from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type SectionPart, type Solid } from './model.ts';
import { PLATE_CORNER_RADIUS_MM } from './plate.ts';
import { type Track, withScope } from './scope.ts';
import { MAX_CIRCLE_DEVIATION_MM, roundDimensionsMm } from './shapes/round.ts';

const kernel = await loadGeometryKernel();
const SCALE = { longestDimensionMm: 80 };

const cone = (heightRatio = 2, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
const plate = (thicknessMm = 2, marginMm = 8) => ({ thicknessMm, marginMm });

type PlaneSection = Exclude<Section, { type: 'parallel-to-bases' | 'horizontal' }>;
type Connector = NonNullable<Section['connector']>;

/** A plane through the apex at the middle of the angles this cone allows in that direction. */
function apex(shape: ConeShape, directionDeg: number): PlaneSection {
  const bounds = coneApexAngleBounds(shape, SCALE, directionDeg);
  if (bounds === null) throw new Error('No plane through the apex');
  return { type: 'oblique-apex', inclinationDeg: (bounds.min + bounds.max) / 2, directionDeg };
}

const cutsOf = (shape: ConeShape): readonly (readonly [string, PlaneSection])[] => [
  ['an axial vertical cut', { type: 'vertical', offsetPercent: 0 }],
  ['an offset vertical cut', { type: 'vertical', offsetPercent: 40 }],
  ['an oblique cut at 30° along +X', { type: 'oblique', positionPercent: 40, inclinationDeg: 30, directionDeg: 0 }],
  ['an oblique cut at 60° towards 135°', { type: 'oblique', positionPercent: 50, inclinationDeg: 60, directionDeg: 135 }],
  ['a cut through the apex along the lean', apex(shape, 0)],
  ['a cut through the apex across the lean', apex(shape, 90)],
];

const shapes: readonly (readonly [string, ConeShape])[] = [
  ['a right cone', cone()],
  ['a leaning cone', cone(2, 1.5)],
];

const cases = shapes.flatMap(([shapeName, shape]) =>
  cutsOf(shape).map(([cutName, section]) => [`${cutName} of ${shapeName}`, shape, section] as const),
);

function specOf(
  shape: ConeShape,
  section: PlaneSection,
  withPlate: ReturnType<typeof plate> | undefined,
  connector?: Connector,
): ModelSpecInput {
  return {
    shape,
    scale: SCALE,
    section: {
      ...section,
      ...(withPlate === undefined ? {} : { plate: withPlate }),
      ...(connector === undefined ? {} : { connector }),
    } as Section,
  };
}

const plateCutOf = (section: PlaneSection, withPlate = plate()): PlateCut =>
  ({ ...(cutOfSection(section) as Exclude<PlaneCut, number>), plate: withPlate }) as PlateCut;

const partOf = (model: GeneratedModel, part: SectionPart): Solid => {
  const found = model.solids.filter((solid) => solid.part === part);
  if (found.length !== 1) throw new Error(`Expected one ${part}, found ${found.length}`);
  return found[0] as Solid;
};

const vertices = (mesh: TriangleMesh): Vec3[] => Array.from({ length: vertexCount(mesh) }, (_, index) => vertexAt(mesh, index));

/** The extent of a mesh along the plane's normal, measured from the plane: s(x) = n·x − n·P. */
function signedExtent(mesh: TriangleMesh, { normal, offset }: ModelSection['plane']) {
  const values = vertices(mesh).map((vertex) => dot(normal, vertex) - offset);
  return { min: Math.min(...values), max: Math.max(...values) };
}

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const volumeOf = (track: Track, manifold: Manifold) => track(manifold).volume();

/** Float32 positions of a model some 100 mm across: a few micrometres. */
const POSITION_TOLERANCE_MM = 1e-4;

/**
 * Touching faces of meshes read back from float32 positions, on a tilted plane, overlap by their rounding: a few micrometres
 * over some thousand square millimetres. The engine checks the exact solids against `connectorVolumeTolerance`.
 */
const FLOAT32_CONTACT_MM3 = 0.02;

/** How far a point lies inside the rounded rectangle, in the frame's (v, u) plane. */
function insideOutline(
  [x, y]: readonly [number, number],
  outline: NonNullable<ModelSection['plate']>['outline'],
  radius: number,
): number {
  const [cx, cy] = [(outline.v.min + outline.v.max) / 2, (outline.u.min + outline.u.max) / 2];
  const [hx, hy] = [(outline.v.max - outline.v.min) / 2 - radius, (outline.u.max - outline.u.min) / 2 - radius];
  const [dx, dy] = [Math.abs(x - cx) - hx, Math.abs(y - cy) - hy];
  return radius - (Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0));
}

/** The turn by `angle` about the line through `centre` along the unit `axis`, column-major (Rodrigues). */
function turnAbout(axis: Vec3, centre: Vec3, angle: number): Mat4 {
  const [x, y, z] = axis;
  const [c, s, k] = [Math.cos(angle), Math.sin(angle), 1 - Math.cos(angle)];
  const r = [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ] as const;
  const t = [0, 1, 2].map((row) => (centre[row] as number) - dot(r[row] as unknown as Vec3, centre));
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, t[0], t[1], t[2], 1] as Mat4;
}

describe('a plain plate on every other cut of the cone', () => {
  it.each(cases)('%s: the slab along n between part 1 and part 2, nothing moved or rescaled', (_, shape, section) => {
    const withPlate = plate(2, 8);
    const model = generateModel(kernel, specOf(shape, section, withPlate));
    const plain = generateModel(kernel, specOf(shape, section, undefined));
    const sectionOf = model.section as ModelSection;
    const { plane } = sectionOf;
    const plateGeometry = sectionOf.plate as NonNullable<ModelSection['plate']>;
    expect(model.solids.map((solid) => [solid.part, solid.name])).toEqual([
      ['part-1', 'cone-part-1'],
      ['part-2', 'cone-part-2'],
      ['plate', 'cone-section-plate'],
    ]);
    // The plane is the one chosen, with or without a plate, and the plate lies in its frame.
    expect(plane).toEqual((plain.section as ModelSection).plane);
    expect(plateGeometry.frame.n).toEqual(plane.normal);
    for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
    // Each part ends T/2 from the plane, measured along n; the plate fills exactly that, whatever way the plane faces.
    const first = signedExtent(partOf(model, 'part-1').mesh, plane);
    const second = signedExtent(partOf(model, 'part-2').mesh, plane);
    const slab = signedExtent(partOf(model, 'plate').mesh, plane);
    expect(first.max).toBeCloseTo(-1, 4);
    expect(second.min).toBeCloseTo(1, 4);
    expect(slab.min).toBeCloseTo(-1, 4);
    expect(slab.max).toBeCloseTo(1, 4);
    // Nothing else moved: the parts reach exactly as far as the uncut parts do.
    const plainFirst = signedExtent(partOf(plain, 'part-1').mesh, plane);
    const plainSecond = signedExtent(partOf(plain, 'part-2').mesh, plane);
    expect(first.min).toBeCloseTo(plainFirst.min, 4);
    expect(second.max).toBeCloseTo(plainSecond.max, 4);
    // The plate covers, by its margin, all the material of the slab: both faces' contours and any corner between them.
    const { origin, u, v } = plateGeometry.frame;
    const local = (point: Vec3): [number, number] => {
      const relative: Vec3 = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
      return [dot(relative, v), dot(relative, u)];
    };
    const whole = generateModel(kernel, { shape, scale: SCALE }).solids[0] as Solid;
    const inSlab = [
      ...vertices(partOf(model, 'part-1').mesh),
      ...vertices(partOf(model, 'part-2').mesh),
      ...vertices(whole.mesh),
    ].filter((vertex) => Math.abs(dot(plane.normal, vertex) - plane.offset) <= 1 + POSITION_TOLERANCE_MM);
    expect(inSlab.length).toBeGreaterThan(0);
    for (const point of inSlab) {
      expect(insideOutline(local(point), plateGeometry.outline, PLATE_CORNER_RADIUS_MM)).toBeGreaterThanOrEqual(
        8 - MAX_CIRCLE_DEVIATION_MM - POSITION_TOLERANCE_MM,
      );
    }
    withScope((track) => {
      const pieces = model.solids.map((solid) => manifoldOf(track, solid.mesh));
      for (const piece of pieces) {
        expect(piece.decompose().map(track)).toHaveLength(1);
        expect(piece.genus()).toBe(0);
      }
      const tolerance = FLOAT32_CONTACT_MM3;
      const [a, b, c] = pieces as [Manifold, Manifold, Manifold];
      expect(volumeOf(track, a.intersect(b))).toBeLessThan(tolerance);
      expect(volumeOf(track, a.intersect(c))).toBeLessThan(tolerance);
      expect(volumeOf(track, b.intersect(c))).toBeLessThan(tolerance);
      // The parts and the slab of the solid between the plate's faces fill the solid.
      const solid = manifoldOf(track, whole.mesh);
      const n = plane.normal;
      const between = track(
        track(solid.trimByPlane([...n], plane.offset - 1)).trimByPlane([-n[0], -n[1], -n[2]], -(plane.offset + 1)),
      );
      const parts = partOf(model, 'part-1').measurements.volume + partOf(model, 'part-2').measurements.volume;
      expect((parts + between.volume()) / whole.measurements.volume).toBeCloseTo(1, 5);
    });
  });

  it('a plane through the apex keeps the apex on it, and the plate takes the tip from both parts', () => {
    for (const [, shape] of shapes) {
      const section = apex(shape, 0);
      const model = generateModel(kernel, specOf(shape, section, plate(2, 8)));
      const { plane, plate: geometry } = model.section as ModelSection;
      const { height, offset } = roundDimensionsMm(shape, SCALE);
      const tip: Vec3 = [offset, 0, height];
      expect(Math.abs(dot(plane.normal, tip) - plane.offset)).toBeLessThan(1e-9);
      // The connectors' centre is the middle section's centroid, not the anchor at the tip.
      const { frame } = geometry as NonNullable<ModelSection['plate']>;
      expect(Math.hypot(frame.origin[0] - tip[0], frame.origin[1] - tip[1], frame.origin[2] - tip[2])).toBeGreaterThan(
        height / 4,
      );
      for (const part of ['part-1', 'part-2'] as const) {
        const nearest = Math.min(
          ...vertices(partOf(model, part).mesh).map((vertex) =>
            Math.hypot(vertex[0] - tip[0], vertex[1] - tip[1], vertex[2] - tip[2]),
          ),
        );
        expect(nearest).toBeGreaterThan(1 - POSITION_TOLERANCE_MM);
      }
      // The faces at ±T/2 are not the middle triangle moved: they meet the base at chords of their own and stop short of the
      // tip, one larger and one smaller than the triangle.
      const geometryOf = conePlateSection(shape, SCALE, plateCutOf(section, plate(2, 8)));
      const faces = [geometryOf.interfaces.lower, geometryOf.interfaces.upper];
      for (const face of faces) {
        expect(face.contour.length).toBeGreaterThan(3);
        expect(Math.abs(dot(face.plane.normal, tip) - face.plane.offset)).toBeCloseTo(1, 9);
      }
      expect(Math.min(...faces.map((face) => face.area))).toBeLessThan(geometryOf.area);
      expect(Math.max(...faces.map((face) => face.area))).toBeGreaterThan(geometryOf.area);
    }
  });

  it('measures the thickness along n, so a steep oblique plate is no thicker for its slope', () => {
    const section: PlaneSection = { type: 'oblique', positionPercent: 50, inclinationDeg: 60, directionDeg: 0 };
    const model = generateModel(kernel, specOf(cone(), section, plate(3, 5)));
    const slab = partOf(model, 'plate');
    const { plane } = model.section as ModelSection;
    const extent = signedExtent(slab.mesh, plane);
    expect(extent.max - extent.min).toBeCloseTo(3, 4);
    // Its vertical extent is that of a tilted rectangle, far more than the thickness.
    expect(slab.measurements.size[2]).toBeGreaterThan(20);
  });

  it('the thickness is limited by how far each part reaches along n, and refused beyond it', () => {
    // r = 10 mm and H = 20 mm; a vertical plane 70 % of r from the axis leaves part 2 about 3 mm deep.
    const small = { longestDimensionMm: 20 };
    const shape = cone(2);
    const section: PlaneSection = { type: 'vertical', offsetPercent: 70 };
    const range = conePlateThicknessRange(shape, small, { offsetPercent: 70 });
    const reach = solidCut(shape, small, { offsetPercent: 70 }) as { reach: { negative: number; positive: number } };
    expect(range.max).toBeCloseTo(2 * (Math.min(reach.reach.negative, reach.reach.positive) - 1.2), 9);
    expect(range.max).toBeLessThan(4);
    const spec = (thicknessMm: number): ModelSpecInput => ({ ...specOf(shape, section, plate(thicknessMm, 5)), scale: small });
    expect(() => generateModel(kernel, spec(range.max))).not.toThrow();
    expect(() => generateModel(kernel, spec(range.max + 0.05))).toThrow(InvalidModelSpecError);
    const thin = generateModel(kernel, spec(range.max));
    const extent = signedExtent(partOf(thin, 'part-2').mesh, (thin.section as ModelSection).plane);
    expect(extent.max - extent.min).toBeCloseTo(1.2, 4);
  });

  it('a twist connector and a plate are refused on every cut', () => {
    expect(() =>
      generateModel(
        kernel,
        specOf(cone(), { type: 'vertical', offsetPercent: 0 }, plate(), {
          type: 'twist',
          sizeMm: 12,
          holeClearanceMm: 0.5,
          axialClearanceMm: 0.2,
        }),
      ),
    ).toThrow(InvalidModelSpecError);
  });

  it('without a plate, the other cuts are the two parts they always were', () => {
    for (const [, section] of cutsOf(cone())) {
      const model = generateModel(kernel, specOf(cone(), section, undefined));
      expect(model.solids.map((solid) => solid.part)).toEqual(['part-1', 'part-2']);
      expect(model.name).not.toMatch(/plate/);
      expect(model.section?.plate).toBeUndefined();
    }
  });
});

const roundConnector = (type: 'plug' | 'dowel', count: 1 | 2, profile: ConnectorProfile): RoundConnector =>
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

function fitted(shape: ConeShape, section: PlaneSection, connector: RoundConnector): RoundConnector {
  const outcome = defaultRoundConnector(shape, SCALE, plateCutOf(section), connector);
  if (outcome.status !== 'available') throw new Error(`No ${connector.type} fits: ${JSON.stringify(outcome.issues)}`);
  return outcome.connector as RoundConnector;
}

describe('plugs and dowels through a plate on the other cuts', () => {
  const connectorCases = cases.flatMap(([name, shape, section]) =>
    (
      [
        ['plug', 1, 'flatted-circle'],
        ['dowel', 2, 'square'],
      ] as const
    ).map(([type, count, profile]) => [`${count} ${profile} ${type}`, name, shape, section, type, count, profile] as const),
  );

  it.each(connectorCases)('%s on %s', (_, __, shape, section, type, count, profile) => {
    const connector = fitted(shape, section, roundConnector(type, count, profile));
    const model = generateModel(kernel, specOf(shape, section, plate(), connector));
    const { plane } = model.section as ModelSection;
    const plan = (model.section as ModelSection).connector as RoundConnectorPlan;
    expect(plan.plateThickness).toBe(2);
    expect(plan.frame.n).toEqual(plane.normal);
    if (type === 'plug') {
      // T + e from part 1's face at −T/2.
      expect(signedExtent(partOf(model, 'part-1').mesh, plane).max).toBeCloseTo(1 + plan.insertion, 4);
    } else {
      for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
        const extent = signedExtent(dowel.mesh, plane);
        expect(extent.max - extent.min).toBeCloseTo(dowelLength(plan), 4);
        expect(dowelLength(plan)).toBeCloseTo(2 * plan.insertion + 2, 12);
      }
    }
    withScope((track) => {
      const [first, second, slab] = (['part-1', 'part-2', 'plate'] as const).map((part) =>
        manifoldOf(track, partOf(model, part).mesh),
      ) as [Manifold, Manifold, Manifold];
      // Blind holes in the parts, through-holes in the plate.
      expect(first.genus()).toBe(0);
      expect(second.genus()).toBe(0);
      expect(slab.genus()).toBe(count);
      const tolerance = FLOAT32_CONTACT_MM3;
      const whole = manifoldOf(track, (generateModel(kernel, { shape, scale: SCALE }).solids[0] as Solid).mesh);
      const grown = track(whole.scale(1 + 1e-6));
      expect(volumeOf(track, first.subtract(grown))).toBeLessThan(tolerance);
      for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
        expect(volumeOf(track, manifoldOf(track, dowel.mesh).subtract(grown))).toBeLessThan(tolerance);
      }
      if (profile === 'flatted-circle') {
        // Turned about its own axis, along n, the plug meets the plate's hole: the flat side keeps one orientation.
        const site = plan.sites[0]?.centre as Vec3;
        expect(volumeOf(track, slab.intersect(first))).toBeLessThan(tolerance);
        for (const angle of [Math.PI / 2, Math.PI]) {
          const turned = track(first.transform(turnAbout(plane.normal, site, angle)));
          expect(volumeOf(track, slab.intersect(turned))).toBeGreaterThan(0.01);
        }
      }
    });
  });

  it('a connector through a plate on a plane through the apex stands in the material, and follows a thicker plate', () => {
    const shape = cone();
    const section = apex(shape, 0);
    const base = fitted(shape, section, roundConnector('dowel', 1, 'circle'));
    const thick = normalizeRoundConnector(shape, SCALE, plateCutOf(section, plate(4, 8)), {
      ...base,
      depthFactor: base.depthFactor * 3,
    } as RoundConnector);
    if (thick.status !== 'available') throw new Error('expected a connector');
    expect(thick.adjusted).toBe(true);
    const sectionWithPlate = solidCut(shape, SCALE, plateCutOf(section, plate(4, 8)));
    const dimensions = roundConnectorDimensions(thick.connector as RoundConnector, 80, sectionWithPlate.span / 2);
    expect(roundConnectorChecks(sectionWithPlate, dimensions).every(satisfies)).toBe(true);
    expect(
      normalizeRoundConnector(shape, SCALE, plateCutOf(section, plate(4, 8)), thick.connector as RoundConnector),
    ).toMatchObject({ status: 'available', adjusted: false });
  });
});

describe('a dovetail on both faces of a plate on the other cuts', () => {
  const dovetail = (entrance: 'standard' | 'opposite'): DovetailConnector => ({
    type: 'dovetail',
    sizeFactor: 0.8,
    lengthPercent: 35,
    clearanceMm: 0.2,
    entrance,
  });
  const dovetailCases = cutsOf(cone()).flatMap(([name, section]) =>
    (['standard', 'opposite'] as const).map((entrance) => [name, section, entrance] as const),
  );

  it.each(dovetailCases)('%s, %s entrance: a tongue on each face, both grooves open at that end', (_, section, entrance) => {
    const shape = cone();
    const model = generateModel(kernel, specOf(shape, section, plate(), dovetail(entrance)));
    const plain = generateModel(kernel, specOf(shape, section, plate()));
    const { plane } = model.section as ModelSection;
    const plan = (model.section as ModelSection).connector as DovetailPlan;
    const interfaces = plan.interfaces ?? [];
    expect(interfaces.map((face) => face.part)).toEqual(['lower', 'upper']);
    // The entrance d lies at the chosen end of the slide axis, the one that rises for the standard one; u = −d in both
    // interfaces, whichever way their n points.
    const section0 = solidCut(shape, SCALE, cutOfSection({ ...section } as Section));
    const d = dovetailEntranceDirection(section0, entrance);
    for (const face of interfaces) {
      face.frame.u.forEach((value, axis) => {
        expect(value).toBeCloseTo(-(d[axis] as number), 12);
      });
      expect(dot(face.frame.n, plane.normal)).toBeCloseTo(face.part === 'upper' ? 1 : -1, 12);
    }
    if (section.type === 'vertical') expect(Math.sign(d[2])).toBe(entrance === 'standard' ? 1 : -1);
    // The tongues stand on the plate's faces, h beyond them along n; the grooves are cut into both parts.
    const slab = signedExtent(partOf(model, 'plate').mesh, plane);
    expect(slab.min).toBeCloseTo(-1 - plan.height, 4);
    expect(slab.max).toBeCloseTo(1 + plan.height, 4);
    expect(partOf(model, 'part-1').measurements.volume).toBeLessThan(partOf(plain, 'part-1').measurements.volume);
    expect(partOf(model, 'part-2').measurements.volume).toBeLessThan(partOf(plain, 'part-2').measurements.volume);
    withScope((track) => {
      const [first, second, slabSolid] = (['part-1', 'part-2', 'plate'] as const).map((part) =>
        manifoldOf(track, partOf(model, part).mesh),
      ) as [Manifold, Manifold, Manifold];
      expect(slabSolid.decompose().map(track)).toHaveLength(1);
      const tolerance = FLOAT32_CONTACT_MM3;
      const moved = (solid: Manifold, direction: Vec3, distance: number) =>
        track(solid.translate([direction[0] * distance, direction[1] * distance, direction[2] * distance]));
      for (const face of interfaces) {
        const part = face.part === 'lower' ? first : second;
        const other = face.part === 'lower' ? second : first;
        const { u, n } = face.frame;
        // Holding the plate still, the part withdraws along −d = +u, the whole way without touching anything.
        for (let step = 0; step <= 20; step += 1) {
          const shifted = moved(part, u, (step / 20) * face.exitDistance);
          expect(volumeOf(track, shifted.intersect(slabSolid))).toBeLessThan(tolerance);
          expect(volumeOf(track, shifted.intersect(other))).toBeLessThan(tolerance);
        }
        const off = moved(part, u, face.exitDistance);
        expect(volumeOf(track, moved(off, n, plan.normalPlay + 0.05).intersect(slabSolid))).toBeLessThan(tolerance);
        expect(volumeOf(track, moved(part, n, plan.normalPlay + 0.05).intersect(slabSolid))).toBeGreaterThan(tolerance);
        expect(volumeOf(track, moved(part, u, -(plan.clearance + 0.05)).intersect(slabSolid))).toBeGreaterThan(tolerance);
      }
    });
  });
});

describe('preview, files and settings of a plate on the other cuts', () => {
  it('moves the parts apart along n around the plate, and prints a flat plate flat and one with tongues on its edge', async () => {
    const shape = cone(2, 1.5);
    const section: PlaneSection = { type: 'oblique', positionPercent: 40, inclinationDeg: 30, directionDeg: 0 };
    const connector = fitted(shape, section, roundConnector('dowel', 1, 'circle'));
    const artifacts = await buildModelArtifacts(kernel, specOf(shape, section, plate(), connector));
    const { model } = artifacts;
    const { plane } = model.section as ModelSection;
    const root = (await new WebIO().readBinary(artifacts.separatedPreviewGlb as Uint8Array)).getRoot();
    const offsets = Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()]));
    expect(offsets[partOf(model, 'plate').name]).toEqual([0, 0, 0]);
    // Back from glTF's metres along its axes to the model's millimetres along n.
    const alongN = (name: string) => {
      const [x, y, z] = offsets[name] as [number, number, number];
      return dot([x * 1000, -z * 1000, y * 1000], plane.normal);
    };
    const first = signedExtent(partOf(model, 'part-1').mesh, plane);
    const second = signedExtent(partOf(model, 'part-2').mesh, plane);
    const slab = signedExtent(partOf(model, 'plate').mesh, plane);
    expect(first.max + alongN(partOf(model, 'part-1').name)).toBeLessThan(slab.min);
    expect(second.min + alongN(partOf(model, 'part-2').name)).toBeGreaterThan(slab.max);
    const dowel = model.solids.find((solid) => solid.part === 'dowel') as Solid;
    expect(signedExtent(dowel.mesh, plane).max + alongN(dowel.name)).toBeLessThan(slab.min);
    // Only the parts move: the offset is along n alone.
    const part2 = offsets[partOf(model, 'part-2').name] as [number, number, number];
    const expected = toGltfPosition([plane.normal[0], plane.normal[1], plane.normal[2]]).map(
      (value) => value * alongN(partOf(model, 'part-2').name),
    );
    part2.forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 9);
    });
    // The print file: every object with its own volume, the plate lying on a face, T high.
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(file.model.objects.map((object) => object.name)).toEqual(model.solids.map((solid) => solid.name));
    file.model.objects.forEach((object, index) => {
      expect(measureMesh(object.mesh).volume).toBeCloseTo((model.solids[index] as Solid).measurements.volume, 1);
    });
    const printed = file.model.objects.find((object) => object.name === 'cone-section-plate') as { mesh: TriangleMesh };
    expect(measureMesh(printed.mesh).size[2]).toBeCloseTo(2, 4);
    // The dowels alone: the assembly's own, T included in their length.
    const plan = (model.section as ModelSection).connector as RoundConnectorPlan;
    const pins = readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model.objects;
    expect(measureMesh((pins[0] as { mesh: TriangleMesh }).mesh).size[2]).toBeCloseTo(dowelLength(plan), 4);
    expect(artifacts.pinsFile?.fileName).toMatch(new RegExp(`-L${Number(dowelLength(plan).toFixed(3))}mm\\.3mf$`));

    const withTongues = await buildModelArtifacts(
      kernel,
      specOf(cone(), { type: 'vertical', offsetPercent: 0 }, plate(), {
        type: 'dovetail',
        sizeFactor: 0.8,
        lengthPercent: 35,
        clearanceMm: 0.2,
      }),
    );
    const standing = readThreeMf(withTongues.printFile.bytes).model.objects.find(
      (object) => object.name === 'cone-section-plate',
    ) as { mesh: TriangleMesh };
    const outline = (withTongues.model.section as ModelSection).plate?.outline as NonNullable<ModelSection['plate']>['outline'];
    expect(measureMesh(standing.mesh).size[2]).toBeCloseTo(outline.u.max - outline.u.min, 3);
  });

  it('the settings record the cut with its plate, and the plate’s outline as built', async () => {
    const section: PlaneSection = { type: 'vertical', offsetPercent: 20 };
    const connector = fitted(cone(), section, roundConnector('plug', 1, 'circle'));
    const artifacts = await buildModelArtifacts(kernel, specOf(cone(), section, plate(2.4, 6), connector));
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.section).toEqual({ type: 'vertical', offsetPercent: 20, plate: { thicknessMm: 2.4, marginMm: 6 } });
    const geometry = (artifacts.model.section as ModelSection).plate as NonNullable<ModelSection['plate']>;
    const along = (axis: Vec3) => {
      const values = vertices(partOf(artifacts.model, 'plate').mesh).map((vertex) => dot(vertex, axis));
      return Math.max(...values) - Math.min(...values);
    };
    expect(json.sourceModel.sectionPlate.outlineLengthMm).toBeCloseTo(along(geometry.frame.u), 3);
    expect(json.sourceModel.sectionPlate.outlineWidthMm).toBeCloseTo(along(geometry.frame.v), 3);
    const plan = (artifacts.model.section as ModelSection).connector as RoundConnectorPlan;
    expect(json.sourceModel.connector.dimensions.plugHeightMm).toBeCloseTo(plan.insertion + 2.4, 12);
    expect(json.sourceModel.connector.dimensions.engagementMm).toBe(plan.insertion);
  });
});
