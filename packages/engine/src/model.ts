import {
  type ModelSpec,
  type ModelSpecInput,
  modelSpecSchema,
  type PhysicalScale,
  type Shape,
  type ShapeKind,
} from '@diploma-3d/schema';
import type { Manifold } from 'manifold-3d';
import { GeometryError, InvalidModelSpecError } from './errors.ts';
import type { GeometryKernel } from './kernel.ts';
import { assertValidSolidMesh, type MeshMeasurements, measureMesh, meshFromManifold, type TriangleMesh } from './mesh.ts';
import { type Track, withScope } from './scope.ts';
import { buildBall } from './shapes/ball.ts';
import { buildUnitBox } from './shapes/box.ts';
import { buildParallelepiped } from './shapes/parallelepiped.ts';
import { buildPrismShape } from './shapes/prism.ts';
import { buildPyramidShape } from './shapes/pyramid.ts';
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
}

export interface GeneratedModel {
  readonly kind: ShapeKind;
  /** ASCII identifier of the model, used for file names and the names of its solids. */
  readonly name: string;
  readonly spec: ModelSpec;
  readonly solids: readonly Solid[];
}

/** Validates the specification, filling in defaults, and builds the shape in millimetres with one uniform scale. */
export function generateModel(kernel: GeometryKernel, input: ModelSpecInput): GeneratedModel {
  const parsed = modelSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidModelSpecError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
  }
  const spec = parsed.data;

  const mesh = withScope((track) => {
    const solid = buildShape(kernel, track, spec.shape, spec.scale);
    const status = solid.status();
    if (status !== 'NoError' || solid.isEmpty()) {
      throw new GeometryError(`Geometry kernel produced no solid (${status}).`);
    }
    return meshFromManifold(solid);
  });
  assertValidSolidMesh(mesh);

  const name = modelName(spec.shape);
  const { shape } = spec;
  const round = shape.kind === 'cylinder' || shape.kind === 'cone';
  const solid: Solid = {
    name,
    mesh,
    measurements: measureMesh(mesh),
    smoothShading: round || shape.kind === 'ball',
    ...(round && shape.offsetRatio !== 0 ? { smoothingShear: roundShear(shape) } : {}),
  };
  return { kind: shape.kind, name, spec, solids: [solid] };
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
 * their complete unnormalised construction, including a displaced upper base or apex; curved solids are built at size.
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
    case 'ball':
      return buildBall(kernel, track, scale);
  }
}
