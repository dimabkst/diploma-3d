import type { ConeShape, CylinderShape, ModelSpecInput, Section } from '@diploma-3d/schema';
import type { Manifold, Mat4 } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import type { PlateSection, SectionFrame } from './connectors/frame.ts';
import { readThreeMf } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { dot, findMeshDefects, measureMesh, type TriangleMesh, type Vec3, vertexAt, vertexCount } from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type Solid } from './model.ts';
import { buildSectionPlate, type SectionPlateGeometry, sectionPlateGeometry } from './plate.ts';
import { type Track, withScope } from './scope.ts';
import { circularSegments } from './shapes/round.ts';

const kernel = await loadGeometryKernel();
const SCALE = { longestDimensionMm: 80 };
const cone = (heightRatio = 2, offsetRatio = 0): ConeShape => ({ kind: 'cone', heightRatio, offsetRatio });
const cylinder = (heightRatio = 1.5, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
type Connector = NonNullable<Section['connector']>;

const specOf = (
  shape: ConeShape | CylinderShape,
  section: Section,
  thicknessMm: number,
  marginMm: number,
  connector?: Connector,
): ModelSpecInput => ({
  shape,
  scale: SCALE,
  section: { ...section, plate: { thicknessMm, marginMm }, ...(connector === undefined ? {} : { connector }) } as Section,
});

const plateOf = (model: GeneratedModel): Solid => model.solids.find((solid) => solid.part === 'plate') as Solid;
const geometryOf = (model: GeneratedModel) => (model.section as ModelSection).plate as SectionPlateGeometry;
const vertices = (mesh: TriangleMesh): Vec3[] => Array.from({ length: vertexCount(mesh) }, (_, index) => vertexAt(mesh, index));
const manifoldOf = (track: Track, mesh: TriangleMesh): Manifold =>
  track(new kernel.Manifold(new kernel.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.triangles })));

/** The column-major matrix that takes the model's millimetres to the frame's local (v, u, n) from its origin. */
function toLocal({ origin, u, v, n }: SectionFrame): Mat4 {
  return [
    v[0],
    u[0],
    n[0],
    0,
    v[1],
    u[1],
    n[1],
    0,
    v[2],
    u[2],
    n[2],
    0,
    -dot(v, origin),
    -dot(u, origin),
    -dot(n, origin),
    1,
  ] as Mat4;
}

/** The plate's outer contour in its own plane, `s` along n from the middle plane, in local (x, y) = (v, u). */
function sliceAt(track: Track, plate: Manifold, frame: SectionFrame, s: number): [number, number][] {
  const polygons = track(track(plate.transform(toLocal(frame))).slice(s)).toPolygons() as [number, number][][];
  const area = (polygon: readonly [number, number][]) =>
    polygon.reduce((sum, [x, y], index) => {
      const [nx, ny] = polygon[(index + 1) % polygon.length] as [number, number];
      return sum + (x * ny - nx * y) / 2;
    }, 0);
  return polygons.reduce((largest, polygon) => (Math.abs(area(polygon)) > Math.abs(area(largest)) ? polygon : largest));
}

const areaOf = (polygon: readonly [number, number][]) =>
  Math.abs(
    polygon.reduce((sum, [x, y], index) => {
      const [nx, ny] = polygon[(index + 1) % polygon.length] as [number, number];
      return sum + (x * ny - nx * y) / 2;
    }, 0),
  );

/** How far a point lies outside the rectangle [x0, x1] × [y0, y1] with corners rounded by `radius`; negative inside. */
function outsideRounded([x, y]: readonly [number, number], x0: number, x1: number, y0: number, y1: number, radius: number) {
  const [dx, dy] = [
    Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - radius),
    Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - radius),
  ];
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** The area of that rectangle as built: each corner a quarter of the regular polygon of the plate's arcs. */
function roundedArea(width: number, height: number, radius: number): number {
  const sides = circularSegments(radius);
  return width * height - 4 * radius ** 2 + (sides / 2) * Math.sin((2 * Math.PI) / sides) * radius ** 2;
}

/**
 * Every plate of the supported cuts has its v horizontal, so that the standing plane meets each plane parallel to its faces
 * along a line y = y_c parallel to the outline's lower side. The plate's slice there is then the outline itself above that line
 * and rounded at all four corners by the plate's radius: the cut's two corners rounded like the outline's own, the flat contact
 * between them, the outline's other corners as they were. Checks that slice, at both faces and between them.
 */
function expectRoundedSlices(model: GeneratedModel, slices = 5): { clippedSlices: number } {
  const geometry = geometryOf(model);
  const { frame, outline, standingLevel, thickness } = geometry;
  const radius = geometry.baseCornerRadius ?? geometry.cornerRadius;
  expect(Math.abs(frame.v[2])).toBeLessThan(1e-12);
  let clippedSlices = 0;
  withScope((track) => {
    const plate = manifoldOf(track, plateOf(model).mesh);
    for (let index = 0; index < slices; index += 1) {
      // Just inside each face, and between them.
      const s = -thickness / 2 + 1e-4 + ((thickness - 2e-4) * index) / (slices - 1);
      const lineY = (standingLevel - frame.origin[2] - s * frame.n[2]) / frame.u[2];
      const bottom = Math.max(outline.u.min, lineY);
      if (lineY > outline.u.min) clippedSlices += 1;
      const contour = sliceAt(track, plate, frame, s);
      // On the rounded outline, up to the sagitta of the arcs' polygon, where the slice crosses a side facet between two corners.
      const sagitta = radius * (1 - Math.cos(Math.PI / circularSegments(geometry.cornerRadius)));
      for (const point of contour) {
        expect(Math.abs(outsideRounded(point, outline.v.min, outline.v.max, bottom, outline.u.max, radius))).toBeLessThan(
          sagitta + 1e-4,
        );
      }
      // No corner is missing or left sharp: the area is the rounded outline's, down to its arcs' polygon.
      const width = outline.v.max - outline.v.min;
      expect(areaOf(contour)).toBeCloseTo(roundedArea(width, outline.u.max - bottom, radius), 2);
      // The flat contact: the lowest points span the straight part of the lower side, between the arcs.
      const lowest = Math.min(...contour.map(([, y]) => y));
      expect(lowest).toBeCloseTo(bottom, 4);
      const flat = contour.filter(([, y]) => y <= bottom + 1e-4).map(([x]) => x);
      expect(Math.min(...flat)).toBeCloseTo(outline.v.min + radius, 3);
      expect(Math.max(...flat)).toBeCloseTo(outline.v.max - radius, 3);
      // The sharp corners the cut would make lie outside, by the arc's r·(√2 − 1) less the polygon's deviation.
      for (const x of [outline.v.min, outline.v.max]) {
        const nearest = Math.min(...contour.map(([px, py]) => Math.hypot(px - x, py - bottom)));
        expect(nearest).toBeGreaterThan(radius * (Math.SQRT2 - 1) - 0.06);
      }
    }
  });
  return { clippedSlices };
}

function expectStandingAndSound(model: GeneratedModel): void {
  const plate = plateOf(model);
  const geometry = geometryOf(model);
  expect(findMeshDefects(plate.mesh)).toEqual([]);
  const lowest = Math.min(...vertices(plate.mesh).map((vertex) => vertex[2]));
  expect(lowest).toBeGreaterThanOrEqual(geometry.standingLevel - 1e-4);
  expect(lowest).toBeCloseTo(geometry.standingLevel, 6);
  withScope((track) => {
    const solid = manifoldOf(track, plate.mesh);
    expect(solid.decompose().map(track)).toHaveLength(1);
  });
}

describe('the corners the standing plane cuts into a plate', () => {
  it('an upright plate: its two new lower corners are rounded like its others, with the flat contact between them', () => {
    const model = generateModel(kernel, specOf(cylinder(), { type: 'vertical', offsetPercent: 0 }, 2, 10));
    const geometry = geometryOf(model);
    expect(geometry.clippedAtBase).toBe(true);
    expect(geometry.baseCornerRadius).toBe(geometry.cornerRadius);
    expectStandingAndSound(model);
    // The plane is clipped the same way across the whole thickness.
    expect(expectRoundedSlices(model).clippedSlices).toBe(5);
    // The contact is one flat face on the plane, as wide as the outline less the two arcs, across the whole thickness.
    const onBase = vertices(plateOf(model).mesh).filter((vertex) => Math.abs(vertex[2]) < 1e-6);
    const across = onBase.map((vertex) => dot(vertex, geometry.frame.v));
    expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(geometry.outline.v.max - geometry.outline.v.min - 4, 3);
    const through = onBase.map((vertex) => dot(vertex, geometry.frame.n));
    expect(Math.max(...through) - Math.min(...through)).toBeCloseTo(2, 4);
    // The recorded extent is the solid's: the contact still reaches the plane, the sides their margin.
    expect(geometry.extent.v).toEqual(geometry.outline.v);
  });

  it('an oblique plate the plane cuts through its thickness: each face rounded where it is cut, unchanged where it is not', () => {
    // A right cone at 80 mm: the middle outline stays 0,25 mm above the base, the lower face reaches below it.
    const section: Section = { type: 'oblique', positionPercent: 20, inclinationDeg: 20, directionDeg: 0 };
    const model = generateModel(kernel, specOf(cone(), section, 4, 3));
    const geometry = geometryOf(model);
    expect(geometry.clippedAtBase).toBe(true);
    expect(geometry.baseCornerRadius).toBe(geometry.cornerRadius);
    expectStandingAndSound(model);
    const { clippedSlices } = expectRoundedSlices(model, 9);
    expect(clippedSlices).toBeGreaterThan(0);
    expect(clippedSlices).toBeLessThan(9);
  });

  it('a steep oblique plate of a leaning cylinder, cut across all of it', () => {
    const section: Section = { type: 'oblique', positionPercent: 50, inclinationDeg: 75, directionDeg: 30 };
    const model = generateModel(kernel, specOf(cylinder(1.5, 0.8), section, 3, 12));
    expectStandingAndSound(model);
    expect(expectRoundedSlices(model).clippedSlices).toBe(5);
  });

  it('beside connectors: the joints are as they were, and all the solid between the faces stays in the plate', () => {
    const dovetail: Connector = { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 45, clearanceMm: 0.2, entrance: 'opposite' };
    for (const [shape, section, connector] of [
      [cone(), { type: 'vertical', offsetPercent: 30 }, dovetail],
      [cylinder(), { type: 'vertical', offsetPercent: -40 }, dovetail],
    ] as const) {
      // The engine itself verifies the joints and that nothing of the solid between the faces is missing from the plate.
      const model = generateModel(kernel, specOf(shape, section as Section, 3, 3, connector));
      const plain = generateModel(kernel, specOf(shape, section as Section, 3, 3));
      expect(geometryOf(model).baseCornerRadius).toBe(2);
      expectStandingAndSound(model);
      // The tongues add the same to the rounded plate as they would to any other: the two plates differ by them alone.
      const tongues = plateOf(model).measurements.volume - plateOf(plain).measurements.volume;
      const plan = (model.section as ModelSection).connector as { height: number; rootWidth: number; length: number };
      const profile = ((plan.rootWidth + plan.rootWidth + 2 * plan.height) / 2) * plan.height;
      expect(tongues).toBeGreaterThan(2 * profile * (plan.length - plan.height) * 0.95);
      expect(tongues).toBeLessThan(2 * profile * plan.length * 1.05);
    }
  });

  it('the same rounded plate goes to the preview and the print file', async () => {
    const artifacts = await buildModelArtifacts(kernel, specOf(cylinder(), { type: 'vertical', offsetPercent: 20 }, 2, 10));
    const plate = plateOf(artifacts.model);
    const printed = readThreeMf(artifacts.printFile.bytes).model.objects.find(
      (object) => object.name === 'cylinder-section-plate',
    ) as { mesh: TriangleMesh };
    expect(measureMesh(printed.mesh).volume).toBeCloseTo(plate.measurements.volume, 1);
    expect(vertexCount(printed.mesh)).toBe(vertexCount(plate.mesh));
  });

  it('a plate the plane does not reach is built exactly as before', () => {
    const model = generateModel(kernel, specOf(cylinder(), { type: 'parallel-to-bases', positionPercent: 10 }, 4, 30));
    const geometry = geometryOf(model);
    expect(geometry.clippedAtBase).toBe(false);
    expect(geometry.baseCornerRadius).toBeUndefined();
    expect(geometry.extent).toBe(geometry.outline);
    withScope((track) => {
      const built = buildSectionPlate(kernel, track, geometry);
      // The outline's arcs at both faces: four quarters of the arcs' polygon, each with both ends.
      const sides = circularSegments(geometry.cornerRadius);
      expect(built.numVert()).toBe(2 * 4 * (sides / 4 + 1));
      const { outline } = geometry;
      const expected =
        roundedArea(outline.v.max - outline.v.min, outline.u.max - outline.u.min, geometry.cornerRadius) * geometry.thickness;
      expect(built.volume()).toBeCloseTo(expected, 6);
    });
  });
});

describe('a cut corner without room for the full radius', () => {
  /**
   * Not a cut the interface offers, whose plates all meet the plane along their lower side: an upright plate turned by 45° in
   * its own plane, so that the plane only nicks one rounded corner, 0,3 mm deep. Rounded by the full 2 mm, that nick would
   * leave a contact of 0,6 mm out of its 2,1 mm; the radius shrinks until half of it remains flat.
   */
  const turned = (): PlateSection => {
    const angle = Math.PI / 4;
    const u: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
    const n: Vec3 = [0, 1, 0];
    const v: Vec3 = [-Math.cos(angle), 0, Math.sin(angle)];
    // The lowest point of the outline, the middle of the corner's arc at (−3, −3) + 2·(−1, −1)/√2, lies 0,3 mm below z = 0.
    const lowest = (-6 - 2 * Math.SQRT2) * Math.SQRT1_2;
    return {
      frame: { origin: [0, 0, -lowest - 0.3], u, v, n },
      halfThickness: 1,
      margin: 3,
      slab: { u: { min: -2, max: 2 }, v: { min: -2, max: 2 } },
      standingLevel: 0,
    } as unknown as PlateSection;
  };

  it('keeps half of the flat contact, nothing below the plane, and the rest of the outline', () => {
    const geometry = sectionPlateGeometry(turned());
    expect(geometry.clippedAtBase).toBe(true);
    const radius = geometry.baseCornerRadius as number;
    expect(radius).toBeGreaterThan(0.05);
    expect(radius).toBeLessThan(geometry.cornerRadius);
    withScope((track) => {
      const plate = buildSectionPlate(kernel, track, geometry);
      const sharp = track(buildSectionPlate(kernel, track, { ...geometry, clippedAtBase: false }).trimByPlane([0, 0, 1], 0));
      expect(plate.decompose().map(track)).toHaveLength(1);
      expect(plate.genus()).toBe(0);
      // Within the sharply cut plate, short of it only near the nick.
      expect(track(plate.subtract(sharp)).volume()).toBeLessThan(1e-6);
      const removed = track(sharp.subtract(plate)).volume();
      expect(removed).toBeGreaterThan(0);
      expect(removed).toBeLessThan(2 * 2 * 2 * 2);
      const box = plate.boundingBox();
      expect(box.min[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(box.min[2]).toBeLessThan(1e-9);
      // The contact on the plane: half the 2,1 mm the nick makes, across the plate's 2 mm thickness.
      const onPlane = (solid: Manifold): Vec3[] => {
        const mesh = solid.getMesh();
        return Array.from({ length: mesh.numVert }, (_, index): Vec3 => {
          const at = index * mesh.numProp;
          const props = mesh.vertProperties;
          return [props[at] as number, props[at + 1] as number, props[at + 2] as number];
        }).filter((point) => Math.abs(point[2]) < 1e-5);
      };
      const width = (points: readonly Vec3[]) =>
        Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0]));
      // The nick of the arcs' polygon, about 2·√(r² − (r − 0,3)²) = 2,1 mm of the ideal circle.
      const nick = width(onPlane(sharp));
      expect(nick).toBeCloseTo(2 * Math.sqrt(2 ** 2 - 1.7 ** 2), 1);
      expect(width(onPlane(plate))).toBeGreaterThanOrEqual(nick / 2 - 1e-6);
      expect(width(onPlane(plate))).toBeLessThan(nick);
      const contact = onPlane(plate);
      const ys = contact.map((point) => point[1]);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 6);
    });
  });
});
