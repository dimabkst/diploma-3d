import type { ConeShape, DovetailConnector, ModelSpecInput, RoundConnector, Section } from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import { type DovetailPlan, interfacePlan, tonguePoints } from './connectors/dovetail.ts';
import {
  coneApexAngleBounds,
  conePlateSection,
  cutOfSection,
  framePoint,
  type PlaneCut,
  type PlateCut,
} from './connectors/frame.ts';
import { defaultRoundConnector } from './connectors/round-capacity.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import {
  dot,
  findMeshDefects,
  measureMesh,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
  vertexCount,
} from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type SectionPart, type Solid } from './model.ts';
import { buildSectionPlate, plateOutline, type SectionPlateGeometry, sectionPlateGeometry } from './plate.ts';
import { type Track, withScope } from './scope.ts';

const kernel = await loadGeometryKernel();
const SCALE = { longestDimensionMm: 80 };
const cone = (heightRatio = 2, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
const plate = (thicknessMm: number, marginMm: number) => ({ thicknessMm, marginMm });

/** Float32 positions of a model some 100 mm across: a few micrometres. */
const POSITION_TOLERANCE_MM = 1e-4;
/** Touching faces of meshes read back from float32 on tilted planes overlap by their rounding, see plate-cuts.test.ts. */
const FLOAT32_CONTACT_MM3 = 0.02;

type PlaneSection = Exclude<Section, { type: 'horizontal' }>;
type Connector = NonNullable<Section['connector']>;

function apex(shape: ConeShape, directionDeg: number): PlaneSection {
  const bounds = coneApexAngleBounds(shape, SCALE, directionDeg);
  if (bounds === null) throw new Error('No plane through the apex');
  return { type: 'oblique-apex', inclinationDeg: (bounds.min + bounds.max) / 2, directionDeg };
}

const specOf = (shape: ConeShape, section: PlaneSection, withPlate?: ReturnType<typeof plate>, connector?: Connector) =>
  ({
    shape,
    scale: SCALE,
    section: {
      ...section,
      ...(withPlate === undefined ? {} : { plate: withPlate }),
      ...(connector === undefined ? {} : { connector }),
    },
  }) as ModelSpecInput;

const plateCutOf = (section: PlaneSection, withPlate: ReturnType<typeof plate>): PlateCut => {
  const plane = cutOfSection(section as Section) as PlaneCut;
  return (typeof plane === 'number' ? { positionPercent: plane, plate: withPlate } : { ...plane, plate: withPlate }) as PlateCut;
};

const geometryOf = (shape: ConeShape, section: PlaneSection, withPlate: ReturnType<typeof plate>) =>
  sectionPlateGeometry(conePlateSection(shape, SCALE, plateCutOf(section, withPlate)));

const partOf = (model: GeneratedModel, part: SectionPart): Solid => {
  const found = model.solids.filter((solid) => solid.part === part);
  if (found.length !== 1) throw new Error(`Expected one ${part}`);
  return found[0] as Solid;
};

const vertices = (mesh: TriangleMesh): Vec3[] => Array.from({ length: vertexCount(mesh) }, (_, index) => vertexAt(mesh, index));
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const volumeOf = (track: Track, manifold: Manifold) => track(manifold).volume();

/** The lowest point of the outline in the middle plane alone, without the plate's thickness. */
const middleLowest = (geometry: SectionPlateGeometry) =>
  Math.min(...plateOutline(geometry).map(([across, along]) => framePoint(geometry.frame, [along, across, 0])[2]));

/** The area of the triangles lying in z = 0 and facing down: the plate's flat face on the standing plane. */
function bottomFace(mesh: TriangleMesh): { area: number; facingDown: boolean } {
  let area = 0;
  let facingDown = true;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    const corners = triangleAt(mesh, triangle).map((index) => vertexAt(mesh, index));
    if (!corners.every((corner) => Math.abs(corner[2]) <= POSITION_TOLERANCE_MM)) continue;
    const vector = triangleAreaVector(mesh, triangle);
    area += Math.hypot(...vector);
    facingDown &&= vector[2] < 0;
  }
  return { area, facingDown };
}

const cutCases = (shape: ConeShape): readonly (readonly [string, PlaneSection])[] => [
  ['an axial vertical cut', { type: 'vertical', offsetPercent: 0 }],
  ['an offset vertical cut', { type: 'vertical', offsetPercent: 40 }],
  ['a low oblique cut', { type: 'oblique', positionPercent: 20, inclinationDeg: 20, directionDeg: 0 }],
  ['an oblique cut at 45°', { type: 'oblique', positionPercent: 40, inclinationDeg: 45, directionDeg: 120 }],
  ['a cut through the apex along the lean', apex(shape, 0)],
  ['a cut through the apex across it', apex(shape, 90)],
];

describe('the section plate stands on or above the figure’s base', () => {
  it('a plate clipped by its thickness alone: its middle outline stays above the base, its lower face would not', () => {
    // Found for a right cone at 80 mm: the outline in the middle plane reaches 0,25 mm above the base, its lower face
    // T/2·cos 20° lower.
    const section: PlaneSection = { type: 'oblique', positionPercent: 20, inclinationDeg: 20, directionDeg: 0 };
    const geometry = geometryOf(cone(), section, plate(4, 3));
    expect(middleLowest(geometry)).toBeGreaterThan(0);
    expect(geometry.clippedAtBase).toBe(true);
    const model = generateModel(kernel, specOf(cone(), section, plate(4, 3)));
    const slab = partOf(model, 'plate');
    expect(slab.measurements.bounds.min[2]).toBeGreaterThanOrEqual(-POSITION_TOLERANCE_MM);
    expect(bottomFace(slab.mesh).area).toBeGreaterThan(0);
    expect(bottomFace(slab.mesh).facingDown).toBe(true);
  });

  const shapes = [
    ['a right cone', cone()],
    ['a leaning cone', cone(2, 1.5)],
  ] as const;
  const cases = shapes.flatMap(([shapeName, shape]) =>
    cutCases(shape).flatMap(([cutName, section]) =>
      [plate(1.6, 10), plate(4, 3), plate(2.4, 25)].map(
        (withPlate) =>
          [
            `${cutName} of ${shapeName}, T ${withPlate.thicknessMm}, margin ${withPlate.marginMm}`,
            shape,
            section,
            withPlate,
          ] as const,
      ),
    ),
  );

  it.each(cases)('%s', (_, shape, section, withPlate) => {
    const model = generateModel(kernel, specOf(shape, section, withPlate));
    const geometry = (model.section as ModelSection).plate as SectionPlateGeometry;
    const slab = partOf(model, 'plate');
    expect(geometry.standingLevel).toBe(0);
    expect(findMeshDefects(slab.mesh)).toEqual([]);
    expect(slab.measurements.bounds.min[2]).toBeGreaterThanOrEqual(-POSITION_TOLERANCE_MM);
    for (const vertex of vertices(slab.mesh)) expect(vertex[2]).toBeGreaterThanOrEqual(-POSITION_TOLERANCE_MM);
    // A plate that reaches the base does so with a flat face on it, never with a point or an edge.
    if (geometry.clippedAtBase) {
      const face = bottomFace(slab.mesh);
      expect(face.area).toBeGreaterThan(withPlate.thicknessMm);
      expect(face.facingDown).toBe(true);
    }
    // The actual extent, as recorded, is the mesh's.
    const along = (axis: Vec3) => {
      const values = vertices(slab.mesh).map((vertex) => dot(vertex, axis) - dot(geometry.frame.origin, axis));
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    const [u, v] = [along(geometry.frame.u), along(geometry.frame.v)];
    expect(u.min).toBeCloseTo(geometry.extent.u.min, 3);
    expect(u.max).toBeCloseTo(geometry.extent.u.max, 3);
    expect(v.min).toBeCloseTo(geometry.extent.v.min, 3);
    expect(v.max).toBeCloseTo(geometry.extent.v.max, 3);
    // The cut, the scale and the parts are those of the plate before it was clipped: the margin changes none of them.
    const other = generateModel(kernel, specOf(shape, section, { ...withPlate, marginMm: withPlate.marginMm === 3 ? 30 : 3 }));
    expect((other.section as ModelSection).plane).toEqual((model.section as ModelSection).plane);
    for (const part of ['part-1', 'part-2'] as const) {
      expect(partOf(other, part).mesh.positions).toEqual(partOf(model, part).mesh.positions);
    }
    withScope((track) => {
      const plateSolid = manifoldOf(track, slab.mesh);
      expect(plateSolid.decompose().map(track)).toHaveLength(1);
      expect(plateSolid.genus()).toBe(0);
      // Only what lay below the base is gone, and the two corners that cut makes, rounded: the plate lies within the unclipped
      // plate cut at the base, and lacks no more than those corners, at most r²·(1 − π/4) of the outline each across the
      // thickness, more where the base meets the side at a sharper angle.
      const candidate = buildSectionPlate(kernel, track, { ...geometry, clippedAtBase: false });
      const above = track(candidate.trimByPlane([0, 0, 1], 0));
      expect(volumeOf(track, plateSolid.subtract(above))).toBeLessThan(FLOAT32_CONTACT_MM3);
      if (geometry.clippedAtBase) {
        const radius = geometry.baseCornerRadius as number;
        expect(radius).toBeGreaterThan(0);
        const corners = 2 * radius ** 2 * (1 - Math.PI / 4) * withPlate.thicknessMm;
        const removed = volumeOf(track, above.subtract(plateSolid));
        expect(removed).toBeGreaterThan(corners / 4);
        expect(removed).toBeLessThan(8 * corners);
      } else {
        expect(volumeOf(track, above.subtract(plateSolid))).toBeLessThan(FLOAT32_CONTACT_MM3);
      }
      // The plate still holds all of the cone between its faces.
      const whole = manifoldOf(track, (generateModel(kernel, { shape, scale: SCALE }).solids[0] as Solid).mesh);
      const { normal, offset } = (model.section as ModelSection).plane;
      const half = withPlate.thicknessMm / 2;
      const between = track(
        track(whole.trimByPlane([...normal] as KernelVec3, offset - half)).trimByPlane(
          [-normal[0], -normal[1], -normal[2]],
          -(offset + half),
        ),
      );
      expect(volumeOf(track, between.subtract(plateSolid))).toBeLessThan(FLOAT32_CONTACT_MM3);
    });
  });

  it('a plate on a cut parallel to the base needs no clipping and is the plate it was', () => {
    const section: PlaneSection = { type: 'parallel-to-bases', positionPercent: 15 };
    const geometry = geometryOf(cone(), section, plate(4, 30));
    expect(geometry.clippedAtBase).toBe(false);
    expect(geometry.extent).toBe(geometry.outline);
    const model = generateModel(kernel, specOf(cone(), section, plate(4, 30)));
    const slab = partOf(model, 'plate');
    expect(slab.measurements.bounds.min[2]).toBeCloseTo(12 - 2, 4);
    const unclipped = withScope((track) => {
      const built = buildSectionPlate(kernel, track, geometry);
      return built.numVert();
    });
    expect(vertexCount(slab.mesh)).toBe(unclipped);
  });
});

describe('connectors on a clipped plate', () => {
  const roundOf = (type: 'plug' | 'dowel', shape: ConeShape, section: PlaneSection, withPlate: ReturnType<typeof plate>) => {
    const connector =
      type === 'plug'
        ? { type, count: 1, profile: 'flatted-circle', diameterFactor: 1, depthFactor: 1, holeClearanceMm: 0.4 }
        : {
            type,
            count: 2,
            profile: 'square',
            diameterFactor: 1,
            depthFactor: 1,
            spacingPercent: 40,
            lowerClearanceMm: 0.3,
            upperClearanceMm: 0.5,
          };
    const outcome = defaultRoundConnector(shape, SCALE, plateCutOf(section, withPlate), connector as RoundConnector);
    if (outcome.status !== 'available') throw new Error('expected a connector');
    return outcome.connector as RoundConnector;
  };
  const dovetail = (entrance: 'standard' | 'opposite'): DovetailConnector => ({
    type: 'dovetail',
    sizeFactor: 0.8,
    lengthPercent: 35,
    clearanceMm: 0.2,
    entrance,
  });
  const sections: readonly (readonly [string, PlaneSection])[] = [
    ['an axial vertical cut', { type: 'vertical', offsetPercent: 0 }],
    ['a low oblique cut', { type: 'oblique', positionPercent: 20, inclinationDeg: 20, directionDeg: 0 }],
    ['a cut through the apex', apex(cone(), 0)],
  ];
  const cases = sections.flatMap(([name, section]) =>
    (['none', 'plug', 'dowel', 'standard', 'opposite'] as const).map((kind) => [name, kind, section] as const),
  );

  it.each(cases)('%s with %s', (_, kind, section) => {
    const shape = cone();
    const withPlate = plate(2, 10);
    const connector: Connector | undefined =
      kind === 'none'
        ? undefined
        : kind === 'plug' || kind === 'dowel'
          ? roundOf(kind, shape, section, withPlate)
          : dovetail(kind);
    const model = generateModel(kernel, specOf(shape, section, withPlate, connector));
    const section0 = model.section as ModelSection;
    expect(section0.plate?.clippedAtBase).toBe(true);
    const slab = partOf(model, 'plate');
    expect(slab.measurements.bounds.min[2]).toBeGreaterThanOrEqual(-POSITION_TOLERANCE_MM);
    expect(bottomFace(slab.mesh).area).toBeGreaterThan(0);
    withScope((track) => {
      const plateSolid = manifoldOf(track, slab.mesh);
      expect(plateSolid.decompose().map(track)).toHaveLength(1);
      const holes = connector?.type === 'plug' ? 1 : connector?.type === 'dowel' ? 2 : 0;
      expect(plateSolid.genus()).toBe(holes);
      const [first, second] = (['part-1', 'part-2'] as const).map((part) => manifoldOf(track, partOf(model, part).mesh)) as [
        Manifold,
        Manifold,
      ];
      expect(volumeOf(track, plateSolid.intersect(first))).toBeLessThan(FLOAT32_CONTACT_MM3);
      expect(volumeOf(track, plateSolid.intersect(second))).toBeLessThan(FLOAT32_CONTACT_MM3);
      if (connector?.type === 'dowel') {
        for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
          const pin = manifoldOf(track, dowel.mesh);
          for (const piece of [plateSolid, first, second]) {
            expect(volumeOf(track, pin.intersect(piece))).toBeLessThan(FLOAT32_CONTACT_MM3);
          }
        }
      }
      if (connector?.type === 'dovetail') {
        const plan = section0.connector as DovetailPlan;
        // Both tongues whole on the plate, which the clip never reaches; then each part slides off its own way.
        for (const face of plan.interfaces ?? []) {
          const tongue = track(
            kernel.Manifold.hull(tonguePoints(interfacePlan(plan, face)).map((point) => [...point] as KernelVec3)),
          );
          expect(volumeOf(track, tongue.subtract(plateSolid))).toBeLessThan(FLOAT32_CONTACT_MM3);
          const part = face.part === 'lower' ? first : second;
          const { u } = face.frame;
          for (let step = 0; step <= 20; step += 1) {
            const distance = (step / 20) * face.exitDistance;
            const shifted = track(part.translate([u[0] * distance, u[1] * distance, u[2] * distance]));
            expect(volumeOf(track, shifted.intersect(plateSolid))).toBeLessThan(FLOAT32_CONTACT_MM3);
          }
        }
        // The chosen entrance is the one built: at the bottom for the opposite one on a vertical cut.
        if (section.type === 'vertical') expect(Math.sign(plan.frame.u[2])).toBe(kind === 'opposite' ? 1 : -1);
      }
    });
  });
});

describe('the clipped plate everywhere', () => {
  it('the preview, the exploded preview, the print file and the settings all hold the same clipped plate', async () => {
    const section: PlaneSection = { type: 'vertical', offsetPercent: 0 };
    const artifacts = await buildModelArtifacts(kernel, specOf(cone(), section, plate(2, 10)));
    const { model } = artifacts;
    const slab = partOf(model, 'plate');
    const geometry = (model.section as ModelSection).plate as SectionPlateGeometry;
    for (const glb of [artifacts.previewGlb, artifacts.separatedPreviewGlb as Uint8Array]) {
      const root = (await new WebIO().readBinary(glb)).getRoot();
      const node = root.listNodes().find((candidate) => candidate.getName() === slab.name);
      expect(node?.getTranslation()).toEqual([0, 0, 0]);
      const positions = node?.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION');
      // glTF is Y-up in metres: the model's z is y.
      if (positions == null) throw new Error('No plate positions in the preview');
      expect((positions.getMin([0, 0, 0]) as number[])[1]).toBeGreaterThanOrEqual(-POSITION_TOLERANCE_MM / 1000);
    }
    const printed = readThreeMf(artifacts.printFile.bytes).model.objects.find((object) => object.name === slab.name) as {
      mesh: TriangleMesh;
    };
    expect(measureMesh(printed.mesh).volume).toBeCloseTo(slab.measurements.volume, 1);
    // Lying on a face, it shows the outline as clipped: as long as the extent along u.
    const sizes = [...measureMesh(printed.mesh).size].sort((a, b) => a - b);
    expect(sizes[2]).toBeCloseTo(
      Math.max(geometry.extent.u.max - geometry.extent.u.min, geometry.extent.v.max - geometry.extent.v.min),
      3,
    );
    expect(geometry.extent.u.max - geometry.extent.u.min).toBeLessThan(geometry.outline.u.max - geometry.outline.u.min);
    expect(model.bounds.min[2]).toBeCloseTo(0, 6);
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.section.plate).toEqual({ thicknessMm: 2, marginMm: 10 });
    expect(json.sourceModel.sectionPlate.outlineLengthMm).toBeCloseTo(slab.measurements.size[2], 3);
  });
});
