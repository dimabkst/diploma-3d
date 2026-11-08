import type { ConeShape, Connector, DovetailConnector, DowelConnector, PlugConnector } from '@diploma-3d/schema';
import { DEFAULT_DOVETAIL } from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Vec3 as KernelVec3, Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts, previewSeparation } from '../artifacts.ts';
import { ConnectorUnsuitableError, InvalidModelSpecError } from '../errors.ts';
import { toGltfPosition } from '../export/glb.ts';
import { readThreeMf } from '../export/three-mf.test-helper.ts';
import { type GeometryKernel, loadGeometryKernel } from '../kernel.ts';
import {
  cross,
  dot,
  findMeshDefects,
  measureMesh,
  subtract,
  type TriangleMesh,
  triangleAreaVector,
  triangleAt,
  triangleCount,
  type Vec3,
  vertexAt,
  vertexCount,
} from '../mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type Solid } from '../model.ts';
import { type Track, withScope } from '../scope.ts';
import { splitByPlane } from '../section.ts';
import { buildRoundSolid, circularSegments, roundDimensionsMm } from '../shapes/round.ts';
import { hasFeasibleValues } from './bounds.ts';
import { type DovetailPlan, dovetailFeasibility, grooveCutter, planDovetail } from './dovetail.ts';
import {
  type ApexCut,
  apexChordCrossesBase,
  coneApexAngleBounds,
  coneApexChord,
  coneObliqueSection,
  isApexChordUsable,
  type ObliqueCut,
  obliqueAxes,
  obliquePlaneContainsAxis,
  obliqueSplitReach,
  satisfies,
} from './frame.ts';
import {
  buildRoundConnectors,
  planRoundConnectors,
  ROUND_CONNECTOR_PROPORTIONS,
  type RoundConnectorParameter,
  roundConnectorChecks,
  roundConnectorDimensions,
  roundConnectorFeasibility,
} from './round.ts';

const kernel: GeometryKernel = await loadGeometryKernel();

const M = 80;
const scale = { longestDimensionMm: M } as const;
const VOLUME_TOLERANCE = 1e-3;
const COPLANAR_NOISE_MM3 = 0.02;
const Z: Vec3 = [0, 0, 1];

const cone = (heightRatio: number, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
const apex = (inclinationDeg: number, directionDeg = 0): ApexCut => ({ inclinationDeg, directionDeg });
const point = (positionPercent = 50, inclinationDeg = 45, directionDeg = 0): ObliqueCut => ({
  positionPercent,
  inclinationDeg,
  directionDeg,
});
const pair = (count: 1 | 2, spacingPercent = 30) => (count === 2 ? { count, spacingPercent } : { count });
const plug = (count: 1 | 2 = 1, overrides: Partial<PlugConnector> = {}): PlugConnector =>
  ({ type: 'plug', diameterFactor: 1, depthFactor: 1, holeClearanceMm: 0.2, ...pair(count), ...overrides }) as PlugConnector;
const dowel = (count: 1 | 2 = 1, overrides: Partial<DowelConnector> = {}): DowelConnector =>
  ({
    type: 'dowel',
    diameterFactor: 1,
    depthFactor: 1,
    lowerClearanceMm: 0.1,
    upperClearanceMm: 0.2,
    ...pair(count),
    ...overrides,
  }) as DowelConnector;
const dovetail = (overrides: Partial<DovetailConnector> = {}): DovetailConnector => ({
  type: 'dovetail',
  ...DEFAULT_DOVETAIL,
  lengthPercent: 25,
  ...overrides,
});

type Cut = ApexCut | ObliqueCut;
const specOf = (shape: ConeShape, cut: Cut, connector?: Connector, longestDimensionMm = M) => ({
  shape,
  scale: { longestDimensionMm },
  section: {
    type: 'positionPercent' in cut ? 'oblique' : 'oblique-apex',
    ...cut,
    ...(connector === undefined ? {} : { connector }),
  } as never,
});
const build = (shape: ConeShape, cut: Cut, connector?: Connector, longest = M): GeneratedModel =>
  generateModel(kernel, specOf(shape, cut, connector, longest));

const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const hasMaterialAt = (track: Track, solid: Manifold, at: Vec3, side = 0.1): boolean =>
  track(solid.intersect(track(track(kernel.Manifold.cube([side, side, side], true)).translate([...at] as KernelVec3)))).volume() >
  0.9 * side ** 3;
const add = (a: Vec3, b: Vec3, factor = 1): Vec3 => [a[0] + factor * b[0], a[1] + factor * b[1], a[2] + factor * b[2]];
const scaled = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor];
const partsOf = (model: GeneratedModel) => {
  const [a, b, ...pins] = model.solids as [Solid, Solid, ...Solid[]];
  expect([a.part, b.part]).toEqual(['part-1', 'part-2']);
  return { a, b, pins };
};
const pieces = (track: Track, mesh: TriangleMesh) => {
  const parts = manifoldOf(track, mesh).decompose();
  for (const part of parts) track(part);
  return parts.length;
};
const triangleArea = (mesh: TriangleMesh, triangle: number) => Math.hypot(...triangleAreaVector(mesh, triangle)) / 2;
const corners = (mesh: TriangleMesh, triangle: number) => triangleAt(mesh, triangle).map((vertex) => vertexAt(mesh, vertex));

function capOf({ mesh, newFaces }: Solid) {
  let area = 0;
  let centroid: Vec3 = [0, 0, 0];
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    if (newFaces?.[triangle] !== 1) continue;
    const [a, b, c] = corners(mesh, triangle) as [Vec3, Vec3, Vec3];
    const size = triangleArea(mesh, triangle);
    area += size;
    centroid = add(centroid, scaled(add(add(a, b), c), size / 3));
  }
  return { area, centroid: scaled(centroid, 1 / area) };
}

const areaOnBed = (mesh: TriangleMesh) => {
  let area = 0;
  for (let triangle = 0; triangle < triangleCount(mesh); triangle += 1) {
    if (corners(mesh, triangle).every(([, , z]) => Math.abs(z) < 1e-3)) area += triangleArea(mesh, triangle);
  }
  return area;
};

/** The base polygon's area on the negative side of the plane's trace on z = 0: the clipped polygon, by the shoelace formula. */
function basePolygonShare(radius: number, cut: ApexCut, chordOffset: number): number {
  const segments = circularSegments(radius);
  const { u } = obliqueAxes(0, cut.directionDeg);
  const corner = (index: number): [number, number] => {
    const angle = (2 * Math.PI * index) / segments;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  };
  // n·x ≤ n·A on the base means q·x ≥ δ, with n = −sin α·q + cos α·Z.
  const side = ([x, y]: [number, number]) => x * u[0] + y * u[1] - chordOffset;
  const clipped: [number, number][] = [];
  for (let index = 0; index < segments; index += 1) {
    const [p, r] = [corner(index), corner(index + 1)];
    if (side(p) >= 0) clipped.push(p);
    if (side(p) >= 0 !== side(r) >= 0) {
      const share = side(p) / (side(p) - side(r));
      clipped.push([p[0] + share * (r[0] - p[0]), p[1] + share * (r[1] - p[1])]);
    }
  }
  const area = (polygon: readonly [number, number][]) =>
    polygon.reduce((sum, [x0, y0], index) => {
      const [x1, y1] = polygon[(index + 1) % polygon.length] as [number, number];
      return sum + (x0 * y1 - x1 * y0) / 2;
    }, 0);
  return area(clipped) / area(Array.from({ length: segments }, (_, index) => corner(index)));
}

const FEASIBLE_APEX: readonly (readonly [string, ConeShape, ApexCut])[] = [
  ['a right cone at 75°', cone(2), apex(75)],
  ['a right cone at 90°', cone(2), apex(90)],
  ['a turned plane of a right cone', cone(2), apex(80, 130)],
  ['an oblique cone along its lean', cone(2, 1), apex(65)],
  ['an oblique cone across its lean', cone(2, 1), apex(80, 90)],
  ['a cone with its apex beyond the base', cone(4, 3), apex(55)],
];
const AXIS_CUTS: readonly (readonly [string, ConeShape, ObliqueCut])[] = [
  ['a plane that stays clear of the base', cone(2), point(50, 15)],
  ['a plane that meets the base', cone(2), point(40, 60)],
  ['an oblique cone', cone(2, 1), point(30, 35, 200)],
  ['a turned plane through an oblique cone', cone(2, 1), point(60, 20, 75)],
];

describe('the plane', () => {
  it.each([...FEASIBLE_APEX, ...AXIS_CUTS])('through %s has the anchor, angle and direction asked for', (_, shape, cut) => {
    const { radius, height: H, offset: d } = roundDimensionsMm(shape, scale);
    const section = coneObliqueSection(shape, scale, cut);
    const t = 'positionPercent' in cut ? (cut as ObliqueCut).positionPercent / 100 : 1;
    expect(section.anchor[0]).toBeCloseTo(t * d, 10);
    expect(section.anchor[1]).toBe(0);
    expect(section.anchor[2]).toBeCloseTo(t * H, 10);
    expect(section.throughApex).toBe(!('positionPercent' in cut));
    const { normal, offset } = section.plane;
    expect(Math.hypot(...normal)).toBeCloseTo(1, 12);
    expect(dot(normal, section.anchor)).toBeCloseTo(offset, 10);
    expect((Math.acos(dot(normal, Z)) * 180) / Math.PI).toBeCloseTo(cut.inclinationDeg, 8);
    const { n, u, v } = obliqueAxes(cut.inclinationDeg, cut.directionDeg);
    expect(section.frame.n).toEqual(n);
    expect(section.frame.u).toEqual(u);
    expect(section.frame.v).toEqual(v);
    const direct = subtract(Z, scaled(n, dot(Z, n)));
    u.forEach((value, axis) => {
      expect(value).toBeCloseTo((direct[axis] as number) / Math.hypot(...direct), 12);
    });
    expect(dot(v, cross(u, n))).toBeCloseTo(1, 12);
    expect(radius).toBeGreaterThan(0);
  });

  it('passes exactly through the apex, not just below it', () => {
    for (const [, shape, cut] of FEASIBLE_APEX) {
      const { height: H, offset: d } = roundDimensionsMm(shape, scale);
      const { plane } = coneObliqueSection(shape, scale, cut);
      expect(dot(plane.normal, [d, 0, H])).toBe(plane.offset);
    }
  });

  it('keeps its angles and scales its offset with the model', () => {
    for (const cut of [apex(75, 30), point(35, 40, 120)]) {
      const [small, large] = [80, 200].map((longestDimensionMm) => coneObliqueSection(cone(2, 1), { longestDimensionMm }, cut));
      expect(large?.plane.normal).toEqual(small?.plane.normal);
      expect(large?.plane.offset).toBeCloseTo(2.5 * (small?.plane.offset as number), 9);
    }
    const [low, high] = [80, 200].map((longestDimensionMm) => coneApexAngleBounds(cone(2, 1), { longestDimensionMm }, 40));
    expect(high?.min).toBeCloseTo(low?.min as number, 1);
    expect(high?.max).toBeCloseTo(low?.max as number, 1);
  });

  it('treats 0° and 360° as one direction', () => {
    const [start, end] = [build(cone(2), apex(75, 0)), build(cone(2), apex(75, 360))];
    expect(end.section?.plane).toEqual(start.section?.plane);
    expect((end.solids[0] as Solid).mesh.positions).toEqual((start.solids[0] as Solid).mesh.positions);
  });

  it('in the axis mode holds a whole axis without dividing by n·a, where the position changes nothing', () => {
    // d = H at 45° along +X.
    const shape = cone(2, 2);
    expect(obliquePlaneContainsAxis(shape, 45, 0)).toBe(true);
    expect(obliquePlaneContainsAxis(shape, 50, 0)).toBe(false);
    const [low, high] = [coneObliqueSection(shape, scale, point(10)), coneObliqueSection(shape, scale, point(90))];
    expect(high.plane.offset).toBeCloseTo(low.plane.offset, 9);
    expect(high.frame.origin[2]).toBeCloseTo(low.frame.origin[2], 9);
    const { a, b } = partsOf(build(shape, point(10)));
    expect(a.measurements.volume / b.measurements.volume).toBeCloseTo(1, 4);
  });
});

describe('the angles of a plane through the apex', () => {
  // R = 40 mm, H = 80 mm.
  const right = cone(2);
  const tangent = (Math.atan2(80, 40) * 180) / Math.PI;

  it('follow from the base’s usable chords: on a right cone, atan2(H, 0,8·R) up to the axial 90°', () => {
    const bounds = coneApexAngleBounds(right, scale, 0);
    expect(bounds?.min).toBeCloseTo((Math.atan2(80, 32) * 180) / Math.PI, 9);
    expect(bounds?.max).toBe(90);
    // The ideal limit of any split lies below that margin.
    expect(tangent).toBeLessThan(bounds?.min as number);
  });

  it('tell the fixture’s four planes apart: only contact, tangency, and two valid sections', () => {
    const chordAt = (inclinationDeg: number) => coneApexChord(right, scale, apex(inclinationDeg));
    // 45°: the plane only touches the cone at the apex.
    expect(apexChordCrossesBase(chordAt(45))).toBe(false);
    expect(() => build(right, apex(45))).toThrow(InvalidModelSpecError);
    // Along a generator: tangent, no split either.
    expect(apexChordCrossesBase(chordAt(tangent))).toBe(false);
    expect(() => build(right, apex(tangent))).toThrow(InvalidModelSpecError);
    // Past the tangent but within the margin: a real split, of one thin sliver, which the policy refuses.
    expect(apexChordCrossesBase(chordAt(65))).toBe(true);
    expect(isApexChordUsable(chordAt(65))).toBe(false);
    expect(() => build(right, apex(65))).toThrow(InvalidModelSpecError);
    for (const inclinationDeg of [75, 90]) {
      expect(isApexChordUsable(chordAt(inclinationDeg))).toBe(true);
      const { a, b } = partsOf(build(right, apex(inclinationDeg)));
      expect(findMeshDefects(a.mesh)).toEqual([]);
      expect(findMeshDefects(b.mesh)).toEqual([]);
    }
  });

  it('allow 90° where it splits, beyond the ordinary oblique plane’s 85°, as an axial section of a right cone', () => {
    const section = coneObliqueSection(right, scale, apex(90));
    expect(section.plane.normal[2]).toBe(0);
    expect(section.frame.u).toEqual([0, 0, 1]);
    expect(obliquePlaneContainsAxis(right, 90, 0)).toBe(true);
    const { a, b } = partsOf(build(right, apex(90)));
    expect(a.measurements.volume / b.measurements.volume).toBeCloseTo(1, 6);
    // On an oblique cone 90° fits only where the apex stands over the base's usable chords.
    expect(coneApexAngleBounds(cone(2, 0.5), scale, 0)?.max).toBe(90);
    expect(coneApexAngleBounds(cone(2, 1), scale, 90)?.max).toBe(90);
    expect(coneApexAngleBounds(cone(2, 1), scale, 0)?.max).toBeLessThan(90);
    expect(() => build(cone(2, 1), apex(90, 0))).toThrow(InvalidModelSpecError);
  });

  it('are computed from the plane’s reach along the lean: atan2(H, L − δ)', () => {
    const shape = cone(2, 1);
    const { height: H, offset: d } = roundDimensionsMm(shape, scale);
    const bounds = coneApexAngleBounds(shape, scale, 0);
    const { usable } = coneApexChord(shape, scale, apex(90, 0));
    expect(bounds?.min).toBeCloseTo((Math.atan2(H, d - usable.min) * 180) / Math.PI, 9);
    expect(bounds?.max).toBeCloseTo((Math.atan2(H, d - usable.max) * 180) / Math.PI, 9);
  });

  it('are empty in a direction against a strong lean, without reversed values', () => {
    // The apex stands 40 mm along +X: rising towards −X, even the vertical plane leaves the base behind.
    expect(coneApexAngleBounds(cone(2, 1), scale, 180)).toBeNull();
    expect(() => build(cone(2, 1), apex(80, 180))).toThrow(InvalidModelSpecError);
    for (const directionDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const bounds = coneApexAngleBounds(cone(4, 3), scale, directionDeg);
      if (bounds !== null) expect(bounds.min).toBeLessThanOrEqual(bounds.max);
    }
    // Too small a model has no usable chord at all.
    expect(coneApexAngleBounds(cone(2), { longestDimensionMm: 2 }, 0)).toBeNull();
  });

  it('build at both solved ends in many directions, on the actual polygon', () => {
    for (const shape of [cone(2), cone(2, 1), cone(4, 3), cone(0.5)]) {
      for (const directionDeg of [0, 37, 90, 145, 270]) {
        const bounds = coneApexAngleBounds(shape, scale, directionDeg);
        if (bounds === null) continue;
        for (const inclinationDeg of [bounds.min, bounds.max]) {
          const cut = apex(Math.min(90, inclinationDeg), directionDeg);
          expect(isApexChordUsable(coneApexChord(shape, scale, cut))).toBe(true);
          const { a, b } = partsOf(build(shape, cut));
          expect(findMeshDefects(a.mesh)).toEqual([]);
          expect(findMeshDefects(b.mesh)).toEqual([]);
        }
      }
    }
  });
});

describe.each(FEASIBLE_APEX)('the section of %s through the apex', (_, shape, cut) => {
  const { radius: R, height: H, offset: d } = roundDimensionsMm(shape, scale);
  const A: Vec3 = [d, 0, H];
  const section = coneObliqueSection(shape, scale, cut);
  const model = build(shape, cut);
  const { a, b } = partsOf(model);

  it('is the triangle of the apex and the base’s chord, with its area centroid, not the anchor', () => {
    const atApex = section.contour.filter((corner) => Math.hypot(...subtract(corner, A)) < 1e-6);
    expect(atApex).toHaveLength(1);
    const chord = section.contour.filter((corner) => Math.abs(corner[2]) < 1e-9);
    expect(chord).toHaveLength(2);
    const [Q0, Q1] = chord as [Vec3, Vec3];
    const centroid = scaled(add(add(A, Q0), Q1), 1 / 3);
    for (let axis = 0; axis < 3; axis += 1) expect(section.frame.origin[axis]).toBeCloseTo(centroid[axis] as number, 8);
    expect(section.area).toBeCloseTo(Math.hypot(...cross(subtract(Q0, A), subtract(Q1, A))) / 2, 8);
    expect(Math.hypot(...subtract(section.frame.origin, A))).toBeGreaterThan(H / 3);
    // The chord lies where the plane's trace does.
    const { offset } = coneApexChord(shape, scale, cut);
    const { u } = obliqueAxes(0, cut.directionDeg);
    for (const [x, y] of [Q0, Q1]) expect(x * u[0] + y * u[1]).toBeCloseTo(offset, 8);
    expect(Math.hypot(Q0[0], Q0[1])).toBeLessThanOrEqual(R + 1e-9);
  });

  it('has the same area and centroid on the actual mesh, and no gap below the apex', () => {
    for (const part of [a, b]) {
      const cap = capOf(part);
      expect(cap.area).toBeCloseTo(section.area, 1);
      for (let axis = 0; axis < 3; axis += 1) expect(cap.centroid[axis]).toBeCloseTo(section.frame.origin[axis] as number, 2);
      // Each part reaches the apex itself.
      const nearest = Math.min(
        ...Array.from({ length: vertexCount(part.mesh) }, (__, vertex) =>
          Math.hypot(...subtract(vertexAt(part.mesh, vertex), A)),
        ),
      );
      expect(nearest).toBeLessThan(1e-3);
    }
  });

  it('splits it into closed, connected parts that each keep the share of the base on their side', () => {
    const whole = generateModel(kernel, { shape, scale }).solids[0] as Solid;
    for (const part of [a, b]) {
      expect(findMeshDefects(part.mesh)).toEqual([]);
      withScope((track) => expect(pieces(track, part.mesh)).toBe(1));
      // Each keeps some of the flat base.
      expect(areaOnBed(part.mesh)).toBeGreaterThan(0);
      expect(part.measurements.bounds.min[2]).toBeCloseTo(0, 6);
    }
    expect(a.measurements.volume + b.measurements.volume).toBeCloseTo(whole.measurements.volume, 1);
    const { offset } = coneApexChord(shape, scale, cut);
    expect(a.measurements.volume / whole.measurements.volume).toBeCloseTo(basePolygonShare(R, cut, offset), 5);
  });
});

describe.each(AXIS_CUTS)('the section through %s', (_, shape, cut) => {
  const section = coneObliqueSection(shape, scale, cut);
  const model = build(shape, cut);
  const { a, b } = partsOf(model);

  it('matches the mesh and keeps the plane’s sides', () => {
    expect(model.name).toBe('cone-oblique-section');
    const { normal, offset } = (model.section as ModelSection).plane;
    for (const [part, sign] of [
      [a, -1],
      [b, 1],
    ] as const) {
      const cap = capOf(part);
      expect(cap.area).toBeCloseTo(section.area, 1);
      for (let axis = 0; axis < 3; axis += 1) expect(cap.centroid[axis]).toBeCloseTo(section.frame.origin[axis] as number, 2);
      for (let vertex = 0; vertex < vertexCount(part.mesh); vertex += 1) {
        expect(sign * (dot(normal, vertexAt(part.mesh, vertex)) - offset)).toBeGreaterThan(-1e-3);
      }
    }
  });

  it('gives closed, connected parts that fill the solid exactly', () => {
    const whole = generateModel(kernel, { shape, scale }).solids[0] as Solid;
    for (const part of [a, b]) {
      expect(findMeshDefects(part.mesh)).toEqual([]);
      withScope((track) => expect(pieces(track, part.mesh)).toBe(1));
    }
    expect(a.measurements.volume + b.measurements.volume).toBeCloseTo(whole.measurements.volume, 1);
    for (const axis of [0, 1, 2] as const) expect(model.size[axis]).toBeCloseTo(whole.measurements.size[axis], 3);
  });
});

describe('an ordinary section', () => {
  it('may stay clear of the base, closing as a curve, or meet it along a chord', () => {
    const atBase = (cut: ObliqueCut) =>
      coneObliqueSection(cone(2), scale, cut).contour.filter(([, , z]) => Math.abs(z) < 1e-9).length;
    expect(atBase(point(50, 15))).toBe(0);
    expect(coneObliqueSection(cone(2), scale, point(50, 15)).contour.length).toBeGreaterThan(40);
    expect(atBase(point(40, 60))).toBe(2);
  });

  it('keeps a usable thickness: a tilted plane close to the apex is refused as a split', () => {
    // 45° at 90 % leaves 5,66 mm from the plane to the apex, under a tenth of the 84,9 mm across the plane.
    const reach = obliqueSplitReach(cone(2), scale, point(90, 45));
    expect(reach.valueMm).toBeCloseTo(0.1 * 80 * Math.SQRT1_2, 6);
    expect(satisfies(reach)).toBe(false);
    expect(() => build(cone(2), point(90, 45))).toThrow(InvalidModelSpecError);
    expect(() => build(cone(2), point(85, 45))).not.toThrow();
  });
});

const CONNECTOR_CASES: readonly (readonly [string, ConeShape, Cut])[] = [
  ['an axial plane through a right cone’s apex', cone(2), apex(90)],
  ['a tilted plane through a right cone’s apex', cone(2), apex(80, 40)],
  ['a plane through an oblique cone’s apex', cone(2, 1), apex(65)],
  ['a plane through a right cone’s axis', cone(2), point(40, 30)],
  ['a plane through an oblique cone’s axis', cone(2, 1), point(35, 25, 200)],
];

describe.each(CONNECTOR_CASES)('connectors on %s', (_, shape, cut) => {
  const section = coneObliqueSection(shape, scale, cut);

  it.each([
    ['a plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['a dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
    ['a dovetail', dovetail(), 2],
  ] as const)('%s builds separate closed connected objects', (__, connector, count) => {
    const model = build(shape, cut, connector);
    expect(model.solids).toHaveLength(count);
    for (const solid of model.solids) {
      expect(findMeshDefects(solid.mesh)).toEqual([]);
      withScope((track) => expect(pieces(track, solid.mesh)).toBe(1));
    }
  });

  it('stand on the area centroid along n, or at C ± s·u, keyed, and never on the anchor', () => {
    const one = planRoundConnectors(shape, scale, cut, plug(1));
    expect(one.frame.n).toEqual(section.plane.normal);
    expect(one.sites[0]?.centre).toEqual(section.frame.origin);
    expect(Math.hypot(...subtract(section.frame.origin, section.anchor))).toBeGreaterThan(0);
    const two = planRoundConnectors(shape, scale, cut, dowel(2));
    const [first, second] = two.sites as [(typeof two.sites)[number], (typeof two.sites)[number]];
    expect(first.along).toBeCloseTo(-second.along, 12);
    const between = subtract(first.centre, second.centre);
    const expected = scaled(section.frame.u, 2 * first.along);
    for (let axis = 0; axis < 3; axis += 1) expect(between[axis]).toBeCloseTo(expected[axis] as number, 9);
    expect(second.pinDiameter).toBeCloseTo(ROUND_CONNECTOR_PROPORTIONS.secondaryDiameter * first.pinDiameter, 12);
  });

  it('put a plug on part 1 and its hole in part 2', () => {
    const { a, b } = partsOf(build(shape, cut, plug(1)));
    const plan = planRoundConnectors(shape, scale, cut, plug(1));
    const inPlug = add(section.frame.origin, section.frame.n, plan.insertion / 2);
    withScope((track) => {
      expect(hasMaterialAt(track, manifoldOf(track, a.mesh), inPlug)).toBe(true);
      expect(hasMaterialAt(track, manifoldOf(track, b.mesh), inPlug)).toBe(false);
    });
  });

  it('solve exact bounds, each end passing the plan’s checks, past it failing, and building', () => {
    const connector = plug(2);
    const { parameters, issues } = roundConnectorFeasibility(shape, scale, cut, connector);
    expect(issues).toEqual([]);
    const dimensions = roundConnectorDimensions(connector, M, section.span / 2);
    const withValue: Record<RoundConnectorParameter, (value: number) => typeof dimensions> = {
      diameter: (diameter) => ({ ...dimensions, diameter }),
      insertion: (insertion) => ({ ...dimensions, insertion }),
      spacing: (spacing) => ({ ...dimensions, spacing }),
      upperClearance: (upper) => ({ ...dimensions, clearance: { ...dimensions.clearance, upper } }),
      lowerClearance: (lower) => ({ ...dimensions, clearance: { ...dimensions.clearance, lower } }),
    };
    const fails = (value: number, key: RoundConnectorParameter) =>
      roundConnectorChecks(section, withValue[key](value)).filter((check) => !satisfies(check));
    for (const key of ['diameter', 'insertion', 'spacing'] as const) {
      const { bounds } = parameters[key];
      expect(hasFeasibleValues(bounds)).toBe(true);
      expect(fails(bounds.min, key)).toEqual([]);
      expect(fails(bounds.max, key)).toEqual([]);
      expect(fails(bounds.max + 1e-3, key).length).toBeGreaterThan(0);
    }
    const depthFactor = parameters.insertion.bounds.max / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);
    expect(() => build(shape, cut, plug(2, { depthFactor }))).not.toThrow();
    expect(() => build(shape, cut, plug(2, { depthFactor: depthFactor * 1.01 }))).toThrow(ConnectorUnsuitableError);
  });
});

describe('a whole cavity', () => {
  it('that fits at the entrance but breaks through deeper in is refused, and does leave the actual cone', () => {
    // Through the apex at 75°, the part on the thin side narrows behind the mouth.
    const [shape, cut] = [cone(2), apex(75)] as const;
    const section = coneObliqueSection(shape, scale, cut);
    const { insertion } = roundConnectorFeasibility(shape, scale, cut, plug(1)).parameters;
    const depthFactor = (insertion.bounds.max + 3) / (ROUND_CONNECTOR_PROPORTIONS.insertion * M);
    const plan = planRoundConnectors(shape, scale, cut, plug(1, { depthFactor }));
    const codes = plan.issues.map(({ code }) => code);
    expect(codes).toContain('hole-bottom-thin');
    expect(codes).not.toContain('hole-wall-thin');
    expect(() => build(shape, cut, plug(1, { depthFactor }))).toThrow(ConnectorUnsuitableError);
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, shape, scale);
      const split = splitByPlane(track, solid, section.plane);
      const built = buildRoundConnectors(kernel, track, { lower: split.negative, upper: split.positive }, plan);
      const cutter = (built.sites[0] as (typeof built.sites)[number]).cutters.upper as Manifold;
      expect(track(cutter.subtract(solid)).volume()).toBeGreaterThan(VOLUME_TOLERANCE);
    });
  });

  it('near the apex is refused for the upper hole of a pair, which the narrowing triangle leaves no room for', () => {
    const { issues } = planRoundConnectors(cone(2), scale, apex(90), plug(2, { spacingPercent: 95 }));
    expect(issues.map(({ code }) => code)).toEqual(expect.arrayContaining(['hole-wall-thin']));
    const site = planRoundConnectors(cone(2), scale, apex(90), plug(2, { spacingPercent: 95 })).sites[0];
    expect(site?.along).toBeGreaterThan(0);
  });

  it('has no value left where the thin part cannot hold it, and smooth surfaces stay', () => {
    // M = 20 mm: at the lowest angle part 2 keeps only 2 mm of the base's width, less than a hole's least depth.
    const size = { longestDimensionMm: 20 };
    const bounds = coneApexAngleBounds(cone(2), size, 0);
    const cut = apex(bounds?.min as number);
    const { parameters, issues } = roundConnectorFeasibility(cone(2), size, cut, plug(1));
    expect(issues.length).toBeGreaterThan(0);
    expect(hasFeasibleValues(parameters.insertion.bounds)).toBe(false);
    expect(() => build(cone(2), cut, plug(1), 20)).toThrow(ConnectorUnsuitableError);
    expect(() => build(cone(2), cut, undefined, 20)).not.toThrow();
  });
});

const DOVETAIL_CASES: readonly (readonly [string, ConeShape, Cut])[] = [
  ['an axial plane through a right cone’s apex', cone(2), apex(90)],
  ['a tilted plane through a right cone’s apex', cone(2), apex(80, 40)],
  ['a plane through an oblique cone’s apex', cone(2, 1), apex(65)],
  ['a plane through a right cone’s axis', cone(2), point(40, 30)],
];

describe.each(DOVETAIL_CASES)('a dovetail on %s', (_, shape, cut) => {
  const section = coneObliqueSection(shape, scale, cut);
  const connector = dovetail();
  const model = build(shape, cut, connector);
  const plan = (model.section as ModelSection).connector as DovetailPlan;
  const { a, b } = partsOf(model);
  const { u: uphill, n } = section.frame;
  const inTongue = add(section.frame.origin, n, plan.height / 2);

  it('slides along the plane, uphill to come off, with the stop downhill', () => {
    expect(plan.frame.u).toEqual(scaled(uphill, -1));
    expect(plan.frame.n).toEqual(n);
    expect(dot(plan.frame.v, cross(plan.frame.u, plan.frame.n))).toBeCloseTo(1, 12);
    withScope((track) => {
      const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
      expect(hasMaterialAt(track, partA, inTongue)).toBe(true);
      expect(hasMaterialAt(track, partB, inTongue)).toBe(false);
      expect(hasMaterialAt(track, partB, add(inTongue, uphill, -(plan.length / 2 + plan.clearance + 0.3)))).toBe(true);
      expect(hasMaterialAt(track, partB, add(inTongue, uphill, plan.length / 2 + 0.5))).toBe(false);
    });
  });

  it('clears the whole path, and is held by the stop and against perpendicular withdrawal', () => {
    withScope((track) => {
      const [partA, partB] = [manifoldOf(track, a.mesh), manifoldOf(track, b.mesh)];
      const overlapAfter = (move: Vec3) => track(track(partA.translate([...move] as KernelVec3)).intersect(partB)).volume();
      for (const share of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        expect(overlapAfter(scaled(uphill, share * plan.exitDistance))).toBeLessThan(COPLANAR_NOISE_MM3);
      }
      expect(overlapAfter(scaled(uphill, -(plan.clearance + 0.1)))).toBeGreaterThan(VOLUME_TOLERANCE);
      expect(overlapAfter(scaled(n, plan.normalPlay + 0.1))).toBeGreaterThan(VOLUME_TOLERANCE);
    });
  });

  it('leaves the solid only through its entry corridor, uphill of the seated tongue, with nothing detached', () => {
    withScope((track) => {
      const solid = buildRoundSolid(kernel, track, shape, scale);
      const outside = track(grooveCutter(kernel, track, plan).subtract(solid));
      const parts = outside.decompose();
      for (const part of parts) track(part);
      expect(parts).toHaveLength(1);
      expect(pieces(track, a.mesh)).toBe(1);
      expect(pieces(track, b.mesh)).toBe(1);
      // Everything of the seated groove stays inside the solid.
      const seated = grooveCutter(kernel, track, { ...plan, exitDistance: 0.01 });
      expect(track(seated.subtract(solid)).volume()).toBeLessThan(VOLUME_TOLERANCE);
    });
  });

  it('solves length bounds from the full profile, and refuses what does not fit without moving the entrance', () => {
    const { length } = dovetailFeasibility(shape, scale, cut, connector).parameters;
    expect(hasFeasibleValues(length.bounds)).toBe(true);
    const percent = (100 * length.bounds.max) / section.span;
    const atEnd = build(shape, cut, dovetail({ lengthPercent: percent }));
    expect(((atEnd.section as ModelSection).connector as DovetailPlan).frame.u).toEqual(scaled(uphill, -1));
    const parts = partsOf(atEnd);
    withScope((track) => {
      expect(pieces(track, parts.a.mesh)).toBe(1);
      expect(pieces(track, parts.b.mesh)).toBe(1);
    });
    expect(() => build(shape, cut, dovetail({ lengthPercent: percent + 1 }))).toThrow(ConnectorUnsuitableError);
  });
});

describe('a dovetail through the apex', () => {
  it('opens as a notch below the apex of a narrowing triangle where its groove is wider than the part', () => {
    const connector = dovetail({ sizeFactor: 2, lengthPercent: 20 });
    expect(planDovetail(cone(2), scale, apex(90), connector).issues).toEqual([]);
    const { b } = partsOf(build(cone(2), apex(90), connector));
    expect(b.measurements.bounds.max[2]).toBeLessThan(80);
    withScope((track) => expect(pieces(track, b.mesh)).toBe(1));
  });

  it('is refused for a stop that the base would leave too thin, not reversed', () => {
    const { issues } = planDovetail(cone(2), scale, apex(90), dovetail({ lengthPercent: 99 }));
    expect(issues.map(({ code }) => code)).toContain('stop-thin');
    expect(() => build(cone(2), apex(90), dovetail({ lengthPercent: 99 }))).toThrow(ConnectorUnsuitableError);
  });
});

describe('the print file', () => {
  const objectsOf = async (shape: ConeShape, cut: Cut, connector?: Connector) => {
    const { printFile, model } = await buildModelArtifacts(kernel, specOf(shape, cut, connector));
    const { unit, objects } = readThreeMf(printFile.bytes).model;
    expect(unit).toBe('millimeter');
    return { objects, model, printFile };
  };

  it.each([
    ['flat faces', undefined, 2],
    ['a dovetail', dovetail(), 2],
    ['a plug', plug(1), 2],
    ['a pair of plugs', plug(2), 2],
    ['a dowel', dowel(1), 3],
    ['a pair of dowels', dowel(2), 4],
  ] as const)('with %s holds independent objects above the bed, apart, at their own scale', async (_, connector, count) => {
    for (const [shape, cut] of [
      [cone(2), apex(85)],
      [cone(2, 1), apex(65)],
      [cone(2), point(40, 30)],
    ] as const) {
      const { objects, model } = await objectsOf(shape, cut, connector);
      expect(objects).toHaveLength(count);
      objects.forEach(({ mesh, name }, index) => {
        const solid = model.solids[index] as Solid;
        expect(name).toBe(solid.name);
        expect(findMeshDefects(mesh)).toEqual([]);
        const measured = measureMesh(mesh);
        expect(measured.volume).toBeCloseTo(solid.measurements.volume, 0);
        expect(measured.bounds.min[2]).toBeCloseTo(0, 4);
        for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1)
          expect(vertexAt(mesh, vertex)[2]).toBeGreaterThanOrEqual(-1e-4);
        if (index > 0) {
          const previous = measureMesh((objects[index - 1] as (typeof objects)[number]).mesh).bounds.max[0];
          expect(measured.bounds.min[0] - previous).toBeCloseTo(5, 3);
        }
      });
    }
  });

  it('stands both parts of a plane through the apex upright on what they keep of the base', async () => {
    const { objects, printFile, model } = await objectsOf(cone(2), apex(75));
    expect(printFile.fileName).toBe('cone-apex-section.3mf');
    const bed = objects.map(({ mesh }) => areaOnBed(mesh));
    expect(bed[0]).toBeGreaterThan(0);
    expect(bed[1]).toBeGreaterThan(0);
    expect(Math.abs((bed[0] as number) + (bed[1] as number) - Math.PI * 40 ** 2)).toBeLessThan(0.05 * 2 * Math.PI * 40);
    objects.forEach(({ mesh }, index) => {
      expect(measureMesh(mesh).size[2]).toBeCloseTo((model.solids[index] as Solid).measurements.size[2], 3);
      expect(measureMesh(mesh).size[2]).toBeCloseTo(80, 3);
    });
  });

  it('chooses a resting face from the actual parts: a tip without any base stands on its cut face', async () => {
    // At 70 % and 15° the plane stays clear of the base: part 2 is the tip, part 1 keeps the whole base.
    const { objects } = await objectsOf(cone(2), point(70, 15));
    const [lower, tip] = objects as [(typeof objects)[number], (typeof objects)[number]];
    expect(areaOnBed(lower.mesh)).toBeGreaterThan(0.99 * Math.PI * 40 ** 2 - 20);
    expect(areaOnBed(tip.mesh)).toBeCloseTo(coneObliqueSection(cone(2), scale, point(70, 15)).area, 0);
  });

  it('turns a tip whose cut carries a protruding connector so that it points up, above the bed', async () => {
    // d = H, climbing past the lean: the apex lies under the plane, in part 1, which keeps no base at all.
    const shape = cone(2, 2);
    const cut = point(70, 80);
    const { faces } = coneObliqueSection(shape, scale, cut);
    expect(faces[0]?.boundsNegative).toBe(false);
    const { objects } = await objectsOf(shape, cut, plug(1));
    const tip = (objects[0] as (typeof objects)[number]).mesh;
    expect(findMeshDefects(tip)).toEqual([]);
    expect(measureMesh(tip).bounds.min[2]).toBeCloseTo(0, 4);
    // Nothing rests flat on the bed; the plug's end face is the highest flat face, turned straight up.
    expect(areaOnBed(tip)).toBeLessThan(1);
    const { max } = measureMesh(tip).bounds;
    let facingUp = 0;
    for (let triangle = 0; triangle < triangleCount(tip); triangle += 1) {
      const up = corners(tip, triangle).every(([, , z]) => Math.abs(z - max[2]) < 1e-3);
      if (up) facingUp += triangleArea(tip, triangle);
    }
    const plan = planRoundConnectors(shape, scale, cut, plug(1));
    expect(facingUp).toBeGreaterThan(
      0.5 * Math.PI * ((plan.sites[0]?.pinDiameter as number) / 2 - (plan.sites[0]?.chamfer as number)) ** 2,
    );
  });

  it('stands the dowels on an end face, along the plane’s normal', async () => {
    const { objects } = await objectsOf(cone(2), apex(80, 60), dowel(2));
    for (const { mesh } of objects.slice(2)) expect(measureMesh(mesh).size[2]).toBeCloseTo(8, 3);
  });
});

describe('the separated preview', () => {
  const nodeOffsets = async (glb: Uint8Array) => {
    const root = (await new WebIO().readBinary(glb)).getRoot();
    return Object.fromEntries(root.listNodes().map((node) => [node.getName(), node.getTranslation()]));
  };

  it.each([
    ['flat faces', undefined],
    ['plugs', plug(1)],
    ['dowels', dowel(2)],
  ] as const)('moves part 2 along n with %s, leaving the meshes and the print file alone', async (_, connector) => {
    const spec = specOf(cone(2), apex(80, 60), connector);
    const artifacts = await buildModelArtifacts(kernel, spec);
    const { model } = artifacts;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const { n } = obliqueAxes(80, 60);
    const expected = toGltfPosition(scaled(n, previewSeparation(model)));
    (offsets[(model.solids[1] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[0] as Solid).name]).toEqual([0, 0, 0]);
    expect((await buildModelArtifacts(kernel, spec)).printFile.bytes).toEqual(artifacts.printFile.bytes);
  });

  it('moves part 1 uphill past the groove with a dovetail, while part 2 stays', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(cone(2), apex(80, 60), dovetail()));
    const { model } = artifacts;
    const plan = (model.section as ModelSection).connector as DovetailPlan;
    const offsets = await nodeOffsets(artifacts.separatedPreviewGlb as Uint8Array);
    const { u } = obliqueAxes(80, 60);
    const expected = toGltfPosition(scaled(u, plan.exitDistance + previewSeparation(model)));
    (offsets[(model.solids[0] as Solid).name] as number[]).forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 6);
    });
    expect(offsets[(model.solids[1] as Solid).name]).toEqual([0, 0, 0]);
  });
});

describe('whatever the cone and plane', () => {
  it('builds where the plane through the apex leaves a rounding copy of it, with one vertex there and nothing degenerate', () => {
    const shape = cone(3, 4);
    const model = build(shape, apex(64.77937855433562, 81.17413407191634));
    const { height: H, offset: d } = roundDimensionsMm(shape, scale);
    for (const solid of model.solids) {
      expect(findMeshDefects(solid.mesh)).toEqual([]);
      const near = Array.from({ length: vertexCount(solid.mesh) }, (_, vertex) => vertexAt(solid.mesh, vertex)).filter(
        (vertex) => Math.hypot(...subtract(vertex, [d, 0, H])) < 1e-3,
      );
      expect(near).toHaveLength(1);
      expect(solid.newFaces).toHaveLength(triangleCount(solid.mesh));
    }
  });

  it('builds or refuses each of a seeded sample, and never fails its three-dimensional checks', { timeout: 90_000 }, () => {
    let seed = 20261111;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <Value>(values: readonly Value[]) => values[Math.floor(random() * values.length)] as Value;
    const outcomes = { built: 0, refused: 0 };
    for (let sample = 0; sample < 160; sample += 1) {
      const shape = cone(pick([0.5, 1, 2, 3, 4, 8]), pick([0, 0, 0.5, 1, 1.5]));
      const direction = 360 * random();
      const bounds = coneApexAngleBounds(shape, scale, direction);
      const cut: Cut =
        random() < 0.5 && bounds !== null
          ? apex(bounds.min + (bounds.max - bounds.min) * random(), direction)
          : point(10 + 80 * random(), 5 + 80 * random(), direction);
      const connector = pick<Connector | undefined>([
        undefined,
        dovetail(),
        dovetail({ lengthPercent: 15 }),
        plug(1),
        plug(2),
        dowel(1),
        dowel(2),
      ]);
      try {
        const { solids } = build(shape, cut, connector);
        for (const solid of solids) {
          expect(findMeshDefects(solid.mesh)).toEqual([]);
          withScope((track) => expect(pieces(track, solid.mesh)).toBe(1));
        }
        outcomes.built += 1;
      } catch (error) {
        expect([ConnectorUnsuitableError.name, InvalidModelSpecError.name]).toContain((error as Error).constructor.name);
        outcomes.refused += 1;
      }
    }
    expect(outcomes.built).toBeGreaterThan(50);
    expect(outcomes.refused).toBeGreaterThan(0);
  });
});
