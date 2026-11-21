import type {
  ConnectorProfile,
  CylinderShape,
  DovetailConnector,
  DowelConnector,
  ModelSpecInput,
  PlugConnector,
  RoundConnector,
  Section,
} from '@diploma-3d/schema';
import { WebIO } from '@gltf-transform/core';
import type { Manifold } from 'manifold-3d';
import { describe, expect, it } from 'vitest';
import { buildModelArtifacts } from './artifacts.ts';
import { type DovetailPlan, dovetailEntranceDirection } from './connectors/dovetail.ts';
import {
  cutOfSection,
  cylinderPlateSection,
  type PlateCut,
  plateThicknessRange,
  satisfies,
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
import { planTwist, twistSupported } from './connectors/twist.ts';
import { ConnectorUnsuitableError, InvalidModelSpecError } from './errors.ts';
import { toGltfPosition } from './export/glb.ts';
import { MODEL_SETTINGS_PATH } from './export/model-settings.ts';
import { readThreeMf, readThreeMfPart } from './export/three-mf.test-helper.ts';
import { loadGeometryKernel } from './kernel.ts';
import { dot, findMeshDefects, measureMesh, type TriangleMesh, type Vec3, vertexAt, vertexCount } from './mesh.ts';
import { type GeneratedModel, generateModel, type ModelSection, type SectionPart, type Solid } from './model.ts';
import { PLATE_CORNER_RADIUS_MM, type SectionPlateGeometry } from './plate.ts';
import { type Track, withScope } from './scope.ts';
import { circularSegments, MAX_CIRCLE_DEVIATION_MM, roundDimensionsMm } from './shapes/round.ts';

const kernel = await loadGeometryKernel();
const SCALE = { longestDimensionMm: 80 };

const cylinder = (heightRatio = 1.5, offsetRatio = 0): CylinderShape => ({ kind: 'cylinder', heightRatio, offsetRatio });
const plate = (thicknessMm = 2, marginMm = 8) => ({ thicknessMm, marginMm });

type CutSection = Exclude<Section, { type: 'horizontal' | 'oblique-apex' }>;
type Connector = NonNullable<Section['connector']>;

/** At M = 80 mm a right cylinder with h/r = 1,5 has r = 40 mm and H = 60 mm; the leaning one r ≈ 28,6 mm, H ≈ 42,9 mm. */
const shapes: readonly (readonly [string, CylinderShape])[] = [
  ['a right cylinder', cylinder()],
  ['a leaning cylinder', cylinder(1.5, 0.8)],
];

const CUTS = {
  parallel: { type: 'parallel-to-bases', positionPercent: 40 },
  axial: { type: 'vertical', offsetPercent: 0 },
  offset: { type: 'vertical', offsetPercent: -45 },
  between: { type: 'oblique', positionPercent: 50, inclinationDeg: 20, directionDeg: 0 },
  lowerBase: { type: 'oblique', positionPercent: 20, inclinationDeg: 40, directionDeg: 90 },
  bothBases: { type: 'oblique', positionPercent: 50, inclinationDeg: 75, directionDeg: 30 },
} as const satisfies Record<string, CutSection>;

const cuts: readonly (readonly [string, CutSection])[] = [
  ['a cut parallel to the bases', CUTS.parallel],
  ['an axial vertical cut', CUTS.axial],
  ['an offset vertical cut', CUTS.offset],
  ['an oblique cut between the bases', CUTS.between],
  ['an oblique cut through the lower base', CUTS.lowerBase],
  ['an oblique cut through both bases', CUTS.bothBases],
];

const cases = shapes.flatMap(([shapeName, shape]) =>
  cuts.map(([cutName, section]) => [`${cutName} of ${shapeName}`, shape, section] as const),
);

function specOf(
  shape: CylinderShape,
  section: CutSection,
  withPlate: ReturnType<typeof plate> | undefined,
  connector?: Connector,
  scale = SCALE,
): ModelSpecInput {
  return {
    shape,
    scale,
    section: {
      ...section,
      ...(withPlate === undefined ? {} : { plate: withPlate }),
      ...(connector === undefined ? {} : { connector }),
    } as Section,
  };
}

const plateCutOf = (section: CutSection, withPlate = plate()): PlateCut => {
  const plane = cutOfSection(section);
  return (typeof plane === 'number' ? { positionPercent: plane, plate: withPlate } : { ...plane, plate: withPlate }) as PlateCut;
};

const partsOf = (section: CutSection): readonly [SectionPart, SectionPart] =>
  section.type === 'parallel-to-bases' ? ['lower', 'upper'] : ['part-1', 'part-2'];

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
/** Touching faces of meshes read back from float32 overlap by their rounding, see plate-cuts.test.ts. */
const FLOAT32_CONTACT_MM3 = 0.02;

/** How far a point lies inside the rounded rectangle, in the frame's (v, u) plane. */
function insideOutline([x, y]: readonly [number, number], outline: SectionPlateGeometry['outline'], radius: number): number {
  const [cx, cy] = [(outline.v.min + outline.v.max) / 2, (outline.u.min + outline.u.max) / 2];
  const [hx, hy] = [(outline.v.max - outline.v.min) / 2 - radius, (outline.u.max - outline.u.min) / 2 - radius];
  const [dx, dy] = [Math.abs(x - cx) - hx, Math.abs(y - cy) - hy];
  return radius - (Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0));
}

const wholeOf = (shape: CylinderShape, scale = SCALE) => generateModel(kernel, { shape, scale }).solids[0] as Solid;

describe('a plain plate on every cut of the cylinder', () => {
  it.each(cases)('%s: the slab along n between the parts, nothing moved or rescaled', (_, shape, section) => {
    const model = generateModel(kernel, specOf(shape, section, plate(2, 8)));
    const plain = generateModel(kernel, specOf(shape, section, undefined));
    const { plane, plate: geometry } = model.section as ModelSection & { plate: SectionPlateGeometry };
    const [negative, positive] = partsOf(section);
    expect(model.solids.map((solid) => [solid.part, solid.name])).toEqual([
      [negative, `cylinder-${negative}${negative === 'lower' ? '-part' : ''}`],
      [positive, `cylinder-${positive}${positive === 'upper' ? '-part' : ''}`],
      ['plate', 'cylinder-section-plate'],
    ]);
    expect(model.name).toMatch(/-plate$/);
    // The plane is the one chosen, with or without a plate, and the plate lies in its frame.
    expect(plane).toEqual((plain.section as ModelSection).plane);
    expect(geometry.frame.n).toEqual(plane.normal);
    for (const solid of model.solids) expect(findMeshDefects(solid.mesh)).toEqual([]);
    // Each part ends T/2 from the plane, measured along n; the plate fills exactly that, whatever way the plane faces.
    const first = signedExtent(partOf(model, negative).mesh, plane);
    const second = signedExtent(partOf(model, positive).mesh, plane);
    const slab = signedExtent(partOf(model, 'plate').mesh, plane);
    expect(first.max).toBeCloseTo(-1, 4);
    expect(second.min).toBeCloseTo(1, 4);
    expect(slab.min).toBeCloseTo(-1, 4);
    expect(slab.max).toBeCloseTo(1, 4);
    // Nothing else moved: the parts reach exactly as far as the uncut parts do, and keep their scale.
    expect(first.min).toBeCloseTo(signedExtent(partOf(plain, negative).mesh, plane).min, 4);
    expect(second.max).toBeCloseTo(signedExtent(partOf(plain, positive).mesh, plane).max, 4);
    // The plate covers, by its margin, all the material of the slab: both faces' contours and any corner between them.
    const { origin, u, v } = geometry.frame;
    const local = (point: Vec3): [number, number] => {
      const relative: Vec3 = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
      return [dot(relative, v), dot(relative, u)];
    };
    const whole = wholeOf(shape);
    const inSlab = [
      ...vertices(partOf(model, negative).mesh),
      ...vertices(partOf(model, positive).mesh),
      ...vertices(whole.mesh),
    ].filter((vertex) => Math.abs(dot(plane.normal, vertex) - plane.offset) <= 1 + POSITION_TOLERANCE_MM);
    expect(inSlab.length).toBeGreaterThan(0);
    for (const point of inSlab) {
      expect(insideOutline(local(point), geometry.outline, PLATE_CORNER_RADIUS_MM)).toBeGreaterThanOrEqual(
        8 - MAX_CIRCLE_DEVIATION_MM - POSITION_TOLERANCE_MM,
      );
    }
    // Never below the plane the cylinder stands on.
    expect(geometry.standingLevel).toBe(0);
    expect(partOf(model, 'plate').measurements.bounds.min[2]).toBeGreaterThanOrEqual(-POSITION_TOLERANCE_MM);
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
      // The parts and the slab of the solid between the plate's faces fill the solid.
      const solid = manifoldOf(track, whole.mesh);
      const n = plane.normal;
      const between = track(
        track(solid.trimByPlane([...n], plane.offset - 1)).trimByPlane([-n[0], -n[1], -n[2]], -(plane.offset + 1)),
      );
      const parts = partOf(model, negative).measurements.volume + partOf(model, positive).measurements.volume;
      expect((parts + between.volume()) / whole.measurements.volume).toBeCloseTo(1, 5);
    });
  });

  it('reads the oblique faces off the finite cylinder: between the bases, through one, or through both', () => {
    for (const [, shape] of shapes) {
      const { height } = roundDimensionsMm(shape, SCALE);
      const levels = (section: CutSection) => {
        const geometry = cylinderPlateSection(shape, SCALE, plateCutOf(section));
        const zs = [geometry.interfaces.lower, geometry.interfaces.upper].flatMap((face) =>
          face.contour.map((point) => point[2]),
        );
        return {
          lower: zs.some((z) => Math.abs(z) < 1e-9),
          upper: zs.some((z) => Math.abs(z - height) < 1e-9),
        };
      };
      expect(levels(CUTS.between)).toEqual({ lower: false, upper: false });
      expect(levels(CUTS.lowerBase)).toEqual({ lower: true, upper: false });
      expect(levels(CUTS.bothBases)).toEqual({ lower: true, upper: true });
    }
  });

  it('measures the thickness along n, so a steep oblique plate is no thicker for its slope', () => {
    const model = generateModel(kernel, specOf(cylinder(), CUTS.bothBases, plate(3, 5)));
    const slab = partOf(model, 'plate');
    const { plane } = model.section as ModelSection;
    const extent = signedExtent(slab.mesh, plane);
    expect(extent.max - extent.min).toBeCloseTo(3, 4);
    expect(slab.measurements.size[2]).toBeGreaterThan(30);
  });

  it('without a plate, every cut is the two parts it always was, read by its own formulas', () => {
    for (const [, shape] of shapes) {
      for (const [, section] of cuts) {
        const model = generateModel(kernel, specOf(shape, section, undefined));
        expect(model.solids.map((solid) => solid.part)).toEqual([...partsOf(section)]);
        expect(model.name).not.toMatch(/plate/);
        expect(model.section?.plate).toBeUndefined();
        const plain = solidCut(shape, SCALE, cutOfSection(section));
        expect(plain.type).toBe(section.type);
        // With a plate the middle frame and the span the connectors' percentages refer to stay the cut's own.
        const plated = cylinderPlateSection(shape, SCALE, plateCutOf(section));
        expect(plated.baseType).toBe(section.type);
        expect(plated.span).toBe(plain.span);
        expect(plated.frame.u).toEqual(plain.frame.u);
        expect(plated.frame.n).toEqual(plain.frame.n);
        plated.frame.origin.forEach((value, axis) => {
          expect(value).toBeCloseTo(plain.frame.origin[axis] as number, 9);
        });
      }
    }
  });
});

describe('a plate on a cylinder’s cut parallel to the bases', () => {
  it.each(shapes)('%s: the contact faces are the base circle at ±T/2, moved along the lean', (_, shape) => {
    const thickness = 3;
    const model = generateModel(kernel, specOf(shape, CUTS.parallel, plate(thickness, 8)));
    const { radius, height, offset: d } = roundDimensionsMm(shape, SCALE);
    const middle = 0.4 * height;
    const centreAt = (z: number): Vec3 => [(d * z) / height, 0, z];
    for (const [part, z] of [
      ['lower', middle - thickness / 2],
      ['upper', middle + thickness / 2],
    ] as const) {
      const face = vertices(partOf(model, part).mesh).filter((vertex) => Math.abs(vertex[2] - z) <= POSITION_TOLERANCE_MM);
      const centre = centreAt(z);
      const reach = face.map((vertex) => Math.hypot(vertex[0] - centre[0], vertex[1] - centre[1]));
      // The polygon's corners lie on the circle of radius r about the axis at that height.
      expect(Math.max(...reach)).toBeCloseTo(radius, 3);
      expect(Math.min(...reach)).toBeGreaterThan(radius * Math.cos(Math.PI / circularSegments(radius)) - POSITION_TOLERANCE_MM);
    }
    // The plate spans both circles: 2r across the lean, 2r and the lean over T along it, each grown by the margin.
    const geometry = (model.section as ModelSection).plate as SectionPlateGeometry;
    expect(geometry.clippedAtBase).toBe(false);
    expect(geometry.outline.u.max - geometry.outline.u.min).toBeCloseTo(2 * radius + 16, 6);
    expect(geometry.outline.v.max - geometry.outline.v.min).toBeCloseTo(2 * radius + (Math.abs(d) * thickness) / height + 16, 6);
  });
});

describe('a plate on a right cylinder’s vertical cut', () => {
  /** wA and wB at the plate's faces, wMax across the slab: the reference widths of the ideal circle. */
  const ideal = (radius: number, y: number) => 2 * Math.sqrt(radius ** 2 - y ** 2);

  it.each([
    [0, 2],
    [3, 3],
    [30, 2],
    [-60, 4],
  ])(
    '%s %% of r from the axis, T = %s mm: the contact widths and the widest chord across the slab',
    (offsetPercent, thickness) => {
      const shape = cylinder();
      const section: CutSection = { type: 'vertical', offsetPercent };
      const model = generateModel(kernel, specOf(shape, section, plate(thickness, 8)));
      const { radius } = roundDimensionsMm(shape, SCALE);
      const inradius = radius * Math.cos(Math.PI / circularSegments(radius));
      const d = (offsetPercent / 100) * radius;
      const half = thickness / 2;
      const { plane } = model.section as ModelSection;
      // A right cylinder's vertical normal is +Y: part 1 ends at y = d − T/2, part 2 starts at y = d + T/2.
      expect(plane.normal).toEqual([0, 1, 0]);
      const widthAt = (part: SectionPart, y: number) => {
        const xs = vertices(partOf(model, part).mesh)
          .filter((vertex) => Math.abs(vertex[1] - y) <= POSITION_TOLERANCE_MM)
          .map((vertex) => vertex[0]);
        return Math.max(...xs) - Math.min(...xs);
      };
      // The polygon lies between its inscribed circle and the circle of radius r, and so does each chord.
      for (const [part, y] of [
        ['part-1', d - half],
        ['part-2', d + half],
      ] as const) {
        const width = widthAt(part, y);
        expect(width).toBeLessThanOrEqual(ideal(radius, y) + POSITION_TOLERANCE_MM);
        expect(width).toBeGreaterThanOrEqual(ideal(inradius, y) - POSITION_TOLERANCE_MM);
      }
      const geometry = cylinderPlateSection(shape, SCALE, plateCutOf(section, plate(thickness, 8)));
      const nearest = Math.max(Math.abs(d) - half, 0);
      const widest = geometry.slab.v.max - geometry.slab.v.min;
      expect(widest).toBeLessThanOrEqual(ideal(radius, nearest) + 1e-9);
      expect(widest).toBeGreaterThanOrEqual(ideal(inradius, nearest) - 1e-9);
      if (Math.abs(d) <= half) {
        // The slab holds the axis: the polygon's corners on ±X give its full width 2r, wider than either face where d ≠ 0.
        expect(widest).toBeCloseTo(2 * radius, 9);
        if (d !== 0) expect(widest).toBeGreaterThan(Math.max(widthAt('part-1', d - half), widthAt('part-2', d + half)));
      }
      // Different widths at the two faces wherever the cut is off the axis.
      if (d !== 0) expect(Math.abs(widthAt('part-1', d - half) - widthAt('part-2', d + half))).toBeGreaterThan(0.1);
      const built = (model.section as ModelSection).plate as SectionPlateGeometry;
      expect(built.outline.v.max - built.outline.v.min).toBeCloseTo(widest + 16, 9);
    },
  );
});

describe('the plate stops at the plane the cylinder stands on', () => {
  it.each([
    ['an axial vertical cut', cylinder(), CUTS.axial],
    ['a vertical cut of a leaning cylinder', cylinder(1.5, 0.8), CUTS.offset],
    ['an oblique cut through the lower base', cylinder(), CUTS.lowerBase],
    ['a steep oblique cut of a leaning cylinder', cylinder(1.5, 0.8), CUTS.bothBases],
  ] as const)('%s: the whole plate, both faces, at or above the base, its margin kept elsewhere', (_, shape, section) => {
    const margin = 12;
    const model = generateModel(kernel, specOf(shape, section, plate(3, margin)));
    const geometry = (model.section as ModelSection).plate as SectionPlateGeometry;
    const slab = partOf(model, 'plate');
    expect(geometry.clippedAtBase).toBe(true);
    // Every vertex of the full volume, not only the middle outline, at or above z = 0, and the flat cut face on it.
    expect(Math.min(...vertices(slab.mesh).map((vertex) => vertex[2]))).toBeCloseTo(0, 6);
    // Only what lay below the base is gone: the plate still reaches its full margin past the slab upwards.
    const { origin, u } = geometry.frame;
    const along = vertices(slab.mesh).map((vertex) =>
      dot([vertex[0] - origin[0], vertex[1] - origin[1], vertex[2] - origin[2]], u),
    );
    expect(Math.max(...along)).toBeCloseTo(geometry.outline.u.max, 4);
    expect(geometry.outline.u.max).toBeCloseTo(
      cylinderPlateSection(shape, SCALE, plateCutOf(section, plate(3, margin))).slab.u.max + margin,
      9,
    );
    expect(geometry.extent.u.min).toBeGreaterThan(geometry.outline.u.min);
    expect(geometry.extent.u.max).toBeCloseTo(geometry.outline.u.max, 9);
  });

  it('a plate parallel to the bases is never cut, even next to the base', () => {
    const model = generateModel(kernel, specOf(cylinder(), { type: 'parallel-to-bases', positionPercent: 10 }, plate(4, 30)));
    expect(((model.section as ModelSection).plate as SectionPlateGeometry).clippedAtBase).toBe(false);
  });
});

describe('the plate’s thickness on a cylinder', () => {
  it('is limited by how far each part reaches along n, and refused beyond it', () => {
    // r = 10 mm and H = 15 mm; a vertical plane 75 % of r from the axis leaves part 2 about 2,5 mm deep.
    const small = { longestDimensionMm: 20 };
    const shape = cylinder();
    const section: CutSection = { type: 'vertical', offsetPercent: 75 };
    const range = plateThicknessRange(shape, small, { offsetPercent: 75 });
    const reach = cylinderPlateSection(shape, small, { offsetPercent: 75, plate: plate(1.2, 5) }).reach;
    expect(range.max).toBeCloseTo(2 * (Math.min(reach.negative, reach.positive) - 1.2), 9);
    expect(range.max).toBeLessThan(4);
    const spec = (thicknessMm: number) => specOf(shape, section, plate(thicknessMm, 5), undefined, small);
    expect(() => generateModel(kernel, spec(range.max))).not.toThrow();
    expect(() => generateModel(kernel, spec(range.max + 0.05))).toThrow(InvalidModelSpecError);
    const thin = generateModel(kernel, spec(range.max));
    const extent = signedExtent(partOf(thin, 'part-2').mesh, (thin.section as ModelSection).plane);
    expect(extent.max - extent.min).toBeCloseTo(1.2, 4);
  });

  it('near a base parallel to it, each part keeps 1,2 mm', () => {
    const small = { longestDimensionMm: 20 };
    const shape = cylinder(0.4);
    const range = plateThicknessRange(shape, small, 10);
    const { height } = roundDimensionsMm(shape, small);
    expect(range.max).toBeCloseTo(Math.min(4, 2 * (0.1 * height - 1.2)), 9);
  });
});

describe('the twist connector beside a plate', () => {
  const twist = { type: 'twist', sizeMm: 14, holeClearanceMm: 0.5, axialClearanceMm: 0.2 } as const;

  it('stays offered for a right cylinder’s parallel cut without a plate, and nowhere through one', () => {
    expect(twistSupported(cylinder(), 50)).toBe(true);
    expect(twistSupported(cylinder(1.5, 0.8), 50)).toBe(false);
    for (const [, section] of cuts) {
      expect(twistSupported(cylinder(), plateCutOf(section))).toBe(false);
      expect(() => planTwist(cylinder(), SCALE, plateCutOf(section), twist)).toThrow(ConnectorUnsuitableError);
      expect(() => generateModel(kernel, specOf(cylinder(), section, plate(), twist))).toThrow(InvalidModelSpecError);
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

function fitted(shape: CylinderShape, section: CutSection, connector: RoundConnector, withPlate = plate()): RoundConnector {
  const outcome = defaultRoundConnector(shape, SCALE, plateCutOf(section, withPlate), connector);
  if (outcome.status !== 'available') throw new Error(`No ${connector.type} fits: ${JSON.stringify(outcome.issues)}`);
  return outcome.connector as RoundConnector;
}

describe('plugs and dowels through a plate on a cylinder', () => {
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
    const [negative, positive] = partsOf(section);
    expect(plan.plateThickness).toBe(2);
    expect(plan.frame.n).toEqual(plane.normal);
    if (type === 'plug') {
      // T + e from part A's face at −T/2, integral with it; the engagement e alone in part B.
      expect(signedExtent(partOf(model, negative).mesh, plane).max).toBeCloseTo(1 + plan.insertion, 4);
      expect(plugHeight(plan)).toBeCloseTo(plan.insertion + 2, 12);
      expect(plan.holeDepth).toBeCloseTo(plan.insertion + 0.3, 12);
    } else {
      const dowels = model.solids.filter((solid) => solid.part === 'dowel');
      expect(dowels).toHaveLength(count);
      for (const dowel of dowels) {
        const extent = signedExtent(dowel.mesh, plane);
        expect(extent.max - extent.min).toBeCloseTo(dowelLength(plan), 4);
        expect(dowelLength(plan)).toBeCloseTo(2 * plan.insertion + 2, 12);
      }
    }
    withScope((track) => {
      const [first, second, slab] = ([negative, positive, 'plate'] as const).map((part) =>
        manifoldOf(track, partOf(model, part).mesh),
      ) as [Manifold, Manifold, Manifold];
      // Blind holes in the parts, through-holes in the plate, every solid in one piece.
      expect(first.genus()).toBe(0);
      expect(second.genus()).toBe(0);
      expect(slab.genus()).toBe(count);
      for (const solid of [first, second, slab]) expect(solid.decompose().map(track)).toHaveLength(1);
      // Nothing of the parts or the dowels leaves the cylinder; nothing overlaps in the assembled position.
      const whole = manifoldOf(track, wholeOf(shape).mesh);
      const grown = track(whole.scale(1 + 1e-6));
      expect(volumeOf(track, first.subtract(grown))).toBeLessThan(FLOAT32_CONTACT_MM3);
      expect(volumeOf(track, second.subtract(grown))).toBeLessThan(FLOAT32_CONTACT_MM3);
      const dowels = model.solids.filter((solid) => solid.part === 'dowel').map((dowel) => manifoldOf(track, dowel.mesh));
      for (const dowel of dowels) expect(volumeOf(track, dowel.subtract(grown))).toBeLessThan(FLOAT32_CONTACT_MM3);
      const pieces = [first, second, slab, ...dowels];
      pieces.forEach((one, index) => {
        for (const other of pieces.slice(index + 1)) {
          expect(volumeOf(track, one.intersect(other))).toBeLessThan(FLOAT32_CONTACT_MM3);
        }
      });
      // Part B's holes are blind: its exterior surface is the uncut part's, so it keeps every bit of that part's hull.
      const plainB = manifoldOf(track, partOf(generateModel(kernel, specOf(shape, section, plate())), positive).mesh);
      expect(track(second.hull()).volume()).toBeCloseTo(track(plainB.hull()).volume(), 0);
    });
  });

  it('keeps one adjustment when the plate grows, and a feasible one stays as it is', () => {
    const shape = cylinder(1.5, 0.8);
    const section = CUTS.offset;
    const base = fitted(shape, section, roundConnector('dowel', 1, 'circle'));
    const deep = { ...base, depthFactor: base.depthFactor * 3 } as RoundConnector;
    const cut = plateCutOf(section, plate(4, 8));
    const thick = normalizeRoundConnector(shape, SCALE, cut, deep);
    if (thick.status !== 'available') throw new Error('expected a connector');
    expect(thick.adjusted).toBe(true);
    const sectionWithPlate = solidCut(shape, SCALE, cut);
    const dimensions = roundConnectorDimensions(thick.connector as RoundConnector, 80, sectionWithPlate.span / 2);
    expect(roundConnectorChecks(sectionWithPlate, dimensions).every(satisfies)).toBe(true);
    expect(normalizeRoundConnector(shape, SCALE, cut, thick.connector as RoundConnector)).toMatchObject({
      status: 'available',
      adjusted: false,
    });
    expect(normalizeRoundConnector(shape, SCALE, plateCutOf(section), base)).toMatchObject({
      status: 'available',
      adjusted: false,
    });
  });
});

describe('a dovetail on both faces of a plate on a cylinder', () => {
  const dovetail = (entrance: 'standard' | 'opposite'): DovetailConnector => ({
    type: 'dovetail',
    sizeFactor: 0.8,
    lengthPercent: 35,
    clearanceMm: 0.2,
    entrance,
  });
  const dovetailCases = [
    ...cuts.map(([name, section]) => [`${name} of a right cylinder`, cylinder(), section] as const),
    ['an offset vertical cut of a leaning cylinder', cylinder(1.5, 0.8), CUTS.offset] as const,
    ['an oblique cut through both bases of a leaning cylinder', cylinder(1.5, 0.8), CUTS.bothBases] as const,
  ].flatMap(([name, shape, section]) =>
    (['standard', 'opposite'] as const).map((entrance) => [name, shape, section, entrance] as const),
  );

  it.each(dovetailCases)(
    '%s, %s entrance: a tongue on each face, both grooves open at that end',
    (_, shape, section, entrance) => {
      const model = generateModel(kernel, specOf(shape, section, plate(), dovetail(entrance)));
      const plain = generateModel(kernel, specOf(shape, section, plate()));
      const { plane } = model.section as ModelSection;
      const plan = (model.section as ModelSection).connector as DovetailPlan;
      const [negative, positive] = partsOf(section);
      const interfaces = plan.interfaces ?? [];
      expect(interfaces.map((face) => face.part)).toEqual(['lower', 'upper']);
      // The entrance d lies at the chosen end of the plate-free cut's slide axis; u = −d in both interfaces, whichever way
      // their n points, so the flipped lower face does not turn the entrance over.
      const d = dovetailEntranceDirection(solidCut(shape, SCALE, cutOfSection(section)), entrance);
      for (const face of interfaces) {
        face.frame.u.forEach((value, axis) => {
          expect(value).toBeCloseTo(-(d[axis] as number), 12);
        });
        expect(dot(face.frame.n, plane.normal)).toBeCloseTo(face.part === 'upper' ? 1 : -1, 12);
      }
      if (section.type === 'vertical' || section.type === 'oblique') {
        expect(Math.sign(d[2])).toBe(entrance === 'standard' ? 1 : -1);
      } else {
        // Horizontal: −u of the cut's own frame, +Y for every cylinder, for the standard entrance.
        expect(d[1]).toBeCloseTo(entrance === 'standard' ? -1 : 1, 12);
      }
      // The tongues stand on the plate's faces, h beyond them along n; the grooves are cut into both parts.
      const slab = signedExtent(partOf(model, 'plate').mesh, plane);
      expect(slab.min).toBeCloseTo(-1 - plan.height, 4);
      expect(slab.max).toBeCloseTo(1 + plan.height, 4);
      expect(partOf(model, negative).measurements.volume).toBeLessThan(partOf(plain, negative).measurements.volume);
      expect(partOf(model, positive).measurements.volume).toBeLessThan(partOf(plain, positive).measurements.volume);
      expect(partOf(model, 'plate').measurements.bounds.min[2]).toBeGreaterThanOrEqual(-POSITION_TOLERANCE_MM);
      withScope((track) => {
        const [first, second, slabSolid] = ([negative, positive, 'plate'] as const).map((part) =>
          manifoldOf(track, partOf(model, part).mesh),
        ) as [Manifold, Manifold, Manifold];
        expect(slabSolid.decompose().map(track)).toHaveLength(1);
        expect(first.decompose().map(track)).toHaveLength(1);
        expect(second.decompose().map(track)).toHaveLength(1);
        // Both tongues lie inside the cylinder in the assembled position: the plate outside it is the plain plate's.
        const whole = track(manifoldOf(track, wholeOf(shape).mesh).scale(1 + 1e-6));
        const outside = (solid: Manifold) => volumeOf(track, solid.subtract(whole));
        const plainPlate = manifoldOf(track, partOf(plain, 'plate').mesh);
        expect(outside(slabSolid)).toBeCloseTo(outside(plainPlate), 1);
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
          // Seated, the undercut holds the part against the plate, and the stop against the slide the other way.
          expect(volumeOf(track, moved(part, n, plan.normalPlay + 0.05).intersect(slabSolid))).toBeGreaterThan(tolerance);
          expect(volumeOf(track, moved(part, u, -(plan.clearance + 0.05)).intersect(slabSolid))).toBeGreaterThan(tolerance);
        }
      });
    },
  );
});

describe('preview, files and settings of a plate on a cylinder', () => {
  it('moves the parts apart along n around the plate, and exports the parts, the plate and the dowels', async () => {
    const shape = cylinder(1.5, 0.8);
    const section = CUTS.lowerBase;
    const connector = fitted(shape, section, roundConnector('dowel', 2, 'flatted-circle'));
    const artifacts = await buildModelArtifacts(kernel, specOf(shape, section, plate(2.4, 10), connector));
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
    for (const dowel of model.solids.filter((solid) => solid.part === 'dowel')) {
      expect(signedExtent(dowel.mesh, plane).max + alongN(dowel.name)).toBeLessThan(slab.min);
    }
    const part2 = offsets[partOf(model, 'part-2').name] as [number, number, number];
    const expected = toGltfPosition([plane.normal[0], plane.normal[1], plane.normal[2]]).map(
      (value) => value * alongN(partOf(model, 'part-2').name),
    );
    part2.forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[axis] as number, 9);
    });
    // The assembled preview shows the same solids where they were built.
    const assembled = (await new WebIO().readBinary(artifacts.previewGlb)).getRoot();
    for (const node of assembled.listNodes()) expect(node.getTranslation()).toEqual([0, 0, 0]);
    // The print file: the parts, the plate and the dowels, each with its own volume; the plate lies flat, T high.
    const file = readThreeMf(artifacts.printFile.bytes);
    expect(artifacts.printFile.fileName).toBe('cylinder-oblique-section-plate.3mf');
    expect(file.model.objects.map((object) => object.name)).toEqual([
      'cylinder-part-1',
      'cylinder-part-2',
      'cylinder-section-plate',
      'cylinder-dowel-1',
      'cylinder-dowel-2',
    ]);
    file.model.objects.forEach((object, index) => {
      expect(measureMesh(object.mesh).volume).toBeCloseTo((model.solids[index] as Solid).measurements.volume, 1);
      expect(findMeshDefects(object.mesh)).toEqual([]);
    });
    const printed = file.model.objects.find((object) => object.name === 'cylinder-section-plate') as { mesh: TriangleMesh };
    expect(measureMesh(printed.mesh).size[2]).toBeCloseTo(2.4, 4);
    // The dowels alone: the assembly's own, T included in their length.
    const plan = (model.section as ModelSection).connector as RoundConnectorPlan;
    const pins = readThreeMf(artifacts.pinsFile?.bytes as Uint8Array).model.objects;
    expect(pins.map((object) => object.name)).toEqual(['cylinder-dowel-1', 'cylinder-dowel-2']);
    for (const pin of pins) expect(measureMesh(pin.mesh).size[2]).toBeCloseTo(dowelLength(plan), 4);
    expect(artifacts.pinsFile?.fileName).toMatch(new RegExp(`-L${Number(dowelLength(plan).toFixed(3))}mm\\.3mf$`));
    const pinsJson = JSON.parse(readThreeMfPart(artifacts.pinsFile?.bytes as Uint8Array, MODEL_SETTINGS_PATH) as string);
    expect(pinsJson.exportedParts.pins[0].lengthMm).toBe(dowelLength(plan));
  });

  it('prints a plate with tongues on its edge, and the parts of a parallel cut with their grooves up', async () => {
    const artifacts = await buildModelArtifacts(
      kernel,
      specOf(cylinder(), CUTS.parallel, plate(), { type: 'dovetail', sizeFactor: 0.8, lengthPercent: 35, clearanceMm: 0.2 }),
    );
    const objects = readThreeMf(artifacts.printFile.bytes).model.objects;
    expect(objects.map((object) => object.name)).toEqual([
      'cylinder-lower-part',
      'cylinder-upper-part',
      'cylinder-section-plate',
    ]);
    const geometry = (artifacts.model.section as ModelSection).plate as SectionPlateGeometry;
    const standing = objects[2] as { mesh: TriangleMesh };
    expect(measureMesh(standing.mesh).size[2]).toBeCloseTo(geometry.extent.u.max - geometry.extent.u.min, 3);
    // Both parts stand on a base, H·40 % and H·60 % − T/2 high: neither rests on its grooved face.
    const { height } = roundDimensionsMm(cylinder(), SCALE);
    expect(measureMesh((objects[0] as { mesh: TriangleMesh }).mesh).size[2]).toBeCloseTo(0.4 * height - 1, 3);
    expect(measureMesh((objects[1] as { mesh: TriangleMesh }).mesh).size[2]).toBeCloseTo(0.6 * height - 1, 3);
  });

  it('the settings record the cylinder, the cut with its plate, the plate’s outline as built and the connector', async () => {
    const shape = cylinder(1.5, 0.8);
    const section = CUTS.axial;
    const connector = fitted(shape, section, roundConnector('plug', 1, 'circle'), plate(2.4, 6));
    const artifacts = await buildModelArtifacts(kernel, specOf(shape, section, plate(2.4, 6), connector));
    const json = JSON.parse(readThreeMfPart(artifacts.printFile.bytes, MODEL_SETTINGS_PATH) as string);
    expect(json.sourceModel.shape).toMatchObject({ kind: 'cylinder', heightRatio: 1.5, offsetRatio: 0.8 });
    expect(json.sourceModel.section).toMatchObject({
      type: 'vertical',
      offsetPercent: 0,
      plate: { thicknessMm: 2.4, marginMm: 6 },
    });
    const geometry = (artifacts.model.section as ModelSection).plate as SectionPlateGeometry;
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
