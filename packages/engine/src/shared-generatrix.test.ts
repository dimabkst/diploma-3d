import {
  type CylinderShape,
  DEFAULT_DOVETAIL,
  DEFAULT_MAGNET,
  type ModelSpecInput,
  type Section,
  type SharedGeneratrixSection,
} from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts, LINKED_PREVIEW_COLORS } from './artifacts.ts';
import { cutOfSection, solidCut } from './connectors/frame.ts';
import {
  type LinkedPlanes,
  linkedAlternativeUsable,
  linkedCylinder,
  linkedFieldScale,
  linkedFirstPlaneDomain,
  linkedMargin,
  linkedStart,
  linkedThinnest,
} from './connectors/linked.ts';
import { ConnectorUnsuitableError, InvalidModelSpecError } from './errors.ts';
import { previewDirection } from './export/glb.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { cross, dot, findMeshDefects, length, type TriangleMesh, type Vec3 } from './mesh.ts';
import { type GeneratedModel, generateModel, type Solid } from './model.ts';
import { type Track, withScope } from './scope.ts';
import { roundDimensionsMm } from './shapes/round.ts';

const kernel = await loadGeometryKernel();
const M80 = { longestDimensionMm: 80 };
const cylinder = (heightRatio: number, offsetRatio: number): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const RIGHT = cylinder(1.5, 0);
const OBLIQUE = cylinder(1.5, 0.8);
type Connector = NonNullable<Section['connector']>;

const planesOf = (fields: Partial<LinkedPlanes> = {}): LinkedPlanes => ({
  generatrixDeg: 0,
  firstPlaneDeg: -30,
  dihedralDeg: 60,
  otherSide: false,
  third: false,
  ...fields,
});
const sectionOf = (planes: LinkedPlanes, connector?: Connector): SharedGeneratrixSection => ({
  type: 'shared-generatrix',
  ...planes,
  ...(connector === undefined ? {} : { connector }),
});
const specOf = (shape: CylinderShape, planes: LinkedPlanes, connector?: Connector): ModelSpecInput => ({
  shape,
  scale: M80,
  section: sectionOf(planes, connector),
});
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));
const FLOAT32_CONTACT_MM3 = 0.02;
const DOWEL: Connector = {
  type: 'dowel',
  count: 1,
  profile: 'circle',
  diameterFactor: 1,
  depthFactor: 1,
  lowerClearanceMm: 0.3,
  upperClearanceMm: 0.5,
};
const PLUG: Connector = {
  type: 'plug',
  count: 1,
  profile: 'circle',
  diameterFactor: 1,
  depthFactor: 1,
  holeClearanceMm: 0.5,
};

/** The parts are closed, connected and apart; without connectors they are the whole cylinder. */
function expectClosedParts(model: GeneratedModel, shape: CylinderShape, count: number, whole = true) {
  const parts = model.solids.filter((solid) => solid.part !== 'dowel');
  expect(parts.map((part) => part.part)).toEqual(['middle', 'part-1', 'part-2', 'part-3'].slice(0, count));
  for (const part of parts) {
    expect(findMeshDefects(part.mesh)).toEqual([]);
    expect(part.measurements.volume).toBeGreaterThan(0);
  }
  withScope((track) => {
    const manifolds = parts.map((part) => manifoldOf(track, part.mesh));
    for (const piece of manifolds) expect(piece.decompose().map(track)).toHaveLength(1);
    manifolds.forEach((first, index) => {
      for (const second of manifolds.slice(index + 1)) {
        expect(track(first.intersect(second)).volume()).toBeLessThan(FLOAT32_CONTACT_MM3);
      }
    });
  });
  if (!whole) return;
  const uncut = generateModel(kernel, { shape, scale: model.spec.scale }).solids[0] as Solid;
  const total = parts.reduce((sum, part) => sum + part.measurements.volume, 0);
  expect(total / uncut.measurements.volume).toBeCloseTo(1, 6);
}

describe('planes through a shared generatrix', () => {
  it('start a right cylinder at the generatrices 0°, 120° and 240°: planes 60° apart, neither through the axis', () => {
    const start = linkedStart(RIGHT, M80, 0);
    expect(start.firstPlaneDeg).toBeCloseTo(-30, 9);
    expect(start.dihedralDeg).toBeCloseTo(60, 9);
    expect(start.otherSide).toBe(false);
    const { radius } = roundDimensionsMm(RIGHT, M80);
    const { points, planes } = linkedCylinder(RIGHT, M80, { ...start, third: true });
    const expected: Vec3[] = [
      [radius, 0, 0],
      [-radius / 2, (radius * Math.sqrt(3)) / 2, 0],
      [-radius / 2, (-radius * Math.sqrt(3)) / 2, 0],
    ];
    points.forEach((point, index) => {
      for (const axisIndex of [0, 1, 2]) expect(point[axisIndex]).toBeCloseTo((expected[index] as Vec3)[axisIndex] as number, 9);
    });
    // The axial plane through A holds the axis, whose foot is the base's centre; these planes keep away from it.
    for (const { offset } of planes) expect(Math.abs(offset)).toBeCloseTo(radius / 2, 9);
  });

  it('read an oblique cylinder’s start angles off its own planes, through the same generatrices', () => {
    const start = linkedStart(OBLIQUE, M80, 40);
    const { points, planes } = linkedCylinder(OBLIQUE, M80, start);
    const { radius } = roundDimensionsMm(OBLIQUE, M80);
    for (const [index, deg] of [40, 160, 280].entries()) {
      const point = points[index] as Vec3;
      expect(point[0]).toBeCloseTo(radius * Math.cos((deg * Math.PI) / 180), 9);
      expect(point[1]).toBeCloseTo(radius * Math.sin((deg * Math.PI) / 180), 9);
    }
    const [first, second] = planes as unknown as [{ normal: Vec3 }, { normal: Vec3 }];
    expect((Math.acos(Math.abs(dot(first.normal, second.normal))) * 180) / Math.PI).toBeCloseTo(start.dihedralDeg, 9);
    // A lean changes the angle between the planes of the same three generatrices.
    expect(start.dihedralDeg).not.toBeCloseTo(60, 3);
  });

  it('hold their generatrices and the lateral direction, meet at exactly the dihedral angle, on either side, however the cylinder leans', () => {
    for (const shape of [RIGHT, OBLIQUE, cylinder(1, 1.4), cylinder(2.5, 0.3)]) {
      const { radius } = roundDimensionsMm(shape, M80);
      for (const generatrixDeg of [0, 75, 200, 330]) {
        const domain = linkedFirstPlaneDomain(shape, M80, generatrixDeg);
        for (const share of [0.3, 0.5, 0.7]) {
          for (const dihedralDeg of [25, 60, 90]) {
            for (const otherSide of [false, true]) {
              const firstPlaneDeg = domain.min + share * (domain.max - domain.min);
              const planes = planesOf({ generatrixDeg, firstPlaneDeg, dihedralDeg, otherSide, third: true });
              let linked: ReturnType<typeof linkedCylinder>;
              try {
                linked = linkedCylinder(shape, M80, planes);
              } catch {
                continue;
              }
              const { axis, points } = linked;
              const [q0, q1, q2] = points;
              const [first, second, third] = linked.planes as [
                { normal: Vec3; offset: number },
                { normal: Vec3; offset: number },
                { normal: Vec3; offset: number },
              ];
              for (const point of points) expect(Math.hypot(point[0], point[1])).toBeCloseTo(radius, 9);
              const holds = ({ normal, offset }: { normal: Vec3; offset: number }, point: Vec3) => {
                expect(dot(normal, point) - offset).toBeCloseTo(0, 9);
                expect(dot(normal, plus(point, axis)) - offset).toBeCloseTo(0, 9);
              };
              holds(first, q0);
              holds(first, q1);
              holds(second, q0);
              holds(second, q2);
              holds(third, q1);
              holds(third, q2);
              const angle = (Math.acos(Math.min(1, Math.abs(dot(first.normal, second.normal)))) * 180) / Math.PI;
              expect(angle).toBeCloseTo(dihedralDeg, 9);
              // Each normal points away from the third point, into its own outer part.
              expect(dot(first.normal, q2)).toBeLessThan(first.offset);
              expect(dot(second.normal, q1)).toBeLessThan(second.offset);
              expect(dot(third.normal, q0)).toBeLessThan(third.offset);
              for (const { normal } of linked.planes) expect(length(normal)).toBeCloseTo(1, 12);
            }
          }
        }
      }
    }
  });

  it('turn the second plane the other way to another plane below 90° and to the same plane at 90°', () => {
    const at = (dihedralDeg: number, otherSide: boolean) =>
      linkedCylinder(OBLIQUE, M80, planesOf({ firstPlaneDeg: -20, dihedralDeg, otherSide })).planes[1] as {
        normal: Vec3;
      };
    expect(Math.abs(dot(at(50, false).normal, at(50, true).normal))).toBeLessThan(0.99);
    expect(Math.abs(dot(at(90, false).normal, at(90, true).normal))).toBeCloseTo(1, 12);
    expect(linkedAlternativeUsable(RIGHT, M80, planesOf({ dihedralDeg: 90 }))).toBe(false);
    expect(linkedAlternativeUsable(RIGHT, M80, planesOf({ firstPlaneDeg: 0, dihedralDeg: 40 }))).toBe(true);
    // From −30°, the other way turns the second plane to −90°, the tangent plane.
    expect(linkedAlternativeUsable(RIGHT, M80, planesOf({ firstPlaneDeg: -30, dihedralDeg: 60 }))).toBe(false);
  });

  it('keep the dihedral angle exact when the cylinder’s lean changes and the planes are rebuilt from their fields', () => {
    const planes = planesOf({ generatrixDeg: 110, firstPlaneDeg: 10, dihedralDeg: 37 });
    for (const offsetRatio of [0, 0.4, 0.9, 1.6]) {
      const [first, second] = linkedCylinder(cylinder(1.5, offsetRatio), M80, planes).planes as unknown as [
        { normal: Vec3 },
        { normal: Vec3 },
      ];
      expect((Math.acos(Math.abs(dot(first.normal, second.normal))) * 180) / Math.PI).toBeCloseTo(37, 9);
    }
  });

  it('refuse only degenerate planes, tangent or coincident, before anything is built', () => {
    const domain = linkedFirstPlaneDomain(RIGHT, M80, 0);
    expect(domain.min).toBeCloseTo(-90, 9);
    expect(domain.max).toBeCloseTo(90, 9);
    // Nearly the tangent plane: its other generatrix comes close to the shared one.
    const tangent = planesOf({ firstPlaneDeg: domain.max - 0.05, dihedralDeg: 30, otherSide: true });
    expect(linkedMargin(RIGHT, M80, tangent)).toBeLessThan(0);
    expect(() => generateModel(kernel, specOf(RIGHT, tangent))).toThrow(InvalidModelSpecError);
    // Nearly coincident planes: their other generatrices nearly coincide.
    const coincident = planesOf({ dihedralDeg: 0.01 });
    expect(linkedMargin(RIGHT, M80, coincident)).toBeLessThan(0);
    expect(() => generateModel(kernel, specOf(RIGHT, coincident))).toThrow(InvalidModelSpecError);
    // The schema refuses no angle between the planes, and more than a right angle.
    expect(() => generateModel(kernel, specOf(RIGHT, planesOf({ dihedralDeg: 0 })))).toThrow(InvalidModelSpecError);
    expect(() => generateModel(kernel, specOf(RIGHT, planesOf({ dihedralDeg: 95 })))).toThrow(InvalidModelSpecError);
    // Only a cylinder takes the section.
    expect(() =>
      generateModel(kernel, {
        shape: { kind: 'cone', heightRatio: 1, offsetRatio: 0 },
        scale: M80,
        section: sectionOf(planesOf()),
      }),
    ).toThrow(InvalidModelSpecError);
    expect(() => linkedCylinder(RIGHT, M80, planesOf({ firstPlaneDeg: 90, dihedralDeg: 30, otherSide: true }))).toThrow();
  });

  it('keep each field on a fixed scale, with gaps only about the tangent and coincident positions', () => {
    for (const shape of [RIGHT, OBLIQUE]) {
      const start = linkedStart(shape, M80, 0);
      for (const field of ['pair', 'dihedral', 'generatrix'] as const) {
        const range = linkedFieldScale(shape, M80, start, field);
        if (range === null) throw new Error('The start has usable planes.');
        const at = (value: number) =>
          field === 'pair'
            ? { ...start, firstPlaneDeg: value }
            : field === 'dihedral'
              ? { ...start, dihedralDeg: value }
              : { ...start, generatrixDeg: value };
        // The ends of the scale and of every gap are usable; just inside a gap is not.
        expect(linkedMargin(shape, M80, at(range.min))).toBeGreaterThanOrEqual(0);
        expect(linkedMargin(shape, M80, at(range.max))).toBeGreaterThanOrEqual(0);
        for (const gap of range.gaps) {
          expect(linkedMargin(shape, M80, at(gap.min))).toBeGreaterThanOrEqual(0);
          expect(linkedMargin(shape, M80, at(gap.max))).toBeGreaterThanOrEqual(0);
          expect(linkedMargin(shape, M80, at((gap.min + gap.max) / 2))).toBeLessThan(0);
          // Narrow: the polygon's deviation from the circle and the numerical least, not a printability rule.
          expect(gap.max - gap.min).toBeLessThan(10);
        }
      }
      // The pair turns nearly the whole half turn; the dihedral angle goes down to a fraction of a degree.
      const pair = linkedFieldScale(shape, M80, start, 'pair');
      expect(pair?.min).toBeLessThan(-80);
      expect(pair?.max).toBeGreaterThan(80);
      expect(pair?.gaps).toHaveLength(1);
      expect(linkedFieldScale(shape, M80, start, 'dihedral')?.min).toBeLessThan(0.1);
      expect(linkedFieldScale(shape, M80, start, 'generatrix')).toEqual({ min: 0, max: 360, gaps: [] });
    }
  });

  it('allow thin but valid parts, which the old printability margin refused, and name the thinnest for a warning', () => {
    // The first plane's other generatrix 20° along the circle from the shared one: part 1 about 0,6 mm thick.
    const thin = planesOf({ firstPlaneDeg: -80, dihedralDeg: 40 });
    expect(linkedMargin(RIGHT, M80, thin)).toBeGreaterThan(0);
    const thinnest = linkedThinnest(RIGHT, M80, thin);
    expect(thinnest?.part).toBe('part-1');
    expect(thinnest?.reachMm).toBeLessThan(1.2);
    expect(thinnest?.reachMm).toBeGreaterThan(0.1);
    // Formerly 73,84–90° at this turn; now anything from a fraction of a degree.
    const dihedral = linkedFieldScale(RIGHT, M80, planesOf({ firstPlaneDeg: -80 }), 'dihedral');
    expect(dihedral?.min).toBeLessThan(1);
  });
});

describe('the controls of a cut through a shared generatrix', () => {
  type Plane = { normal: Vec3; offset: number };
  const planesAt = (shape: CylinderShape, fields: Partial<LinkedPlanes>) =>
    linkedCylinder(shape, M80, planesOf(fields)).planes as unknown as [Plane, Plane, Plane?];
  const angleBetween = (a: Plane, b: Plane) => (Math.acos(Math.min(1, Math.abs(dot(a.normal, b.normal)))) * 180) / Math.PI;
  const same = (a: Plane, b: Plane) => {
    for (const axis of [0, 1, 2]) expect(a.normal[axis]).toBeCloseTo(b.normal[axis] as number, 12);
    expect(a.offset).toBeCloseTo(b.offset, 9);
  };

  it('moves only the second plane with the dihedral angle, both with the pair’s turn, their angle kept', () => {
    for (const shape of [RIGHT, OBLIQUE]) {
      const [first, second] = planesAt(shape, { firstPlaneDeg: -20, dihedralDeg: 40 });
      const [firstWider, secondWider] = planesAt(shape, { firstPlaneDeg: -20, dihedralDeg: 55 });
      same(first, firstWider);
      expect(angleBetween(second, secondWider)).toBeGreaterThan(1);
      expect(angleBetween(firstWider, secondWider)).toBeCloseTo(55, 9);
      const [firstTurned, secondTurned] = planesAt(shape, { firstPlaneDeg: 5, dihedralDeg: 40 });
      expect(angleBetween(first, firstTurned)).toBeGreaterThan(1);
      expect(angleBetween(second, secondTurned)).toBeGreaterThan(1);
      expect(angleBetween(firstTurned, secondTurned)).toBeCloseTo(40, 9);
    }
  });

  it('keeps the first two planes when the third is added, and the stored solution of the second plane always', () => {
    const [first, second] = planesAt(OBLIQUE, { firstPlaneDeg: 10, dihedralDeg: 50 });
    const [firstThird, secondThird, third] = planesAt(OBLIQUE, { firstPlaneDeg: 10, dihedralDeg: 50, third: true });
    same(first, firstThird);
    same(second, secondThird);
    expect(third).toBeDefined();
    // Turning the pair until the second plane is tangent is refused there, never answered by the other solution.
    const tangentTurn = planesOf({ firstPlaneDeg: 30 });
    expect(linkedMargin(RIGHT, M80, tangentTurn)).toBeLessThan(0);
    const range = linkedFieldScale(RIGHT, M80, planesOf(), 'pair');
    const gap = range?.gaps[0];
    expect(gap?.min).toBeLessThan(30);
    expect(gap?.max).toBeGreaterThan(30);
    // Beyond the gap the same solution goes on: the second plane still 60° from the first, the same way about AA1.
    const [firstBeyond, secondBeyond] = planesAt(RIGHT, { firstPlaneDeg: (gap?.max ?? 0) + 1 });
    expect(angleBetween(firstBeyond, secondBeyond)).toBeCloseTo(60, 9);
  });
});

describe('a cylinder cut through a shared generatrix', () => {
  it('cuts the default right cylinder into three closed parts, two of them alike, that fill it', () => {
    const model = generateModel(kernel, specOf(RIGHT, planesOf()));
    expect(model.name).toBe('cylinder-two-shared-generatrix-sections');
    expectClosedParts(model, RIGHT, 3);
    const [, part1, part2] = model.solids as [Solid, Solid, Solid];
    expect(part1.measurements.volume / part2.measurements.volume).toBeCloseTo(1, 6);
    expect(model.section?.linked?.interfaces.map(({ part }) => part)).toEqual(['part-1', 'part-2']);
  });

  it('cuts four parts with the third plane, a triangular prism in the middle', () => {
    for (const shape of [RIGHT, OBLIQUE]) {
      const planes = { ...linkedStart(shape, M80, 0), third: true };
      const model = generateModel(kernel, specOf(shape, planes));
      expect(model.name).toBe('cylinder-three-shared-generatrix-sections');
      expectClosedParts(model, shape, 4);
      // The prism's base is the triangle of the three points, its height the cylinder's; the polygon cuts its edges a little.
      const [q0, q1, q2] = linkedCylinder(shape, M80, planes).points;
      const triangle = length(cross(minus(q1, q0), minus(q2, q0))) / 2;
      const prism = (model.solids[0] as Solid).measurements.volume;
      expect(prism / (triangle * roundDimensionsMm(shape, M80).height)).toBeCloseTo(1, 3);
      // Each plane bounds the middle part: its vertices lie on their negative sides.
      const { interfaces } = model.section?.linked ?? { interfaces: [] };
      const { positions } = (model.solids[0] as Solid).mesh;
      for (const { plane } of interfaces) {
        for (let index = 0; index < positions.length; index += 3) {
          const point: Vec3 = [positions[index] ?? 0, positions[index + 1] ?? 0, positions[index + 2] ?? 0];
          expect(dot(plane.normal, point) - plane.offset).toBeLessThan(1e-3);
        }
      }
    }
  });

  it('cuts any usable planes: a first plane off the axis, the other side, a right angle, a short arc', () => {
    const cases: [CylinderShape, Partial<LinkedPlanes>][] = [
      [RIGHT, { firstPlaneDeg: 25, dihedralDeg: 40, otherSide: true }],
      [RIGHT, { firstPlaneDeg: 0, dihedralDeg: 40, otherSide: true }],
      [OBLIQUE, { generatrixDeg: 30, firstPlaneDeg: -45, dihedralDeg: 90, third: true }],
      [OBLIQUE, { generatrixDeg: 250, firstPlaneDeg: 20, dihedralDeg: 45, otherSide: true, third: true }],
      // The generatrices 80° and 120° along the circle from the shared one: a middle part on a 40° arc.
      [RIGHT, { firstPlaneDeg: -50, dihedralDeg: 20 }],
      // Part 1 on a 20° arc, about 0,6 mm thick: thin, yet a valid section.
      [RIGHT, { firstPlaneDeg: -80, dihedralDeg: 40, third: true }],
      // A small angle between the planes, and the dihedral angle's former minimum far below.
      [OBLIQUE, { firstPlaneDeg: -20, dihedralDeg: 3 }],
    ];
    for (const [shape, fields] of cases) {
      const planes = planesOf(fields);
      expect(linkedMargin(shape, M80, planes)).toBeGreaterThan(0);
      expectClosedParts(generateModel(kernel, specOf(shape, planes)), shape, planes.third ? 4 : 3);
    }
  });

  it('joins every outer part to the middle one with the same connector, fitted to its own plane', () => {
    for (const connector of [
      { type: 'dovetail', ...DEFAULT_DOVETAIL },
      PLUG,
      DOWEL,
      { type: 'magnet', ...DEFAULT_MAGNET },
    ] as Connector[]) {
      const planes = { ...linkedStart(OBLIQUE, M80, 0), third: true };
      const model = generateModel(kernel, specOf(OBLIQUE, planes, connector));
      expectClosedParts(model, OBLIQUE, 4, false);
      const { interfaces } = model.section?.linked ?? { interfaces: [] };
      expect(interfaces).toHaveLength(3);
      for (const { connector: plan, plane } of interfaces) {
        expect(plan?.type).toBe(connector.type);
        // Each connector stands on its own plane, along its normal.
        expect(Math.abs(dot(plan?.frame.n ?? [0, 0, 0], plane.normal))).toBeCloseTo(1, 9);
        expect(dot(plane.normal, plan?.frame.origin ?? [0, 0, 0]) - plane.offset).toBeCloseTo(0, 6);
      }
      const dowels = model.solids.filter((solid) => solid.part === 'dowel');
      expect(dowels.map((dowel) => dowel.joint)).toEqual(connector.type === 'dowel' ? [0, 1, 2] : []);
    }
  });

  it('changes the middle part by what each plane’s connector changes alone', () => {
    const planes = planesOf({ third: true });
    const plain = (generateModel(kernel, specOf(RIGHT, planes)).solids[0] as Solid).measurements.volume;
    const joined = generateModel(kernel, specOf(RIGHT, planes, PLUG));
    const middle = (joined.solids[0] as Solid).measurements.volume;
    // One plug of the same size stands on each of the three equal sections.
    const plugs = new Set(joined.section?.linked?.interfaces.map(({ connector }) => JSON.stringify(connector?.frame.u)));
    expect(plugs.size).toBe(1);
    const single = (middle - plain) / 3;
    expect(single).toBeGreaterThan(0);
    const outers = joined.solids.slice(1, 4).map((solid) => solid.measurements.volume);
    for (const outer of outers) expect(outer / (outers[0] as number)).toBeCloseTo(1, 3);
  });

  it('refuses connectors whose cavities in the middle part come too close to each other, and says why', () => {
    expect(() =>
      generateModel(
        kernel,
        specOf(RIGHT, planesOf({ firstPlaneDeg: -30, dihedralDeg: 10 }), { type: 'magnet', ...DEFAULT_MAGNET }),
      ),
    ).toThrow(ConnectorUnsuitableError);
    try {
      generateModel(kernel, specOf(RIGHT, planesOf({ firstPlaneDeg: -30, dihedralDeg: 15 }), DOWEL));
      throw new Error('Expected a refusal.');
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorUnsuitableError);
      expect((error as ConnectorUnsuitableError).issues).toEqual([{ code: 'interfaces-too-close' }]);
    }
  });

  it('keeps a connector’s walls from the other planes, which bound the middle part', () => {
    const section = sectionOf(planesOf({ firstPlaneDeg: -50, dihedralDeg: 10 }));
    for (const planeIndex of [0, 1]) {
      const cut = cutOfSection({ ...section, planeIndex } as Section);
      const view = solidCut(OBLIQUE, M80, cut);
      if (!('faces' in view)) throw new Error('Expected a faceted section.');
      const other = linkedCylinder(OBLIQUE, M80, section).planes[1 - planeIndex] as { normal: Vec3 };
      const bound = view.faces.find(
        (face) =>
          face.boundsNegative &&
          !face.boundsPositive &&
          Math.abs(
            face.alongU * dot(other.normal, view.frame.u) +
              face.alongV * dot(other.normal, view.frame.v) +
              face.alongN * dot(other.normal, view.frame.n) -
              1,
          ) < 1e-9,
      );
      expect(bound).toBeDefined();
      // The middle part is a thin wedge: it reaches far less from the plane than the whole cylinder.
      expect(view.reach.negative).toBeLessThan(roundDimensionsMm(OBLIQUE, M80).radius);
    }
  });
});

describe('the files and the preview of a cut through a shared generatrix', () => {
  it('export every part and dowel as its own object, with each plane’s connector in the settings', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(RIGHT, planesOf({ third: true }), DOWEL));
    expect(artifacts.printFile.fileName).toBe('cylinder-three-shared-generatrix-sections.3mf');
    expect(readThreeMf(artifacts.printFile.bytes).model.objects.map((object) => object.name)).toEqual([
      'cylinder-middle-part',
      'cylinder-part-1',
      'cylinder-part-2',
      'cylinder-part-3',
      'cylinder-dowel-1',
      'cylinder-dowel-2',
      'cylinder-dowel-3',
    ]);
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.section).toEqual({ type: 'shared-generatrix', ...planesOf({ third: true }) });
    expect(json.sourceModel.connector.settings).toEqual(DOWEL);
    expect(json.sourceModel.connector.atPlanes).toHaveLength(3);
    expect(artifacts.pinsFile).toBeDefined();
  });

  it('labels the generatrices and keeps the middle part still while each outer part moves along its own normal', async () => {
    const shape = OBLIQUE;
    const planes = { ...linkedStart(shape, M80, 0), third: true };
    const artifacts = await buildModelArtifacts(kernel, specOf(shape, planes));
    const assembled = artifacts.vertexLabels ?? [];
    expect([...new Set(assembled.map(({ name }) => name))]).toEqual(['A', 'A1', 'B', 'B1', 'C', 'C1']);
    // Assembled, the shared generatrix is one label for the three parts along it.
    expect(assembled.filter(({ name }) => name === 'A').map(({ parts }) => parts)).toEqual([['middle', 'part-1', 'part-2']]);
    const separated = artifacts.separatedVertexLabels ?? [];
    const at = (labels: typeof assembled, name: string, part: string) =>
      labels.find((label) => label.name === name && label.parts.includes(part as never))?.position as Vec3;
    expect(at(separated, 'A', 'middle')).toEqual(at(assembled, 'A', 'middle'));
    const { interfaces } = artifacts.model.section?.linked ?? { interfaces: [] };
    const gaps: number[] = [];
    for (const [index, part] of (['part-1', 'part-2', 'part-3'] as const).entries()) {
      const name = index === 2 ? 'B' : 'A';
      const move = minus(at(separated, name, part), at(assembled, name, part));
      const direction = previewDirection({}, (interfaces[index] as { plane: { normal: Vec3 } }).plane.normal);
      expect(length(cross(move, direction))).toBeLessThan(1e-9);
      expect(dot(move, direction)).toBeGreaterThan(0);
      gaps.push(length(move));
    }
    // Flat cut faces: every interface opens by the same gap.
    expect(gaps[1] as number).toBeCloseTo(gaps[0] as number, 9);
    expect(gaps[2] as number).toBeCloseTo(gaps[0] as number, 9);
    // The plain cut's preview is the assembly: no part moves.
    expect(artifacts.separatedPreviewGlb).toBeDefined();
  });

  it('colours each plane’s cut faces and shows the generatrices in the preview alone, never in the print file', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(OBLIQUE, planesOf({ third: true }), DOWEL));
    for (const glb of [artifacts.previewGlb, artifacts.separatedPreviewGlb]) {
      const document = await new WebIO().readBinary(glb as Uint8Array);
      const materials = document
        .getRoot()
        .listMaterials()
        .map((material) => material.getName());
      expect(materials).toEqual(expect.arrayContaining(['plane-1', 'plane-2', 'plane-3', 'guide-AA1', 'guide-BB1', 'guide-CC1']));
      // The guides run along the cut faces' rims, so they are white like every outline; no outline takes a plane's colour.
      expect(materials.filter((name) => name.endsWith('-edges'))).toEqual([]);
      for (const material of document.getRoot().listMaterials()) {
        if (material.getName().startsWith('guide-')) expect(material.getBaseColorFactor()).toEqual([1, 1, 1, 1]);
      }
      // Each plane's faces in its own material, on every part that has them.
      const used = new Set(
        document
          .getRoot()
          .listMeshes()
          .flatMap((mesh) => mesh.listPrimitives().map((primitive) => primitive.getMaterial()?.getName())),
      );
      for (const name of ['plane-1', 'plane-2', 'plane-3', 'guide-AA1']) expect(used.has(name)).toBe(true);
      // The guides stay with the middle part, which never moves: on the lateral surface at A, B and C.
      const nodes = document.getRoot().listNodes();
      const guide = nodes.find((node) => node.getName() === 'guide-AA1');
      expect(guide?.getTranslation()).toEqual([0, 0, 0]);
    }
    expect(LINKED_PREVIEW_COLORS.planes).toHaveLength(3);
    // The print file has the parts and dowels, nothing of the guides.
    expect(readThreeMf(artifacts.printFile.bytes).model.objects.map((object) => object.name)).toEqual([
      'cylinder-middle-part',
      'cylinder-part-1',
      'cylinder-part-2',
      'cylinder-part-3',
      'cylinder-dowel-1',
      'cylinder-dowel-2',
      'cylinder-dowel-3',
    ]);
  });

  it('stand every part on the lower base in the print file, as a vertical cut’s', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(OBLIQUE, planesOf({ third: true })));
    const { objects } = readThreeMf(artifacts.printFile.bytes).model;
    for (const object of objects) {
      const heights = object.mesh.positions.filter((_, index) => index % 3 === 2);
      expect(Math.min(...heights)).toBeCloseTo(0, 6);
      expect(Math.max(...heights)).toBeCloseTo(roundDimensionsMm(OBLIQUE, M80).height, 4);
    }
  });
});
