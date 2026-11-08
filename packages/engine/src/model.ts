import {
  type ModelSpec,
  type ModelSpecInput,
  modelSpecSchema,
  type PhysicalScale,
  type SectionType,
  type Shape,
  type ShapeKind,
} from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { buildDovetail, type DovetailPlan, planDovetail, verifyDovetail } from './connectors/dovetail.ts';
import {
  CONSTRAINT_ROUNDOFF_MM,
  cutOfSection,
  obliqueCylinderSection,
  obliqueSplitReach,
  satisfies,
  sectionOffsetMm,
  verticalCylinderSection,
  verticalOffsetLimitMm,
} from './connectors/frame.ts';
import { buildRoundConnectors, planRoundConnectors, type RoundConnectorPlan, verifyRoundConnectors } from './connectors/round.ts';
import { ConnectorUnsuitableError, GeometryError, InfeasibleGeometryError, InvalidModelSpecError } from './errors.ts';
import type { GeometryKernel } from './kernel.ts';
import {
  assertValidSolidMesh,
  type Bounds,
  type MeshMeasurements,
  measureMesh,
  meshFromManifold,
  meshWithNewFaces,
  originalIdsOf,
  subtract,
  type TriangleMesh,
  type Vec3,
} from './mesh.ts';
import { type Track, withScope } from './scope.ts';
import { type Plane, sectionPlane, splitByPlane } from './section.ts';
import { buildBall } from './shapes/ball.ts';
import { buildUnitBox } from './shapes/box.ts';
import { checkNumericalFeasibility } from './shapes/feasibility.ts';
import { buildParallelepiped } from './shapes/parallelepiped.ts';
import { buildPrismShape } from './shapes/prism.ts';
import { buildPyramidShape } from './shapes/pyramid.ts';
import { buildRegularPolyhedron } from './shapes/regular-polyhedron.ts';
import { buildRoundSolid, roundDimensionsMm, roundShear } from './shapes/round.ts';

export interface Solid {
  /** ASCII identifier, also used as the object name in exported files. */
  readonly name: string;
  readonly mesh: TriangleMesh;
  readonly measurements: MeshMeasurements;
  /** Display hint: the solid approximates curved surfaces, which the preview shades smoothly. */
  readonly smoothShading: boolean;
  /**
   * Display hint for a smooth solid made by shearing a right one, x' = x + kx·z, y' = y + ky·z: the preview smooths
   * its normals on the right solid and maps them through the shear. Absent for solids that were not sheared.
   */
  readonly smoothingShear?: readonly [number, number];
  /**
   * Which part of a sectioned solid this is: below or above a plane parallel to the bases, on the negative (1) or
   * positive (2) side of the normal of a vertical or oblique plane, or a separate removable dowel.
   */
  readonly part?: SectionPart;
  /**
   * For a part: 1 per triangle that the cut or a connector made, 0 where the solid's original surface remains. The
   * preview shows these faces apart from the exterior.
   */
  readonly newFaces?: Uint8Array;
}

export type SectionPart = 'lower' | 'upper' | 'part-1' | 'part-2' | 'dowel';

export type ConnectorPlan = DovetailPlan | RoundConnectorPlan;

export interface ModelSection {
  readonly type: SectionType;
  /** The cutting plane in the model's millimetres; the upper part or part 2 lies on the side its normal points to. */
  readonly plane: Plane;
  /** The connector joining the parts, with the frame it is built in; absent for flat cut faces. */
  readonly connector?: ConnectorPlan;
}

export interface GeneratedModel {
  readonly kind: ShapeKind;
  /** ASCII identifier of the model, used for file names and the names of its solids. */
  readonly name: string;
  readonly spec: ModelSpec;
  /**
   * The whole solid, or its parts in the order of the plane's negative and positive side, followed by any removable
   * dowels, all in the assembled position.
   */
  readonly solids: readonly Solid[];
  /** The bounds of the assembled model: of the whole solid, also when it is sectioned. */
  readonly bounds: Bounds;
  readonly size: Vec3;
  readonly section?: ModelSection;
}

type BuiltMeshes =
  | { readonly whole: TriangleMesh }
  | {
      readonly type: SectionType;
      readonly plane: Plane;
      readonly parts: Readonly<Record<'lower' | 'upper', MarkedMesh>>;
      readonly dowels: readonly MarkedMesh[];
    };

type MarkedMesh = { readonly mesh: TriangleMesh; readonly newFaces: Uint8Array };

/** Completes the model name of a sectioned solid, e.g. "cylinder-parallel-section". */
const sectionNames: Readonly<Record<SectionType, string>> = {
  'parallel-to-bases': 'parallel-section',
  vertical: 'vertical-section',
  oblique: 'oblique-section',
};

/** The names of a section's parts in the order of the plane's negative and positive side, and their object names. */
const partNames: Readonly<Record<SectionType, readonly [SectionPart, SectionPart]>> = {
  'parallel-to-bases': ['lower', 'upper'],
  vertical: ['part-1', 'part-2'],
  oblique: ['part-1', 'part-2'],
};
const partObjectName = (name: string, part: SectionPart): string =>
  part === 'lower' || part === 'upper' ? `${name}-${part}-part` : `${name}-${part}`;

/**
 * Validates the specification, filling in defaults, checks that the solid can be represented reliably, and builds it in
 * millimetres with one uniform scale. A section splits that solid, already at its physical size, so both parts keep
 * the scale of the whole and their cut faces coincide. A connector is planned and checked before anything is built,
 * then built in millimetres on the parts and verified on them in three dimensions.
 */
export function generateModel(kernel: GeometryKernel, input: ModelSpecInput): GeneratedModel {
  const parsed = modelSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidModelSpecError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  const spec = parsed.data;
  const feasibility = checkNumericalFeasibility(spec.shape);
  if (!feasibility.feasible) throw new InfeasibleGeometryError(feasibility.relativeRounding);

  assertVerticalOffset(spec);
  assertObliqueSplit(spec);
  const connector = planConnector(spec);
  const built = withScope((track): BuiltMeshes => {
    const solid = checked(buildShape(kernel, track, spec.shape, spec.scale));
    if (spec.section === undefined) return { whole: meshFromManifold(solid) };
    const originalIds = originalIdsOf(solid);
    const plane = spec.section.type === 'parallel-to-bases' ? sectionPlane(spec.section, solid.boundingBox()) : cutPlaneOf(spec);
    const split = splitByPlane(track, solid, plane);
    let parts = { lower: split.negative, upper: split.positive };
    let dowels: readonly Manifold[] = [];
    const longest = spec.scale.longestDimensionMm;
    if (connector?.type === 'dovetail') {
      const joined = buildDovetail(kernel, track, parts, connector);
      verifyDovetail(kernel, track, { whole: solid, upper: parts.upper }, joined, connector, longest);
      parts = { lower: checked(joined.lower), upper: checked(joined.upper) };
    } else if (connector !== undefined) {
      const joined = buildRoundConnectors(kernel, track, parts, connector);
      verifyRoundConnectors(kernel, track, solid, joined, connector, longest);
      parts = { lower: checked(joined.lower), upper: checked(joined.upper) };
      dowels = joined.pins.map(checked);
    }
    return {
      type: spec.section.type,
      plane,
      parts: { lower: meshWithNewFaces(parts.lower, originalIds), upper: meshWithNewFaces(parts.upper, originalIds) },
      dowels: dowels.map((dowel) => meshWithNewFaces(dowel, originalIds)),
    };
  });

  const name = modelName(spec.shape);
  const { shape } = spec;
  const round = shape.kind === 'cylinder' || shape.kind === 'cone';
  const solidOf = (solidName: string, mesh: TriangleMesh): Solid => {
    assertValidSolidMesh(mesh);
    return {
      name: solidName,
      mesh,
      measurements: measureMesh(mesh),
      smoothShading: round || shape.kind === 'ball',
      ...(round && shape.offsetRatio !== 0 ? { smoothingShear: roundShear(shape) } : {}),
    };
  };
  if ('whole' in built) {
    const solid = solidOf(name, built.whole);
    const { bounds, size } = solid.measurements;
    return { kind: shape.kind, name, spec, solids: [solid], bounds, size };
  }
  const parts = (['lower', 'upper'] as const).map((side, index): Solid => {
    const part = partNames[built.type][index] as SectionPart;
    return { ...solidOf(partObjectName(name, part), built.parts[side].mesh), part, newFaces: built.parts[side].newFaces };
  });
  const bounds = unionBounds(parts.map((part) => part.measurements.bounds));
  // Curved but never sheared: a dowel lies along the cut's normal however the cylinder leans.
  const dowels = built.dowels.map(({ mesh, newFaces }, index): Solid => {
    assertValidSolidMesh(mesh);
    return {
      name: `${name}-dowel-${index + 1}`,
      mesh,
      measurements: measureMesh(mesh),
      smoothShading: true,
      part: 'dowel',
      newFaces,
    };
  });
  return {
    kind: shape.kind,
    name: `${name}-${sectionNames[built.type]}`,
    spec,
    solids: [...parts, ...dowels],
    bounds,
    size: subtract(bounds.max, bounds.min),
    section: { type: built.type, plane: built.plane, ...(connector === undefined ? {} : { connector }) },
  };
}

/** The plane of a vertical or oblique section, which only a cylinder offers. */
function cutPlaneOf({ shape, scale, section }: ModelSpec): Plane {
  if (shape.kind !== 'cylinder') throw new GeometryError('Expected a cut of a cylinder.');
  if (section?.type === 'vertical') return verticalCylinderSection(shape, scale, section.offsetPercent).plane;
  if (section?.type === 'oblique') return obliqueCylinderSection(shape, scale, section).plane;
  throw new GeometryError('Expected a vertical or oblique cut.');
}

/** A vertical plane within the distance from the axis that leaves both parts usable; see `verticalOffsetLimitMm`. */
function assertVerticalOffset({ shape, scale, section }: ModelSpec): void {
  if (section?.type !== 'vertical' || shape.kind !== 'cylinder') return;
  const offset = sectionOffsetMm(section.offsetPercent, roundDimensionsMm(shape, scale).radius);
  const limit = verticalOffsetLimitMm(shape, scale);
  if (Math.abs(offset) > limit + CONSTRAINT_ROUNDOFF_MM) {
    throw new InvalidModelSpecError([
      `section.offsetPercent: ${offset} mm is beyond the ${limit} mm that leave two usable parts.`,
    ]);
  }
}

/** Both parts of an oblique cut keep a usable thickness: a body that cannot be split, whatever the connector. */
function assertObliqueSplit({ shape, scale, section }: ModelSpec): void {
  if (section?.type !== 'oblique' || shape.kind !== 'cylinder') return;
  const reach = obliqueSplitReach(shape, scale, section);
  if (!satisfies(reach)) {
    throw new InvalidModelSpecError([
      `section: the thinner part reaches ${reach.valueMm} mm from the plane, less than the ${reach.minimumMm} mm of a usable part.`,
    ]);
  }
}

/** The connector's plan; refuses the specification before any geometry is built when the connector does not fit. */
function planConnector({ shape, scale, section }: ModelSpec): ConnectorPlan | undefined {
  if (section?.connector === undefined) return undefined;
  if (shape.kind !== 'cylinder' && shape.kind !== 'cone') throw new ConnectorUnsuitableError([{ code: 'unsupported-shape' }]);
  const { connector } = section;
  const cut = cutOfSection(section);
  const plan =
    connector.type === 'dovetail'
      ? planDovetail(shape, scale, cut, connector)
      : planRoundConnectors(shape, scale, cut, connector);
  if (plan.issues.length > 0) throw new ConnectorUnsuitableError(plan.issues);
  return plan;
}

function checked(solid: Manifold): Manifold {
  const status = solid.status();
  if (status !== 'NoError' || solid.isEmpty()) {
    throw new GeometryError(`Geometry kernel produced no solid (${status}).`);
  }
  return solid;
}

/** The parts of a sectioned solid fill it exactly, so their bounds together are those of the whole. */
function unionBounds(boxes: readonly Bounds[]): Bounds {
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const box of boxes) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max };
}

/**
 * The shape kind, with the number of sides of a regular base for prisms and pyramids, e.g. "prism-6-sided", or the base
 * type otherwise, e.g. "prism-triangle" or "prism-trapezoid".
 */
export function modelName(shape: Shape): string {
  if ((shape.kind === 'prism' || shape.kind === 'pyramid') && shape.baseType !== 'regular') {
    return `${shape.kind}-${shape.baseType}`;
  }
  return shape.kind === 'prism' || shape.kind === 'pyramid' ? `${shape.kind}-${shape.baseSides}-sided` : shape.kind;
}

/**
 * The solid in millimetres: boxes are built in model units and scaled once; prisms and pyramids are scaled once after
 * their complete unnormalised construction, including a displaced upper base or apex; curved solids are built at size,
 * and regular polyhedra as the convex hull of their vertices in millimetres.
 */
function buildShape(kernel: GeometryKernel, track: Track, shape: Shape, scale: PhysicalScale): Manifold {
  const toMillimetres = (unitSolid: Manifold) => track(unitSolid.scale(scale.longestDimensionMm));
  switch (shape.kind) {
    case 'cube':
    case 'cuboid':
      return toMillimetres(buildUnitBox(kernel, track, shape));
    case 'parallelepiped':
      return buildParallelepiped(kernel, track, shape, scale);
    case 'prism':
      return buildPrismShape(kernel, track, shape, scale);
    case 'pyramid':
    case 'tetrahedron':
      return buildPyramidShape(kernel, track, shape, scale);
    case 'cylinder':
    case 'cone':
      return buildRoundSolid(kernel, track, shape, scale);
    case 'octahedron':
    case 'icosahedron':
    case 'dodecahedron':
      return buildRegularPolyhedron(kernel, track, shape.kind, scale);
    case 'ball':
      return buildBall(kernel, track, scale);
  }
}
