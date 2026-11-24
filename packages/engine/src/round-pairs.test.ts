import { DEFAULT_DOVETAIL, DEFAULT_MAGNET, type ModelSpecInput, type Section, type Shape } from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts, SECTION_COLORS } from './artifacts.ts';
import { coneObliqueSection, cutOfSection, type PairedCut, pairedOffsets, solidCut } from './connectors/frame.ts';
import { planMagnets } from './connectors/magnet.ts';
import { InvalidModelSpecError } from './errors.ts';
import { readThreeMf } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { dot, findMeshDefects, type TriangleMesh, type Vec3 } from './mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from './model.ts';
import { type Track, withScope } from './scope.ts';
import { roundDimensionsMm } from './shapes/round.ts';

const kernel = await loadGeometryKernel();
const M80 = { longestDimensionMm: 80 };
const RIGHT_CYLINDER = { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 } as const;
const OBLIQUE_CYLINDER = { kind: 'cylinder', heightRatio: 2, offsetRatio: 0.8 } as const;
const RIGHT_CONE = { kind: 'cone', heightRatio: 2, offsetRatio: 0 } as const;
const OBLIQUE_CONE = { kind: 'cone', heightRatio: 2, offsetRatio: 0.7 } as const;
type Connector = NonNullable<Section['connector']>;
const DOWEL: Connector = {
  type: 'dowel',
  count: 1,
  profile: 'circle',
  diameterFactor: 1,
  depthFactor: 1,
  lowerClearanceMm: 0.3,
  upperClearanceMm: 0.5,
};

const specOf = (shape: Shape, section: Record<string, unknown>): ModelSpecInput =>
  ({ shape, scale: M80, section }) as ModelSpecInput;
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));

/** Three closed, connected parts, apart, that fill the whole solid, in their order along the planes' normal. */
function expectThreeParts(model: GeneratedModel) {
  const parts = model.solids.filter((solid) => solid.part !== 'dowel');
  expect(parts).toHaveLength(3);
  expect(parts[1]?.part).toBe('middle');
  for (const part of parts) expect(findMeshDefects(part.mesh)).toEqual([]);
  withScope((track) => {
    const manifolds = parts.map((part) => manifoldOf(track, part.mesh));
    for (const piece of manifolds) expect(piece.decompose().map(track)).toHaveLength(1);
    manifolds.forEach((first, index) => {
      for (const second of manifolds.slice(index + 1)) expect(track(first.intersect(second)).volume()).toBeLessThan(0.02);
    });
  });
  const whole = generateModel(kernel, { shape: model.spec.shape, scale: model.spec.scale }).solids[0] as Solid;
  const total = parts.reduce((sum, part) => sum + part.measurements.volume, 0);
  expect(total / whole.measurements.volume).toBeCloseTo(1, 6);
  // The parts follow each other along the normal: the lower plane's offset below the upper's.
  const { plane, secondInterface } = model.section ?? {};
  expect(plane?.offset).toBeLessThan(secondInterface?.plane.offset as number);
  expect(dot(plane?.normal as Vec3, secondInterface?.plane.normal as Vec3)).toBeCloseTo(1, 12);
}

const PAIRS: [string, Shape, Record<string, unknown>][] = [
  ['a right cylinder parallel to its bases', RIGHT_CYLINDER, { type: 'parallel-to-bases', positionPercent: 30 }],
  ['an oblique cylinder parallel to its axis', OBLIQUE_CYLINDER, { type: 'axis-parallel', offsetPercent: 0, directionDeg: 90 }],
  [
    'an oblique cylinder by an inclined plane',
    OBLIQUE_CYLINDER,
    { type: 'oblique', positionPercent: 50, inclinationDeg: 30, directionDeg: 0 },
  ],
  ['a right cylinder through its axis', RIGHT_CYLINDER, { type: 'vertical', offsetPercent: 0 }],
  ['a right cone parallel to its base', RIGHT_CONE, { type: 'parallel-to-bases', positionPercent: 30 }],
  ['an oblique cone parallel to its base', OBLIQUE_CONE, { type: 'parallel-to-bases', positionPercent: 30 }],
  ['a cone through its apex', RIGHT_CONE, { type: 'oblique-apex', inclinationDeg: 80, directionDeg: 0 }],
  ['a cone through its axis', RIGHT_CONE, { type: 'vertical', offsetPercent: 0 }],
];

describe('a second plane parallel to a cylinder’s or a cone’s section', () => {
  it.each(PAIRS)('cuts %s into three closed parts, the first plane where it was', (_name, shape, first) => {
    const single = generateModel(kernel, specOf(shape, first));
    for (const secondPositionPercent of [15, 85]) {
      const model = generateModel(kernel, specOf(shape, { ...first, secondPositionPercent }));
      expect(model.name).toMatch(/-two-.*-sections$/);
      expectThreeParts(model);
      // The first plane is the single cut's, on whichever side of it the second lies.
      const { section } = model;
      const firstPlane = section?.sectionIndex === 0 ? section.plane : section?.secondInterface?.plane;
      for (const axis of [0, 1, 2]) {
        expect(firstPlane?.normal[axis]).toBeCloseTo(single.section?.plane.normal[axis] as number, 9);
      }
      expect(firstPlane?.offset).toBeCloseTo(single.section?.plane.offset as number, 6);
      // The export keeps the whole solid's size.
      for (const axis of [0, 1, 2]) expect(model.size[axis]).toBeCloseTo(single.size[axis] as number, 6);
    }
  });

  it('places the second plane at its share of the whole solid’s extent along the shared normal, either side of the first', () => {
    const cut = cutOfSection({
      type: 'oblique',
      positionPercent: 50,
      inclinationDeg: 30,
      directionDeg: 0,
      secondPositionPercent: 20,
    } as Section) as PairedCut;
    const { normal, first, second, extent } = pairedOffsets(OBLIQUE_CYLINDER, M80, cut);
    expect(second).toBeCloseTo(extent.min + 0.2 * (extent.max - extent.min), 9);
    expect(second).toBeLessThan(first);
    // Seen from the second plane: the same normal and frame, the middle part on the first plane's side.
    const atFirst = solidCut(OBLIQUE_CYLINDER, M80, cut);
    const atSecond = solidCut(OBLIQUE_CYLINDER, M80, { ...cut, atSecond: true });
    expect(atSecond.frame.n).toEqual(atFirst.frame.n);
    expect(atSecond.frame.u).toEqual(atFirst.frame.u);
    expect(atFirst.middle).toEqual({ side: 'negative', thickness: expect.closeTo(first - second, 9) });
    expect(atSecond.middle).toEqual({ side: 'positive', thickness: expect.closeTo(first - second, 9) });
    expect(dot(normal, atSecond.frame.origin)).toBeCloseTo(second, 9);
  });

  it('keeps a plane through the apex at the apex, and moves the second plane off it', () => {
    const shape = RIGHT_CONE;
    const apexCut = { inclinationDeg: 80, directionDeg: 0 };
    const cut = cutOfSection({ type: 'oblique-apex', ...apexCut, secondPositionPercent: 25 } as Section) as PairedCut;
    const apex: Vec3 = [0, 0, roundDimensionsMm(shape, M80).height];
    const atFirst = solidCut(shape, M80, cut);
    const atSecond = solidCut(shape, M80, { ...cut, atSecond: true });
    if (!('plane' in atFirst) || !('plane' in atSecond)) throw new Error('Expected faceted sections.');
    expect(dot(atFirst.plane.normal, apex) - atFirst.plane.offset).toBeCloseTo(0, 9);
    expect(Math.abs(dot(atSecond.plane.normal, apex) - atSecond.plane.offset)).toBeGreaterThan(1);
    expect(atFirst.plane).toEqual(coneObliqueSection(shape, M80, apexCut).plane);
    expect(atSecond.type).toBe('cone-oblique');
    expect((atSecond as { throughApex?: boolean }).throughApex).toBe(false);
  });

  it('follows the solid’s proportions: the first plane by its construction, the second by its share of the extent', () => {
    const section = { type: 'parallel-to-bases', positionPercent: 30, secondPositionPercent: 70 };
    for (const shape of [RIGHT_CONE, { ...RIGHT_CONE, heightRatio: 3 }, OBLIQUE_CONE]) {
      const model = generateModel(kernel, specOf(shape, section));
      const height = roundDimensionsMm(shape, M80).height;
      expect(model.section?.plane.offset).toBeCloseTo(0.3 * height, 9);
      expect(model.section?.secondInterface?.plane.offset).toBeCloseTo(0.7 * height, 9);
    }
  });

  it('refuses coincident or nearly coincident planes, and a section plate beside two planes', () => {
    const near = specOf(RIGHT_CYLINDER, { type: 'parallel-to-bases', positionPercent: 50, secondPositionPercent: 52 });
    expect(() => generateModel(kernel, near)).toThrow(InvalidModelSpecError);
    expect(() => generateModel(kernel, near)).toThrow(/secondPositionPercent/);
    expect(() =>
      generateModel(
        kernel,
        specOf(RIGHT_CYLINDER, {
          type: 'parallel-to-bases',
          positionPercent: 30,
          secondPositionPercent: 70,
          plate: { thicknessMm: 2, marginMm: 5 },
        }),
      ),
    ).toThrow(InvalidModelSpecError);
    expect(() =>
      generateModel(
        kernel,
        specOf(RIGHT_CYLINDER, { type: 'parallel-to-bases', positionPercent: 30, secondPositionPercent: 95 }),
      ),
    ).toThrow(InvalidModelSpecError);
  });

  it('joins the middle part at both planes with the final parts, checking what both sides take from it', () => {
    for (const connector of [
      DOWEL,
      { type: 'dovetail', ...DEFAULT_DOVETAIL },
      { type: 'magnet', ...DEFAULT_MAGNET },
    ] as Connector[]) {
      const model = generateModel(
        kernel,
        specOf(OBLIQUE_CYLINDER, {
          type: 'axis-parallel',
          offsetPercent: 0,
          directionDeg: 90,
          secondPositionPercent: 85,
          connector,
        }),
      );
      expect(model.section?.connector?.type).toBe(connector.type);
      expect(model.section?.secondInterface?.connector?.type).toBe(connector.type);
      expect(model.solids.filter((solid) => solid.part === 'dowel')).toHaveLength(connector.type === 'dowel' ? 2 : 0);
    }
    // Thick magnets from both sides of a thin middle part: refused for the middle part, which both planes see.
    const thin = cutOfSection({
      type: 'parallel-to-bases',
      positionPercent: 40,
      secondPositionPercent: 55,
    } as Section);
    const plan = planMagnets(RIGHT_CYLINDER, M80, thin, { type: 'magnet', ...DEFAULT_MAGNET, magnetThicknessMm: 6 });
    expect(plan.issues.map(({ code }) => code)).toContain('middle-thin');
  });
});

/** Each part's cut faces by material: which section colours a part's surfaces take. */
async function sectionMaterials(glb: Uint8Array): Promise<string[][]> {
  const document = await new WebIO().readBinary(glb);
  return document
    .getRoot()
    .listNodes()
    .map((node) =>
      (node.getMesh()?.listPrimitives() ?? [])
        .filter((primitive) => primitive.getMode() === 4)
        .map((primitive) => primitive.getMaterial()?.getName() as string)
        .filter((name) => name.startsWith('plane-')),
    );
}

describe('the colours of a section’s planes in the preview', () => {
  const pair = (positionPercent: number, secondPositionPercent: number, connector?: Connector) =>
    specOf(RIGHT_CYLINDER, {
      type: 'parallel-to-bases',
      positionPercent,
      secondPositionPercent,
      ...(connector === undefined ? {} : { connector }),
    });

  it('colours each plane’s mating faces alike, the middle part with both, by the section and not by the order', async () => {
    for (const [first, second] of [
      [30, 70],
      [70, 30],
    ] as const) {
      for (const connector of [undefined, DOWEL, { type: 'dovetail', ...DEFAULT_DOVETAIL } as Connector]) {
        const artifacts = await buildModelArtifacts(kernel, pair(first, second, connector));
        // Lower, middle, upper, then any dowels: the first section is the lower plane at 30 % and the upper one at 70 %.
        const [lowerFirst, upperFirst] = first < second ? ['plane-1', 'plane-2'] : ['plane-2', 'plane-1'];
        for (const glb of [artifacts.previewGlb, artifacts.separatedPreviewGlb as Uint8Array]) {
          const [lower, middle, upper, ...dowels] = await sectionMaterials(glb);
          expect(lower).toEqual([lowerFirst]);
          expect(middle?.sort()).toEqual(['plane-1', 'plane-2']);
          expect(upper).toEqual([upperFirst]);
          if (connector?.type === 'dowel') expect(dowels).toEqual([[lowerFirst], [upperFirst]]);
        }
        // The print file has the parts and dowels alone, at the same scale as without colours.
        const { objects } = readThreeMf(artifacts.printFile.bytes).model;
        expect(objects).toHaveLength(connector?.type === 'dowel' ? 5 : 3);
      }
    }
  });

  it('keeps the first section orange alone, and orange and green on every solid with two parallel planes', async () => {
    const single = await buildModelArtifacts(kernel, specOf(RIGHT_CONE, { type: 'parallel-to-bases', positionPercent: 40 }));
    expect((await sectionMaterials(single.previewGlb)).flat()).toEqual(['plane-1', 'plane-1']);
    expect(SECTION_COLORS).toEqual(['#f7bb6b', '#2ed1a2']);
    const pairs: ModelSpecInput[] = [
      { shape: { kind: 'ball' }, scale: M80, section: { type: 'horizontal', offsetPercent: -30, secondOffsetPercent: 30 } },
      specOf({ kind: 'cube' }, { type: 'face-parallel', face: 'ABCD', positionPercent: 70, secondPositionPercent: 30 }),
      specOf(
        { kind: 'prism', baseType: 'regular', baseSides: 5, heightRatio: 2, offsetXRatio: 0.3, offsetYRatio: 0 },
        { type: 'face-parallel', face: 'ABCDE', positionPercent: 30, secondPositionPercent: 60 },
      ),
      specOf({ kind: 'tetrahedron' }, { type: 'face-parallel', face: 'ABC', positionPercent: 25, secondPositionPercent: 50 }),
      specOf(RIGHT_CONE, { type: 'oblique-apex', inclinationDeg: 80, directionDeg: 0, secondPositionPercent: 25 }),
    ];
    for (const spec of pairs) {
      const artifacts = await buildModelArtifacts(kernel, spec);
      const parts = await sectionMaterials(artifacts.separatedPreviewGlb as Uint8Array);
      const middle = parts[artifacts.model.solids.findIndex((solid) => solid.part === 'middle')];
      expect(middle?.sort()).toEqual(['plane-1', 'plane-2']);
      expect(parts.flat().filter((name) => name === 'plane-1')).toHaveLength(2);
      expect(parts.flat().filter((name) => name === 'plane-2')).toHaveLength(2);
    }
  });
});
