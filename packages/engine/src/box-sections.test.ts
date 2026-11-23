import {
  BOX_FACES,
  type BoxFace,
  type BoxSectionSpec,
  type BoxSegment,
  type BoxVertex,
  DEFAULT_MAGNET,
  type ModelSpecInput,
  type Section,
} from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts, SECTION_PREVIEW_GAP_RELATIVE } from './artifacts.ts';
import {
  type BoxPointRange,
  boxFaceLines,
  boxFaceOrientations,
  boxFaceParallelPercent,
  boxLineAngleBounds,
  boxParallelFaces,
  boxPlane,
  boxPointEdges,
  boxPointRange,
  boxSection,
  boxSplitReach,
  boxThroughLineChoices,
  boxTopologyOf,
  boxTraceChoices,
  boxVertices,
  inPointRange,
  topologyOf,
} from './connectors/box.ts';
import { cutOfSection } from './connectors/frame.ts';
import { planMagnets } from './connectors/magnet.ts';
import { defaultRoundConnector } from './connectors/round-capacity.ts';
import { ConnectorUnsuitableError, InvalidModelSpecError } from './errors.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { findMeshDefects, type TriangleMesh, type Vec3, vertexAt, vertexCount } from './mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from './model.ts';
import { type Track, withScope } from './scope.ts';

const kernel = await loadGeometryKernel();

const L = 60;
const SCALE = { longestDimensionMm: L };
const CUBE = { kind: 'cube' } as const;
const CUBOID = { kind: 'cuboid', widthRatio: 0.6, heightRatio: 1.4 } as const;
// Leaning along +X and +Y, with a 60° base: no edge of it is axis-aligned but AB.
const OBLIQUE = {
  kind: 'parallelepiped',
  baseSideRatio: 0.7,
  heightRatio: 1.1,
  baseAngleDeg: 60,
  offsetXRatio: 0.3,
  offsetYRatio: 0.2,
} as const;
type BoxShapeInput = Extract<ModelSpecInput['shape'], { kind: 'cube' | 'cuboid' | 'parallelepiped' | 'prism' }>;
type Connector = NonNullable<Section['connector']>;

const spec = (shape: BoxShapeInput, section: object, connector?: Connector): ModelSpecInput => ({
  shape,
  scale: SCALE,
  section: { ...section, ...(connector === undefined ? {} : { connector }) } as Section,
});

/** The section's polygon as the engine reads it off the solid's faces. */
const sectionOf = (shape: BoxShapeInput, section: object) => {
  const model = generateModel(kernel, spec(shape, section));
  const cut = cutOfSection(model.spec.section as Section);
  return { model, section: boxSection(model.spec.shape as never, model.spec.scale, cut as never) };
};

const POSITION_TOLERANCE_MM = 1e-4;
/** Touching faces of meshes read back from float32 overlap by their rounding, see plate-cuts.test.ts. */
const FLOAT32_CONTACT_MM3 = 0.02;

const vertices = (mesh: TriangleMesh): Vec3[] => Array.from({ length: vertexCount(mesh) }, (_, index) => vertexAt(mesh, index));
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Every part closed, oriented, of genus 0 and one piece, no two overlapping, and all of them the whole solid. */
function expectPartsOfWhole(model: GeneratedModel): void {
  const shape = model.spec.shape;
  const whole = generateModel(kernel, { shape, scale: model.spec.scale }).solids[0]?.measurements.volume as number;
  const parts = model.solids.filter((solid) => solid.part !== 'dowel');
  for (const solid of model.solids) {
    expect(findMeshDefects(solid.mesh)).toEqual([]);
    expect(solid.measurements.volume).toBeGreaterThan(0);
  }
  withScope((track) => {
    const pieces = parts.map((solid) => manifoldOf(track, solid.mesh));
    for (const piece of pieces) {
      expect(piece.decompose().map(track)).toHaveLength(1);
      expect(piece.genus()).toBe(0);
    }
    pieces.forEach((one, index) => {
      for (const other of pieces.slice(index + 1)) expect(track(one.intersect(other)).volume()).toBeLessThan(FLOAT32_CONTACT_MM3);
    });
  });
  const removed = model.section?.connector === undefined ? 0 : undefined;
  const total = parts.reduce((sum, solid) => sum + solid.measurements.volume, 0);
  // Flat faces fill the solid exactly; a connector's holes and grooves take some away, pins and tongues add back.
  if (removed === 0) expect(total / whole).toBeCloseTo(1, 6);
  else expect(total / whole).toBeLessThanOrEqual(1 + 1e-6);
}

/** The cube's own coordinates as the textbook's unit cube has them: (0, 0, 0) at A, (1, 1, 1) at C1. */
const unit = ([x, y, z]: Vec3): Vec3 => [x / L + 0.5, y / L + 0.5, z / L];

describe('sections of a cube by its reference planes', () => {
  it('z = 1/2, parallel to the base: a square with the cube’s area, halving it', () => {
    const { model, section } = sectionOf(CUBE, { type: 'face-parallel', face: 'ABCD', positionPercent: 50 });
    expect(section.contour).toHaveLength(4);
    for (const corner of section.contour) expect(unit(corner)[2]).toBeCloseTo(0.5, 9);
    expect(section.area).toBeCloseTo(L * L, 6);
    expect(model.name).toBe('cube-face-parallel-section');
    expect(model.solids.map((solid) => solid.part)).toEqual(['lower', 'upper']);
    for (const solid of model.solids) expect(solid.measurements.volume).toBeCloseTo(L ** 3 / 2, 3);
    expectPartsOfWhole(model);
  });

  it('x = y, through the diagonal AC and the lateral edges: a rectangle a × a√2, halving it', () => {
    const { model, section } = sectionOf(CUBE, { type: 'longitudinal', trace: 'AC', positionPercent: 50 });
    expect(section.contour).toHaveLength(4);
    for (const corner of section.contour) expect(unit(corner)[0] - unit(corner)[1]).toBeCloseTo(0, 9);
    expect(section.area).toBeCloseTo(L * L * Math.SQRT2, 6);
    expect(model.solids.map((solid) => solid.part)).toEqual(['part-1', 'part-2']);
    for (const solid of model.solids) expect(solid.measurements.volume).toBeCloseTo(L ** 3 / 2, 3);
    expectPartsOfWhole(model);
  });

  it('x + y + z = 1/2, perpendicular to AC1 near A: an equilateral triangle cutting off a corner of a³/48', () => {
    const { model, section } = sectionOf(CUBE, { type: 'inclined', normalAlong: ['A', 'C1'], positionPercent: 100 / 6 });
    expect(section.contour).toHaveLength(3);
    for (const corner of section.contour) expect(unit(corner).reduce((sum, value) => sum + value, 0)).toBeCloseTo(0.5, 9);
    const sides = section.contour.map((corner, index) => distance(corner, section.contour[(index + 1) % 3] as Vec3));
    for (const side of sides) expect(side).toBeCloseTo((L * Math.SQRT2) / 2, 6);
    expect(section.area).toBeCloseTo(((Math.sqrt(3) / 4) * (L * L)) / 2, 6);
    const volumes = model.solids.map((solid) => solid.measurements.volume).sort((a, b) => a - b);
    expect(volumes[0]).toBeCloseTo(L ** 3 / 48, 3);
    expectPartsOfWhole(model);
  });

  it('x + y + z = 3/2, perpendicular to AC1 through the centre: a regular hexagon', () => {
    const { model, section } = sectionOf(CUBE, { type: 'inclined', normalAlong: ['A', 'C1'], positionPercent: 50 });
    expect(section.contour).toHaveLength(6);
    const side = (L * Math.SQRT2) / 2;
    section.contour.forEach((corner, index) => {
      expect(unit(corner).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1.5, 9);
      expect(distance(corner, section.contour[(index + 1) % 6] as Vec3)).toBeCloseTo(side, 6);
    });
    expect(section.area).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * side * side, 6);
    for (const solid of model.solids) expect(solid.measurements.volume).toBeCloseTo(L ** 3 / 2, 3);
    expectPartsOfWhole(model);
  });

  it('x + 2y + 3z = 5/2, by its angles to the base: a pentagon', () => {
    // n = (1, 2, 3)/√14 = (−sin α cos φ, −sin α sin φ, cos α); positions run over 0 ≤ x + 2y + 3z ≤ 6.
    const inclinationDeg = (Math.acos(3 / Math.sqrt(14)) * 180) / Math.PI;
    const directionDeg = 180 + (Math.atan2(2, 1) * 180) / Math.PI;
    const { model, section } = sectionOf(CUBE, { type: 'inclined', inclinationDeg, directionDeg, positionPercent: 250 / 6 });
    expect(section.contour).toHaveLength(5);
    for (const corner of section.contour) {
      const [x, y, z] = unit(corner);
      expect(x + 2 * y + 3 * z).toBeCloseTo(2.5, 9);
    }
    expectPartsOfWhole(model);
  });
});

describe('a plane through an edge or a diagonal of a face', () => {
  it('through AB and the midpoint of CC1: a rectangle a × a√5/2, the prism below it a quarter of the cube', () => {
    const through = { type: 'through-line', face: 'ABCD', line: ['A', 'B'], method: 'point', pointEdge: ['C', 'C1'] };
    const { model, section } = sectionOf(CUBE, { ...through, pointPercent: 50 });
    expect(section.contour).toHaveLength(4);
    expect(section.area).toBeCloseTo((L * L * Math.sqrt(5)) / 2, 6);
    const volumes = model.solids.map((solid) => solid.measurements.volume).sort((a, b) => a - b);
    expect(volumes[0]).toBeCloseTo(L ** 3 / 4, 3);
    expect(volumes[1]).toBeCloseTo((3 * L ** 3) / 4, 3);
    expectPartsOfWhole(model);
    // The point at either end of the edge: the vertex C or C1 itself.
    expect(sectionOf(CUBE, { ...through, pointPercent: 100 }).section.area).toBeCloseTo(L * L * Math.SQRT2, 6);
    // A point on the line itself fixes no plane.
    expect(() => generateModel(kernel, spec(CUBE, { ...through, pointEdge: ['B', 'B1'], pointPercent: 0 }))).toThrow(
      InvalidModelSpecError,
    );
  });

  it('through the side face’s diagonal AB1, at right angles to that face: the diagonal section AB1C1D', () => {
    const { model, section } = sectionOf(CUBE, {
      type: 'through-line',
      face: 'ABB1A1',
      line: ['A', 'B1'],
      method: 'angle',
      angleDeg: 90,
    });
    const corners = boxVertices(CUBE, SCALE);
    expect(section.contour).toHaveLength(4);
    for (const vertex of [corners.A, corners.B1, corners.C1, corners.D]) {
      expect(Math.min(...section.contour.map((corner) => distance(corner, vertex)))).toBeLessThan(POSITION_TOLERANCE_MM);
    }
    expect(section.area).toBeCloseTo(L * L * Math.SQRT2, 6);
    expectPartsOfWhole(model);
  });

  it('turns about an edge from its face into the solid, and only up to the adjacent face', () => {
    // 45° from the base about AB is the diagonal section through C1D1.
    const { section } = sectionOf(CUBE, { type: 'through-line', face: 'ABCD', line: ['A', 'B'], method: 'angle', angleDeg: 45 });
    const corners = boxVertices(CUBE, SCALE);
    for (const vertex of [corners.C1, corners.D1]) {
      expect(Math.min(...section.contour.map((corner) => distance(corner, vertex)))).toBeLessThan(POSITION_TOLERANCE_MM);
    }
    // About an edge the usable angles lie within the cube's dihedral angle, symmetric for a cube; about a diagonal, nearly 180°.
    const edge = boxLineAngleBounds(CUBE, SCALE, 'ABCD', ['A', 'B']);
    expect(edge?.min).toBeGreaterThan(0);
    expect(edge?.max).toBeLessThan(90);
    expect((edge?.min ?? 0) + (edge?.max ?? 0)).toBeCloseTo(90, 2);
    const diagonal = boxLineAngleBounds(CUBE, SCALE, 'ABCD', ['A', 'C']);
    expect((diagonal?.max ?? 0) - (diagonal?.min ?? 0)).toBeGreaterThan(120);
    for (const angleDeg of [95, 1]) {
      expect(() =>
        generateModel(kernel, spec(CUBE, { type: 'through-line', face: 'ABCD', line: ['A', 'B'], method: 'angle', angleDeg })),
      ).toThrow(InvalidModelSpecError);
    }
  });
});

describe('the same modes on the parallelepipeds', () => {
  it('a cuboid with unequal edges: a plane parallel to a side face at a quarter, and the diagonal section through BD', () => {
    const [a, b, c] = [L / 1.4, (0.6 * L) / 1.4, L];
    const side = sectionOf(CUBOID, { type: 'face-parallel', face: 'ABB1A1', positionPercent: 25 });
    expect(side.section.area).toBeCloseTo(a * c, 6);
    for (const corner of side.section.contour) expect(corner[1]).toBeCloseTo(-b / 2 + 0.25 * b, 9);
    const volumes = side.model.solids.map((solid) => solid.measurements.volume).sort((p, q) => p - q);
    expect(volumes[0]).toBeCloseTo(0.25 * a * b * c, 3);
    expectPartsOfWhole(side.model);
    const diagonal = sectionOf(CUBOID, { type: 'longitudinal', trace: 'BD', positionPercent: 50 });
    expect(diagonal.section.area).toBeCloseTo(Math.hypot(a, b) * c, 6);
    expectPartsOfWhole(diagonal.model);
  });

  it('an oblique parallelepiped: planes along its own lateral edges and faces, wherever they lean', () => {
    const corners = boxVertices(OBLIQUE, SCALE);
    const lateral: Vec3 = [corners.A1[0] - corners.A[0], corners.A1[1] - corners.A[1], corners.A1[2] - corners.A[2]];
    // The diagonal section is a parallelogram through A, C, C1 and A1, parallel to the lateral edges, halving the solid.
    const diagonal = sectionOf(OBLIQUE, { type: 'longitudinal', trace: 'AC', positionPercent: 50 });
    const { normal } = diagonal.section.plane;
    expect(normal[0] * lateral[0] + normal[1] * lateral[1] + normal[2] * lateral[2]).toBeCloseTo(0, 9);
    for (const vertex of [corners.A, corners.C, corners.C1, corners.A1]) {
      expect(Math.min(...diagonal.section.contour.map((corner) => distance(corner, vertex)))).toBeLessThan(POSITION_TOLERANCE_MM);
    }
    for (const solid of diagonal.model.solids) {
      expect(solid.measurements.volume / (diagonal.model.solids[0]?.measurements.volume as number)).toBeCloseTo(1, 3);
    }
    expectPartsOfWhole(diagonal.model);
    // A plane parallel to the base meets every lateral edge at the same fraction: the section is the base moved up.
    const base = sectionOf(OBLIQUE, { type: 'face-parallel', face: 'ABCD', positionPercent: 30 });
    const baseArea = sectionOf(OBLIQUE, { type: 'face-parallel', face: 'ABCD', positionPercent: 70 }).section.area;
    expect(base.section.area).toBeCloseTo(baseArea, 6);
    for (const corner of base.section.contour) expect(corner[2]).toBeCloseTo(0.3 * corners.A1[2], 9);
    expectPartsOfWhole(base.model);
    // A plane through an edge and a point of another, as on the cube.
    const through = sectionOf(OBLIQUE, {
      type: 'through-line',
      face: 'ABCD',
      line: ['A', 'B'],
      method: 'point',
      pointEdge: ['C', 'C1'],
      pointPercent: 50,
    });
    expectPartsOfWhole(through.model);
  });

  it('keeps each plane’s relation to the solid when its dimensions change', () => {
    for (const shape of [OBLIQUE, { ...OBLIQUE, baseAngleDeg: 75, offsetXRatio: -0.4, heightRatio: 1.6 }] as const) {
      const corners = boxVertices(shape, SCALE);
      const plane = boxPlane(corners, { type: 'longitudinal', trace: 'BD', traceAngleDeg: 0, positionPercent: 50 });
      // Through the diagonal BD and the lateral edges at its ends, whatever the solid.
      for (const vertex of [corners.B, corners.D, corners.B1, corners.D1]) {
        const along = plane.normal[0] * vertex[0] + plane.normal[1] * vertex[1] + plane.normal[2] * vertex[2];
        expect(along).toBeCloseTo(plane.offset, 9);
      }
      const edge = boxPlane(corners, {
        type: 'through-line',
        face: 'ABCD',
        line: ['A', 'B'],
        method: 'point',
        pointEdge: ['C', 'C1'],
        pointPercent: 50,
      });
      const middle: Vec3 = [
        (corners.C[0] + corners.C1[0]) / 2,
        (corners.C[1] + corners.C1[1]) / 2,
        (corners.C[2] + corners.C1[2]) / 2,
      ];
      for (const point of [corners.A, corners.B, middle]) {
        expect(edge.normal[0] * point[0] + edge.normal[1] * point[1] + edge.normal[2] * point[2]).toBeCloseTo(edge.offset, 9);
      }
    }
  });
});

describe('two parallel planes of a box', () => {
  it('three closed parts of the whole, each plane where it was asked to be, the middle part between them', () => {
    const model = generateModel(
      kernel,
      spec(CUBE, { type: 'face-parallel', face: 'ABCD', positionPercent: 70, secondPositionPercent: 30 }),
    );
    expect(model.name).toBe('cube-two-face-parallel-sections');
    expect(model.solids.map((solid) => solid.part)).toEqual(['lower', 'middle', 'upper']);
    expect(model.section?.plane.offset).toBeCloseTo(0.3 * L, 9);
    expect(model.section?.secondInterface?.plane.offset).toBeCloseTo(0.7 * L, 9);
    expect(model.solids.map((solid) => solid.measurements.volume / L ** 3)).toEqual([
      expect.closeTo(0.3, 6),
      expect.closeTo(0.4, 6),
      expect.closeTo(0.3, 6),
    ]);
    expectPartsOfWhole(model);
    // Along an inclined normal the parts are numbered, the middle one between them.
    const inclined = generateModel(
      kernel,
      spec(OBLIQUE, { type: 'inclined', inclinationDeg: 30, directionDeg: 20, positionPercent: 35, secondPositionPercent: 65 }),
    );
    expect(inclined.solids.map((solid) => solid.part)).toEqual(['part-1', 'middle', 'part-2']);
    expectPartsOfWhole(inclined);
  });

  it('refuses a middle part thinner than a tenth of the solid’s extent along the normal', () => {
    const close = { type: 'face-parallel', face: 'ABCD', positionPercent: 50, secondPositionPercent: 55 };
    expect(() => generateModel(kernel, spec(CUBE, close))).toThrow(/secondPositionPercent/);
    expect(() => generateModel(kernel, spec(CUBE, { ...close, secondPositionPercent: 60 }))).not.toThrow();
  });

  it('fits a connector at both planes on the final parts, and refuses magnets the thin middle part cannot hold', () => {
    const section = { type: 'face-parallel', face: 'ABCD', positionPercent: 30, secondPositionPercent: 70 } as const;
    for (const connector of [
      { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 40, clearanceMm: 0.2 },
      { type: 'magnet', ...DEFAULT_MAGNET },
    ] as const) {
      const model = generateModel(kernel, spec(CUBE, section, connector));
      expect(model.section?.connector).toBeDefined();
      expect(model.section?.secondInterface?.connector).toBeDefined();
      expectPartsOfWhole(model);
    }
    const thin = { ...section, positionPercent: 45, secondPositionPercent: 56 };
    expect(() => generateModel(kernel, spec(CUBE, thin, { type: 'magnet', ...DEFAULT_MAGNET, magnetThicknessMm: 3 }))).toThrow(
      ConnectorUnsuitableError,
    );
  });
});

describe('connectors on the actual polygon', () => {
  const corner = { type: 'inclined', normalAlong: ['A', 'C1'], positionPercent: 100 / 6 } as const;
  const fitted = (section: object, connector: object) => {
    const outcome = defaultRoundConnector(CUBE, SCALE, cutOfSection(section as Section), connector as never);
    if (outcome.status !== 'available') throw new Error('expected a connector');
    return outcome.connector as Connector;
  };

  it.each([
    ['a dovetail', () => ({ type: 'dovetail', sizeFactor: 0.8, lengthPercent: 40, clearanceMm: 0.2 }) as Connector],
    [
      'a plug',
      () =>
        fitted(corner, { type: 'plug', count: 1, profile: 'circle', diameterFactor: 1, depthFactor: 1, holeClearanceMm: 0.4 }),
    ],
    [
      'a pair of dowels',
      () =>
        fitted(corner, {
          type: 'dowel',
          count: 2,
          profile: 'square',
          diameterFactor: 1,
          depthFactor: 1,
          spacingPercent: 40,
          lowerClearanceMm: 0.3,
          upperClearanceMm: 0.5,
        }),
    ],
    ['magnets', () => ({ type: 'magnet', ...DEFAULT_MAGNET, count: 1 }) as Connector],
  ])('%s on the triangle cut off a corner, built and verified there', (_, connector) => {
    const model = generateModel(kernel, spec(CUBE, corner, connector()));
    expect(model.section?.connector).toBeDefined();
    expectPartsOfWhole(model);
  });

  it('places magnets inside the polygon, away from its corners, and refuses them on a section too narrow for them', () => {
    const hexagon = cutOfSection({ type: 'inclined', normalAlong: ['A', 'C1'], positionPercent: 50 } as Section);
    const plan = planMagnets(CUBE, SCALE, hexagon, { type: 'magnet', ...DEFAULT_MAGNET, count: 6 });
    expect(plan.issues).toEqual([]);
    const contour = boxSection(CUBE, SCALE, hexagon as never).contour;
    for (const site of plan.sites) {
      // Inside every edge of the hexagon by more than the pocket's radius.
      contour.forEach((a, index) => {
        const b = contour[(index + 1) % contour.length] as Vec3;
        const edge: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const towards: Vec3 = [site.centre[0] - a[0], site.centre[1] - a[1], site.centre[2] - a[2]];
        const cross = Math.hypot(
          edge[1] * towards[2] - edge[2] * towards[1],
          edge[2] * towards[0] - edge[0] * towards[2],
          edge[0] * towards[1] - edge[1] * towards[0],
        );
        expect(cross / Math.hypot(...edge)).toBeGreaterThan(DEFAULT_MAGNET.magnetDiameterMm / 2);
      });
    }
    const tip = cutOfSection({ type: 'inclined', normalAlong: ['A', 'C1'], positionPercent: 10 } as Section);
    expect(planMagnets(CUBE, SCALE, tip, { type: 'magnet', ...DEFAULT_MAGNET, count: 3 }).issues.length).toBeGreaterThan(0);
    expect(() =>
      generateModel(kernel, spec(CUBE, { ...corner, positionPercent: 10 }, { type: 'magnet', ...DEFAULT_MAGNET, count: 3 })),
    ).toThrow(ConnectorUnsuitableError);
  });
});

describe('preview and export of a box’s parts', () => {
  it('names the vertices in the preview, moving them with their part, and prints each part resting on a flat face', async () => {
    const section = { type: 'through-line', face: 'ABCD', line: ['A', 'B'], method: 'angle', angleDeg: 45 } as const;
    const artifacts = await buildModelArtifacts(kernel, spec(CUBE, section));
    expect(artifacts.separatedPreviewGlb).toBeDefined();
    const names = (artifacts.vertexLabels ?? []).map((label) => label.name);
    expect(names).toEqual(['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1']);
    // In glTF metres, Y up: C1 at (L/2, L, −L/2) mm in the assembled preview.
    const c1 = artifacts.vertexLabels?.find((label) => label.name === 'C1')?.position as Vec3;
    expect(c1.map((value) => value * 1000)).toEqual([expect.closeTo(L / 2, 6), expect.closeTo(L, 6), expect.closeTo(-L / 2, 6)]);
    // Assembled, A and B on the plane are one label each, of both parts, and their cut faces are inside the cube.
    for (const label of artifacts.vertexLabels ?? []) expect(label.faceNormals).toHaveLength(3);
    expect(artifacts.vertexLabels?.find((label) => label.name === 'A')?.parts).toEqual(['part-1', 'part-2']);
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(artifacts.printFile.fileName).toBe('cube-edge-section.3mf');
    expect(file.model.objects.map((object) => object.name)).toEqual(['cube-part-1', 'cube-part-2']);
    for (const object of file.model.objects) {
      const points = vertices(object.mesh);
      const lowest = Math.min(...points.map((point) => point[2]));
      // The wedge above the plane keeps only the edge AB of the base: it is turned onto a face rather than balanced on it.
      const onBed = points.filter((point) => point[2] - lowest < POSITION_TOLERANCE_MM);
      expect(onBed.length).toBeGreaterThanOrEqual(3);
    }
    const settings = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(settings.sourceModel.section).toMatchObject(section);
  });

  it('three parts of two planes, with their connectors, in the preview and the print file', async () => {
    const artifacts = await buildModelArtifacts(
      kernel,
      spec(
        CUBOID,
        { type: 'longitudinal', trace: 'AC', positionPercent: 50, secondPositionPercent: 80 },
        { type: 'magnet', ...DEFAULT_MAGNET, count: 2 },
      ),
    );
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(file.model.objects.map((object) => object.name)).toEqual(['cuboid-part-1', 'cuboid-middle-part', 'cuboid-part-2']);
    // A, C, A1 and C1 lie on the plane through AC, between the middle part and part 2, B's side being the one 80 % measures
    // towards: apart, each is shown on both parts beside it, B only on part 1 and D only on part 2.
    expect(artifacts.vertexLabels).toHaveLength(8);
    expect((artifacts.separatedVertexLabels ?? []).map((label) => `${label.name}:${label.parts.join('+')}`)).toEqual([
      'A:middle',
      'A:part-2',
      'B:part-1',
      'C:middle',
      'C:part-2',
      'D:part-2',
      'A1:middle',
      'A1:part-2',
      'B1:part-1',
      'C1:middle',
      'C1:part-2',
      'D1:part-2',
    ]);
    const settings = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(settings.sourceModel.connector.atUpperPlane).toBeDefined();
  });
});

describe('a box section on another solid', () => {
  it('is refused, as a round solid’s section is on a box', () => {
    expect(() =>
      generateModel(kernel, {
        shape: { kind: 'cylinder', heightRatio: 2, offsetRatio: 0 },
        scale: SCALE,
        section: { type: 'face-parallel', face: 'ABCD', positionPercent: 50 },
      }),
    ).toThrow(InvalidModelSpecError);
    expect(() =>
      generateModel(kernel, { shape: CUBE, scale: SCALE, section: { type: 'horizontal', offsetPercent: 0 } }),
    ).toThrow();
  });
});

describe('a plane through a face’s diagonal and a point of an edge of the opposite face', () => {
  // In the unit cube A = (0, 0, 0), …, C1 = (1, 1, 1), here [−L/2, L/2]² × [0, L]: the plane through A, C and the midpoint
  // P = (1, 1/2, 1) of B1C1 is 2x − 2y − z = 0. It meets A1B1 at its midpoint Q = (1/2, 0, 1): the trapezoid ACPQ, AC ∥ QP.
  // B's side, 2x − 2y ≥ z, holds ∫₀¹ min(2u, 1)(1 − u) du = 1/6 + 1/8 = 7/24 of the cube, with u = x − y.
  const midpoint = { type: 'through-line', face: 'ABCD', line: ['A', 'C'], method: 'point', pointEdge: ['B1', 'C1'] } as const;
  const unit = ([x, y, z]: Vec3): Vec3 => [x * L - L / 2, y * L - L / 2, z * L];

  it('is the trapezoid ACPQ, cutting off 7/24 of the cube on B’s side', () => {
    const { model, section } = sectionOf(CUBE, { ...midpoint, pointPercent: 50 });
    const expected = [unit([0, 0, 0]), unit([1, 1, 0]), unit([1, 0.5, 1]), unit([0.5, 0, 1])];
    expect(section.contour).toHaveLength(4);
    for (const corner of expected) {
      expect(Math.min(...section.contour.map((point) => distance(point, corner)))).toBeLessThan(POSITION_TOLERANCE_MM);
    }
    const [first, second] = model.solids.map((solid) => solid.measurements.volume / L ** 3);
    expect([first, second].sort()).toEqual([expect.closeTo(7 / 24, 6), expect.closeTo(17 / 24, 6)]);
    expectPartsOfWhole(model);
  });

  // The default parallelepiped, a rhombus with 60°, and the oblique one, whose extruded base used to be rounded off the very
  // vertices the plane is constructed through, leaving slivers beside A and C that failed as soon as a part was turned to print.
  const RHOMBUS = {
    kind: 'parallelepiped',
    baseSideRatio: 1,
    heightRatio: 1,
    baseAngleDeg: 60,
    offsetXRatio: 0,
    offsetYRatio: 0,
  } as const;
  const shapes = [
    ['the cube', CUBE],
    ['a cuboid', CUBOID],
    ['the default parallelepiped', RHOMBUS],
    ['an oblique parallelepiped', OBLIQUE],
  ] as const;
  const connectors: readonly (readonly [string, (shape: BoxShapeInput, section: object) => Connector | undefined])[] = [
    ['smooth', () => undefined],
    ['a dovetail', () => ({ type: 'dovetail', sizeFactor: 0.8, lengthPercent: 40, clearanceMm: 0.2 })],
    [
      'a plug',
      (shape, section) => {
        const outcome = defaultRoundConnector(shape as never, SCALE, cutOfSection(section as Section), {
          type: 'plug',
          count: 1,
          profile: 'circle',
          diameterFactor: 1,
          depthFactor: 1,
          holeClearanceMm: 0.4,
        } as never);
        if (outcome.status !== 'available') throw new Error('expected a plug');
        return outcome.connector as Connector;
      },
    ],
    ['magnets', () => ({ type: 'magnet', ...DEFAULT_MAGNET })],
  ];

  for (const [shapeName, shape] of shapes) {
    for (const pointPercent of [0, 50, 100]) {
      it.each(connectors)(`on ${shapeName} at ${pointPercent} %: %s, to the print file`, async (_, connectorOf) => {
        const section = { ...midpoint, pointPercent };
        const artifacts = await buildModelArtifacts(kernel, spec(shape, section, connectorOf(shape, section)));
        expectPartsOfWhole(artifacts.model);
        expect(readThreeMf(artifacts.printFile.bytes).model.objects).toHaveLength(2);
        // The parts' corners are the solid's own: no copy of a vertex lies a rounding error away from it.
        const corners = Object.values(boxVertices(artifacts.model.spec.shape as never, SCALE));
        for (const solid of artifacts.model.solids) {
          for (const point of vertices(solid.mesh)) {
            const nearest = Math.min(...corners.map((corner) => distance(point, corner)));
            expect(nearest < 1e-4 || nearest > 1e-2).toBe(true);
          }
        }
      });
    }
  }
});

describe('the choices of a plane through a line that lead to a usable plane', () => {
  /** Whether the plane through the line and the point is unique and leaves both parts a tenth of the extent. */
  const usable = (shape: BoxShapeInput, face: BoxFace, line: BoxSegment, edge: BoxSegment, pointPercent: number) => {
    const box = { type: 'through-line', face, line, method: 'point', pointEdge: edge, pointPercent } as const;
    let reach: { valueMm: number; minimumMm: number };
    try {
      reach = boxSplitReach(shape as never, SCALE, { box: box as BoxSectionSpec });
    } catch {
      return false;
    }
    const plane = boxPlane(boxVertices(shape as never, SCALE), box as BoxSectionSpec);
    return reach.valueMm >= 0.1 * (plane.extent.max - plane.extent.min);
  };

  it('leaves out an edge all of whose points give a face of the cube, and keeps one that only an end of fails', () => {
    const choices = boxThroughLineChoices(CUBE as never);
    const edgesOf = (face: BoxFace, line: string) =>
      (choices[face] ?? []).find((choice) => choice.line.join('') === line)?.pointEdges.map((edge) => edge.join(''));
    // Through AB of the side face ABB1A1, any point of BC or AD gives the base ABCD.
    expect(edgesOf('ABB1A1', 'AB')).not.toContain('BC');
    expect(edgesOf('ABB1A1', 'AB')).not.toContain('DA');
    // Through AB of the base, A1B1 gives the side face, and AA1 and BB1 give it too, or meet the line.
    expect(edgesOf('ABCD', 'AB')).toEqual(['B1C1', 'C1D1', 'D1A1', 'CC1', 'DD1']);
    // Through AC, AA1 fails only at A; B1C1 everywhere gives a plane, as the screenshot's midpoint does.
    expect(edgesOf('ABCD', 'AC')).toEqual(expect.arrayContaining(['AA1', 'B1C1']));
    expect(boxPointRange(CUBE as never, SCALE, 'ABCD', ['A', 'C'], ['A', 'A1'])).toEqual({
      min: 0,
      max: 100,
      minOpen: true,
      maxOpen: false,
    });
    expect(boxPointRange(CUBE as never, SCALE, 'ABCD', ['A', 'C'], ['B1', 'C1'])).toEqual({
      min: 0,
      max: 100,
      minOpen: false,
      maxOpen: false,
    });
    expect(boxPointRange(CUBE as never, SCALE, 'ABB1A1', ['A', 'B'], ['B', 'C'], 'proportional')).toBeNull();
  });

  it('ends a point’s range where the plane through it reaches the usable angles about the line', () => {
    // Through AB and a point of CC1 at t: the wedge below rises t·L over the side L, its plane at atan t from the base.
    const range = boxPointRange(CUBE as never, SCALE, 'ABCD', ['A', 'B'], ['C', 'C1']) as BoxPointRange;
    const angles = boxLineAngleBounds(CUBE as never, SCALE, 'ABCD', ['A', 'B']) as { min: number; max: number };
    expect(range.min).toBeCloseTo(100 * Math.tan((angles.min * Math.PI) / 180), 3);
    expect(range.max).toBe(100);
    expect(range.minOpen || range.maxOpen).toBe(false);
  });

  // Every face, line and edge of each solid, against the plane itself at every whole percent: the closed form of the range
  // and the choices agree with the rule wherever it is checked, so that no usable choice is left out nor an unusable one kept.
  it.each([
    ['the cube', CUBE],
    ['a cuboid with unequal edges', { kind: 'cuboid', widthRatio: 0.25, heightRatio: 3 } as const],
    ['an oblique parallelepiped', OBLIQUE],
  ] as const)('on %s, every point range and choice agrees with the plane it makes', (_, shape) => {
    const choices = boxThroughLineChoices(shape as never);
    for (const face of Object.keys(BOX_FACES) as BoxFace[]) {
      expect((choices[face] ?? []).length).toBeGreaterThan(0);
      for (const line of boxFaceLines(boxTopologyOf(shape as never), face)) {
        const offered = (choices[face] ?? []).find((choice) => choice.line.join('') === line.join(''));
        const bounds = boxLineAngleBounds(shape as never, SCALE, face, line, 'proportional');
        expect(offered !== undefined).toBe(bounds !== null);
        for (const edge of boxPointEdges(boxTopologyOf(shape as never), face)) {
          const range = boxPointRange(shape as never, SCALE, face, line, edge, 'proportional');
          const samples = Array.from({ length: 101 }, (_, percent) => percent);
          for (const percent of samples) {
            if (range !== null && Math.min(Math.abs(percent - range.min), Math.abs(percent - range.max)) < 0.05) continue;
            expect(usable(shape, face, line, edge, percent)).toBe(range !== null && inPointRange(range, percent));
          }
          const listed = offered?.pointEdges.some((other) => other.join('') === edge.join('')) ?? false;
          expect(listed).toBe(range !== null);
        }
      }
    }
  });
});

const TRIANGLES = 4;

/** Each node's surface vertices where the preview shows them: glTF metres, through the node's own world matrix. */
async function shownVertices(glb: Uint8Array): Promise<Map<string, Vec3[]>> {
  const root = (await new WebIO().readBinary(glb)).getRoot();
  const shown = new Map<string, Vec3[]>();
  for (const node of root.listNodes()) {
    const matrix = node.getWorldMatrix();
    const points: Vec3[] = [];
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const positions = primitive.getAttribute('POSITION');
      // The surface only: the outlines are lifted off it, see EDGE_LIFT_RELATIVE.
      if (positions === null || primitive.getMode() !== TRIANGLES) continue;
      for (let index = 0; index < positions.getCount(); index += 1) {
        const [x, y, z] = positions.getElement(index, [0, 0, 0]) as unknown as Vec3;
        points.push(
          [0, 1, 2].map((row) => {
            const at = (column: number) => matrix[column * 4 + row] as number;
            return at(0) * x + at(1) * y + at(2) * z + at(3);
          }) as unknown as Vec3,
        );
      }
    }
    shown.set(node.getName(), points);
  }
  return shown;
}

describe('vertex labels on the preview’s own geometry', () => {
  // A float32 vertex of a model some 0.1 m across, in metres.
  const SHOWN_MATCH_M = 1e-6;
  const cases = [
    [
      'a strongly unequal cuboid, one plane parallel to a side face',
      { kind: 'cuboid', widthRatio: 0.25, heightRatio: 3 },
      { type: 'face-parallel', face: 'BCC1B1', positionPercent: 30 },
      undefined,
    ],
    [
      'a parallelepiped leaning along both horizontal axes, through AC and the midpoint of B1C1, with a dovetail',
      { kind: 'parallelepiped', baseSideRatio: 0.6, heightRatio: 0.9, baseAngleDeg: 70, offsetXRatio: 0.5, offsetYRatio: -0.4 },
      { type: 'through-line', face: 'ABCD', line: ['A', 'C'], method: 'point', pointEdge: ['B1', 'C1'], pointPercent: 50 },
      { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 40, clearanceMm: 0.2 },
    ],
    [
      'the same parallelepiped, two planes perpendicular to AC1, with magnets',
      { kind: 'parallelepiped', baseSideRatio: 0.6, heightRatio: 0.9, baseAngleDeg: 70, offsetXRatio: 0.5, offsetYRatio: -0.4 },
      {
        type: 'inclined',
        inclinationDeg: 0,
        directionDeg: 0,
        normalAlong: ['A', 'C1'],
        positionPercent: 30,
        secondPositionPercent: 70,
      },
      { type: 'magnet', ...DEFAULT_MAGNET, count: 1 },
    ],
    [
      'the cube by two diagonal planes through BD, at 50 % and 70 %',
      CUBE,
      { type: 'longitudinal', trace: 'BD', traceAngleDeg: 0, positionPercent: 50, secondPositionPercent: 70 },
      undefined,
    ],
    [
      'an oblique triangular prism by two planes perpendicular to its lateral edges',
      { kind: 'prism', baseType: 'regular', baseSides: 3, heightRatio: 1.5, offsetXRatio: 0.6, offsetYRatio: -0.3 },
      {
        type: 'inclined',
        inclinationDeg: 0,
        directionDeg: 0,
        normalAlong: ['A', 'A1'],
        positionPercent: 35,
        secondPositionPercent: 65,
      },
      { type: 'magnet', ...DEFAULT_MAGNET, count: 1 },
    ],
    [
      'a hexagonal prism through its longer diagonal AD, which holds four of its vertices',
      { kind: 'prism', baseType: 'regular', baseSides: 6, heightRatio: 1, offsetXRatio: 0, offsetYRatio: 0 },
      { type: 'longitudinal', trace: 'diagonal', traceSegment: ['A', 'D'], through: true, traceAngleDeg: 0, positionPercent: 50 },
      undefined,
    ],
    [
      'the cube’s diagonal section through four of its vertices',
      CUBE,
      { type: 'longitudinal', trace: 'AC', traceAngleDeg: 0, positionPercent: 50 },
      undefined,
    ],
    [
      'the cube by two planes through its vertices: B, D, A1 and C, A1, B1',
      CUBE,
      {
        type: 'inclined',
        inclinationDeg: 0,
        directionDeg: 0,
        normalAlong: ['A', 'C1'],
        positionPercent: 100 / 3,
        secondPositionPercent: 200 / 3,
      },
      undefined,
    ],
  ] as const;

  it.each(cases)('%s: each label at its vertex, on each part that keeps it', async (_, shape, section, connector) => {
    const artifacts = await buildModelArtifacts(kernel, spec(shape as never, section, connector as Connector | undefined));
    const { model } = artifacts;
    const corners = boxVertices(model.spec.shape as never, SCALE);
    const views = [
      [artifacts.previewGlb, artifacts.vertexLabels],
      [artifacts.separatedPreviewGlb as Uint8Array, artifacts.separatedVertexLabels],
    ] as const;
    for (const [glb, labels] of views) {
      const shown = await shownVertices(glb);
      const root = (await new WebIO().readBinary(glb)).getRoot();
      const nodeOf = (part: string) => {
        const name = model.solids.find((solid) => solid.part === part)?.name as string;
        return { points: shown.get(name) ?? [], node: root.listNodes().find((node) => node.getName() === name) };
      };
      const near = (points: readonly Vec3[], point: Vec3) => points.some((other) => distance(other, point) <= SHOWN_MATCH_M);
      for (const label of labels ?? []) {
        expect(label.parts.length).toBeGreaterThan(0);
        for (const part of label.parts) {
          const { points, node } = nodeOf(part);
          // The label's anchor is a vertex of its part as shown, and it is that very vertex: the named corner of the solid,
          // moved by the part's node once.
          expect(near(points, label.position)).toBe(true);
          const [x, y, z] = corners[label.name as BoxVertex];
          const translation = node?.getTranslation() ?? [0, 0, 0];
          const expected: Vec3 = [x / 1000 + translation[0], z / 1000 + translation[1], -y / 1000 + translation[2]];
          expect(distance(label.position, expected)).toBeLessThan(1e-12);
        }
      }
      // Every corner that a part shows has its label there, once.
      for (const solid of model.solids.filter((solid) => solid.part !== 'dowel')) {
        const { points, node } = nodeOf(solid.part as string);
        const translation = node?.getTranslation() ?? [0, 0, 0];
        for (const vertex of topologyOf(corners).vertices) {
          const [x, y, z] = corners[vertex];
          const at: Vec3 = [x / 1000 + translation[0], z / 1000 + translation[1], -y / 1000 + translation[2]];
          if (!near(points, at)) continue;
          const named = (labels ?? []).filter((label) => label.name === vertex && distance(label.position, at) <= SHOWN_MATCH_M);
          expect(named).toHaveLength(1);
          expect(named[0]?.parts).toContain(solid.part);
        }
      }
    }
    // Assembled, the copies coincide: one label per vertex.
    expect((artifacts.vertexLabels ?? []).map((label) => label.name)).toEqual([...topologyOf(corners).vertices]);
  });

  it('shows a vertex on the plane on both parts apart, with its cut face, and once in the assembled cube', async () => {
    const artifacts = await buildModelArtifacts(
      kernel,
      spec(CUBE, { type: 'longitudinal', trace: 'AC', traceAngleDeg: 0, positionPercent: 50 }),
    );
    const copies = (artifacts.separatedVertexLabels ?? []).filter((label) => label.name === 'A');
    expect(copies.map((label) => label.parts)).toEqual([['part-1'], ['part-2']]);
    expect(distance(copies[0]?.position as Vec3, copies[1]?.position as Vec3)).toBeGreaterThan(0.001);
    // Each copy faces the base, the side face its part keeps, and the cut face; the cube's diagonal plane is vertical.
    for (const copy of copies) expect(copy.faceNormals).toHaveLength(3);
    const assembled = (artifacts.vertexLabels ?? []).filter((label) => label.name === 'A');
    expect(assembled).toHaveLength(1);
    expect(assembled[0]?.parts).toEqual(['part-1', 'part-2']);
    expect(assembled[0]?.faceNormals).toHaveLength(3);
  });
});

describe('three parts of two parallel planes, moved apart in their order', () => {
  const OBLIQUE_BOTH = {
    kind: 'parallelepiped',
    baseSideRatio: 0.6,
    heightRatio: 0.9,
    baseAngleDeg: 70,
    offsetXRatio: 0.5,
    offsetYRatio: -0.4,
  } as const;
  const cases = [
    [
      'the cube through BD, the second plane at 70 %',
      CUBE,
      { type: 'longitudinal', trace: 'BD', traceAngleDeg: 0, positionPercent: 50, secondPositionPercent: 70 },
    ],
    [
      'the cube through BD, the second plane at 30 %',
      CUBE,
      { type: 'longitudinal', trace: 'BD', traceAngleDeg: 0, positionPercent: 50, secondPositionPercent: 30 },
    ],
    [
      'a cuboid by two horizontal planes',
      { kind: 'cuboid', widthRatio: 0.25, heightRatio: 3 },
      { type: 'face-parallel', face: 'ABCD', positionPercent: 70, secondPositionPercent: 30 },
    ],
    [
      'an oblique parallelepiped by two inclined planes',
      OBLIQUE_BOTH,
      { type: 'inclined', inclinationDeg: 35, directionDeg: 120, positionPercent: 40, secondPositionPercent: 75 },
    ],
    [
      'an oblique parallelepiped parallel to a side face',
      OBLIQUE_BOTH,
      { type: 'face-parallel', face: 'BCC1B1', positionPercent: 60, secondPositionPercent: 25 },
    ],
  ] as const;

  it.each(cases)('%s: the middle part stays, both interfaces open, and assembled nothing moves', async (_, shape, section) => {
    const artifacts = await buildModelArtifacts(kernel, spec(shape as BoxShapeInput, section));
    const { model } = artifacts;
    const lower = model.section?.plane as { normal: Vec3; offset: number };
    const upper = model.section?.secondInterface?.plane as { normal: Vec3; offset: number };
    const n = lower.normal;
    expect(upper.offset).toBeGreaterThan(lower.offset);
    const along = (point: Vec3) => n[0] * point[0] + n[1] * point[1] + n[2] * point[2];
    const order = ['lower', 'middle', 'upper'].map((place) =>
      model.solids.find((solid) =>
        place === 'middle'
          ? solid.part === 'middle'
          : place === 'lower'
            ? solid.part === 'lower' || solid.part === 'part-1'
            : solid.part === 'upper' || solid.part === 'part-2',
      ),
    ) as Solid[];
    // The cut's own order: each part lies between the planes that bound it.
    const span = (solid: Solid) => {
      const values = vertices(solid.mesh).map(along);
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    expect(span(order[0] as Solid).max).toBeLessThan(lower.offset + POSITION_TOLERANCE_MM);
    expect(span(order[1] as Solid).min).toBeGreaterThan(lower.offset - POSITION_TOLERANCE_MM);
    expect(span(order[1] as Solid).max).toBeLessThan(upper.offset + POSITION_TOLERANCE_MM);
    expect(span(order[2] as Solid).min).toBeGreaterThan(upper.offset - POSITION_TOLERANCE_MM);
    // Apart: −g·n, 0 and +g·n in glTF metres, and each interface open by the gap, measured on the parts as shown.
    const shown = await shownVertices(artifacts.separatedPreviewGlb as Uint8Array);
    const nGltf: Vec3 = [n[0], n[2], -n[1]];
    const shownSpan = (solid: Solid) => {
      const values = (shown.get(solid.name) ?? []).map(
        (point) => 1000 * (nGltf[0] * point[0] + nGltf[1] * point[1] + nGltf[2] * point[2]),
      );
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    const gap = SECTION_PREVIEW_GAP_RELATIVE * Math.max(...model.size);
    const [first, middle, last] = order.map(shownSpan) as [
      { min: number; max: number },
      { min: number; max: number },
      { min: number; max: number },
    ];
    expect(middle.min - first.max).toBeCloseTo(gap, 3);
    expect(last.min - middle.max).toBeCloseTo(gap, 3);
    const root = (await new WebIO().readBinary(artifacts.separatedPreviewGlb as Uint8Array)).getRoot();
    const translation = (solid: Solid) =>
      root
        .listNodes()
        .find((node) => node.getName() === solid.name)
        ?.getTranslation() ?? [0, 0, 0];
    expect(translation(order[1] as Solid)).toEqual([0, 0, 0]);
    for (const [solid, sign] of [
      [order[0], -1],
      [order[2], 1],
    ] as const) {
      const t = translation(solid as Solid).map((value) => value * 1000);
      for (let axis = 0; axis < 3; axis += 1) expect(t[axis]).toBeCloseTo(sign * gap * (nGltf[axis] as number), 5);
    }
    const assembled = (await new WebIO().readBinary(artifacts.previewGlb)).getRoot();
    for (const node of assembled.listNodes()) expect(node.getTranslation()).toEqual([0, 0, 0]);
  });
});

describe('planes parallel to a face, by one face of each opposite pair', () => {
  it('groups each face with the one opposite it, and keeps the first of each pair', () => {
    expect(boxFaceOrientations(boxVertices(CUBE, SCALE))).toEqual({
      ABCD: 'ABCD',
      A1B1C1D1: 'ABCD',
      ABB1A1: 'ABB1A1',
      BCC1B1: 'BCC1B1',
      CDD1C1: 'ABB1A1',
      DAA1D1: 'BCC1B1',
    });
    expect(boxParallelFaces(boxVertices(OBLIQUE, SCALE))).toEqual(['ABCD', 'ABB1A1', 'BCC1B1']);
  });

  // Strongly oblique: the side faces' normals are far from the axes, and still each pair is the topology's.
  const LEANING = {
    kind: 'parallelepiped',
    baseSideRatio: 0.4,
    heightRatio: 0.5,
    baseAngleDeg: 35,
    offsetXRatio: 2,
    offsetYRatio: -1.5,
  } as const;
  it.each([
    ['the cube', CUBE],
    ['a cuboid', CUBOID],
    ['an oblique parallelepiped', OBLIQUE],
    ['a strongly oblique parallelepiped', LEANING],
  ] as const)('on %s, a position from the opposite face is the same plane from its representative', (_, shape) => {
    const vertices = boxVertices(shape as never, SCALE);
    const representatives = boxFaceOrientations(vertices);
    expect(boxParallelFaces(vertices)).toEqual(['ABCD', 'ABB1A1', 'BCC1B1']);
    for (const face of Object.keys(BOX_FACES) as BoxFace[]) {
      const representative = representatives[face] as BoxFace;
      if (representative === face) continue;
      for (const percent of [10, 23.7, 50, 90]) {
        const converted = boxFaceParallelPercent(shape as never, SCALE, face, percent, representative);
        expect(converted).toBeCloseTo(100 - percent, 9);
        const before = boxPlane(vertices, { type: 'face-parallel', face, positionPercent: percent });
        const after = boxPlane(vertices, { type: 'face-parallel', face: representative, positionPercent: converted });
        // n·x = d and n'·x = d' are one plane: n' = −n and d' = −d.
        expect(distance(after.normal, before.normal.map((value) => -value) as unknown as Vec3)).toBeLessThan(1e-12);
        expect(after.offset).toBeCloseTo(-before.offset, 9);
      }
    }
  });
});

describe('sections of the prisms, by the same modes', () => {
  const regular = (baseSides: 3 | 4 | 5 | 6 | 8, heightRatio = 1, offsetXRatio = 0, offsetYRatio = 0) =>
    ({ kind: 'prism', baseType: 'regular', baseSides, heightRatio, offsetXRatio, offsetYRatio }) as const;
  const TRIANGULAR = regular(3, 1.2);
  // Obtuse at A: the altitudes from B and C meet the extensions of the opposite sides.
  const OBTUSE = {
    kind: 'prism',
    baseType: 'triangle',
    baseSideRatio: 1.4,
    baseAngleDeg: 115,
    heightRatio: 1,
    offsetXRatio: 0.3,
    offsetYRatio: 0.2,
  } as const;
  const TRAPEZOID = {
    kind: 'prism',
    baseType: 'trapezoid',
    parallelSideRatio: 0.5,
    baseHeightRatio: 0.6,
    baseShiftRatio: 0.1,
    heightRatio: 1,
    offsetXRatio: 0,
    offsetYRatio: 0.3,
  } as const;
  const volumeOf = (shape: BoxShapeInput) =>
    generateModel(kernel, { shape, scale: SCALE }).solids[0]?.measurements.volume as number;
  const partVolumes = (model: GeneratedModel) =>
    model.solids
      .filter((solid) => solid.part !== 'dowel')
      .map((solid) => solid.measurements.volume / volumeOf(model.spec.shape as BoxShapeInput));
  const longitudinal = (fields: object) => ({
    type: 'longitudinal',
    traceAngleDeg: 0,
    positionPercent: 50,
    through: true,
    ...fields,
  });
  const baseArea = (shape: BoxShapeInput) => {
    const vertices = boxVertices(shape as never, SCALE);
    const base = boxTopologyOf(shape as never).faces[boxTopologyOf(shape as never).lowerBase] as BoxVertex[];
    return Math.abs(
      base.reduce((sum, name, index) => {
        const [x0, y0] = vertices[name];
        const [x1, y1] = vertices[base[(index + 1) % base.length] as BoxVertex];
        return sum + x0 * y1 - x1 * y0;
      }, 0) / 2,
    );
  };

  it.each([
    ['a triangular prism', regular(3), 4],
    ['a square prism', regular(4), 3],
    ['a pentagonal prism', regular(5, 1, 0.3, 0.2), 6],
    ['a hexagonal prism', regular(6), 4],
    ['an octagonal prism', regular(8), 5],
    ['a prism over a scalene triangle', OBTUSE, 4],
    ['a trapezoidal prism, whose bases’ parallel sides make one orientation', TRAPEZOID, 4],
  ] as const)('%s: one face of each orientation of its faces', (_, shape, count) => {
    const topology = boxTopologyOf(shape as never);
    expect(topology.vertices).toHaveLength(2 * topology.sides);
    expect(topology.edges).toHaveLength(3 * topology.sides);
    expect(topology.faceNames).toHaveLength(topology.sides + 2);
    const faces = boxParallelFaces(boxVertices(shape as never, SCALE));
    expect(faces).toHaveLength(count);
    expect(faces[0]).toBe(topology.lowerBase);
  });

  it.each([
    ['triangular', TRIANGULAR],
    ['pentagonal, oblique', regular(5, 1, 0.3, 0.2)],
    ['hexagonal', regular(6)],
    ['trapezoidal, oblique', TRAPEZOID],
  ] as const)('a plane parallel to the base of a %s prism is its base', (_, shape) => {
    const { model, section } = sectionOf(shape, { type: 'face-parallel', positionPercent: 35 });
    expect(section.contour).toHaveLength(boxTopologyOf(shape as never).sides);
    expect(section.area).toBeCloseTo(baseArea(shape), 6);
    expect(partVolumes(model)).toEqual([expect.closeTo(0.35, 6), expect.closeTo(0.65, 6)]);
    expectPartsOfWhole(model);
  });

  it('the median of an equilateral base from C: through CC1 and the midpoint of AB, halving the prism, as its altitude and bisector do', () => {
    const shape = TRIANGULAR;
    const vertices = boxVertices(shape, SCALE);
    const { model, section } = sectionOf(shape, longitudinal({ trace: 'median', traceVertex: 'C' }));
    const middle = vertices.A.map((value, axis) => (value + (vertices.B[axis] as number)) / 2) as unknown as Vec3;
    for (const point of [vertices.C, vertices.C1, middle]) {
      expect(Math.min(...section.contour.map((corner) => distance(corner, point)))).toBeLessThan(POSITION_TOLERANCE_MM);
    }
    expect(partVolumes(model)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)]);
    expectPartsOfWhole(model);
    const choices = boxTraceChoices(shape);
    expect(choices.sameLines.C).toEqual(['median', 'height', 'bisector']);
    for (const trace of ['height', 'bisector']) {
      expect(sectionOf(shape, longitudinal({ trace, traceVertex: 'C' })).section.area).toBeCloseTo(section.area, 6);
    }
  });

  it('the midline parallel to AB cuts off the prism over the triangle of C and the midpoints of CA and CB, a quarter', () => {
    const { model } = sectionOf(TRIANGULAR, longitudinal({ trace: 'midline', traceSegment: ['A', 'B'] }));
    expect(partVolumes(model).sort()).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.75, 6)]);
    expectPartsOfWhole(model);
  });

  it('on an obtuse base, the altitude from the obtuse vertex meets BC at right angles; those from B and C only touch the prism', () => {
    const vertices = boxVertices(OBTUSE, SCALE);
    const choices = boxTraceChoices(OBTUSE);
    expect(choices.height).toEqual(['A']);
    expect(choices.median).toEqual(['A', 'B', 'C']);
    expect(choices.bisector).toEqual(['A', 'B', 'C']);
    const plane = boxPlane(vertices, longitudinal({ trace: 'height', traceVertex: 'A' }) as BoxSectionSpec);
    const side = [0, 1, 2].map((axis) => (vertices.C[axis] as number) - (vertices.B[axis] as number)) as unknown as Vec3;
    const lateral = [0, 1, 2].map((axis) => (vertices.A1[axis] as number) - (vertices.A[axis] as number)) as unknown as Vec3;
    // The plane holds A and the lateral direction, and its trace is perpendicular to BC: n is along BC's projection.
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(plane.normal, vertices.A)).toBeCloseTo(plane.offset, 9);
    expect(dot(plane.normal, lateral)).toBeCloseTo(0, 9);
    expect(Math.abs(dot(plane.normal, [-side[1], side[0], 0]))).toBeLessThan(1e-9);
    // From B the line leaves the triangle at once: the plane holds BB1 and leaves the prism on one side.
    const touching = boxPlane(vertices, longitudinal({ trace: 'height', traceVertex: 'B' }) as BoxSectionSpec);
    expect(Math.min(touching.offset - touching.extent.min, touching.extent.max - touching.offset)).toBeLessThan(1e-9);
  });

  it('through AB and the midpoint of the opposite lateral edge CC1: the tetrahedron ABCM, a sixth of the prism', () => {
    const section = {
      type: 'through-line',
      face: 'ABC',
      line: ['A', 'B'],
      method: 'point',
      pointEdge: ['C', 'C1'],
      pointPercent: 50,
    };
    const smooth = generateModel(kernel, spec(TRIANGULAR, section));
    expect(partVolumes(smooth).sort()).toEqual([expect.closeTo(1 / 6, 6), expect.closeTo(5 / 6, 6)]);
    expectPartsOfWhole(smooth);
    const lines = boxThroughLineChoices(TRIANGULAR).ABC ?? [];
    expect(lines.map(({ line }) => line.join(''))).toEqual(['AB', 'BC', 'CA']);
    expect(lines[0]?.pointEdges.map((edge) => edge.join(''))).toEqual(['B1C1', 'C1A1', 'CC1']);
    const magnets = generateModel(kernel, spec(TRIANGULAR, section, { type: 'magnet', ...DEFAULT_MAGNET, count: 1 }));
    expectPartsOfWhole(magnets);
  });

  it('a lateral face’s diagonal AB1, by its angle: the plane holds A and B1 whatever the prism becomes', () => {
    expect(boxFaceLines(boxTopologyOf(TRIANGULAR), 'ABB1A1').map((line) => line.join(''))).toEqual([
      'AB',
      'BB1',
      'B1A1',
      'A1A',
      'AB1',
      'BA1',
    ]);
    expect(boxFaceLines(boxTopologyOf(TRIANGULAR), 'ABC').map((line) => line.join(''))).toEqual(['AB', 'BC', 'CA']);
    const section = { type: 'through-line', face: 'ABB1A1', line: ['A', 'B1'], method: 'angle', angleDeg: 50 } as const;
    for (const shape of [TRIANGULAR, regular(3, 2, 0.4, -0.3)]) {
      const vertices = boxVertices(shape, SCALE);
      const plane = boxPlane(vertices, section as BoxSectionSpec);
      for (const point of [vertices.A, vertices.B1]) {
        expect(plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2]).toBeCloseTo(plane.offset, 9);
      }
      expectPartsOfWhole(generateModel(kernel, spec(shape, section)));
    }
  });

  it('a regular hexagonal prism: the longer diagonal AD halves it, the shorter AC cuts off the prism over ABC, a sixth', () => {
    const hexagon = regular(6);
    const long = sectionOf(hexagon, longitudinal({ trace: 'diagonal', traceSegment: ['A', 'D'] }));
    expect(partVolumes(long.model)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)]);
    const short = sectionOf(hexagon, longitudinal({ trace: 'diagonal', traceSegment: ['A', 'C'] }));
    expect(partVolumes(short.model).sort()).toEqual([expect.closeTo(1 / 6, 6), expect.closeTo(5 / 6, 6)]);
    // Both through two lateral edges: rectangles of the prism's height.
    const height = boxVertices(hexagon, SCALE).A1[2];
    const vertices = boxVertices(hexagon, SCALE);
    expect(long.section.area).toBeCloseTo(distance(vertices.A, vertices.D) * height, 6);
    expect(short.section.area).toBeCloseTo(distance(vertices.A, vertices.C) * height, 6);
    expectPartsOfWhole(long.model);
    expectPartsOfWhole(short.model);
  });

  it('an inclined plane cuts a triangular prism in a pentagon, through both bases and every lateral face', () => {
    const { model, section } = sectionOf(regular(3, 1), {
      type: 'inclined',
      inclinationDeg: 50,
      directionDeg: 0,
      positionPercent: 50,
    });
    expect(section.contour).toHaveLength(5);
    expectPartsOfWhole(model);
  });

  it('an oblique prism: longitudinal planes stay along its lateral edges, n·a = 0, as it leans and grows', () => {
    for (const shape of [regular(5, 1, 0.3, 0.2), regular(5, 1.6, -0.5, 0.4), OBTUSE]) {
      const vertices = boxVertices(shape as never, SCALE);
      const lateral = [0, 1, 2].map((axis) => (vertices.A1[axis] as number) - (vertices.A[axis] as number)) as unknown as Vec3;
      const sections = [
        { type: 'longitudinal', trace: 'angle', traceAngleDeg: 35, positionPercent: 40 },
        ...(shape === OBTUSE
          ? [longitudinal({ trace: 'median', traceVertex: 'B' })]
          : [longitudinal({ trace: 'diagonal', traceSegment: ['B', 'E'] })]),
      ];
      for (const section of sections) {
        const plane = boxPlane(vertices, section as BoxSectionSpec);
        expect(plane.normal[0] * lateral[0] + plane.normal[1] * lateral[1] + plane.normal[2] * lateral[2]).toBeCloseTo(0, 9);
        expectPartsOfWhole(generateModel(kernel, spec(shape as BoxShapeInput, section)));
      }
    }
  });

  it('perpendicular to the lateral edges, n ∥ a: in the middle its area times the lateral edge is the volume; near an end it crosses a base', () => {
    const shape = regular(3, 1, 1.5, 0);
    const vertices = boxVertices(shape, SCALE);
    const lateral = distance(vertices.A1, vertices.A);
    const perpendicular = (positionPercent: number) =>
      sectionOf(shape, { type: 'inclined', inclinationDeg: 0, directionDeg: 0, normalAlong: ['A', 'A1'], positionPercent });
    const middle = perpendicular(50);
    expect(middle.section.contour).toHaveLength(3);
    expect(middle.section.area * lateral).toBeCloseTo(volumeOf(shape), 3);
    // Not the base's number of sides: a quadrilateral where the plane meets a base and two lateral edges.
    const end = perpendicular(25);
    expect(end.section.contour).toHaveLength(4);
    expectPartsOfWhole(middle.model);
    expectPartsOfWhole(end.model);
  });

  it('two parallel planes of an oblique triangular prism with magnets: three closed parts of the whole, both interfaces fitted', () => {
    const model = generateModel(
      kernel,
      spec(
        regular(3, 1.2, 0.3, -0.2),
        { type: 'face-parallel', face: 'BCC1B1', positionPercent: 30, secondPositionPercent: 70 },
        { type: 'magnet', ...DEFAULT_MAGNET, count: 1 },
      ),
    );
    expect(model.solids.map((solid) => solid.part)).toEqual(['part-1', 'middle', 'part-2']);
    expect(model.section?.connector).toBeDefined();
    expect(model.section?.secondInterface?.connector).toBeDefined();
    expectPartsOfWhole(model);
  });

  it('a square prism of the cube’s proportions is the cube: the same vertices, and the same parts for the same sections', () => {
    const square = regular(4, 1);
    const [prism, cube] = [boxVertices(square, SCALE), boxVertices(CUBE, SCALE)];
    for (const vertex of boxTopologyOf(CUBE).vertices) expect(distance(prism[vertex], cube[vertex])).toBeLessThan(1e-9);
    for (const section of [
      { type: 'through-line', face: 'ABCD', line: ['A', 'C'], method: 'point', pointEdge: ['B1', 'C1'], pointPercent: 50 },
      { type: 'inclined', inclinationDeg: 0, directionDeg: 0, normalAlong: ['A', 'C1'], positionPercent: 30 },
      longitudinal({ trace: 'diagonal', traceSegment: ['B', 'D'] }),
    ]) {
      const [a, b] = [generateModel(kernel, spec(square, section)), generateModel(kernel, spec(CUBE, section))];
      expect(a.solids.map((solid) => solid.measurements.volume)).toEqual(
        b.solids.map((solid) => expect.closeTo(solid.measurements.volume, 6)),
      );
    }
  });

  it('refuses a face, a trace or a segment that the prism does not have', () => {
    for (const section of [
      { type: 'face-parallel', face: 'ABCD', positionPercent: 50 },
      longitudinal({ trace: 'diagonal', traceSegment: ['A', 'C'] }),
      { type: 'inclined', inclinationDeg: 0, directionDeg: 0, normalAlong: ['A', 'D1'], positionPercent: 50 },
      { type: 'through-line', face: 'ABC', line: ['A', 'C1'], method: 'angle', angleDeg: 30 },
    ]) {
      expect(() => generateModel(kernel, spec(TRIANGULAR, section))).toThrow(InvalidModelSpecError);
    }
    expect(() => generateModel(kernel, spec(regular(6), longitudinal({ trace: 'median', traceVertex: 'A' })))).toThrow(
      InvalidModelSpecError,
    );
  });
});
