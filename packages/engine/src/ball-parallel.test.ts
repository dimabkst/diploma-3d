import { DEFAULT_MAGNET, type ModelSpecInput, type Section } from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import { cutOfSection } from './connectors/frame.ts';
import type { MagnetPlan } from './connectors/magnet.ts';
import { defaultRoundConnector } from './connectors/round-capacity.ts';
import { ConnectorUnsuitableError, InvalidModelSpecError } from './errors.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { findMeshDefects, measureMesh, type TriangleMesh, type Vec3, vertexAt, vertexCount } from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type SectionPart, type Solid } from './model.ts';
import { type Track, withScope } from './scope.ts';
import { splitByParallelPlanes } from './section.ts';
import { ballCentreMm, ballInradiusMm, ballRadiusMm, buildBall } from './shapes/ball.ts';

const kernel = await loadGeometryKernel();
const BALL = { kind: 'ball' } as const;
type Connector = NonNullable<Section['connector']>;

const specOf = (first: number, second?: number, connector?: Connector, longestDimensionMm = 80): ModelSpecInput => ({
  shape: BALL,
  scale: { longestDimensionMm },
  section: {
    type: 'horizontal',
    offsetPercent: first,
    ...(second === undefined ? {} : { secondOffsetPercent: second }),
    ...(connector === undefined ? {} : { connector }),
  } as Section,
});

const partOf = (model: GeneratedModel, part: SectionPart): Solid => {
  const found = model.solids.filter((solid) => solid.part === part);
  if (found.length !== 1) throw new Error(`Expected one ${part}, found ${found.length}`);
  return found[0] as Solid;
};
const vertices = (mesh: TriangleMesh): Vec3[] => Array.from({ length: vertexCount(mesh) }, (_, index) => vertexAt(mesh, index));
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));

/** Float32 positions of a model some 100 mm across: a few micrometres. */
const POSITION_TOLERANCE_MM = 1e-4;
/** Touching faces of meshes read back from float32 overlap by their rounding, see plate-cuts.test.ts. */
const FLOAT32_CONTACT_MM3 = 0.02;

/** How far the vertices of a part at this height reach from the vertical through the centre: the section's radius there. */
function sectionRadius(mesh: TriangleMesh, height: number, centre: Vec3): number {
  const reach = vertices(mesh)
    .filter((vertex) => Math.abs(vertex[2] - height) <= POSITION_TOLERANCE_MM)
    .map((vertex) => Math.hypot(vertex[0] - centre[0], vertex[1] - centre[1]));
  return Math.max(...reach);
}

describe('two parallel planes through a ball', () => {
  const cases = [
    ['on opposite sides of the centre', -30, 40, 80],
    ['on the same side, above the centre', 20, 60, 80],
    ['on the same side, below the centre, mirrored', -20, -60, 80],
    ['one through the centre', 0, 50, 80],
    ['in their own order, the first above the second', 40, -30, 80],
    ['near the poles, at the limits', -80, 80, 80],
    ['at a smaller size', -30, 40, 40],
    ['at a larger size', -30, 40, 160],
  ] as const;

  it.each(cases)('%s: three closed parts, the ball once over, cut where the planes lie', (_, first, second, longest) => {
    const scale = { longestDimensionMm: longest };
    const model = generateModel(kernel, specOf(first, second, undefined, longest));
    const whole = generateModel(kernel, { shape: BALL, scale }).solids[0] as Solid;
    expect(model.name).toBe('ball-parallel-horizontal-sections');
    expect(model.solids.map((solid) => [solid.part, solid.name])).toEqual([
      ['lower', 'ball-lower-part'],
      ['middle', 'ball-middle-part'],
      ['upper', 'ball-upper-part'],
    ]);
    // The specification keeps the planes' identity; only the construction sorts them.
    expect(model.spec.section).toMatchObject({ offsetPercent: first, secondOffsetPercent: second });
    const radius = ballRadiusMm(scale);
    const centre = ballCentreMm(scale);
    const [low, high] = [Math.min(first, second), Math.max(first, second)].map(
      (percent) => centre[2] + (percent / 100) * radius,
    ) as [number, number];
    const section = model.section as ModelSection;
    expect(section.plane.offset).toBeCloseTo(low, 9);
    expect(section.secondInterface?.plane.offset).toBeCloseTo(high, 9);
    expect(section.secondInterface?.plane.normal).toEqual(section.plane.normal);
    for (const solid of model.solids) {
      expect(findMeshDefects(solid.mesh)).toEqual([]);
      expect(solid.measurements.volume).toBeGreaterThan(0);
    }
    const [lower, middle, upper] = (['lower', 'middle', 'upper'] as const).map((part) => partOf(model, part).measurements.bounds);
    expect(lower?.max[2]).toBeCloseTo(low, 4);
    expect(middle?.min[2]).toBeCloseTo(low, 4);
    expect(middle?.max[2]).toBeCloseTo(high, 4);
    expect(upper?.min[2]).toBeCloseTo(high, 4);
    // The sections are the sphere's circles √(R² − d²), within the polyhedron's deviation, on both parts that share them.
    const deviation = radius - ballInradiusMm(scale);
    for (const [height, parts] of [
      [low, ['lower', 'middle']],
      [high, ['middle', 'upper']],
    ] as const) {
      const ideal = Math.sqrt(radius ** 2 - (height - centre[2]) ** 2);
      for (const part of parts) {
        const circle = sectionRadius(partOf(model, part).mesh, height, centre);
        expect(circle).toBeLessThanOrEqual(ideal + POSITION_TOLERANCE_MM);
        expect(circle).toBeGreaterThanOrEqual(ideal - 2 * deviation - POSITION_TOLERANCE_MM);
      }
    }
    withScope((track) => {
      const pieces = model.solids.map((solid) => manifoldOf(track, solid.mesh));
      for (const piece of pieces) {
        expect(piece.decompose().map(track)).toHaveLength(1);
        expect(piece.genus()).toBe(0);
      }
      pieces.forEach((one, index) => {
        for (const other of pieces.slice(index + 1))
          expect(track(one.intersect(other)).volume()).toBeLessThan(FLOAT32_CONTACT_MM3);
      });
    });
    const total = model.solids.reduce((sum, solid) => sum + solid.measurements.volume, 0);
    expect(total / whole.measurements.volume).toBeCloseTo(1, 6);
  });

  it('a single plane stays the two parts it always was', () => {
    const model = generateModel(kernel, specOf(30));
    expect(model.name).toBe('ball-horizontal-section');
    expect(model.solids.map((solid) => solid.part)).toEqual(['lower', 'upper']);
    expect(model.section?.secondInterface).toBeUndefined();
  });

  it('splits along any shared normal: an inclined pair of planes also gives three regions of the whole', () => {
    withScope((track) => {
      const scale = { longestDimensionMm: 80 };
      const ball = buildBall(kernel, track, scale);
      const tilt = (35 * Math.PI) / 180;
      const normal: Vec3 = [Math.sin(tilt), 0, Math.cos(tilt)];
      const centre = ballCentreMm(scale);
      const along = normal[0] * centre[0] + normal[1] * centre[1] + normal[2] * centre[2];
      const parts = splitByParallelPlanes(track, ball, normal, [along - 12, along + 20]);
      const volumes = [parts.lower, parts.middle, parts.upper].map((part) => part.volume());
      for (const volume of volumes) expect(volume).toBeGreaterThan(0);
      expect(volumes.reduce((sum, volume) => sum + volume, 0) / ball.volume()).toBeCloseTo(1, 9);
      // Both cut faces of the middle region lie on the two planes.
      const mesh = parts.middle.getMesh();
      const heights = Array.from({ length: mesh.numVert }, (_, index) => {
        const at = index * mesh.numProp;
        const props = mesh.vertProperties;
        return normal[0] * (props[at] as number) + normal[1] * (props[at + 1] as number) + normal[2] * (props[at + 2] as number);
      });
      expect(Math.min(...heights)).toBeCloseTo(along - 12, 4);
      expect(Math.max(...heights)).toBeCloseTo(along + 20, 4);
      expect(() => splitByParallelPlanes(track, ball, normal, [along + 5, along + 5])).toThrow();
      expect(() => splitByParallelPlanes(track, ball, normal, [along - 12, along + 60])).toThrow();
    });
  });

  it('refuses planes too close to each other, beyond the limits, or with a section plate', () => {
    // At 80 mm the middle part must be 8 mm thick: 20 % of r.
    expect(() => generateModel(kernel, specOf(10, 29))).toThrow(InvalidModelSpecError);
    expect(() => generateModel(kernel, specOf(10, 10))).toThrow(InvalidModelSpecError);
    expect(() => generateModel(kernel, specOf(10, 30))).not.toThrow();
    // Nearly tangent: a ball at 20 mm leaves its caps their 2 mm only up to about 80 % of r.
    expect(() => generateModel(kernel, specOf(-20, 81))).toThrow(InvalidModelSpecError);
    expect(() =>
      generateModel(kernel, {
        shape: BALL,
        scale: { longestDimensionMm: 80 },
        section: { type: 'horizontal', offsetPercent: 0, secondOffsetPercent: 40, plate: { thicknessMm: 2, marginMm: 8 } },
      }),
    ).toThrow(InvalidModelSpecError);
  });
});

describe('connectors at both planes', () => {
  const fitted = (connector: Connector, first: number, second: number) => {
    const outcome = defaultRoundConnector(
      BALL,
      { longestDimensionMm: 80 },
      cutOfSection({ type: 'horizontal', offsetPercent: first, secondOffsetPercent: second }),
      connector as Parameters<typeof defaultRoundConnector>[3],
    );
    if (outcome.status !== 'available') throw new Error('expected a connector');
    return outcome.connector as Connector;
  };
  const connectors: readonly (readonly [string, Connector])[] = [
    ['a dovetail', { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 40, clearanceMm: 0.2 }],
    [
      'plugs',
      fitted({ type: 'plug', count: 1, profile: 'circle', diameterFactor: 1, depthFactor: 1, holeClearanceMm: 0.4 }, -30, 40),
    ],
    [
      'a pair of dowels',
      fitted(
        {
          type: 'dowel',
          count: 2,
          profile: 'square',
          diameterFactor: 1,
          depthFactor: 1,
          spacingPercent: 40,
          lowerClearanceMm: 0.3,
          upperClearanceMm: 0.5,
        },
        -30,
        40,
      ),
    ],
    ['magnets', { type: 'magnet', ...DEFAULT_MAGNET }],
  ];

  it.each(connectors)('%s: built and verified at each plane on the final parts', (_, connector) => {
    const model = generateModel(kernel, specOf(-30, 40, connector));
    const plain = generateModel(kernel, specOf(-30, 40));
    const section = model.section as ModelSection;
    expect(section.connector?.type).toBe(connector.type);
    expect(section.secondInterface?.connector?.type).toBe(connector.type);
    for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
    withScope((track) => {
      for (const part of ['lower', 'middle', 'upper'] as const) {
        const solid = manifoldOf(track, partOf(model, part).mesh);
        expect(solid.decompose().map(track)).toHaveLength(1);
      }
    });
    if (connector.type === 'dowel') {
      const dowels = model.solids.filter((solid) => solid.part === 'dowel');
      expect(dowels.map((dowel) => dowel.joint)).toEqual([0, 0, 1, 1]);
    }
    if (connector.type === 'magnet') {
      // The lower and upper parts lose the pockets of their plane, the middle part those of both.
      const lost = (part: SectionPart) => partOf(plain, part).measurements.volume - partOf(model, part).measurements.volume;
      expect(lost('middle') / (lost('lower') + lost('upper'))).toBeCloseTo(1, 3);
      const [lower, upper] = [section.connector as MagnetPlan, section.secondInterface?.connector as MagnetPlan];
      expect(lower.sites).toHaveLength(3);
      expect(upper.sites).toHaveLength(3);
      // Each plane's pairs share their centres on that plane: both pockets of a pair open there.
      for (const [plan, plane] of [
        [lower, section.plane],
        [upper, section.secondInterface?.plane],
      ] as const) {
        for (const site of plan.sites) expect(site.centre[2]).toBeCloseTo(plane?.offset as number, 9);
      }
      // Between the pockets of both planes the middle part keeps the 2 mm beneath each: 8,2 mm apart at least.
      expect(upper.frame.origin[2] - lower.frame.origin[2] - 2 * lower.holeDepth).toBeGreaterThanOrEqual(2);
    }
  });

  it('a middle part too thin for the connectors of both planes is refused, and said why', () => {
    // 20 % of r apart at 80 mm: the middle part is 8 mm, less than two 3,1 mm pockets and 2 mm between them.
    const thick = { type: 'magnet', ...DEFAULT_MAGNET, magnetThicknessMm: 3 } as const;
    expect(() => generateModel(kernel, specOf(10, 30, thick))).toThrow(ConnectorUnsuitableError);
    try {
      generateModel(kernel, specOf(10, 30, thick));
    } catch (error) {
      expect((error as ConnectorUnsuitableError).issues.map((issue) => issue.code)).toEqual(['middle-thin']);
    }
    // The same magnets fit a single plane at either position.
    expect(() => generateModel(kernel, specOf(10, undefined, thick))).not.toThrow();
    expect(() => generateModel(kernel, specOf(30, undefined, thick))).not.toThrow();
    const deep = {
      type: 'dowel',
      count: 1,
      profile: 'circle',
      diameterFactor: 1,
      depthFactor: 1.2,
      lowerClearanceMm: 0.3,
      upperClearanceMm: 0.5,
    } as const;
    expect(() => generateModel(kernel, specOf(10, 30, deep))).toThrow(ConnectorUnsuitableError);
  });
});

describe('the preview and the files of three parts', () => {
  it('moves the parts apart in their order along the normal, and exports all three with the dowels of both planes', async () => {
    const dowel = {
      type: 'dowel',
      count: 1,
      profile: 'circle',
      diameterFactor: 0.8,
      depthFactor: 0.8,
      lowerClearanceMm: 0.3,
      upperClearanceMm: 0.5,
    } as const;
    const artifacts = await buildModelArtifacts(kernel, specOf(40, -30, dowel));
    const { model } = artifacts;
    const root = (await new WebIO().readBinary(artifacts.separatedPreviewGlb as Uint8Array)).getRoot();
    const offsets = Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()]));
    // glTF is Y-up: the model's +Z is the preview's +Y.
    const up = (name: string) => (offsets[name] as [number, number, number])[1];
    // The middle part stays, the outer ones move away from it, each dowel with the part below its plane.
    expect(up('ball-middle-part')).toBe(0);
    expect(up('ball-lower-part')).toBeLessThan(0);
    expect(up('ball-upper-part')).toBeGreaterThan(0);
    const dowels = model.solids.filter((solid) => solid.part === 'dowel');
    expect(up(dowels[0]?.name as string)).toBeCloseTo(up('ball-lower-part'), 12);
    expect(up(dowels[1]?.name as string)).toBe(0);
    // Each interface opens beyond what the dowels seated below it reach.
    const reachAbove = (index: number, offset: number) =>
      Math.max(...vertices((dowels[index] as Solid).mesh).map(([, , z]) => z - offset));
    expect(-up('ball-lower-part') * 1000).toBeGreaterThan(reachAbove(0, model.section?.plane.offset as number));
    expect(up('ball-upper-part') * 1000).toBeGreaterThan(reachAbove(1, model.section?.secondInterface?.plane.offset as number));
    // Only along the normal: nothing moves sideways.
    for (const [x, , z] of Object.values(offsets) as [number, number, number][]) {
      expect(x).toBe(0);
      expect(z).toBe(0);
    }
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(artifacts.printFile.fileName).toBe('ball-parallel-horizontal-sections.3mf');
    expect(file.model.objects.map((object) => object.name)).toEqual([
      'ball-lower-part',
      'ball-middle-part',
      'ball-upper-part',
      'ball-dowel-1',
      'ball-dowel-2',
    ]);
    file.model.objects.forEach((object, index) => {
      expect(findMeshDefects(object.mesh)).toEqual([]);
      expect(measureMesh(object.mesh).volume).toBeCloseTo((model.solids[index] as Solid).measurements.volume, 1);
    });
    expect(readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model.objects.map((object) => object.name)).toEqual([
      'ball-dowel-1',
      'ball-dowel-2',
    ]);
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.section).toEqual({
      type: 'horizontal',
      offsetPercent: 40,
      secondOffsetPercent: -30,
    });
    expect(json.sourceModel.connector.settings).toEqual(dowel);
    expect(json.sourceModel.connector.atUpperPlane).toBeDefined();
  });
});
