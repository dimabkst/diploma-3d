import { type ConeShape, type CylinderShape, DEFAULT_MAGNET, type ModelSpecInput, type Section } from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import {
  axialApexAngles,
  axisParallelCylinderSection,
  axisParallelOffsetLimitPercent,
  coneApexAngleBounds,
  coneObliqueSection,
} from './connectors/frame.ts';
import { ConnectorUnsuitableError, InvalidModelSpecError } from './errors.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { dot, findMeshDefects, type TriangleMesh, type Vec3 } from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type Solid } from './model.ts';
import { type Track, withScope } from './scope.ts';
import { roundDimensionsMm } from './shapes/round.ts';

const kernel = await loadGeometryKernel();
const M80 = { longestDimensionMm: 80 };
const cone = (heightRatio: number, offsetRatio: number): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
const cylinder = (heightRatio: number, offsetRatio: number): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
type Connector = NonNullable<Section['connector']>;

const specOf = (shape: ConeShape | CylinderShape, section: Section, scale = M80): ModelSpecInput => ({ shape, scale, section });
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const FLOAT32_CONTACT_MM3 = 0.02;

/** The model's two parts are closed, connected and apart, and together they are the whole solid. */
function expectTwoClosedParts(model: GeneratedModel, shape: ConeShape | CylinderShape) {
  const parts = model.solids.filter((solid) => solid.part === 'part-1' || solid.part === 'part-2');
  expect(parts).toHaveLength(2);
  const whole = generateModel(kernel, { shape, scale: model.spec.scale }).solids[0] as Solid;
  for (const part of parts) {
    expect(findMeshDefects(part.mesh)).toEqual([]);
    expect(part.measurements.volume).toBeGreaterThan(0);
  }
  withScope((track) => {
    const [a, b] = parts.map((part) => manifoldOf(track, part.mesh)) as [Manifold, Manifold];
    for (const piece of [a, b]) expect(piece.decompose().map(track)).toHaveLength(1);
    expect(track(a.intersect(b)).volume()).toBeLessThan(FLOAT32_CONTACT_MM3);
  });
  const total = parts.reduce((sum, part) => sum + part.measurements.volume, 0);
  expect(total / whole.measurements.volume).toBeCloseTo(1, 6);
}

/** The apex A and the base's centre C of a cone in millimetres, C at the origin. */
const apexOf = (shape: ConeShape, scale = M80): Vec3 => {
  const { height, offset } = roundDimensionsMm(shape, scale);
  return [offset, 0, height];
};

describe('a plane through a cone’s apex', () => {
  const cones = [cone(2, 0), cone(1, 0.7), cone(3, 1.5), cone(2, 0.4)];

  it('holds the actual apex for every cone, angle and direction: d = n·A', () => {
    for (const shape of cones) {
      for (const directionDeg of [0, 45, 90, 180, 250]) {
        const bounds = coneApexAngleBounds(shape, M80, directionDeg);
        if (bounds === null) continue;
        const section = coneObliqueSection(shape, M80, { inclinationDeg: (bounds.min + bounds.max) / 2, directionDeg });
        expect(dot(section.plane.normal, apexOf(shape)) - section.plane.offset).toBeCloseTo(0, 9);
      }
    }
  });

  it('cuts two closed parts of the whole cone', () => {
    const shape = cone(1, 0.7);
    const bounds = coneApexAngleBounds(shape, M80, 45) as { min: number; max: number };
    const model = generateModel(
      kernel,
      specOf(shape, { type: 'oblique-apex', inclinationDeg: (bounds.min + bounds.max) / 2, directionDeg: 45 }),
    );
    expectTwoClosedParts(model, shape);
  });
});

describe('the axial section of a cone', () => {
  it('holds the apex and the base’s centre, also where the cone leans and the plane is not vertical', () => {
    for (const shape of [cone(2, 0), cone(1, 0.7), cone(3, 1.5), cone(2, 0.4)]) {
      for (const directionDeg of [0, 60, 90, 150, 200, 270, 330]) {
        // The stored angle is whatever was last derived; the engine derives it anew from the cone it builds.
        const model = generateModel(
          kernel,
          specOf(shape, { type: 'oblique-apex', inclinationDeg: 30, directionDeg, axial: true }),
        );
        const { normal, offset } = (model.section as ModelSection).plane;
        expect(dot(normal, apexOf(shape)) - offset).toBeCloseTo(0, 9);
        expect(dot(normal, [0, 0, 0]) - offset).toBeCloseTo(0, 9);
        expect(model.spec.section).toMatchObject({ axial: true, ...axialApexAngles(shape, directionDeg) });
        // Across the lean, or for a right cone, the axial plane is vertical; along the lean of a leaning cone it is not.
        const across = Math.abs(Math.cos((directionDeg * Math.PI) / 180)) < 1e-9;
        if (shape.offsetRatio === 0 || across) expect(normal[2]).toBeCloseTo(0, 9);
        else expect(Math.abs(normal[2])).toBeGreaterThan(1e-3);
      }
    }
  });

  it('stays axial when the cone changes, at any size', () => {
    const section: Section = { type: 'oblique-apex', inclinationDeg: 80, directionDeg: 20, axial: true };
    for (const [shape, longestDimensionMm] of [
      [cone(1, 0.5), 60],
      [cone(2.5, 1.2), 80],
      [cone(1.5, 0.9), 140],
    ] as const) {
      const scale = { longestDimensionMm };
      const model = generateModel(kernel, specOf(shape, section, scale));
      const { normal, offset } = (model.section as ModelSection).plane;
      expect(dot(normal, apexOf(shape, scale)) - offset).toBeCloseTo(0, 9);
      expect(offset).toBeCloseTo(0, 9);
      expectTwoClosedParts(model, shape);
    }
  });

  it('takes the connectors on its triangle, and says where they cannot fit near the apex', () => {
    const shape = cone(1, 0.7);
    const section = (connector: Connector): Section => ({
      type: 'oblique-apex',
      inclinationDeg: 45,
      directionDeg: 60,
      axial: true,
      connector,
    });
    const magnets = generateModel(kernel, specOf(shape, section({ type: 'magnet', ...DEFAULT_MAGNET })));
    expect(magnets.solids.map((solid) => solid.part)).toEqual(['part-1', 'part-2']);
    // At 30 mm the triangle is too small for three 15 mm magnets: refused, with the reason, nothing silently dropped.
    expect(() =>
      generateModel(
        kernel,
        specOf(shape, section({ type: 'magnet', ...DEFAULT_MAGNET, magnetDiameterMm: 15 }), { longestDimensionMm: 30 }),
      ),
    ).toThrow(ConnectorUnsuitableError);
  });
});

describe('a cylinder’s plane parallel to its axis', () => {
  const shapes = [cylinder(1.5, 0), cylinder(1.5, 0.8), cylinder(2.5, 1.2)];
  const axisOf = (shape: CylinderShape, scale = M80): Vec3 => {
    const { height, offset } = roundDimensionsMm(shape, scale);
    return [offset, 0, height];
  };

  it('keeps n·a = 0 whatever the lean and the direction, and at offset zero holds both base centres', () => {
    for (const shape of shapes) {
      for (const offsetDirectionDeg of [0, 30, 90, 135, 220]) {
        const axial = axisParallelCylinderSection(shape, M80, { offsetPercent: 0, offsetDirectionDeg });
        const moved = axisParallelCylinderSection(shape, M80, { offsetPercent: 40, offsetDirectionDeg });
        const a = axisOf(shape);
        expect(dot(axial.plane.normal, a)).toBeCloseTo(0, 9);
        expect(axial.plane.offset).toBeCloseTo(0, 9);
        expect(dot(axial.plane.normal, a) - axial.plane.offset).toBeCloseTo(0, 9);
        // Moving away from the axis keeps the orientation.
        expect(moved.plane.normal).toEqual(axial.plane.normal);
        expect(moved.plane.offset).toBeGreaterThan(0);
        // The section is the base chord swept along a: a rectangle for a right cylinder, a parallelogram otherwise.
        const [p0, p1, p2, p3] = moved.contour as [Vec3, Vec3, Vec3, Vec3];
        expect(moved.contour).toHaveLength(4);
        const sides = [
          [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
          [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]],
        ] as [Vec3, Vec3];
        const slanted = sides.find((side) => Math.abs(side[2]) > 1) as Vec3;
        const chord = sides.find((side) => Math.abs(side[2]) <= 1e-9) as Vec3;
        const length = Math.hypot(...slanted);
        const axisLength = Math.hypot(...a);
        expect(Math.abs(dot(slanted, a)) / (length * axisLength)).toBeCloseTo(1, 9);
        if (shape.offsetRatio === 0) expect(dot(chord, slanted)).toBeCloseTo(0, 6);
        // Opposite sides are equal and parallel.
        expect(p3[0] - p0[0]).toBeCloseTo(p2[0] - p1[0], 6);
        expect(p3[2] - p0[2]).toBeCloseTo(p2[2] - p1[2], 6);
      }
    }
  });

  it('cuts two closed parts of the whole, and refuses an offset beyond the usable range', () => {
    const shape = cylinder(1.5, 0.8);
    const limit = axisParallelOffsetLimitPercent(shape, M80, 45);
    expect(limit).toBeGreaterThan(50);
    expectTwoClosedParts(
      generateModel(kernel, specOf(shape, { type: 'axis-parallel', offsetPercent: 40, directionDeg: 45 })),
      shape,
    );
    expect(() =>
      generateModel(kernel, specOf(shape, { type: 'axis-parallel', offsetPercent: limit, directionDeg: 45 })),
    ).not.toThrow();
    expect(() =>
      generateModel(kernel, specOf(shape, { type: 'axis-parallel', offsetPercent: limit + 0.5, directionDeg: 45 })),
    ).toThrow(InvalidModelSpecError);
  });

  it('stays parallel to the axis, and axial, when the cylinder changes', () => {
    const section: Section = { type: 'axis-parallel', offsetPercent: 0, directionDeg: 30 };
    for (const shape of [cylinder(1, 0.3), cylinder(2, 1.1), cylinder(3, 0.7)]) {
      const model = generateModel(kernel, specOf(shape, section));
      const { normal, offset } = (model.section as ModelSection).plane;
      expect(dot(normal, axisOf(shape))).toBeCloseTo(0, 9);
      expect(offset).toBeCloseTo(0, 9);
    }
  });

  it('the vertical cut stays vertical, perpendicular to the base plane, for every lean', () => {
    for (const shape of shapes) {
      const model = generateModel(kernel, specOf(shape, { type: 'vertical', offsetPercent: 30 }));
      expect((model.section as ModelSection).plane.normal[2]).toBe(0);
    }
  });

  it('takes every connector, and exports both parts with what joins them', async () => {
    const shape = cylinder(1.5, 0.8);
    for (const connector of [
      { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 40, clearanceMm: 0.2 },
      { type: 'magnet', ...DEFAULT_MAGNET },
    ] as const) {
      const model = generateModel(
        kernel,
        specOf(shape, { type: 'axis-parallel', offsetPercent: 30, directionDeg: 120, connector }),
      );
      expect(model.solids.map((solid) => solid.part)).toEqual(['part-1', 'part-2']);
    }
    const dowel: Connector = {
      type: 'dowel',
      count: 1,
      profile: 'circle',
      diameterFactor: 1,
      depthFactor: 1,
      lowerClearanceMm: 0.3,
      upperClearanceMm: 0.5,
    };
    const artifacts = await buildModelArtifacts(
      kernel,
      specOf(shape, { type: 'axis-parallel', offsetPercent: 0, directionDeg: 90, connector: dowel }),
    );
    expect(readThreeMf(artifacts.printFile.bytes).model.objects.map((object) => object.name)).toEqual([
      'cylinder-part-1',
      'cylinder-part-2',
      'cylinder-dowel-1',
    ]);
    expect(artifacts.printFile.fileName).toBe('cylinder-axis-parallel-section.3mf');
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.section).toEqual({ type: 'axis-parallel', offsetPercent: 0, directionDeg: 90 });
    // Too deep a magnet for a thin part near the outer surface: refused, said why, never dropped.
    expect(() =>
      generateModel(
        kernel,
        specOf(shape, {
          type: 'axis-parallel',
          offsetPercent: 70,
          directionDeg: 90,
          connector: { type: 'magnet', ...DEFAULT_MAGNET, magnetThicknessMm: 8 },
        }),
      ),
    ).toThrow(ConnectorUnsuitableError);
  });
});
