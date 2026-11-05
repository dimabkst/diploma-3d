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
import { GeometryError, InfeasibleGeometryError, InvalidModelSpecError } from './errors.ts';
import type { GeometryKernel } from './kernel.ts';
import {
  assertValidSolidMesh,
  type Bounds,
  type MeshMeasurements,
  measureMesh,
  meshFromManifold,
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
import { buildRoundSolid, roundShear } from './shapes/round.ts';

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
  /** Which part of a sectioned solid this is: below the cutting plane or above it, on the side of its normal. */
  readonly part?: SectionPart;
}

export type SectionPart = 'lower' | 'upper';

export interface ModelSection {
  /** The cutting plane in the model's millimetres; the upper part lies on the side its normal points to. */
  readonly plane: Plane;
}

export interface GeneratedModel {
  readonly kind: ShapeKind;
  /** ASCII identifier of the model, used for file names and the names of its solids. */
  readonly name: string;
  readonly spec: ModelSpec;
  /** The whole solid, or its lower and upper part in this order, all in the assembled position. */
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
      readonly parts: Readonly<Record<SectionPart, TriangleMesh>>;
    };

/** Completes the model name of a sectioned solid, e.g. "cylinder-parallel-section". */
const sectionNames: Readonly<Record<SectionType, string>> = { 'parallel-to-bases': 'parallel-section' };

/**
 * Validates the specification, filling in defaults, checks that the solid can be represented reliably, and builds it in
 * millimetres with one uniform scale. A section splits that solid, already at its physical size, so both parts keep
 * the scale of the whole and their cut faces coincide.
 */
export function generateModel(kernel: GeometryKernel, input: ModelSpecInput): GeneratedModel {
  const parsed = modelSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidModelSpecError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  const spec = parsed.data;
  const feasibility = checkNumericalFeasibility(spec.shape);
  if (!feasibility.feasible) throw new InfeasibleGeometryError(feasibility.relativeRounding);

  const built = withScope((track): BuiltMeshes => {
    const solid = checked(buildShape(kernel, track, spec.shape, spec.scale));
    if (spec.section === undefined) return { whole: meshFromManifold(solid) };
    const plane = sectionPlane(spec.section, solid.boundingBox());
    const { positive: upper, negative: lower } = splitByPlane(track, solid, plane);
    const parts = { lower: meshFromManifold(lower), upper: meshFromManifold(upper) };
    return { type: spec.section.type, plane, parts };
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
  const parts = (['lower', 'upper'] as const).map(
    (part): Solid => ({ ...solidOf(`${name}-${part}-part`, built.parts[part]), part }),
  );
  const bounds = unionBounds(parts.map((part) => part.measurements.bounds));
  return {
    kind: shape.kind,
    name: `${name}-${sectionNames[built.type]}`,
    spec,
    solids: parts,
    bounds,
    size: subtract(bounds.max, bounds.min),
    section: { plane: built.plane },
  };
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
